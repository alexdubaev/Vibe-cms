# Vibe CMS — handoff для следующего агента

Дата состояния: 2026-08-25
Рабочий каталог: `D:\codex\VIBE-cms\app`
Ветка: `master`; последний коммит до текущей незакоммиченной работы: `c77f991 fix(builder): rollback failed publication promotion`.

Важно для передачи:

- Все перечисленные ниже изменения пока находятся в рабочем дереве и не закоммичены.
- Не добавлять в коммит пользовательские/инструментальные untracked-каталоги `.ux-audit/` и `webapp/.21st/`.
- Перед коммитом проверить `git diff --check`, затем отдельно убедиться, что staged-набор содержит только код,
  тесты и документацию этой задачи.

## Что уже сделано

Текущий функциональный прогресс оценивается примерно в 90% кодового объёма; production-развёртывание намеренно не включено без согласованных доменов и облачных параметров. Реализованы:

- роли `user/editor/owner`, capability-политика и совместимость старого `admin` с `owner`;
- Prisma-модели и миграции CMS: страницы, ревизии, media/usage, approvals, publications, controller/builds, preview grants/sessions, builder nonces, audit/outbox;
- CMS backend API с приватными ответами и optimistic revision conflicts;
- безопасная передача: approval/publication snapshots не возвращаются через HTTP mutation responses;
- CMS media API: signed-ticket upload/finalize, list/search, alt-текст, owner-only durable delete;
- media finalize извлекает bounded dimensions для PNG/JPEG/WebP/AVIF без декодирования пикселей и сохраняет их в asset record;
- publication snapshot включает только ready media descriptors с безопасным immutable `publicPath`, а live/preview Astro renderer разрешает media IDs без private object keys;
- публикационная логика, immutable artifacts, builder HMAC/nonce, Yandex queue/storage adapters;
- website snapshot loader, static rendering, robots/sitemap и fail-closed preview exchange helper;
- request-time Astro preview runtime: Node adapter, external `/__preview/*` rewrite, one-time exchange,
  session revalidation on every render, private draft page DTO, authorized media proxy и security headers;
- website-builder publication runtime: static release upload в inactive Yandex slot, прямое подтверждение marker/index,
  HTTPS selector switch, CDN purge, public marker polling и fail-closed runtime configuration;
- website-builder provider-side media copy: backend signed build input resolves only frozen ready media into short-lived
  signed URLs plus slot-scoped public destinations/content types; builder copies them after inactive-slot cleanup and
  before static objects/marker, failing closed before promotion on any copy error;
- public CMS renderer: hero/text-image/benefits/gallery/CTA/contacts/form-placeholder and collection-selection blocks,
  structured text, safe inline links, public media paths and preview media proxy;
- immutable website redirects are uploaded into the inactive slot before the publication marker;
- failed publication recovery: backend queues a fresh reconcile wake-up for the same desired revision, while the CMS UI
  polls queued/building state and exposes a human-readable «Повторить публикацию» action;
- webapp CMS routes:
  - `/admin/pages`;
  - `/admin/pages/$pageId`;
  - `/admin/media`;
  - `/admin/publications`;
- редактор страниц: core fields, SEO, порядок блоков, autosave, conflict preservation;
- поля Hero/CTA/TextImage и выбор изображений для Hero/TextImage/Gallery;
- structured text-поле TextImage (многострочный редактор с безопасным преобразованием в paragraphs);
- редактор карточек Benefits (2–8 карточек, заголовок/описание/иконка, add/remove/update);
- дополнительные кнопки Hero/CTA, переключатели Contacts и способ связи FormPlaceholder;
- отправка на согласование, approve/reject/publish UI;
- история ревизий: список безопасных metadata и scoped restore;
- русская CMS-навигация для editor/owner;
- TDD-тесты backend/webapp/integration.

## Последний завершённый блок

Расширение полей редактора блоков:

- pure helpers для structured text и bounded benefits items с TDD-проверками;
- TextImage получил многострочный редактор контента с лимитами schema;
- Benefits получил карточки с ограничениями 2–8 и выбором иконки;
- Hero/CTA получили дополнительную кнопку с безопасным добавлением/удалением;
- Contacts получили переключатели видимости полей, FormPlaceholder — способ связи.
- collection selection blocks получили безопасный список активных записей и picker по типам service/case/review/faq;
- backend `GET /api/cms/entries?type=...` отдаёт только id, тип, имя, summary, revision и archived.

Preview runtime end-to-end:

- backend `GET /api/cms/preview/pages/:pageId` revalidates the opaque session, current actor role and page scope;
- backend `GET /api/cms/preview/media/:assetId` returns only a short-lived signed download URL, never an object key;
- website renders dynamic draft pages through the private Node runtime and follows media URLs server-side;
- all preview successes and indistinguishable failures carry `private, no-store` and `X-Robots-Tag: noindex, nofollow`;
- Astro ignores leading-underscore page directories, so middleware rewrites external `/__preview/*` to internal `src/pages/preview/*` routes.

Website publication promotion end-to-end:

- `website-builder/src/server.ts` теперь собирает concrete `publishRelease` из Yandex Object Storage и HTTP control-plane adapters;
- перед selector switch проверяются `blue|green/__publication_revision.txt` и `index.html` напрямую из storage;
- selector и purge требуют HTTPS endpoints и Bearer token, purge получает `paths: ['/*']` и publication revision;
- публикация считается успешной только после polling публичного marker с `no-store` и revision query parameter;
- server fail-closed при отсутствии storage, public origin, selector/purge или promotion token env.

Media finalize dimensions:

- parser читает только ограниченный prefix объекта и поддерживает PNG IHDR, JPEG SOF, WebP VP8/VP8L/VP8X и AVIF `ispe`;
- image upload без подтверждённых положительных dimensions отклоняется, видео/PDF проходят прежний signature-only путь;
- unit и PostgreSQL integration тесты подтверждают, что width/height доходят до persisted `cmsMediaAsset`.

CMS production builder/preview infrastructure:

- Yandex foundation получил opt-in `cms_publication_enabled`: отдельные builder/preview/promotion/trigger identities,
  Message Queue + DLQ с `maxReceiveCount = 5`, Lockbox bindings и immutable builder/preview image repositories;
- builder запускается отдельным Serverless Container с 2 GiB/1 core/600 s и получает только HMAC, queue,
  website-storage и promotion bindings; runtime сохраняет только нужные backend queue/HMAC bindings;
- preview получает только backend origin, публикуется через отдельный API Gateway custom domain и не получает CMS secrets;
- существующий защищённый website bucket сохранён как один versioned bucket с blue/green object prefixes,
  а builder policy ограничена этими prefixes; selector/purge control-plane остаётся внешним HTTPS контрактом;
- release wrapper при включённом Yandex CMS строит и пушит backend, builder и preview по immutable digests;
- добавлены production/runtime Terraform acceptance contracts и синхронизирована документация; реальный cloud plan/apply
  не выполнялся.

Продолжение UI-плана — rich structured text editor:

- TextImage теперь сохраняет не только абзацы, но и заголовки `##`/`###`, bullet/numbered lists, цитаты,
  bold/italic и внутренние либо безопасные HTTPS-ссылки через человекочитаемую разметку без JSON;
- добавлен `StructuredTextEditor` с подсказкой, aria-состоянием ошибки и отказом от небезопасных ссылок;
- CMS inline-text contract сохраняет значимые пробелы между форматированными узлами, а `contentPathSchema` больше
  не принимает абсолютные URL как внутренние пути;
- проверки UI-среза: `bun run test:webapp` — **68 pass, 0 fail**; contracts — **26 pass, 0 fail**;
  `bun run typecheck:webapp`, `bun run lint`, `bun run architecture:check` — успешно.

Продолжение UI-плана — visual QA и CMS Playwright smoke:

- login визуально проверен на 375/768/1024/1440 px; CMS workspace дополнительно проверен на 375 и 1440 px;
  mobile скрывает sidebar без горизонтального overflow, desktop сохраняет двухколоночный редактор секций;
- добавлен `webapp/e2e/specs/cms.spec.ts`: owner login → страницы → открытие редактора → structured text → сохранение → reload;
- smoke прогнан на чистой PostgreSQL E2E БД: **1 pass, 0 fail**;
- smoke выявил и закрыл дефект wiring: `/api/cms/media` проверял CMS role до установки authenticated principal;
  media routes теперь последовательно применяют `requireAuth`, затем `requireCmsAccess`, добавлен backend RED/GREEN test;
- контрольные кадры сохранены в `output/playwright/`;
- auth/avatar/RBAC E2E синхронизированы с Russian-first labels, сообщениями и ролями текущего UI;
- полный Playwright-набор на чистой PostgreSQL E2E БД: **17 pass, 0 fail** (auth, avatar, CMS smoke и RBAC).

Проверки блока: `bun run test:webapp` — **68 pass, 0 fail**; CMS backend app/routes — **25 pass, 0 fail**;
`bun run --cwd webapp e2e` — **17 pass, 0 fail**; `bun run lint`, `bun run typecheck:webapp`,
`bun run build:webapp`, `bun run architecture:check` — успешно.

## Следующий блок: закончить UI-полировку и русификацию

Следующий агент должен начать именно с этого блока, не возвращаясь к уже закрытому structured-text editor.
Это bounded-доработка существующего `webapp`, без изменения backend/API-архитектуры.

### Цель

Довести пользовательский интерфейс до цельного Russian-first состояния и закрыть финальный visual QA по
админским поверхностям. Базовая функциональность уже зелёная: `bun run --cwd webapp e2e` — **17 pass, 0 fail**.
Новые изменения не должны ухудшить этот baseline.

### Очередь реализации

1. Перевести оставшиеся пользовательские fallback-сообщения на русский, сохранив API-контракты:
   - `webapp/src/features/auth/components/form-errors.tsx` — default title `Authentication failed`;
   - `webapp/src/features/avatar/queries.ts` — rejected file / too-small / too-large messages;
   - `webapp/src/features/avatar/upload.ts` — transfer/storage failure messages;
   - `webapp/src/components/ui/command.tsx` — default command palette title/description;
   - сообщения валидации auth из `packages/contracts/src/auth.ts` (`Invalid email address`, password length),
     если они отображаются напрямую в UI. Не ломать backend tests: допустима frontend mapping-функция.
2. Сначала добавить unit/component tests на выбранный mapping сообщений (RED → минимальная реализация → GREEN),
   затем обновить E2E-ожидания для соответствующих edge states. Assertion должен описывать видимый русский текст.
3. Провести visual QA и при необходимости точечную полировку следующих маршрутов на desktop и mobile:
   - `/admin/users` — таблица/поиск/empty/error/role dialog;
   - `/admin/media` — upload/list/search/delete/error;
   - `/admin/publications` — queued/building/failed/retry/empty;
   - `/admin/content/service` — collection list/editor/empty/error;
   - `/admin/settings`, `/app/profile`, `/app/settings` — формы, alerts, session states.
   Проверять overflow, клиппинг, доступные labels, focus/keyboard, loading/error/empty states и читаемость карточек.
4. Добавить операционные Playwright-проверки publication retry/rollback только после появления реальных production
   endpoints; текущий CMS editor smoke уже зелёный и повторно переписывать его не нужно.

### Файлы для первого прохода

- `webapp/src/features/auth/components/form-errors.tsx`;
- `webapp/src/features/avatar/queries.ts`;
- `webapp/src/features/avatar/upload.ts`;
- `webapp/src/components/ui/command.tsx`;
- `packages/contracts/src/auth.ts` и связанные auth tests — только если выбран contract-level перевод;
- `webapp/e2e/specs/auth.spec.ts`, `avatar.spec.ts`, `rbac.spec.ts`, `cms.spec.ts`;
- `webapp/tests/*` для unit/component coverage.

### Проверки после каждого заметного шага

```powershell
Set-Location D:\codex\VIBE-cMS\app
bun run test:webapp
bun run lint
bun run typecheck:webapp
bun run --cwd webapp e2e
```

Для E2E при занятом порте использовать свободные значения `E2E_BACKEND_PORT` и `E2E_WEB_PORT`, например 57001/59001.
Не считать root `bun run test` зелёным на Windows из-за зафиксированных Bun/Prisma integration transaction timeouts.

История ревизий end-to-end:

- backend repository: `listPageRevisions` с сортировкой newest-first;
- service: `listPageRevisions` и scoped `restorePage`;
- routes:
  - `GET /api/cms/pages/:pageId/revisions`;
  - `POST /api/cms/pages/:pageId/revisions/:revisionId/restore`;
- webapp API/query hooks и карточка «История версий» в редакторе;
- source payload и служебные поля не попадают в safe revision DTO.

Основные изменённые файлы последнего блока:

- `backend/src/modules/cms/application/ports.ts`;
- `backend/src/modules/cms/application/cms-service.ts`;
- `backend/src/modules/cms/infrastructure/cms-repository.ts`;
- `backend/src/modules/cms/transport/routes.ts`;
- `backend/src/modules/cms/cms.test.ts`;
- `backend/src/modules/cms/infrastructure/cms-repository.integration.test.ts`;
- `backend/src/modules/cms/transport/routes.test.ts`;
- `webapp/src/features/cms/api.ts`;
- `webapp/src/features/cms/queries.ts`;
- `webapp/src/features/cms/pages.tsx`;
- `webapp/src/features/cms/components/PageEditor.tsx`;
- `webapp/src/features/cms/editor-model.ts`;
- `webapp/tests/cms-api.test.ts`;
- `webapp/tests/cms-editor-model.test.ts`.

Дополнительно изменены:

- `backend/src/modules/cms/transport/routes.test.ts` — HTTP smoke для bodyless retry.
- `webapp/src/components/ui/*`, `webapp/src/components/dashboard/SectionCards.tsx` и
  `webapp/src/features/admin/UserDirectory.tsx` — русские доступные подписи, скрытие служебных revision-полей
  и более спокойная визуальная иерархия.
- `webapp/src/features/cms/api.ts`, `queries.ts`, `pages.tsx`, `index.ts` и `webapp/tests/cms-api.test.ts` — retry,
  polling queued/building и понятное состояние failed publication.
- `website/src/cms/components/Block.astro`, `StructuredText.astro`, `InlineNodes.astro`, `CmsPage.astro`,
  `website/src/cms/media.ts`, route pages и `website/tests/cms-media-rendering.test.ts` — полный public-safe
  renderer для CMS block types/media/structured text.
- `website-builder/src/{build-site,release-pipeline,server,static-upload,yandex-storage}.ts` и tests — public origin,
  redirects, inactive-slot upload и provider redirect metadata.
- `CHECKLIST.md` и `docs/WEB_SURFACES.md` — capability ledger синхронизирован с реальным кодом.

## Последние проверки

Последние успешные результаты:

- `bun run typecheck` — все workspace typechecks успешны; website оставляет только существующий hint о deprecated `verticalAlign`;
- `bun run test:backend:unit` — **339 pass, 0 fail**;
- `bun run test:contracts` — **26 pass, 0 fail**;
- `bun run test:website-builder` — **25 pass, 0 fail**;
- CMS backend app/routes tests — **25 pass, 0 fail**;
- CMS repository integration — **10 pass, 0 fail**;
- `bun run test:webapp` — **68 pass, 0 fail**;
- `bun run build:webapp` — успешно;
- `bun run architecture:check` — успешно, 442 source files;
- media PostgreSQL integration — **1 pass, 0 fail**;
- `bun run --cwd website test` — **12 pass, 0 fail**; website typecheck/build успешны, остаётся только существующий `verticalAlign` hint;
- `bun run --cwd website-builder test` — **25 pass, 0 fail**;
- `bun run --cwd website-builder typecheck` — успешно;
- `bun run typecheck`, `bun run lint`, `bun run build` — успешно; website оставляет только существующий hint о deprecated `verticalAlign`;
- `bun run test` — не завершает backend integration на Windows/Bun/Prisma; root runner остановлен после
  воспроизводимых transaction-timeout failures. До этого infra (71), contracts (26) и backend unit (339) прошли;
  webapp/website/builder suites также прошли отдельно. Не считать полный root test зелёным на Windows.
- `docker build -f website-builder/Dockerfile -t vibe-cms-builder-test .` — остановлен на зависшем внешнем `bun install --frozen-lockfile` без прогресса;
- `docker compose ps` — `app-postgres-1` и `app-postgres_test-1` healthy.

Последний отдельный полный прогон после изменений:

- `bun run lint` — успешно.
- `bun run typecheck` — успешно; website: только существующий Astro hint `verticalAlign`.
- `bun run build` — успешно; website также сообщает только Vite warning о размере server chunk.
- `bun run architecture:check` — успешно (442 source files).
- `bun run test:infra` — 71 pass; `bun run test:contracts` — 26 pass;
- `bun run test:infra` после CMS-инфраструктуры — **72 pass, 0 fail**; отдельный `bun test scripts/infra.test.mjs` —
  **43 pass, 0 fail**;
  `bun run test:backend:unit` — 339 pass; `bun run test:webapp` — 68 pass;
  `bun run test:website` — 12 pass; `bun run test:website-builder` — 25 pass.

Детализация integration-проверки на `127.0.0.1:38900`:

- `db.integration.test.ts` — 6 pass; `outbox.integration.test.ts` — 9 pass;
- `cms.integration.test.ts` — 3 pass; `media.integration.test.ts` — 1 pass;
  `uploads.integration.test.ts` — 15 pass;
- `cms-repository.integration.test.ts` — 10 pass; `publication-repository.integration.test.ts` — 7 pass;
  `builder-nonce-store.integration.test.ts` — 1 pass;
- `users.integration.test.ts` — чистый изолированный запуск проходит 9 первых тестов, затем зависает
  на следующем seed/bootstrap transaction; полный файл на Windows не считать завершённым.
- `auth.integration.test.ts` — 12 pass, 1 fail: тест отката password change получил
  `Transaction API error: Unable to start a transaction in the given time.` вместо `outbox unavailable`;
- `deploy-database.integration.test.ts` — первый grant test и migration privilege test проходят, но
  `runtime database reconciliation rolls back every revoke when a later grant fails` получает тот же P2028
  вместо injected failure, `runtime database reconciliation refuses inherited roles` получает P2028 вместо
  `inherits role`, а `legacy public schema ownership is inventoried and transferred explicitly` превышает
  стандартный timeout 5 секунд.

Изолированная диагностика подтвердила, что обычный Prisma transaction и те же SQL вне `bun:test` проходят;
проблема возникает на Windows/Bun/Prisma adapter при повторном интерактивном transaction в integration runner.
Попытка увеличить `maxWait` превращает быстрый P2028 в зависание и удалена; production-код не изменён
спекулятивным workaround. Повторять integration после переноса на Linux/CI или после обновления Bun/Prisma.

Для repository integration используется отдельный тестовый контейнер на `127.0.0.1:38900`; credentials бери из локального test env, не добавляй их в код или handoff.

Terraform acceptance сейчас не запускается в этой Windows-сессии: `bun run test:terraform` завершается сообщением
`terraform is not installed or is not available on PATH`. После установки Terraform первым делом прогнать весь
`bun run test:terraform`, затем сделать credential-free `infra:plan` с согласованными Yandex domain/certificate и
selector/purge inputs.

## Что делать дальше

Приоритетный порядок:

1. Выполнить блок «закончить UI-полировку и русификацию» выше; сохранить полный E2E baseline **17/17**.
2. Установить Terraform и прогнать production/runtime acceptance; затем выполнить credential-free Yandex plan с
   согласованными preview domain/certificate и HTTPS selector/purge endpoints. Cloud apply по-прежнему не выполнять
   без явного согласования параметров.
3. Добавить операционные Playwright-проверки publication retry/rollback после появления production endpoints;
   CMS editor smoke уже добавлен и зелёный.
4. Повторить полный release-gate: backend integration на стабильном runner, Docker builds и deployment smoke.

## Известные ограничения и gotchas

- `website-builder/src/server.ts` намеренно fail-closed: без полного набора production env процесс не стартует; live control-plane
  endpoints должны предоставлять HTTPS selector/purge API с Bearer token.
- Docker image build для website-builder и preview ранее/сейчас зависает на `bun install`; `docker build -f website/Dockerfile.preview`
  завершался внешней Bun tarball integrity/extraction ошибкой для нескольких пакетов, а `website-builder/Dockerfile`
  остановлен после длительного отсутствия прогресса на том же install этапе.
- Полный backend integration suite упирается в Windows/Bun/Prisma `Transaction API error: Unable to start a transaction in the given time` в auth/deploy-database integration tests; не заявлять, что весь integration suite зелёный. Изменение `maxWait` не является рабочим решением и в коде не оставлено.
- Не возвращать `candidateSnapshot`/`snapshot` через transport routes. Внутренние service DTO могут содержать snapshot для frozen approval/publication logic — это намеренно.
- Page autosave должен сохранять стабильный mutation ref и не пересоздавать queue на каждом React Query state change. Текущий `PageEditor` использует `mutationRef` и remount key `${id}:${draftRevision}`.
- Signed media upload обязан отправлять ticket headers verbatim, `credentials: omit`; object keys и signed URLs не показывать в UI/DTO.
- Основной CMS foundation закоммичен как `23ee9ae feat(cms): add content collections and preview foundations`;
  preview runtime закоммичен как `ea7af76 feat(cms): ship protected website preview runtime`,
  blue/green publication — как `4ad4854 feat(cms): wire blue-green website publication`.

## Полезные команды

```powershell
Set-Location D:\codex\VIBE-cms\app

docker compose up -d
docker compose ps

bun run typecheck
bun run lint
bun run architecture:check
bun run test:backend:unit
bun run test:webapp
bun run build:webapp
bun run test:website
bun run test:website-builder
```

Для следующего feature-блока соблюдать TDD: сначала добавить тест, убедиться в корректном RED, затем минимальная реализация и GREEN, затем рефакторинг.
