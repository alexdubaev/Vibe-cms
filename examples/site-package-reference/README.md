# Reference calculator Site Package

Этот пример показывает сквозной пакет с собственным Astro-layout, блоком
`estimateCalculator` и автоматически собранной CMS-формой.

CMS хранит только тексты и числовые параметры. Формула
`Math.max(minimumPrice, area * unitPrice)` принадлежит коду пакета и выполняется
в браузере без backend/API и без runtime-запросов к CMS. Заголовок и описание
уже находятся в статическом HTML до запуска скрипта.

## Проверка

```powershell
bun run site-package:stage -- reference-calculator
bun install
bun run test:contracts
bun run test:webapp
bun run test:website
bun run build:website
```

`page-draft.json` содержит демо-страницу `/calculator` с `noIndex: true`. При bootstrap добавьте
`expectedRevision: 0`, а перед `createPage` удалите это служебное поле. Повторный bootstrap не должен
перезаписывать уже отредактированную страницу.
