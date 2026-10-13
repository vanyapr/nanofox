# NanoFox

**Lazy ads first.** NanoFox waits until an ad place is near the viewport before
calling Yandex Advertising Network (YAN). If YAN officially reports that its
auction found no ad, NanoFox can show an approved static partner banner in the
same place. It is a small self-hosted component, not another ad platform.

Russian: [README.md](README.md). Full specification: [SPEC_EN.md](SPEC_EN.md).

> This repository contains no real publisher block IDs, creatives, links, or
> configuration. The shipped configuration is disabled.

## 1. The problem

An ordinary YAN slot is sometimes filled and sometimes not. After an official
no-fill, a publisher may want to show approved partner material in that same
slot—without a parallel auction or a server just to rotate a few banners.

## 2. Existing solutions

Adfox and other ad servers solve a broader problem: inventory, campaign rules,
reporting, and integrations. Header bidding solicits competing bids before an
ad is shown. Those tools are appropriate when those capabilities are needed,
but can be excessive for testing one hypothesis: “what should appear after
no-fill?” NanoFox neither competes with bids nor replaces those systems.

References: [Yandex Adfox](https://yandex.ru/support/adfox/),
[Google Ad Manager](https://admanager.google.com/home/resources/), and
[Prebid](https://docs.prebid.org/overview/intro.html).

## 3. The approach

One file holds an image-campaign list and weights. For every slot NanoFox calls
YAN once. Only the documented final callback of
`Ya.Context.AdvManager.render()` moves the slot to `NO_FILL` and permits a
fallback choice. Slow delivery, a missing API, `onError`, container height, and
iframe contents are **not** no-fill.

YAN's official pattern: [showing own advertising in a unit](https://yandex.ru/support/partner/ru/web/units/tag-features#rtb-code-tuning-alt-code).

## 4. Benefits

- One ready `nanofox.js`; no runtime dependency, backend, database, or bundler.
- Lazy initialization via `IntersectionObserver`; safe immediate start when it
  is unavailable—no polyfill and no DOM polling.
- A narrow waterfall: YAN → official no-fill only → image fallback.
- Idempotent `refresh()` and callbacks: one DOM element cannot issue two YAN
  requests.
- Weighted rotation, non-personal localStorage, and events for an existing
  Metrica installation or `CustomEvent`.
- The shipped artifact is ES5 and deliberately avoids `Map`, `Set`, `WeakMap`,
  `Promise`, `URL`, and implied polyfills.

## 5. Limits

- Only static image fallback: no auction, frequency capping, or CPA reporting.
- A slow/missing YAN response or YAN error leaves a diagnostic state; it never
  starts partner delivery.
- Confirmed fallback visibility requires image `load` and an
  `IntersectionObserver` threshold of 0.5. Without it delivery still works,
  but history is not committed and repetition is possible.
- localStorage has only origin-local rotation tokens and experiment assignment.
  If storage is unavailable, they last only for the current page.
- Without `MutationObserver`, an externally removed, still-pending fallback
  keeps its page reservation. NanoFox does not poll DOM to cover that edge.
- Legal labeling, ERID, approvals, and creative rights remain publisher work.

## 6. How it works

1. `refresh()` discovers `[data-nanofox]` and optionally supported legacy
   markup.
2. If `lazy` is enabled, an observer waits for the configured `rootMargin`.
3. NanoFox creates a unique container and calls the existing YAN loader.
4. `onRender` records `YAN_RENDERED`; `onError` records `ERROR`.
5. Only the official no-fill callback lets the treatment select a compatible,
   active weighted banner.
6. The banner receives dimensions, `loading="lazy"`, `decoding="async"`, a new
   tab, and `rel="sponsored noopener noreferrer"`.

States are `IDLE → REQUESTING → YAN_RENDERED` or
`IDLE → REQUESTING → NO_FILL → FALLBACK_RENDERED → DONE`; `ERROR`, `SKIPPED`,
`DISABLED`, and `UNKNOWN` are also possible. A late callback cannot change a
terminal state.

## 7. Connect it

Production needs only built `nanofox.js`. `nanofox.ts` is the documented
source; `npm run build` deterministically regenerates the ready file.

```html
<script src="/js/nanofox.js" defer></script>
<div data-nanofox="article"></div>
```

An ordinary-slot configuration:

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

Call `NanoFox.refresh(root)` for dynamically inserted places. Calling it again
is safe.

### Responsive container, fixed banner

An adaptive container width does not have to equal the fallback's intrinsic
size. For example, a container up to 798 px wide (and at least 358 px in the
target mobile layout) can explicitly admit 300×250: NanoFox does not set
`min-width:798px`, reserves 250 px of height, and centers the banner with
`max-width:100%`.

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

Without `fallbackMaxWidth/fallbackMaxHeight`, the strict historical contract
remains: `campaign.width` and `campaign.height` must exactly equal `slot.width`
and `slot.height`. Add the fluid form only after confirming the real minimum
slot width and YAN format on staging.

### One YAN owner and rollback

Two tags alone are not fail-open where existing code already calls YAN. Each
slot needs exactly one owner: NanoFox or the old renderer. Keep a host-side
switch to the existing renderer:

```html
<script>
function renderArticle(slot) {
  if (window.NanoFox && window.NanoFox.canOwn(slot)) {
    window.NanoFox.refresh(slot);
  } else {
    /* The existing YAN call for this exact slot. */
    window.yaContextCb.push(function () {
      Ya.Context.AdvManager.render({ blockId: 'EXISTING_BLOCK_ID', renderTo: 'EXISTING_CONTAINER_ID' });
    });
  }
}
</script>
```

Missing NanoFox or `enabled: false` then returns to the old path without a
double render. Keep the existing YAN loader: NanoFox uses its `yaContextCb`
queue and does not load it again.

### Compatible legacy lazy markup

The verified legacy contract is `.lazy-ad[data-block-id]`, `data-block-id`,
`yaContextCb`, `rootMargin: "200px"`, and ordinary `renderWidget()`. It can be
enabled without editing the existing containers:

```js
legacy: {
  enabled: true,
  selector: '.lazy-ad[data-block-id]',
  rootMargin: '200px',
  slots: { 'R-A-PLACEHOLDER-1': 'article' },
  excludedBlockIds: []
}
```

Only an explicit `data-block-id → slot` mapping uses NanoFox `render()` and may
get fallback. An unmapped place stays lazy Yandex-only `renderWidget()` with no
fallback. Put top/overlay/floor/video and any special A/B formats in
`excludedBlockIds` until their own contract is migrated and tested. NanoFox does
not claim a universal drop-in replacement for such loaders.

## 8. Add banners to rotation

Use real, approved values in deployment; these are placeholders only:

```js
campaigns: {
  'partner-1': {
    enabled: true, type: 'image', image: '/ads/partner-300x250.webp',
    url: 'https://advertiser.example/path?affiliate=example',
    width: 300, height: 250, weight: 70, label: 'Advertisement', alt: ''
  },
  'partner-2': { /* same dimensions and fields, weight: 30 */ }
}
```

Only HTTPS and root-relative URLs are accepted; `http:`, `//`, `data:`, and
`javascript:` are rejected. A choice needs an enabled campaign of exactly the
slot size. History commits only after load and confirmed visibility; a page
reservation stops two slots choosing the same unseen campaign.

## 9. Check before launch

1. Confirm an ordinary inline YAN RTB slot and its no-fill callback.
2. Check dimensions, CSP for file/creatives, existing Metrica, and the loader.
3. Make a `data-block-id → slot` table and exclude special formats.
4. Approve URLs, tracking parameters, legal labels, and creative rights.
5. On staging test mock no-fill, slow/no response, `onError`, disabled mode,
   double initialization, desktop, and mobile.
6. Verify that one owner calls YAN and rollback reaches the old renderer.

## Development and checks

The only dev dependency is TypeScript 5.9.3 (Apache-2.0); it is absent from the
ready file. TypeScript 7 no longer supports an ES5 target, so the compatible
version is pinned. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

```bash
npm install
npm run build          # nanofox.ts -> nanofox.js
npm run typecheck      # strict, no emit
npm run check:artifact # catches stale nanofox.js
npm run check:es5      # catches APIs needing a polyfill
npm test               # typecheck + artifact + ES5 + unit tests
npm run test:browser   # Playwright QA with mocked YAN
```

`nanofox.js` remains the one runtime file. Useful commentary stays in both
source and artifact; measure raw and compressed size separately before release.

## License

[MIT](LICENSE).
