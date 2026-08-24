# Vibe CMS — handoff для следующего агента

Дата состояния: 2026-08-24  
Рабочий каталог: `D:\codex\VIBE-cms\app`

## Что уже сделано

Текущий функциональный прогресс оценивается примерно в 81%. Реализованы:

- роли `user/editor/owner`, capability-политика и совместимость старого `admin` с `owner`;
- Prisma-модели и миграции CMS: страницы, ревизии, media/usage, approvals, publications, controller/builds, preview grants/sessions, builder nonces, audit/outbox;
- CMS backend API с приватными ответами и optimistic revision conflicts;
- безопасная передача: approval/publication snapshots не возвращаются через HTTP mutation responses;
- CMS media API: signed-ticket upload/finalize, list/search, alt-текст, owner-only durable delete;
- media finalize извлекает bounded dimensions для PNG/JPEG/WebP/AVIF без декодирования пикселей и сохраняет их в asset record;
- публикационная логика, immutable artifacts, builder HMAC/nonce, Yandex queue/storage adapters;
- website snapshot loader, static rendering, robots/sitemap и fail-closed preview exchange helper;
- request-time Astro preview runtime: Node adapter, external `/__preview/*` rewrite, one-time exchange,
  session revalidation on every render, private draft page DTO, authorized media proxy и security headers;
- website-builder publication runtime: static release upload в inactive Yandex slot, прямое подтверждение marker/index,
  HTTPS selector switch, CDN purge, public marker polling и fail-closed runtime configuration;
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

Проверки блока: `bun run test:webapp` — **56 pass, 0 fail**; CMS backend app/routes — **18 pass, 0 fail**; `bun run lint`, `bun run typecheck:webapp`, `bun run build:webapp`, `bun run architecture:check` — успешно.

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

## Последние проверки

Последние успешные результаты:

- `bun run typecheck` — все workspace typechecks успешны; website оставляет только существующий hint о deprecated `verticalAlign`;
- `bun run test:backend:unit` — **325 pass, 0 fail**;
- CMS backend app/routes tests — **18 pass, 0 fail**;
- CMS repository integration — **10 pass, 0 fail**;
- `bun run test:webapp` — **56 pass, 0 fail**;
- `bun run build:webapp` — успешно;
- `bun run architecture:check` — успешно, 432 source files;
- media PostgreSQL integration — **1 pass, 0 fail**;
- `bun run --cwd website-builder test` — **19 pass, 0 fail**;
- `bun run --cwd website-builder typecheck` — успешно;
- `bun run typecheck`, `bun run lint`, `bun run build` — успешно; website оставляет только существующий hint о deprecated `verticalAlign`;
- `bun run test` — infra/contracts/backend unit/webapp/website/builder проходят; backend integration на Windows/Bun остановлен после известных Prisma transaction timeout failures;
- `docker build -f website-builder/Dockerfile -t vibe-cms-builder-test .` — остановлен на зависшем внешнем `bun install --frozen-lockfile` без прогресса;
- `docker compose ps` — `app-postgres-1` и `app-postgres_test-1` healthy.

Для repository integration используется отдельный тестовый контейнер на `127.0.0.1:38900`; credentials бери из локального test env, не добавляй их в код или handoff.

## Что делать дальше

Приоритетный порядок:

1. Довести builder release pipeline:
   - подключить server-side media copy из publication snapshot в inactive slot;
   - завершить snapshot-aware renderer для всех public media paths;
   - добавить rollback/операционную проверку selector и purge.
2. Закрыть Terraform/acceptance/operations checklist и проверить deploy smoke.

## Известные ограничения и gotchas

- `website-builder/src/server.ts` намеренно fail-closed: без полного набора production env процесс не стартует; live control-plane
  endpoints должны предоставлять HTTPS selector/purge API с Bearer token.
- Docker image build для website-builder и preview ранее/сейчас зависает на `bun install`; `docker build -f website/Dockerfile.preview`
  завершался внешней Bun tarball integrity/extraction ошибкой для нескольких пакетов, а `website-builder/Dockerfile`
  остановлен после длительного отсутствия прогресса на том же install этапе.
- Полный backend integration suite ранее упирался в Windows/Bun/Prisma `Transaction API error: Unable to start a transaction in the given time` в `deploy-database.integration.test.ts`. CMS-targeted integration tests проходят; не заявлять, что весь integration suite зелёный.
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
