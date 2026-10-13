# NanoFox

A minimal self-hosted advertising waterfall: one script, Yandex Advertising
Network (YAN) first, and a static image fallback only after the official no-fill
callback. There are no runtime dependencies, backend, database, build step,
cookies, or fingerprinting.

Russian version: [README.md](README.md). Full specifications:
[English](SPEC_EN.md) and [Russian](SPEC_RU.md).

> Status: local MVP. This repository does not deploy production code or enable
> any real publisher campaign.

## Behaviour

1. Finds `<div data-nanofox="article"></div>`.
2. Matches `location.hostname` and the slot to the in-file `CONFIG`.
3. Calls the already-loaded `Ya.Context.AdvManager.render` exactly once.
4. Selects one compatible active image campaign by weight only if YAN calls
   the documented no-fill callback.
5. Leaves the slot empty if no campaign qualifies. A NanoFox failure must not
   break the page.

NanoFox never uses timeouts, `onError`, `onRender`, DOM height, or an iframe to
infer no-fill. The documented `onError` only records diagnostic `ERROR`; it
never starts the partner fallback. NanoFox never loads the YAN loader a second
time.

This is **not header bidding**: NanoFox does not run parallel auctions, request
partner networks alongside YAN, or compare bids, eCPM, or source responses. A
partner image fallback is permitted only after the official YAN no-fill
callback. Slow loading, a missing YAN API, or `onError` are not no-fill and do
not display partner advertising.

Yandex documents this exact model in Russian, [“Show your own ad in a
unit”](https://yandex.ru/support/partner/ru/web/units/tag-features#rtb-code-tuning-alt-code):
the alternative code is the last argument to `render()` and runs only when the
auction has no suitable offer. The [English Yandex Advertising Network
documentation](https://yandex.com/support/partner/en/) is also linked here.
As of 13 October 2026, the English version of that page does not contain an
equivalent alternative-code section, so the precise normative link and code
example are the official Russian source above.

## Installation

Place an independent copy of `nanofox.js` on each site and configure it in the
file. The starter configuration intentionally uses `enabled: false` and has no
campaigns: it contains no live publisher IDs, creatives, partner URLs, or legal
marking data.

```html
<script src="/js/nanofox.js" defer></script>
<div data-nanofox="article"></div>
```

### Required host integration path

Those two lines are not a standalone fail-open solution if the page already
calls YAN. Every slot must have **one owner**: NanoFox or the legacy renderer.
Host code must remain on the page and call normal YAN when `nanofox.js` is
unavailable or disabled:

```html
<script>
  // Runs after deferred nanofox.js. If context.js is still loading, NanoFox
  // uses its existing yaContextCb queue.
  function renderArticleSlot(slotElement) {
    if (window.NanoFox && window.NanoFox.canOwn(slotElement)) {
      window.NanoFox.refresh(slotElement);
      return;
    }

    // The existing normal renderer for this slot. Preserve its existing block
    // ID, renderTo ID and lazy-load policy.
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

Do not leave the legacy `.lazy-ad` call beside this switch: replace the old
call for the approved slot. If NanoFox is absent, the legacy renderer runs; if
NanoFox is enabled and owns the configured slot, the legacy renderer does not.
That prevents a duplicate auction and permits a safe NanoFox rollback.

Use `NanoFox.refresh(root)` for dynamically inserted nodes. The same element
is processed once even when the script is included twice, `refresh` is repeated
or a no-fill callback arrives late.

## Configuration

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
      label: 'Advertisement'
    }
  },
  analytics: { enabled: true, provider: 'metrika', counterId: 123456 }
};
```

`width` and `height` are required and must match exactly between a slot and its
fallback campaign. Only HTTPS URLs and root-relative URLs (`/assets/ad.webp`)
are allowed; `http:`, `//`, `data:`, and `javascript:` are rejected. Creatives
use DOM APIs with `loading="lazy"`, `decoding="async"`, explicit dimensions,
`target="_blank"`, and `rel="sponsored noopener noreferrer"`.

This does not replace legal disclosure. Approve `label`, required identifiers,
creative rights, destination URL, and applicable legal requirements before
setting a campaign to `enabled: true`.

## Partner creative rotation

After official YAN no-fill, NanoFox makes a weighted-random selection only
among eligible active campaigns that have not been **confirmed visible** in the
current cycle. Per-origin history uses a separate `localStorage` key,
`nanofox:rotation:<version>`, containing only a bounded list of non-personal,
versioned campaign tokens. Changing `rotation.version` starts a new history;
changing the experiment ID changes only A/B assignment and does not reset
rotation. There is no cross-domain history.

A campaign enters history only after its image has loaded successfully and has
met the 0.5 `IntersectionObserver` threshold. DOM insertion, slow loading, and
an unseen banner do not consume history. Until visibility is confirmed, the
campaign has a page-level reservation, so concurrent slots cannot select it;
an image error or wrapper removal releases the reservation. If all still-unseen
campaigns are reserved, the slot remains empty: NanoFox does not reset the
cycle, set a timer, or poll the DOM.

After all compatible campaigns are confirmed viewed, only their history entries
are cleared and a new cycle begins. Disabled, unsafe, and incompatible campaigns
do not participate; changing a campaign URL or dimensions creates a new token
and treats it as new. History defaults to 100 entries but retains up to 500
current active campaigns; above that, a full cycle is not guaranteed. If storage
is unavailable, page memory is used. Without `IntersectionObserver`, delivery
still works but visibility cannot be confirmed: no history is committed and the
reservation releases after image load, so repetition is possible.

## States and measurement

`IDLE → REQUESTING → NO_FILL → FALLBACK_RENDERED → DONE`; a documented
`onRender` produces a separate terminal `YAN_RENDERED` state, and diagnostics
are `ERROR`, `SKIPPED`, `DISABLED`, and `UNKNOWN`. A `render()` return alone
does not prove an impression. `onRender` is used only as Yandex's documented
render signal and never as no-fill; the final `render()` callback is the sole
no-fill/fallback signal. Until either documented signal arrives, the slot stays
`REQUESTING`, avoiding guesses and premature partner advertising.

NanoFox uses an already-loaded Metrica counter only when `counterId` is set and
also dispatches `CustomEvent`s: `nanofox_eligible`, `nanofox_yandex_request`,
`nanofox_no_fill`, `nanofox_fallback_render`, `nanofox_fallback_visible`,
`nanofox_fallback_click`, and `nanofox_error`. Parameters are site, slot,
campaign, source, experiment, variant, and reason—no personal data or stable
visitor ID. `nanofox_fallback_visible` is recorded only after image load and
the `IntersectionObserver` threshold; a DOM insertion is not reported as a
visible impression. Analytics errors are ignored.

## Experiment

When `experiment.enabled` is true, control/treatment assignment is 50/50 (or
the configured weights), per origin, and saved under a `localStorage` key
containing the experiment ID. When storage is unavailable, assignment survives
only for the current page. Changing the ID starts a new assignment, not a new
rotation history. Control and treatment use identical YAN calls; control leaves
a no-fill slot empty and treatment may render fallback. With the experiment
disabled, fallback is available to every visitor while NanoFox is enabled.
Cross-domain assignment is not attempted.

## Verification

```bash
node --test tests/nanofox.test.js
```

The Node unit suite uses mocks and covers the 18 required scenarios plus 70/30
weighted selection. Browser fixtures live in `tests/playwright.spec.js`; they
run only with Playwright installed and do not send any real advertising request:

```bash
npm install --no-save @playwright/test
npx playwright test tests/playwright.spec.js
```

See [examples/index.html](examples/index.html) and
[docs/integration-example.html](docs/integration-example.html). Playwright is
a development/QA tool, not a NanoFox runtime dependency.

## Before enabling on a production site

1. Confirm the current loader, CSP, Metrica, unit type, and real dimensions in
   the source repository.
2. Choose an ordinary inline RTB unit with documented `render()` support only;
   exclude Overlay, Floor Ad, Top Ad, video, and Adfox-created units.
3. Introduce one owner switch, exercise mock no-fill on staging, and verify no
   second YAN call occurs.
4. Approve the creative, partner link, disclosure, and reporting process.
5. Start a limited experiment instead of replacing every unit at once.

## License

[MIT](LICENSE).
