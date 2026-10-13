# NanoFox — public specification v0.1

NanoFox is a compact self-hosted JavaScript waterfall for ordinary inline ad
slots. Production needs one file, `nanofox.js`; it has no runtime dependencies,
backend, database, build step, API, admin panel, or standalone CSS.

`nanofox.ts` is strictly type-checked and compiled into the checked-in ES5
artifact `nanofox.js`. TypeScript is development-only; production loads the
single ready JS file. The target deliberately requires no `Map`, `Set`,
`WeakMap`, `Promise`, `URL`, or polyfill. `IntersectionObserver`,
`MutationObserver`, `CustomEvent`, and `localStorage` are feature-detected and
have documented fail-open behaviour.

## Boundaries

- Yandex Advertising Network (YAN) is requested first through the existing
  loader and documented `Ya.Context.AdvManager.render`.
- A static partner image banner can run only from the final official YAN
  no-fill callback. Slow loading, a missing API, `onError`, `onRender`, DOM
  height, and iframe contents are not no-fill.
- This is not header bidding: no parallel auctions, concurrent partner-network
  calls, bid/eCPM comparison, or repeated YAN requests.
- A slot has one owner: NanoFox **or** its legacy renderer. The host path must
  call the normal renderer when NanoFox is missing or disabled.
- NanoFox uses no cookies, fingerprinting, user IDs, personal profiles, or
  proprietary network analytics.
- When enabled, lazy initialization waits for `IntersectionObserver` and a
  configured `rootMargin`; without that API it safely starts once immediately,
  with neither a polyfill nor DOM polling.

## Configuration

`CONFIG` is at the top of the runtime file. The public starter is disabled and
uses only `publisher.example` and placeholder values. A production configuration
must contain only approved block IDs, creatives, URLs, and ad disclosure.

A slot has `yandex`, explicit `width`/`height`, and `fallback` campaign IDs. A
campaign must be an enabled `image` with safe HTTPS or root-relative URLs,
matching dimensions, and a positive `weight`. Unsafe, incompatible, or disabled
campaigns are excluded.

For a responsive container, explicit `fallbackMaxWidth` / `fallbackMaxHeight`
and `reserveHeight` may replace width equality: a banner no larger than the
declared bounds is centered with `max-width:100%`, while height reservation
reduces CLS without imposing a desktop `min-width` on mobile. Without max
fields, the historical strict `slot.width×height == campaign.width×height`
contract remains.

`lazy` supplies `enabled` and `rootMargin`. Optional `legacy` supports only a
verified `.lazy-ad[data-block-id]` / `data-block-id` / `yaContextCb` /
`renderWidget()` contract: an explicit `legacy.slots` mapping from block ID to
an ordinary NanoFox slot moves that place to documented `render()` and may
enable fallback. Unmapped places remain Yandex-only. Special top/overlay/floor/
video/A-B formats belong in `excludedBlockIds` or retain another owner; a
universal loader replacement is not claimed.

## States and resilience

`IDLE → REQUESTING → NO_FILL → FALLBACK_RENDERED → DONE`; documented `onRender`
sets terminal `YAN_RENDERED`. Diagnostics are `ERROR`, `SKIPPED`, `DISABLED`,
and `UNKNOWN`. Duplicate and late callbacks cannot create a second display.

When the YAN API is still loading but `window.yaContextCb` exists, NanoFox
queues one call. When neither API nor queue is available, it records `UNKNOWN`
without fallback. `onError` records `ERROR` without fallback. Exceptions are
isolated per slot; polling, no-fill timeouts, and retry loops are prohibited.

Without `MutationObserver`, delivery still works: an image error releases its
reservation, while a pending wrapper removed by unrelated code can remain
reserved for that page. NanoFox intentionally does not add polling for this
rare legacy edge case.

## Fallback rotation

After official no-fill, weighted random selects only eligible campaigns not yet
confirmed viewed in the current cycle. Per-origin history is separate from A/B
under `nanofox:rotation:<version>` in `localStorage`; it is a bounded list of
versioned campaign tokens, not personal data. Changing `rotation.version`
starts a new cycle; changing the experiment ID changes only A/B assignment.
There is no cross-domain history.

A campaign is viewed only after successful `img.load` and a 0.5
`IntersectionObserver` threshold. Until then a page-level reservation prevents
concurrent slots from selecting the same unseen creative. An image error or
wrapper removal releases it. If all unseen candidates are reserved, the slot
remains empty without resetting early, setting a timer, or polling. After all
compatible campaigns are viewed, the next cycle begins. Page memory is used on
storage failure. Without `IntersectionObserver`, delivery still works but no
history is written, so repetition is possible. History defaults to 100 entries
and caps at 500; a complete cycle is not guaranteed above 500 active campaigns.

## Rendering, analytics, and security

Fallbacks use DOM APIs only—never `innerHTML`—with lazy/async image loading,
dimensions, `target="_blank"`, `rel="sponsored noopener noreferrer"`, and a
text label. This does not replace legal advertising obligations. NanoFox
reserves space with inline styles and never replaces a YAN iframe.

When an already-loaded Metrica counter is available, NanoFox sends optional
events and also dispatches `CustomEvent`: eligible, YAN request/render, no-fill,
fallback render/visible/click, and error. `fallback_visible` requires both load
and IntersectionObserver. Parameters are limited to site, slot, campaign,
source, experiment, variant, and reason.

`eval`, dynamic string execution, scripts from configuration, remote/query
configuration, and client-side secrets are forbidden. Verify CSP, unit type,
dimensions, creative rights, URL, and legal disclosure in staging before any
production enablement.

## Verification

Unit tests mock YAN and cover no-fill, errors, A/B, idempotency, storage
fallback, visibility, rotation cycle/reload, reservations, image error,
removal, eligibility, URL safety, lazy above/below-viewport behaviour, dynamic
slots, and the legacy adapter. Playwright fixtures use only a local mock and
never request a real ad. `npm run typecheck`, `npm run check:artifact`, and
`npm run check:es5` verify strict source, artifact freshness, and the absence
of unpolyfilled ES2015 APIs. Production deployment needs separate approval.
