# NanoFox

Минимальный self-hosted waterfall для рекламы: один файл, РСЯ первой, статичный
image fallback — только после официального no-fill callback. Никаких runtime
зависимостей, backend, БД, сборки, cookies или fingerprinting.

English version: [README.en.md](README.en.md). Полное ТЗ: [SPEC_RU.md](SPEC_RU.md)
и [English specification](SPEC_EN.md).

> Статус: локальный MVP. Production deploy и включение реальных кампаний не
> входят в этот репозиторий.

## Что делает

1. Находит `<div data-nanofox="article"></div>`.
2. Сопоставляет текущий hostname и слот с `CONFIG` в начале `nanofox.js`.
3. Один раз вызывает уже загруженный `Ya.Context.AdvManager.render`.
4. Если **официальный** callback РСЯ сообщает о no-fill, выбирает один
   совместимый активный image-баннер по весам.
5. Если нет campaign, место остаётся пустым. Сбой NanoFox не ломает страницу.

NanoFox не запускает fallback по таймауту, `onError`, `onRender`, высоте DOM
или содержимому iframe. Документированный `onError` переводит слот в
диагностический `ERROR`, но не включает партнёрку. Он не подключает loader РСЯ
повторно.

Это **не header bidding**: NanoFox не запускает параллельные аукционы, не
запрашивает партнёрские сети одновременно с РСЯ и не сравнивает ставки,
eCPM или ответы источников. Резервный партнёрский image-баннер допускается
только после официального YAN no-fill callback. Медленная загрузка, отсутствие
API РСЯ или `onError` не равны no-fill и оставляют партнёрскую рекламу
непоказанной.

Официальное подтверждение модели находится в разделе Яндекса
«[Показ своей рекламы в блоке](https://yandex.ru/support/partner/ru/web/units/tag-features#rtb-code-tuning-alt-code)»:
альтернативный код передаётся последним аргументом `render()` и выполняется,
если аукцион не подобрал предложение. Общий англоязычный справочник: [Yandex
Advertising Network](https://yandex.com/support/partner/en/). На 13 октября
2026 в англоязычном варианте этой страницы раздел про alternative code не
эквивалентен русской версии, поэтому точная норма и пример выше ссылаются на
оригинальный официальный русскоязычный раздел.

## Установка

Для каждого сайта размещают его независимую копию `nanofox.js` и задают
действительную конфигурацию внутри файла. Стартовая конфигурация намеренно
`enabled: false`, а кампаний нет: в ней нет реальных ID, креативов, партнёрских
ссылок и маркировки издателя.

```html
<script src="/js/nanofox.js" defer></script>
<div data-nanofox="article"></div>
```

### Обязательный host integration path

Двух строк недостаточно для fail-open, если страница уже вызывает РСЯ. Один
слот должен иметь **ровно одного владельца**: NanoFox либо старый renderer.
Хостовый код обязан остаться на странице и делать fallback к штатному РСЯ,
когда `nanofox.js` не загрузился или отключён:

```html
<script>
  // Выполняется после defer nanofox.js. Если context.js ещё загружается,
  // NanoFox использует его существующую очередь yaContextCb.
  function renderArticleSlot(slotElement) {
    if (window.NanoFox && window.NanoFox.canOwn(slotElement)) {
      window.NanoFox.refresh(slotElement);
      return;
    }

    // Существующий штатный renderer именно этого слота.
    // Здесь сохраняются прежние blockId, renderTo и lazy-loading сайта.
    window.yaContextCb.push(function () {
      Ya.Context.AdvManager.render({
        blockId: 'REAL_EXISTING_BLOCK_ID',
        renderTo: 'REAL_EXISTING_CONTAINER_ID'
      });
    });
  }
  document.addEventListener('DOMContentLoaded', function () {
    renderArticleSlot(document.querySelector('[data-nanofox="article"]'));
  });
</script>
```

Не ставьте этот fallback рядом с автоматическим старым `.lazy-ad` вызовом:
старый код этого согласованного слота заменяется данным owner-switch. Если
скрипт NanoFox отсутствует, ветка вызовет прежний renderer; если он включён и
слот настроен, старый renderer не запускается. Это предотвращает двойной
аукцион и позволяет выключить NanoFox без регрессии РСЯ.

`NanoFox.refresh(root)` можно вызвать для динамически добавленного DOM. Один
и тот же элемент будет обработан один раз даже при двойном подключении файла,
повторном `refresh` или позднем no-fill callback.

## Конфигурация

```js
const CONFIG = {
  enabled: true,
  experiment: { enabled: true, id: 'nanofox-v1', control: 50, treatment: 50 },
  rotation: { version: 'v1', maxEntries: 100 },
  sites: {
    'publisher.example': {
      enabled: true,
      slots: {
        article: {
          yandex: 'R-A-CONFIRMED-1',
          width: 300,
          height: 250,
          fallback: ['approved-campaign']
        }
      }
    }
  },
  campaigns: {
    'approved-campaign': {
      enabled: true,
      type: 'image',
      image: '/ads/approved-300x250.webp',
      url: 'https://advertiser.example/path?affiliate=approved',
      width: 300,
      height: 250,
      weight: 100,
      label: 'Реклама'
    }
  },
  analytics: { enabled: true, provider: 'metrika', counterId: 123456 }
};
```

`width` и `height` обязательны и должны точно совпадать у слота и fallback.
Разрешены только HTTPS URL либо root-relative URL (`/assets/ad.webp`); `http:`,
`//`, `data:` и `javascript:` отклоняются. Креатив добавляется DOM API с
`loading="lazy"`, `decoding="async"`, размерами, `target="_blank"` и
`rel="sponsored noopener noreferrer"`. Это не заменяет юридическую маркировку:
`label`, ERID/другие сведения и разрешение на креатив надо утвердить до
`enabled: true`.

## Ротация партнёрских креативов

После официального YAN no-fill NanoFox выбирает weighted random только среди
подходящих активных кампаний, которые ещё не были **подтверждённо видимы** в
текущем круге. История живёт per-origin в отдельном от A/B ключе
`nanofox:rotation:<version>` в `localStorage`; в ней только ограниченный список
неперсональных versioned-токенов кампаний. Смена `rotation.version` начинает
новую историю; смена ID эксперимента меняет только A/B-назначение и не сбрасывает
ротацию. Междоменной истории нет.

Кампания попадает в историю только после успешного `load` изображения и
пересечения `IntersectionObserver` с порогом 0.5. Вставка в DOM, медленная
загрузка и невидимый баннер историю не расходуют. До подтверждения видимости
кампания зарезервирована на текущей странице, поэтому несколько слотов не
выберут её одновременно; image error или удаление wrapper освобождают reserve.
Если все ещё невиденные кампании заняты такими reservation, слот остаётся
пустым: NanoFox не сбрасывает круг, не ставит таймер и не опрашивает DOM.

Когда все совместимые кампании подтверждённо просмотрены, очищается только их
часть истории и начинается следующий круг. Отключённая, небезопасная или
несовместимая кампания не участвует; изменение URL/размера кампании создаёт
новый токен и делает её новой для ротации. История ограничена 100 записями по
умолчанию, но удерживает до 500 текущих активных кампаний; при большем числе
полный цикл не гарантируется. При недоступном storage используется только
память страницы. При отсутствии `IntersectionObserver` показ не ломается, но
видимость не может быть подтверждена: история не записывается, а reservation
снимается после успешной загрузки, поэтому возможен повтор.

## Состояния и измерения

`IDLE → REQUESTING → NO_FILL → FALLBACK_RENDERED → DONE`; при документированном
`onRender` возможен отдельный terminal-state `YAN_RENDERED`; также возможны
`ERROR`, `SKIPPED`, `DISABLED`, `UNKNOWN`. Успешный возврат `render()` сам по
себе не доказывает показ. `onRender` используется только как документированный
сигнал отрисовки РСЯ и никогда не означает no-fill; no-fill и fallback возможны
только через последний callback `render()`. Пока нет ни одного из этих сигналов,
слот остаётся `REQUESTING`, что исключает угадывание и преждевременную партнёрку.

События передаются только в уже существующую Метрику (если задан `counterId`)
и/или как `CustomEvent`: `nanofox_eligible`, `nanofox_yandex_request`,
`nanofox_no_fill`, `nanofox_fallback_render`, `nanofox_fallback_visible`,
`nanofox_fallback_click`, `nanofox_error`. Параметры — site, slot, campaign,
source, experiment, variant и reason; персональных идентификаторов нет.
`nanofox_fallback_visible` фиксируется только после `load` и пересечения
`IntersectionObserver`; вставка DOM не выдаётся за видимый impression. Ошибки
аналитики игнорируются.

## Эксперимент

При `experiment.enabled: true` control/treatment назначаются 50/50 (или по
указанным весам) на origin и сохраняются в `localStorage` по ключу, содержащему
ID эксперимента. При запрете storage используется назначение только страницы.
Смена ID создаёт новое назначение, но не меняет отдельную историю ротации.
Control и treatment имеют одинаковый вызов РСЯ; control на no-fill оставляет
место пустым, treatment может показать fallback. При выключенном эксперименте
fallback разрешён всем, если NanoFox включён. Междоменная склейка не выполняется.

## Проверка

```bash
node --test tests/nanofox.test.js
```

Node unit-suite использует mocks и покрывает 18 обязательных сценариев,
slow/late callbacks, image error, stateful analytics, URL safety и ротацию:
круг/reload, storage error, multi-slot reservation, removal и visibility.
Browser fixtures проверяют desktop/mobile, отсутствие fallback по
таймауту, отключённый/недоступный скрипт и двойной вызов; они не делают
реальных рекламных запросов:

```bash
npm install --no-save @playwright/test
npx playwright test tests/playwright.spec.js
```

См. [examples/index.html](examples/index.html) и
[docs/integration-example.html](docs/integration-example.html). Playwright —
только dev/QA-инструмент, не runtime-зависимость NanoFox.

## Перед включением на production-сайте

1. Подтвердить в исходном репозитории текущий loader, CSP, Метрику, тип блока
   и реальный размер каждого слота.
2. Выбрать только обычный inline RTB слот с документированным `render()`;
   исключить Overlay, Floor Ad, Top Ad, video и блоки из Adfox.
3. Внести один owner-switch, пройти mock no-fill на staging и проверить
   отсутствие второго вызова РСЯ.
4. Утвердить креатив, партнёрскую ссылку, маркировку и систему отчётности.
5. Запустить ограниченный experiment, а не заменять все блоки сразу.

## Лицензия

[MIT](LICENSE).
