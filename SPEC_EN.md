# NanoFox — public specification v0.1

NanoFox is a compact self-hosted JavaScript waterfall for ordinary inline ad
slots. Production needs one file, `nanofox.js`; it has no runtime dependencies,
backend, database, build step, API, admin panel, or standalone CSS.

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

## Configuration

`CONFIG` is at the top of the runtime file. The public starter is disabled and
uses only `publisher.example` and placeholder values. A production configuration
must contain only approved block IDs, creatives, URLs, and ad disclosure.

A slot has `yandex`, explicit `width`/`height`, and `fallback` campaign IDs. A
campaign must be an enabled `image` with safe HTTPS or root-relative URLs,
matching dimensions, and a positive `weight`. Unsafe, incompatible, or disabled
campaigns are excluded.

## States and resilience

`IDLE → REQUESTING → NO_FILL → FALLBACK_RENDERED → DONE`; documented `onRender`
sets terminal `YAN_RENDERED`. Diagnostics are `ERROR`, `SKIPPED`, `DISABLED`,
and `UNKNOWN`. Duplicate and late callbacks cannot create a second display.

When the YAN API is still loading but `window.yaContextCb` exists, NanoFox
queues one call. When neither API nor queue is available, it records `UNKNOWN`
without fallback. `onError` records `ERROR` without fallback. Exceptions are
isolated per slot; polling, no-fill timeouts, and retry loops are prohibited.

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
removal, eligibility, and URL safety. Playwright fixtures use only a local mock
and never request a real ad. Production deployment needs separate approval.
