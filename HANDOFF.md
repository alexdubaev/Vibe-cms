# VIBE CMS — handoff для следующего агента

## Текущая цель

Реализовать Site Packages и студийную API-модель для VIBE CMS:

- студия создаёт разные лендинги по правилам `vibe-landing`;
- каждый клиент получает один фиксированный уникальный дизайн;
- клиент редактирует только разрешённые поля через CMS;
- исходный репозиторий и CMS/API остаются у студии;
- для каждого клиента запускается отдельная изолированная CMS/API-установка;
- публикация собирает статический сайт и отправляет его на клиентское S3-совместимое хранилище;
- обычные посетители не обращаются к CMS API;
- браузерные калькуляторы работают без backend, а запись/CRM/платежи проектируются отдельно.

Архитектура подтверждена пользователем 2026-08-25.

## Обязательные документы

Читать в таком порядке:

1. `AGENTS.md`;
2. `docs/superpowers/specs/2026-08-25-vibe-cms-site-packages-api-design.md`;
3. `docs/superpowers/plans/2026-08-25-vibe-cms-site-packages-api.md`;
4. `docs/specs/vibe-cms-module-design.md` — только как описание уже реализованного CMS core;
5. `docs/CMS_SITE_WORKFLOW.md`;
6. `docs/WEB_SURFACES.md`;
7. текущий код и тесты файлов, перечисленных в выполняемой задаче плана.

Новая спецификация имеет приоритет над старым решением о передаче каждому клиенту отдельного
репозитория и отсутствии студийного CMS-хостинга.

## Состояние репозитория на момент handoff

- Рабочий каталог: `D:\codex\VIBE-cms\app`.
- Ветка: `main`.
- Remote: `origin = https://github.com/alexdubaev/Vibe-cms.git`.
- Последний запушенный функциональный commit до новой спецификации:
  `8c48996 feat(cms): add branding and site delivery guide`.
- Спецификация закоммичена:
  `7f88712 docs(cms): define site package API architecture`.
- Подробный implementation plan и этот handoff находятся в следующем docs-коммите.
- Реализация Site Packages ещё не начата. Следующий шаг — Task 1 плана.
- Спецификация и план не требуют cloud apply.

Перед любым изменением выполнить:

```powershell
Set-Location D:\codex\VIBE-cms\app
git status --short --branch
git log -5 --oneline --decorate
```

## Что уже реализовано и не должно дублироваться

- роли `owner/editor` и capability-проверки;
- страницы, коллекции, меню, настройки и redirects;
- черновики, autosave и optimistic concurrency;
- ревизии и restore-to-draft;
- CMS media upload/finalize/list/delete и безопасные public descriptors;
- authenticated preview;
- approval/publication flow и retry;
- immutable publication snapshot/artifact;
- HMAC, timestamp и nonce для builder API;
- publication controller/build records и outbox;
- Astro build через `CMS_SNAPSHOT_FILE`;
- `StaticUploadPort`, media copy, blue/green slots, marker verification и promotion;
- добавление, удаление, дублирование и перестановка текущих блоков в `PageEditor`;
- core block schemas и generic Astro renderer;
- логотип VIBE CMS в login/admin UI;
- нейтральная `/cms-demo` fixture и документы для агента без контекста.

Новая работа должна извлечь реестры и добавить точки расширения. Не создавать вторые версии
редактора страниц, media API, preview, snapshot или publication pipeline.

## Что предстоит реализовать

Мастер-план содержит 13 последовательных задач:

1. package-aware contract factories;
2. build-selected Site Package staging;
3. package-aware backend validation и snapshots;
4. package state и content migrations;
5. registry-driven CMS admin editor;
6. package layout/renderers в Astro;
7. reference calculator Site Package;
8. package mismatch и selected-only Docker images;
9. generic S3 publication adapter;
10. общий VDS `flock` для Astro builds;
11. отдельный studio Compose stack на клиента;
12. export, backups, retention и capacity smoke;
13. полный E2E, документация и финальный handoff.

Каждая задача в плане содержит точные файлы, интерфейсы, RED/GREEN-команды и отдельный commit.
Не выполнять задачи вне порядка: поздние интерфейсы ссылаются на имена, определённые ранними.

## Начало работы

Использовать `superpowers:subagent-driven-development` для выполнения плана с отдельным агентом и
review на каждую задачу либо `superpowers:executing-plans` для последовательных batches.

Первое действие — baseline перед Task 1:

```powershell
bun run test:contracts
bun run test:backend:unit
bun run test:webapp
bun run test:website
bun run test:website-builder
```

Затем выполнить только Task 1 из
`docs/superpowers/plans/2026-08-25-vibe-cms-site-packages-api.md`, начиная с failing tests.

## Ключевые технические решения

- Multi-tenant таблицы и `tenantId/siteId` не добавлять.
- Каждая установка получает отдельную базу, роль БД, origins, secrets, private media scope и
  destination credentials.
- Выбор пакета происходит при build/deploy; browser и snapshot не могут выбирать пакет.
- Stored block shape остаётся `{ id, type, data }`.
- Core blocks становятся registry entries.
- Обычные bespoke fields описываются ограниченными field descriptors.
- Сложный блок может иметь package-owned React editor, но backend всё равно валидирует его schema.
- Публичный Astro output статический; CMS API не участвует в page views.
- Первый bespoke acceptance package — browser-only calculator.
- Первый destination adapter — S3-compatible blue/green hosting.
- Builder concurrency на общем VDS ограничивается Linux `flock` через общий volume.
- Клиентские runtime APIs, booking, payments, CRM inbox, SFTP, FTP, DRM, Kubernetes, Redis и
  multi-tenancy не входят в этот план.

## Инфраструктурная модель

Для пилота согласована гипотеза VDS 4 vCPU / 8 GB RAM / 80 GB disk. Публичные сайты и опубликованные
изображения находятся на стороне клиента. VDS обслуживает admin/API, operational database, preview и
редкие bounded builds.

Не обещать фиксированное количество клиентов до Task 12 capacity smoke. Ограничить build
concurrency, временные файлы, Docker image retention и логи; резервные копии хранить вне VDS.

## Проверки и известные ограничения

Последний полный функциональный baseline до planning-коммитов был зелёным для webapp/website/builder,
typecheck, lint, production builds и architecture check. Этот docs-only этап не перезапускал полный
release gate.

Известное ограничение Windows:

- полный backend integration suite может получать Prisma P2028 transaction timeout в
  `deploy-database.integration.test.ts`;
- Linux CI ранее подтверждал backend integration;
- не менять production transaction semantics ради Windows workaround.

Известная отдельная CI-проблема:

- Terraform Yandex validation имеет ранее зафиксированную conditional type error;
- она не относится к Site Packages и не должна маскироваться изменениями этого плана.

Перед завершением каждой задачи выполнять команды, указанные в плане. Перед заявлением о полной
готовности использовать `superpowers:verification-before-completion` и полный gate из Task 13.

## Git и workspace hygiene

Не добавлять и не удалять пользовательские/инструментальные каталоги:

- `.playwright-cli/`;
- `.ux-audit/`;
- `output/`;
- `webapp/.21st/`.

Стадировать только файлы текущей задачи. Перед commit:

```powershell
git diff --check
git diff --cached --name-status
```

Не использовать force-push, reset, stash, checkout поверх чужих изменений или cloud apply без
явного запроса пользователя.

## Необходимые решения перед реальным production deploy

Кодовый план можно выполнить без этих значений. Для production понадобятся отдельно:

- клиентский package ID и реальный business brief;
- admin/API/preview domains;
- PostgreSQL database/user credentials;
- private media bucket;
- customer public S3 destination и CDN/promotion endpoints;
- TLS/DNS;
- backup destination и retention;
- первый owner account;
- коммерческий срок managed CMS/hosting и export/handoff policy.

Не запрашивать эти значения и не выполнять deploy, пока кодовые задачи и локальный acceptance не
завершены.
