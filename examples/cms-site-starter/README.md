# Нейтральный CMS core fixture

Это технический page payload для lifecycle-проверки Vibe CMS, а не starter дизайна и не готовый
сайт бизнеса. Новый bespoke customer site создаётся через `vibe-landing` и один Site Package по
`docs/SITE_PACKAGES.md`; acceptance reference находится в `examples/site-package-reference/`.

Путь примера — `/cms-demo`, поэтому он не заменяет `/`.

Проверяемый путь:

`idempotent bootstrap → CMS editor → draft reload → preview → approval → publication → Astro build`.

Payload находится в `page-draft.json`. Он:

- проходит текущий `selectedPageDraftSchema` после добавления `expectedRevision: 0`;
- использует только существующие `hero`, `benefits`, `textImage` и `cta`;
- не требует media assets и внешних сервисов;
- имеет `noIndex: true`;
- не содержит бизнес-фактов, цен, отзывов или контактов.

Перед `createPage` удалите служебный `expectedRevision`. Повторный bootstrap не должен создавать
вторую `/cms-demo` и не должен перезаписывать страницу, которую пользователь уже редактировал.
