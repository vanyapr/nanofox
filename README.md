# NanoFox

**Ленивая реклама сначала.** NanoFox ждёт, пока место приблизится к viewport,
и только затем вызывает РСЯ. Если РСЯ официально сообщает, что аукцион не
подобрал объявление, NanoFox может показать разрешённый статичный партнёрский
баннер в том же месте. Это маленький self-hosted компонент, а не новая
рекламная платформа.

English: [README.en.md](README.en.md). Полная спецификация: [SPEC_RU.md](SPEC_RU.md).

> В репозитории нет реальных блоков, ссылок, креативов или конфигураций
> издателей. Начальная конфигурация выключена.

## 1. Проблема

Есть обычный слот РСЯ. Иногда он заполняется, иногда нет. В случае
официального no-fill издатель хочет показать в том же слоте одобренный
партнёрский материал — без одновременного второго аукциона и без сервера для
управления несколькими баннерами.

## 2. Какие есть решения

Adfox и другие ad server'ы предназначены для более широкой задачи: управление
инвентарём, правилами кампаний, отчётностью и подключениями. Header bidding
предназначен для конкурентного получения ставок до показа. Это полезные
инструменты, когда действительно нужны их функции, но для проверки одной
гипотезы «что показать после no-fill» они могут быть избыточны. NanoFox не
конкурирует со ставками и не заменяет эти системы.

Справка: [Yandex Adfox](https://yandex.ru/support/adfox/),
[Google Ad Manager](https://admanager.google.com/home/resources/) и
[Prebid](https://docs.prebid.org/overview/intro.html).

## 3. Подход

Список image-кампаний и их веса живут в конфигурации одного файла. Для каждого
слота NanoFox сначала и ровно один раз запрашивает РСЯ. Только последний,
документированный callback `Ya.Context.AdvManager.render()` переводит слот в
`NO_FILL` и разрешает выбор fallback. Медленная загрузка, отсутствие API,
`onError`, высота контейнера и содержимое iframe **не** означают no-fill.

Официальная схема Яндекса: [«Показ своей рекламы в блоке»](https://yandex.ru/support/partner/ru/web/units/tag-features#rtb-code-tuning-alt-code).

## 4. Плюсы

- Один готовый `nanofox.js`, без runtime-зависимостей, backend, БД и сборщика.
- Ленивая инициализация с `IntersectionObserver`; без него — безопасный
  немедленный запуск, а не полифилл или polling.
- Небольшой waterfall: РСЯ → только официальный no-fill → image fallback.
- Идемпотентные `refresh()` и callbacks: один DOM-элемент не создаст второй
  запрос РСЯ.
- Ротация по весам, localStorage без персонального ID и события для уже
  подключённой Метрики/`CustomEvent`.
- Production-артефакт — ES5. В исходнике нет скрытой надежды на `Map`, `Set`,
  `WeakMap`, `Promise`, `URL` или полифиллы.

## 5. Минусы и ограничения

- Только статичный image fallback; это не аукцион, не frequency capping и не
  отчётность о CPA-конверсиях.
- Если РСЯ не ответила или вернула ошибку, место остаётся в диагностическом
  состоянии: партнёрская реклама не запускается.
- Подтверждённая видимость fallback требует `load` картинки и
  `IntersectionObserver` с порогом 0.5. Без observer показ работает, но
  кампания не записывается в историю — повтор возможен.
- `localStorage` хранит только origin-local версию/токены ротации и вариант
  эксперимента. Если storage запрещён, назначение и история действуют только
  до конца страницы.
- При отсутствии `MutationObserver` удаление ещё не загруженного fallback
  извне не освобождает page reservation; NanoFox не опрашивает DOM ради этого.
- Юридическая маркировка, ERID и разрешения на креатив не создаются кодом.

## 6. Как работает

1. `refresh()` находит `[data-nanofox]` и/или включённую совместимую legacy
   разметку.
2. Если включён `lazy`, observer ждёт заданный `rootMargin` перед запросом.
3. Создаётся уникальный контейнер и вызывается существующий загрузчик РСЯ.
4. `onRender` фиксирует `YAN_RENDERED`; `onError` фиксирует `ERROR`.
5. Только официальный callback no-fill даёт treatment-группе выбрать
   совместимый активный баннер по весам.
6. Баннер получает размеры, `loading="lazy"`, `decoding="async"`, новую
   вкладку и `rel="sponsored noopener noreferrer"`.

Состояния: `IDLE → REQUESTING → YAN_RENDERED` либо
`IDLE → REQUESTING → NO_FILL → FALLBACK_RENDERED → DONE`. Также возможны
`ERROR`, `SKIPPED`, `DISABLED`, `UNKNOWN`; terminal-state не меняется поздним
callback.

## 7. Как подключить

В production нужен только собранный `nanofox.js`. Исходник `nanofox.ts` нужен
разработчику; `npm run build` детерминированно пересобирает готовый файл.

```html
<script src="/js/nanofox.js" defer></script>
<div data-nanofox="article"></div>
```

Конфигурация для обычного слота:

```js
const CONFIG = {
  enabled: true,
  lazy: { enabled: true, rootMargin: '200px' },
  experiment: { enabled: true, id: 'nanofox-v1', control: 50, treatment: 50 },
  sites: {
    'publisher.example': {
      enabled: true,
      slots: { article: { yandex: 'R-A-PLACEHOLDER-1', width: 300, height: 250, fallback: ['partner-1'] } }
    }
  },
  campaigns: {}, rotation: { version: 'v1', maxEntries: 100 },
  analytics: { enabled: true, provider: 'metrika', counterId: null }
};
```

Для динамически добавленных мест вызовите `NanoFox.refresh(root)`. Повторный
вызов безопасен.

### Адаптивный контейнер и фиксированный баннер

Ширина адаптивного контейнера не обязана совпадать с intrinsic-размером
fallback. Например, для контейнера до 798 px (и не уже 358 px в целевом
mobile-layout) можно явно разрешить 300×250: NanoFox не ставит `min-width:798px`,
резервирует высоту 250 px и центрирует баннер с `max-width:100%`.

```js
article: {
  yandex: 'R-A-PLACEHOLDER-RESPONSIVE',
  fallbackMaxWidth: 798,
  fallbackMaxHeight: 250,
  reserveHeight: 250,
  fallbackAlign: 'center',
  fallback: ['partner-300x250']
}
```

Без `fallbackMaxWidth/fallbackMaxHeight` сохраняется строгий старый контракт:
`campaign.width` и `campaign.height` обязаны в точности совпасть со
`slot.width` и `slot.height`. Добавляйте fluid-вариант только после проверки
реальной минимальной ширины слота и формата РСЯ на staging.

### Один владелец РСЯ и откат

Две HTML-строки сами по себе не дают fail-open, если старый код уже вызывает
РСЯ. У каждого слота должен быть один owner: NanoFox либо старый renderer.
Оставьте на хосте переключатель к существующему renderer:

```html
<script>
function renderArticle(slot) {
  if (window.NanoFox && window.NanoFox.canOwn(slot)) {
    window.NanoFox.refresh(slot);
  } else {
    /* Существующий вызов РСЯ именно этого слота. */
    window.yaContextCb.push(function () {
      Ya.Context.AdvManager.render({ blockId: 'EXISTING_BLOCK_ID', renderTo: 'EXISTING_CONTAINER_ID' });
    });
  }
}
</script>
```

Так отсутствие файла или `enabled: false` возвращает прежний путь без двойного
render. Не удаляйте старый loader РСЯ: NanoFox использует его очередь
`yaContextCb`, но не загружает его повторно.

### Совместимая lazy-разметка

Проверенный контракт legacy-разметки: `.lazy-ad[data-block-id]`, поле
`data-block-id`, очередь `yaContextCb`, `rootMargin: "200px"` и обычный
`renderWidget()`. Его можно включить без изменения самих контейнеров:

```js
legacy: {
  enabled: true,
  selector: '.lazy-ad[data-block-id]',
  rootMargin: '200px',
  slots: { 'R-A-PLACEHOLDER-1': 'article' },
  excludedBlockIds: []
}
```

Только явно отображённый `data-block-id → slot` получает NanoFox `render()` и
может иметь fallback. Неотображённое место остаётся ленивым Yandex-only
`renderWidget()` без fallback. В `excludedBlockIds` должны быть top/overlay/
floor/video и любые специальные A/B-форматы, пока их собственный контракт не
перенесён и не протестирован: NanoFox не обещает универсальную drop-in замену
таких loader'ов.

## 8. Как добавить баннеры в ротацию

Добавьте кампаниям реальные, одобренные данные; в примере ниже значения только
шаблоны:

```js
campaigns: {
  'partner-1': {
    enabled: true,
    type: 'image',
    image: '/ads/partner-300x250.webp',
    url: 'https://advertiser.example/path?affiliate=example',
    width: 300, height: 250, weight: 70,
    label: 'Реклама', alt: ''
  },
  'partner-2': { /* те же размер и поля, weight: 30 */ }
}
```

Допускаются только HTTPS и root-relative URL; `http:`, `//`, `data:` и
`javascript:` отклоняются. Выбираются только активные кампании точно того же
размера, что слот. История записывается лишь после загрузки и подтверждённой
видимости, а page reservation не даёт двум слотам взять одну ещё невидимую
кампанию.

## 9. Что проверить перед запуском

1. Подтвердить у РСЯ тип обычного inline RTB-слота и callback no-fill.
2. Сверить размеры, CSP для файла/креативов, существующие Метрику и loader.
3. Сделать таблицу `data-block-id → slot`; исключить special formats.
4. Утвердить URL, tracking-параметры, маркировку и юридические требования.
5. На staging выполнить mock no-fill, slow/no response, `onError`, disabled,
   двойную инициализацию, desktop и mobile.
6. Проверить, что один owner вызывает РСЯ и откат возвращает старый renderer.

## Разработка и проверка

Нужна только dev-зависимость TypeScript 5.9.3 (Apache-2.0); её нет в готовом
файле. TypeScript 7 больше не поддерживает ES5 target, поэтому версия закреплена
на совместимой ветке. См. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

```bash
npm install
npm run build          # nanofox.ts -> nanofox.js
npm run typecheck      # strict, без emit
npm run check:artifact # ловит устаревший nanofox.js
npm run check:es5      # ловит API, требующие polyfill
npm test               # typecheck + artifact + ES5 + unit tests
npm run test:browser   # Playwright QA, mock РСЯ
```

`nanofox.js` остаётся единственным runtime-файлом. Полезные комментарии
сохраняются и в исходнике, и в артефакте; исходный и compressed размеры можно
измерить отдельно перед выпуском.

## Лицензия

[MIT](LICENSE).
