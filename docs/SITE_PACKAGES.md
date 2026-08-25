# Site Packages: руководство студии

Site Package — это выбранное при сборке code-owned расширение Vibe CMS для одного
клиента. Оно соединяет индивидуальный сайт с общим CMS core, но не является
динамическим plugin, темой или no-code схемой. В одной клиентской сборке всегда
ровно один пакет.

## Границы ответственности

| Владелец | Ответственность |
| --- | --- |
| CMS core | Auth/RBAC, editor shell, persistence, optimistic revisions, preview grants/sessions, approval, immutable publication snapshot, builder/destination ports and registry boundaries. |
| Site Package | Package manifest, permitted core blocks, bespoke contracts/defaults/editor descriptors or custom editor, Astro layout/renderers, browser formulas, package content migrations, fixtures and acceptance tests. |
| Customer | Approved facts, copy and media rights; values exposed as editable by the package; domains, storage/destination credentials, data residency, retention, backups and hosting approvals. |
| Studio/operations | Repository and package code, one isolated installation per customer, staging/build/release, secret delivery, monitoring, backups/restores, upgrades and incident response. |

Клиент меняет только поля, которые пакет явно описал в admin registry. Дизайн,
формулы, код, границы полей, секреты, destination и package selection остаются
code/operations-owned. CMS не принимает HTML, CSS, JavaScript, iframe URL, формулу или package ID
от клиента как инструкцию к выполнению.

## Структура пакета

Source живёт в `site-packages/<package-id>/`. Минимальный package содержит:

- `package.json` — внутреннее workspace-имя и exports;
- `src/contract.ts` — stable ID/version/schemaVersion, schemas, defaults, block and field descriptors;
- `src/admin.ts` — admin registry и, только когда descriptor model недостаточна, package-owned editor;
- `src/website.ts` — package layout и Astro renderers;
- `src/components/` — renderer/browser modules без секретов;
- `tests/` — contract, renderer, browser и migration acceptance;
- idempotent package bootstrap defaults для первой установки.

Application code импортирует только `@vibe-cms/selected-site-package/{contract,admin,website}`.
`packages/selected-site-package/` — генерируемый, ignored build input: его не редактируют,
не коммитят и не используют как source of truth.

## Как создать клиентский пакет

1. Заполните `docs/CMS_SITE_BRIEF.md` реальными бизнес-фактами и границами первой версии.
2. Примените `vibe-landing`; сохраните в задаче точный блок:

   ```text
   Uses from Vibe:
   Not using:
   Adds:
   Why:
   ```

3. Из дизайна отделите code-owned layout/formulas от customer-editable content/parameters.
4. Скопируйте минимальную структуру `site-packages/vibe-core` в новый allowlisted ID. Не
   переносите чужие customer assets/defaults/secrets.
5. Разрешите только нужные core blocks. Bespoke block добавляйте, когда семантика core
   не подходит; одновременно добавьте schema, defaults, editor, renderer, migration и tests.
6. Для browser-only interaction храните в CMS только безопасные параметры; формула и поведение
   компилируются в package. Runtime API и external integration требуют отдельного spec/threat model.
7. Добавьте idempotent bootstrap через CMS repository. Повторный запуск не перезаписывает
   customer-edited content. Raw SQL и production publication из seed запрещены.
8. До установки зависимостей и любой сборки stage ровно один пакет:

   ```powershell
   bun run site-package:stage -- <package-id>
   bun install --frozen-lockfile
   ```

9. Запустите package/contracts/admin/website/builder/browser tests и production builds. Проверьте
   preview и publication с тем же package ID/version/schemaVersion.

`examples/site-package-reference/` и `site-packages/reference-calculator/` — acceptance reference. Его
калькулятор выполняет формулу в браузе и продолжает работать при недоступном CMS API.

## Миграции и fail-closed правила

- `packageId`, `version` и `schemaVersion` попадают в immutable snapshot; snapshot не выбирает package.
- Configured ID должен совпадать с compiled descriptor и database state. Mismatch останавливает
  mutation/build до upload/promotion.
- Persisted schema меняется только sequential, idempotent package migrations под advisory lock.
- Неудачная migration/build/upload/promotion оставляет прежний public release live.
- Final customer images содержат shared core и selected package, но не `site-packages/` и не чужие packages.

## Изоляция, данные и доставка

Каждый клиент получает отдельные database/role, admin/API/preview hostnames, secret set,
private media scope, static destination credentials, backups/restore procedure и resource limits. Даже при одном
PostgreSQL server cross-customer SQL grants нет.

| Данные | Место |
| --- | --- |
| Drafts, revisions, approvals, publication metadata | Отдельная customer database. |
| Исходные media | Приватный customer media bucket/scope. |
| Published HTML/assets/media | Customer-controlled S3-compatible static destination, blue/green prefixes and marker. |
| Backups | Зашифрованное off-host storage с restore test и customer retention policy. |
| Export | Локальный sanitized export из изолированной installation; не содержит credentials/signed URLs/private object keys. |

Для real deployment клиент передаёт по защищённому каналу: customer ID, package ID, admin/API/preview
hosts, public URL, database name/role secret, private media endpoint/bucket credentials, public destination
endpoint/bucket/region/credentials, allowed CORS origins, email settings when applicable, backup destination/retention,
resource limits and domain/DNS/CDN decisions. Затем operations выполняет план и проверки.

**Никакого cloud apply/deploy без отдельного явного разрешения.** Локальная готовность не означает
разрешение на Terraform apply, DNS change, upload в production bucket или создание облачных ресурсов.

## Приёмка

Пакет готов, когда:

- CMS edit сохраняется и переживает reload; preview и production используют один renderer;
- snapshot собирается, marker проверен и destination promotion завершена;
- public HTML и browser modules работают при заблокированном `/api/cms`;
- QA на 375/768/1024/1440 покрывает navigation/focus, calculator, overflow, heading order, metadata,
  reduced motion и dimensions/responsive loading для каждого добавленного media fixture;
- package mismatch, invalid block и failed migration/build/upload не mutation/promote;
- release gate и Linux Docker isolation smoke зелёны, а любое environment limitation записано дословно.

В reference-calculator нет media, поэтому его E2E не заявляет проверку dimensions; первый customer package
с media обязан добавить её в свою acceptance fixture.
