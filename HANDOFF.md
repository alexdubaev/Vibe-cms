# VIBE CMS — Site Packages handoff

## Источники истины

1. `docs/superpowers/specs/2026-08-25-vibe-cms-site-packages-api-design.md`;
2. `docs/superpowers/plans/2026-08-25-vibe-cms-site-packages-api.md`;
3. `docs/SITE_PACKAGES.md`;
4. `docs/CMS_SITE_WORKFLOW.md` и `docs/CMS_SITE_BRIEF.md`;
5. `CHECKLIST.md` — текущие product/deployment решения.

Не возвращайтесь к старой модели нейтрального CMS site starter. Для bespoke сайта источник истины —
ровно один build-selected Site Package и isolated customer installation.

## Прогресс

- Последний полностью завершённый до этого handoff пунк плана: Task 12, commit
  `696c6ab fix(cms): complete exact export URL filtering`.
- Task 13 — финальная приёмка/документация. Базовый handoff — commit `1a0096a`; последующий review-fix
  закрывает замечания Task 13 и whole-branch review отдельным commit, видимым через `git log -1 --oneline`.
- В утверждённом плане не осталось unchecked implementation task только после применения review-fix commit.
  Linux/stable-Docker acceptance ниже остаётся обязательным release evidence, но не скрытым implementation scope.

## Выбранный acceptance package

`reference-calculator` должен быть staged до install/build:

```powershell
bun run site-package:stage -- reference-calculator
bun install --frozen-lockfile
```

Его E2E доказывает: owner sign-in; CMS add/edit/save/reload calculator; package layout в protected preview;
approval/publication; immutable snapshot; real Astro static build; fake-S3 upload/marker/promotion; public HTML при
заблокированном `/api/cms`; browser formula `max(minimumPrice, area * unitPrice)`; QA 375/768/1024/1440,
literal heading order/exact metadata/keyboard navigation/reduced-motion computed style/overflow. В reference fixture нет media; dimensions проверяются в первом
customer package с media.

## Ключевые границы

- CMS core владеет auth/persistence/preview/approval/snapshot/delivery ports.
- Package владеет layout/contracts/defaults/editors/renderers/browser formulas/migrations/tests.
- Клиент меняет только declared content/parameters, не design/code/formulas/secrets/destination.
- Package ID в config, compiled descriptor, DB state и snapshot должен совпадать; mismatch fails closed.
- Один customer = отдельные database role, hosts, secrets, private media, destination, backups, limits.
- Public site — static HTML/assets/media; ordinary visitors не зависят от CMS/API uptime.
- Multi-tenancy, SFTP-only delivery, booking, payments, generic leads inbox и DRM absent без нового approval.

## Проверки и Windows limitation

Фокусный E2E:

```text
bun run --cwd webapp e2e -- site-package.spec.ts
PASS: 1 passed (24.7s)
```

Полный Task 13 gate перечислен в `docs/CMS_SITE_WORKFLOW.md`; финальные результаты — в
`.superpowers/sdd/2026-08-25-vibe-cms-site-packages-api/task-13-report.md`.

| Команда | Наблюдаемый результат |
| --- | --- |
| `bun run site-package:stage -- reference-calculator` | LIMIT: Windows `EPERM` rename из-за foreign PID 63376; process не завершался. |
| `bun install --frozen-lockfile` | PASS: 1103 installs checked, no changes. |
| `bun run test:contracts` | PASS: 31. |
| `bun run test:backend:unit` | PASS. |
| `bun run test:webapp` | PASS. |
| `bun run test:website` | PASS: 18. |
| `bun run test:website-builder` | PASS: 63; 2 `flock` tests skipped by their existing non-Linux guard. |
| `bun run typecheck` | PASS: 0 errors; existing `verticalAlign` deprecation hint only. |
| `bun run lint` | PASS. |
| `bun run build:webapp` | PASS. |
| `bun run build:website` | PASS; existing large-chunk warning only. |
| `bun run architecture:check` | PASS: 456 source files. |
| `bun run --cwd webapp e2e` | REVIEW RUN: 19 passed including package acceptance; one unrelated CMS test received a blank Vite page before login and timed out. Exact failed test rerun PASS: 1 in 14.2s. |
| `git diff --check` | PASS. |
| `bun run test:backend:integration` | LIMIT: advisory-lock PostgreSQL cases passed, then Windows Docker produced transaction-start timeouts and stalled cleanup; owned runner interrupted after repeated no-output waits. Repeat on Linux/stable Docker. |
| `bun scripts/docker-smoke-site-package.mjs reference-calculator` | PASS: all four images built from `git archive HEAD`; package descriptor, source isolation and compiled static output passed; builder served; backend proved fail-closed before serve when its startup database gate could not connect. |

На Windows официальный staging может падать `EPERM` на rename `packages/selected-site-package`, если его
держит запущенный Astro/Vite process. В текущей workspace это foreign PID 63376: **не завершать его**.
Для чистой приёмки staging повторяется после того, как владелец процесса его остановит. Полный PostgreSQL
integration suite и два guarded `flock` теста окончательно повторяются на Linux/стабильном Docker.

## Workspace hygiene

Неотслеживаемые user-owned directories на момент handoff:

- `.playwright-cli/`;
- `.ux-audit/`;
- `output/`;
- `webapp/.21st/`.

Не удалять, не стейджить и не перезаписывать их. `packages/selected-site-package/` тоже generated/ignored и не
входит в commit.

## Что нужно для production onboarding

До реального deploy нужны customer/package IDs; admin/API/preview/public hosts; allowed origins; отдельные
DB name/role secret; private-media endpoint/bucket credentials; public S3-compatible endpoint/bucket/region/credentials;
DNS/CDN; backup destination/retention; resource limits; monitoring/restore owners; export/deletion policy; secure secret-delivery
channel и явное deploy/apply approval.

**Cloud apply, DNS changes и production upload в Task 13 не выполнялись.** Не выполнять их без отдельного явного
разрешения и полных customer values.
