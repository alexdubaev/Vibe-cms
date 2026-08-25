# Isolated studio customer profile

This directory describes one CMS installation on a shared studio VDS. Each customer gets a
separate Compose project, customer bridge network, PostgreSQL database and runtime role, private
working-media bucket, public publication bucket, immutable image set, and three loopback ingress
ports. Only the external PostgreSQL network and VDS-wide Astro lock volume are shared.

The stack runs the backend API, scheduler, static admin webapp, protected preview runtime, and one
Site-Package-specific builder. It does **not** serve the public website or published media. The
builder writes immutable output to the customer's public S3-compatible destination, and that
destination/CDN remains the public site's serving layer.

## Customer configuration contract

Create an uncommitted `deploy/studio/<installation-slug>.env` from
`customer.env.example`. The slug is a lowercase DNS-style identifier and must be reserved once on
the VDS; it determines the Compose project (`vibe-<slug>`) and database name
(`vibe_<slug-with-underscores>`). Choose three unique loopback ports and four unique HTTPS origins
for admin, API, preview, and the public site.

Use two PostgreSQL roles against the same customer database:

- `DATABASE_URL` is the least-privilege runtime role passed to backend and scheduler;
- `DATABASE_ADMIN_URL` is the customer database owner used only by an explicitly approved
  migration operation. Compose never passes it into a service.

Use distinct storage identities. The backend receives only the private working-media key; the
builder receives only the public destination key. `*_S3_SCOPE` records the reviewed bucket-only
policy in the exact form `bucket:<bucket>/*`. Validation can prove the declaration matches the
configured bucket, but the operator must verify the provider policy itself before rollout. Neither
credential may grant account-wide bucket access, bucket deletion, or access to another customer.

Every image reference is assembled as `<repository>@<sha256 digest>`. Build the backend, webapp,
preview, and builder images for the selected Site Package and production origins before recording
their digests. The static webapp's API origin is compiled at image build time; it must match
`API_ORIGIN`. A mutable tag by itself is not accepted.

The fake values in `customer.env.example` are public test data, not deployable credentials. The
validator rejects known placeholders, low-variety secrets, reused database roles, cross-customer
database/bucket names, duplicate or non-HTTPS origins, unpinned images, and relative build-lock
paths. Keep real env files out of Git and out of captured Compose output.

## Dry-run validation

These commands only validate local configuration. They do not create networks, volumes,
databases, buckets, DNS, certificates, containers, or cloud resources:

```powershell
bun scripts/studio-installation-config.mjs validate --env deploy/studio/client-auto.env
docker compose --project-name vibe-client-auto --env-file deploy/studio/client-auto.env -f deploy/studio/compose.customer.yml config --quiet
```

`config --quiet` is intentional: expanded Compose output contains interpolated credentials. Never
redirect a non-quiet `docker compose config` result into a committed file or CI artifact. The
validator prints only the installation slug, project name, and the secret-free dry-run command.

## Host boundaries and operator review

Before an approved rollout, the operator separately provides:

- an existing external Docker network named by `STUDIO_POSTGRES_NETWORK`, attached to PostgreSQL;
- a customer-only database and runtime/owner roles with the ownership rules in
  [../../docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md);
- one external named volume, shared by every customer builder, mounted at `/var/lock/vibe-cms`;
- bucket-scoped media, publication, promotion, and queue credentials;
- Caddy 2.10 or newer, DNS for admin, API, and preview, plus an imported customer fragment based on
  `Caddyfile.example`.

Caddy is host-level so multiple customer projects do not compete for ports 80/443. Compose binds
admin, API, and preview only to `127.0.0.1`; the builder has no published port. Caddy automatically
handles TLS and caps request bodies. Do not add the public website host to this Caddy fragment.

The only service volume mount is the builder's shared lock directory. No service receives the
repository, Docker socket, database owner URL, another customer's network, or another customer's
storage key. All services have read-only root filesystems, bounded CPU/memory/PIDs, capped local
logs, and explicitly sized temporary filesystems. Review host disk/log retention, monitoring,
backup, restore, queue delivery, and image/package compatibility before rollout.

Runtime mutation commands are deliberately omitted. Cloud apply, database migration, container
start, DNS changes, and Caddy reload require a separately reviewed customer rollout with real
values and explicit authorization.
