# Как создавать публичные сайты через Vibe CMS

Этот документ — стартовая точка для агента, который впервые открыл репозиторий и должен создать
лендинг или небольшой публичный сайт, управляемый через CMS. Для bespoke customer site
обязательно прочитайте `docs/SITE_PACKAGES.md`: один code-owned Site Package выбирается
до install/build и определяет дизайн, разрешённые поля, bespoke blocks и browser modules.

## Обязательный workflow для bespoke сайта

1. Заполните `docs/CMS_SITE_BRIEF.md`, включая package ID, ownership, editable fields,
   browser/runtime/external capabilities, destination, data/export/hosting и границы первой версии.
2. Примените `vibe-landing` и сохраните без переименования блок:

   ```text
   Uses from Vibe:
   Not using:
   Adds:
   Why:
   ```

3. Создайте `site-packages/<package-id>`: package владеет дизайном, layout, формулами,
   schemas/defaults/editor descriptors/renderers/migrations/tests; CMS core владеет auth, persistence,
   preview, approval, snapshot и delivery ports. Клиенту доступны только declared content/parameters.
4. До install/build выполните `bun run site-package:stage -- <package-id>`. Не редактируйте и не
   коммитьте ignored `packages/selected-site-package/`.
5. Выполните idempotent package bootstrap, затем journey
   `CMS edit → reload → protected preview → approval → immutable snapshot → Astro build → destination marker/promotion`.
6. Откройте опубликованный HTML с заблокированным `/api/cms`; browser-only interaction должна
   работать. Проверьте 375/768/1024/1440, focus/navigation, overflow, headings, metadata,
   reduced motion и media dimensions для пакетов с media.

Один customer installation имеет отдельные database/role, hosts, secrets, private media,
publication destination, backups и resource limits. Multi-tenancy в одной database, runtime package selection,
customer code/formulas, SFTP-only delivery, booking, payments и DRM отсутствуют, пока их отдельно не
согласовали. Cloud apply/deploy требует отдельного явного разрешения.

## Карта системы

| Зона | Ответственность |
| --- | --- |
| `webapp` | Закрытая админка: страницы, коллекции, медиа, настройки, preview и публикации. |
| `backend` | CMS-контракты, права, черновики, ревизии, согласование и immutable publication snapshot. |
| `website` | Публичный Astro renderer. SEO-контент находится в готовом HTML. |
| `website-builder` | Сборка и продвижение опубликованного snapshot в production. Для локального создания страницы не нужен. |
| `packages/contracts` | Единственная схема допустимых page blocks, SEO и collection entries. |

Перед изменением публичного сайта прочитайте:

1. `AGENTS.md`;
2. `README.md`;
3. `CHECKLIST.md`;
4. этот документ;
5. `docs/CMS_SITE_BRIEF.md`;
6. `docs/WEB_SURFACES.md`;
7. `docs/SITE_PACKAGES.md`;
8. `packages/contracts/src/cms/content.ts` и выбранный package contract/renderer.

Не предполагайте, что сайт уже опубликован или имеет публичный URL. Проверьте конфигурацию и сообщите
пользователю локальные адреса отдельно от production-адресов.

## Минимальный локальный запуск

Из корня репозитория:

```powershell
Copy-Item backend/.env.example backend/.env
docker compose --env-file backend/.env up -d postgres
bun install --frozen-lockfile
bun run --cwd backend prisma:deploy
bun run dev:seed
```

Запустите нужные поверхности в отдельных терминалах:

```powershell
bun run dev:backend
bun run dev:webapp
bun run dev:website
```

Локальные значения по умолчанию:

- админка: `http://localhost:5173/admin`;
- API: `http://localhost:3000`;
- публичный Astro website: адрес, который напечатает `astro dev` (обычно `http://localhost:4321`);
- локальный owner: `admin@example.com` / `local-admin-password`.

Если порт переопределён или занят, источником истины остаётся вывод процесса, а не значения выше.

## Создание новой CMS-страницы

Сейчас админка умеет редактировать существующие страницы, но не создаёт новую page row. Поэтому новую
страницу инициализирует локальный idempotent seed/helper или package bootstrap, после чего весь
дальнейший контент меняется через CMS.

Правильный bootstrap:

1. Подготовьте page payload по `selectedPageDraftSchema` без `expectedRevision`.
2. Проверьте payload схемой, временно добавив `expectedRevision: 0`, затем удалите служебное поле перед записью.
3. Используйте `createCmsRepository(db)` и сначала `findPageByPath(path)`.
4. Если страницы нет — создайте её через `createPage({ path, title, payload })`.
5. Если страница уже существует — не перезаписывайте пользовательский контент автоматически.
6. Seed должен оставаться local-only, принимать только loopback PostgreSQL и быть идемпотентным.
7. Не вставляйте CMS JSON через raw SQL и не создавайте production publication напрямую из seed.

Готовый пример находится в `examples/cms-site-starter/`. Его путь — `/cms-demo`, поэтому он не заменяет
главную страницу `/`.

После bootstrap:

1. войдите в `/admin` как owner;
2. откройте `Страницы` → нужную страницу;
3. измените блоки и дождитесь сохранения черновика;
4. проверьте защищённый `Предпросмотр`;
5. отправьте страницу на согласование;
6. в `Публикации` согласуйте и опубликуйте revision;
7. проверьте public route и отсутствие старого контента после сборки snapshot.

Preview зависит от настроенного preview runtime. `website` получает приватный backend origin через
`CMS_BACKEND_ORIGIN`; не превращайте его в `PUBLIC_*` и не передавайте preview token в браузерный bundle.

## Доступные блоки

| Тип | Назначение |
| --- | --- |
| `hero` | Главный оффер, пояснение и одна-две ссылки. |
| `textImage` | Структурированный текст, опционально с изображением. |
| `benefits` | От 2 до 8 преимуществ. |
| `serviceSelection` | Выбор опубликованных записей типа `service`. |
| `caseSelection` | Выбор опубликованных кейсов. |
| `testimonialSelection` | Выбор опубликованных отзывов. |
| `faqSelection` | Выбор опубликованных FAQ. |
| `gallery` | От 1 до 20 готовых media assets. |
| `cta` | Финальный призыв к действию. |
| `contacts` | Карточки контактных данных из настроек сайта. |
| `formPlaceholder` | Честная заглушка будущей формы; она не отправляет данные. |

Не придумывайте новый block type, пока разрешённые core blocks решают задачу. Bespoke block
принадлежит package registry, а не switch в CMS core; его schema, defaults, editor, renderer, migration
и tests меняются вместе.

## Контент, медиа и ссылки

- SEO title/description и основной текст должны быть в CMS payload, а не загружаться клиентским JavaScript.
- Используйте медиа только через CMS media IDs; private object keys и signed URLs не должны попадать в DTO.
- Для тестовой страницы ставьте `seo.noIndex: true`.
- `actionSchema` принимает внутренний path, same-page anchor или credential-free HTTPS URL.
- Renderer пока не назначает `block.id` HTML-секции. Не заявляйте работающий scroll-to-block CTA без отдельного изменения и теста renderer-а.
- Настоящая форма заявки, отправка email и CRM-интеграция не входят в `formPlaceholder`; это отдельный продуктовый scope.

## Definition of done

Страница готова, когда:

- она существует отдельно от `/` и видна в `/admin/pages`;
- draft проходит `selectedPageDraftSchema`, сохраняется и переживает reload;
- preview показывает последнюю сохранённую версию либо точно документирован runtime blocker;
- опубликованный snapshot проходит contracts и Astro production build;
- mobile и desktop не имеют горизонтального overflow, навигация и ссылки доступны с клавиатуры;
- title, description, heading order и `noIndex` соответствуют брифу;
- нет новых зависимостей, cloud apply и production credentials.

Минимальные проверки:

```powershell
bun run test:contracts
bun run test:backend:unit
bun run test:webapp
bun run test:website
bun run test:website-builder
bun run typecheck
bun run lint
bun run build:webapp
bun run build:website
bun run architecture:check
bun run --cwd webapp e2e
git diff --check
```

Для изменённого CMS user journey добавляйте Playwright только когда сценарий стабилен и проверяет
сохранение, права, preview или публикацию, а не CSS-детали.
