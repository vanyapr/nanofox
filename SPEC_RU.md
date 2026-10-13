# NanoFox — публичная спецификация v0.1

NanoFox — компактный self-hosted JavaScript waterfall для обычных inline
рекламных мест. В production нужен один файл `nanofox.js`; он не имеет runtime
зависимостей, backend, БД, сборки, API, панели управления или отдельного CSS.

Исходник `nanofox.ts` строго проверяется и компилируется в checked-in ES5
артефакт `nanofox.js`. TypeScript существует только для разработки; production
подключает один готовый JS-файл. Целевой код намеренно не требует `Map`, `Set`,
`WeakMap`, `Promise`, `URL` или полифиллов. `IntersectionObserver`,
`MutationObserver`, `CustomEvent` и `localStorage` используются только после
feature detection и имеют описанный fail-open путь.

## Границы

- Сначала вызывается Yandex Advertising Network (YAN/РСЯ) через существующий
  loader и документированный `Ya.Context.AdvManager.render`.
- Партнёрский статичный image-баннер возможен только из финального callback
  официального YAN no-fill. Медленная загрузка, недоступный API, `onError`,
  `onRender`, DOM-высота и содержимое iframe не являются no-fill.
- Это не header bidding: нет параллельных аукционов, одновременного вызова
  партнёрских сетей, сравнения ставок/eCPM или повторных YAN-запросов.
- У одного слота один владелец: NanoFox **или** штатный renderer. Host path
  обязан вызвать прежний renderer при отсутствующем/выключенном NanoFox.
- Компонент не использует cookies, fingerprinting, user ID, персональные
  профили или собственную сетевую статистику.
- Ленивая инициализация, если включена, ждёт `IntersectionObserver` и
  `rootMargin`; при отсутствии API делает один безопасный немедленный запуск,
  не добавляя полифилл и не опрашивая DOM.

## Конфигурация

`CONFIG` находится в начале runtime-файла. Публичный starter оставляет его
выключенным и использует только `publisher.example` и placeholder-значения.
Production-конфигурация должна содержать только утверждённые block ID,
креативы, URL и рекламную маркировку.

Слот имеет `yandex`, явные `width`/`height` и массив `fallback`. Кампания
должна быть включённым `image` с безопасными HTTPS либо root-relative URL,
точно совпадающими размерами и положительным `weight`. Небезопасные протоколы,
несовместимые или выключенные кампании исключаются.

Для адаптивного контейнера вместо равенства ширин допускается явный контракт
`fallbackMaxWidth`/`fallbackMaxHeight` и `reserveHeight`: баннер не больше
max-границ, центрируется с `max-width:100%`, а резерв высоты уменьшает CLS.
Такая настройка не ставит desktop `min-width` на mobile. Без max-полей старый
строгий контракт `slot.width×height == campaign.width×height` сохраняется.

`lazy` задаёт `enabled` и `rootMargin`. Необязательный `legacy` поддерживает
только проверенный контракт `.lazy-ad[data-block-id]`/`data-block-id`/
`yaContextCb`/`renderWidget()`: явное отображение `legacy.slots` из block ID в
обычный NanoFox slot переводит место на документированный `render()` и может
получить fallback. Неотображённые места остаются Yandex-only. Специальные
top/overlay/floor/video/A-B форматы должны быть в `excludedBlockIds` либо иметь
отдельного owner: универсальная замена их loader'ов не заявляется.

## Состояния и отказоустойчивость

`IDLE → REQUESTING → NO_FILL → FALLBACK_RENDERED → DONE`; документированный
`onRender` даёт terminal-state `YAN_RENDERED`. Диагностические состояния:
`ERROR`, `SKIPPED`, `DISABLED`, `UNKNOWN`. Поздние и дублирующиеся callbacks
не создают второй показ.

Если YAN API ещё грузится, но есть `window.yaContextCb`, NanoFox помещает в
очередь один вызов. Если API/очереди нет, фиксируется `UNKNOWN`; fallback не
запускается. `onError` фиксирует `ERROR` без fallback. Все исключения изолированы
на уровне слота; polling, no-fill timeout и бесконечные повторы запрещены.

Отсутствие `MutationObserver` не ломает показ: image error освобождает
reservation, но удалённый сторонним кодом pending wrapper может остаться
зарезервированным до конца страницы. NanoFox намеренно не вводит polling ради
этого редкого legacy edge case.

## Ротация fallback

После официального no-fill weighted random выбирает только ещё не
подтверждённо просмотренные подходящие кампании. История per-origin хранится
отдельно от A/B в `localStorage` под `nanofox:rotation:<version>`; это
ограниченный список versioned токенов кампаний, без персональных данных.
Изменение `rotation.version` создаёт новый круг, а изменение experiment ID
меняет только A/B-назначение. Междоменной истории нет.

Кампания становится просмотренной только после успешного `img.load` и
пересечения `IntersectionObserver` с порогом 0.5. До этого действует
page-level reservation, поэтому параллельные слоты не выбирают одинаковый
непросмотренный креатив. Error изображения и удаление wrapper освобождают
reservation. Если все unseen-кандидаты заняты, слот остаётся пустым без
преждевременного reset, таймера или polling. После просмотра всех совместимых
кампаний начинается следующий круг. При storage error применяется page memory.
Без `IntersectionObserver` показ остаётся рабочим, но история не пополняется,
поэтому повтор возможен. История ограничена 100 записями по умолчанию и 500
максимум; при большем количестве активных кампаний полный круг не гарантирован.

## Отображение, аналитика и безопасность

Fallback строится только DOM API, без `innerHTML`: lazy/async image, размеры,
`target="_blank"`, `rel="sponsored noopener noreferrer"` и текстовая
маркировка. Это не заменяет юридические требования к рекламе. NanoFox
резервирует пространство inline-стилями и не подменяет YAN iframe.

При наличии уже загруженной Метрики отправляются необязательные события, а
также dispatch’ятся `CustomEvent`: eligible, YAN request/render, no-fill,
fallback render/visible/click и error. `fallback_visible` требует и load, и
IntersectionObserver. Параметры ограничены site, slot, campaign, source,
experiment, variant и reason.

Запрещены `eval`, динамическое исполнение строк, скрипты из конфигурации,
удалённая/query-параметр конфигурация и клиентские секреты. Совместимость CSP,
типы блоков, размеры, креативы, URL и правовая маркировка проверяются в staging
до production-включения.

## Проверка

Unit-тесты используют YAN mock и покрывают no-fill, ошибки, A/B, idempotency,
storage fallback, visibility, rotation cycle/reload, reservations, image error,
removal, eligibility, URL safety, lazy above/below viewport, dynamic slots и
legacy adapter. Playwright fixtures используют только локальный mock и не
запрашивают реальную рекламу. `npm run typecheck`, `npm run check:artifact` и
`npm run check:es5` проверяют strict source, актуальность артефакта и запрет
неполифиллируемых ES2015 API. Production deploy требует отдельного разрешения.
