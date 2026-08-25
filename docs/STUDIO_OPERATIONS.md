# Studio CMS operations

These procedures apply to one isolated, single-site customer installation. They do not authorize a
production backup, restore, cloud write, database mutation, or retention deletion. First substitute
customer-specific values outside Git, review the generated plan, and obtain explicit operational
approval.

## Customer content export

The export is a portable JSON handoff of customer-owned CMS content. It contains the selected Site
Package identity, current settings, page drafts, collection drafts, menus, active redirects, and a
public media manifest. It does not serialize database rows wholesale. Password hashes, session and
reset-token hashes, builder/storage secrets, private object keys, signed/source URLs, audit
diagnostics, and storage credentials are excluded. The media manifest contains the stable public
path and stored content hash only; media bytes are delivered separately from the customer's backup
or publication destination. Credential-bearing URL values are removed even when stored under an
otherwise ordinary field such as `url`, `href`, or `downloadUrl`; ordinary public HTTP(S) links
without authority-bearing query or fragment parameters remain exportable. Matching is structural:
recognized exact parameter names (including reset, password, access-key, and signed-provider
parameters) must carry a value. Parameter names and values are not substring-matched, so benign
vocabulary such as `tokenization` and `credentialing` remains exportable.

Run with the isolated installation's read-capable runtime database URL and an explicit output file:

```powershell
$env:DATABASE_URL = '<isolated customer runtime database URL>'
bun backend/scripts/export-cms-data.ts --output D:\approved-export\client-auto.json
Remove-Item Env:DATABASE_URL
```

The command refuses an existing file unless `--replace` is explicit, writes mode `0600` on POSIX
hosts, and prints the output path, byte size, and whole-file SHA-256. The JSON also carries a
`metadata.contentSha256` over its content envelope; consumers should validate it before import or
handoff. Windows does not expose POSIX permission bits, so place the file in an ACL-restricted
directory and review its ACL separately. Never commit exports.

## Encrypted off-host backup

Backups require PostgreSQL client tools, `age`, `rclone`, and an S3-compatible AWS CLI. Use a
dedicated external backup bucket and credential, different from the private working-media bucket
and public publication destination. Its declared scope must be exactly:

```text
bucket:<customer-backup-bucket>/<installation-slug>/*
```

Add these values only to the ignored customer environment file:

```text
STUDIO_BACKUP_ENDPOINT=https://backup-provider.example
STUDIO_BACKUP_REGION=<region>
STUDIO_BACKUP_BUCKET=<slug>-external-backups
STUDIO_BACKUP_ACCESS_KEY_ID=<bucket-scoped key>
STUDIO_BACKUP_SECRET_ACCESS_KEY=<bucket-scoped secret>
STUDIO_BACKUP_S3_SCOPE=bucket:<slug>-external-backups/<slug>/*
STUDIO_BACKUP_AGE_RECIPIENT=<offline-held age public recipient>
STUDIO_BACKUP_RCLONE_CRYPT_PASSWORD=<rclone-obscured crypt password>
STUDIO_BACKUP_RETENTION_DAYS=35
```

The same file already supplies `INSTALLATION_SLUG`, `DATABASE_ADMIN_URL`,
`CMS_SITE_PACKAGE_ID`, and the scoped `PRIVATE_STORAGE_*` values. The age identity and rclone crypt
password recovery material must be kept in the studio secret manager and an offline recovery copy;
do not store them beside the backup objects.

Generate a non-mutating, credential-free command plan first:

```powershell
bun scripts/studio-backup.mjs plan --env deploy/studio/client-auto.env
```

The plan uses PostgreSQL `PG*` environment variables instead of placing or printing the database
URL. An approved execution requires both gates:

```powershell
bun scripts/studio-backup.mjs backup --env deploy/studio/client-auto.env --execute --confirm=backup:client-auto
```

Execution dumps only the configured database, encrypts the dump with `age`, copies customer media
through an encrypted `rclone crypt` remote, uploads the encrypted archive plus JSON metadata, and
removes only its validated per-run temporary directory. Metadata records installation/package ID,
UTC time, encrypted archive name, SHA-256, byte size, and retention days. Failed uploads do not
turn incomplete data into a success record.

Retention is enforced by a provider lifecycle rule limited to the exact customer prefix. Compare
the provider rule with `STUDIO_BACKUP_RETENTION_DAYS`; never use an account-wide expiration rule.
The script's retention selector rejects objects outside `<installation-slug>/`, so an operator can
review an inventory before any separately approved provider deletion. Retain enough generations to
cover detection delay and verify legal/customer terms before changing the number of days.

## Restore verification

Restore tests use a disposable database named exactly
`vibe_<installation-slug-with-underscores>_restore_test`. The planner rejects the live database,
near-match names, and another installation's `_restore_test` database:

```powershell
$env:STUDIO_BACKUP_AGE_IDENTITY_FILE = 'D:\secrets\client-auto.agekey'
bun scripts/studio-backup.mjs restore-plan --env deploy/studio/client-auto.env --archive D:\approved-backup\client-auto.dump.age
```

The verification sequence creates that exact disposable database, decrypts into a validated
temporary directory, restores with owner/ACL replay disabled, checks the selected package row, and
drops only that exact database after successful validation. On failure it removes only decrypted
temporary files and deliberately leaves the test database for inspection; cleanup must reuse the
same exact-name validation. Never point restore verification at a production or shared database.

After reviewing the plan, an approved rehearsal has its own exact confirmation gate:

```powershell
bun scripts/studio-backup.mjs restore-verify --env deploy/studio/client-auto.env --archive D:\approved-backup\client-auto.dump.age --execute --confirm=restore-verify:client-auto
Remove-Item Env:STUDIO_BACKUP_AGE_IDENTITY_FILE
```

Before onboarding production, run one approved restore rehearsal against fake or specifically
authorized installation data, record elapsed time and the package-state result, and verify the
restored application with its storage credentials disabled. Task 12 validation did not perform a
database restore.

## Capacity evidence

The capacity smoke is intentionally local and fake. It queues three serialized fake publish jobs,
writes bounded temporary artifacts to the local temp directory, samples process RSS, and records
build duration, queue wait, and aggregate temporary disk bytes for every artifact that coexists in
the workspace. It never calls the CMS API, customer storage, the builder queue, or a cloud endpoint.

```powershell
bun scripts/studio-capacity-smoke.mjs --dry-run
```

Reports are mode `0600` on POSIX and written under ignored `.scratch/studio-capacity/`. Override
the evidence ceilings only with reviewed byte values:

```powershell
bun scripts/studio-capacity-smoke.mjs --dry-run --memory-ceiling-bytes=1073741824 --disk-ceiling-bytes=67108864
```

The command exits non-zero when either ceiling is exceeded. A three-request synthetic smoke is a
regression signal, not a sizing guarantee: the report intentionally contains no customer/client
count. Production capacity decisions still require representative containers, database load,
publication artifacts, simultaneous requests, host monitoring, and repeated measurements.

## Operational review checklist

- Confirm the env file names one installation and all database/bucket prefixes contain that slug.
- Confirm backup and media credentials cannot access another bucket or delete the bucket itself.
- Confirm database URLs, secret keys, decrypted dumps, and expanded Compose config are absent from
  logs and artifacts.
- Confirm database archive and media objects are encrypted, checksums are recorded, and keys are
  recoverable independently of the VDS.
- Confirm a recent isolated restore rehearsal succeeded before treating backups as recoverable.
- Confirm lifecycle, Docker image/log, temporary-file, and report retention are bounded.
- Treat capacity reports as measured evidence only; do not turn them into a fixed site-count claim.
