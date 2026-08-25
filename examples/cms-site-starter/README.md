# Нейтральный CMS site starter

Это технический пример page payload для проверки Vibe CMS, а не готовый сайт конкретного бизнеса.
Он показывает существующие блоки и полный жизненный цикл контента без отраслевых предположений.

Путь примера — `/cms-demo`, поэтому он не заменяет `/`.

Проверяемый путь:

`idempotent bootstrap → CMS editor → draft reload → preview → approval → publication → Astro build`.

Payload находится в `page-draft.json`. Он:

- проходит текущий `pageDraftSchema` после добавления `expectedRevision: 0`;
- использует только существующие `hero`, `benefits`, `textImage` и `cta`;
- не требует media assets и внешних сервисов;
- имеет `noIndex: true`;
- не содержит бизнес-фактов, цен, отзывов или контактов.

Перед `createPage` удалите служебный `expectedRevision`. Повторный bootstrap не должен создавать
вторую `/cms-demo` и не должен перезаписывать страницу, которую пользователь уже редактировал.
