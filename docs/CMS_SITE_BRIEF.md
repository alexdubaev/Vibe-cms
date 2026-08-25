# Бриф CMS-сайта и Site Package

Этот шаблон передаёт агенту продуктовые требования. CMS core уже определён репозиторием:
`webapp` — управление, `backend` — данные и публикация, `website` — публичный HTML. Для bespoke
сайта заполните все разделы и прочитайте `docs/SITE_PACKAGES.md`.

## Проект

- Название сайта/организации; назначение; аудитория; география/язык:
- Основное действие посетителя и подтверждённые бизнес-факты:
- Stable Site Package ID (kebab-case) и внутреннее имя:

## Владение и редактируемость

- Что принадлежит CMS core:
- Что принадлежит Site Package (дизайн, layout, blocks, формулы, migrations):
- Какие тексты, медиа, ссылки и числовые параметры редактирует клиент:
- Какие поля точно не должны быть доступны клиенту:
- Кто в студии владеет code/repository, staging, release и operations:

## Структура, контент и CMS-управление

- Главная `/`, дополнительные paths, header/footer menu и нужные коллекции:
- Медиа: кто предоставляет файлы и права на них:
- Для каждой страницы: цель, offer, секции, actions/links, SEO title/description и индексация:
- Кто редактирует (`editor`/`owner`), кто согласует/публикует:
- Нужны ли preview, история версий/восстановление; какие данные private:

## Интерактивные возможности

Для каждой отметьте ровно один тип:

- browser-only: без секретов/API; формула в package, в CMS только safe parameters;
- customer runtime: отдельные contract/threat model/auth/rate limit/idempotency/retention;
- external integration: провайдер, server-side secrets, webhooks и failure policy;
- absent/deferred в первой версии.

## Изоляция, destination, данные и export

- Customer/installation ID; admin/API/preview hosts и allowed origins; public URL/domain:
- Отдельная database/role и data residency:
- Private media endpoint/bucket/scope и retention:
- Customer-controlled S3-compatible destination: endpoint/bucket/region; credentials — только secret channel:
- CDN/DNS/promotion/rollback ownership:
- Backup destination, encryption, retention и restore-test owner:
- Кто/как получает sanitized export; срок и deletion policy:
- Hosting/resource limits; кто отдельно разрешает deploy/apply:

## Границы первой версии

- Не публиковать вымышленные цены, гарантии, отзывы, сертификаты и контакты.
- Real form/CRM/email не следует из `formPlaceholder`; это отдельный scope.
- Multi-tenant DB, runtime package switching, arbitrary customer code/formulas, SFTP-only delivery,
  booking, payments, generic leads inbox и DRM отсутствуют без отдельно согласованного scope.
- Не выполнять cloud deploy/apply без отдельного явного разрешения.
- Для test fixture использовать `seo.noIndex: true`.

## Готовый prompt для агента без контекста

```text
Клонируй https://github.com/alexdubaev/Vibe-cms и работай в ветке main. Это активный пользовательский
репозиторий: не удаляй/не заменяй origin. До изменений прочитай AGENTS.md, README.md, CHECKLIST.md,
docs/CMS_SITE_WORKFLOW.md, docs/CMS_SITE_BRIEF.md, docs/SITE_PACKAGES.md, docs/WEB_SURFACES.md и
examples/site-package-reference/.

Создай CMS-сайт по приложенному брифу. Примени vibe-landing и запиши PROJECT SCOPE с точными
headings Uses from Vibe / Not using / Adds / Why. Создай один build-selected Site Package.
Бизнес-контент и safe parameters живут в CMS; дизайн, layout, формулы и код — в package.
Сохрани draft/preview/approval/publication/static-destination flow; public HTML не вызывает CMS API.

Для initial rows используй idempotent local-only package bootstrap через CMS repository; не raw SQL и не
production publication из seed. До install/build выполни site-package:stage. Запусти полный gate из
docs/CMS_SITE_WORKFLOW.md, включая E2E с заблокированным CMS API и QA 375/768/1024/1440.
Сообщи local URLs/login, browser QA, customer deployment values и явно запиши, что cloud apply не выполнялся.
```
