/*
 * NanoFox v0.1 | MIT
 *
 * This is the editable source. `nanofox.js` is the checked-in ES5 production
 * artifact produced by `npm run build`; it deliberately has no runtime
 * dependency. TypeScript is used for design-time guarantees only.
 *
 * Design rules that shape this file:
 * - A Yandex no-fill callback is the only transition that may start fallback.
 * - Every DOM element has one SlotRecord for this page, so refreshes and late
 *   callbacks cannot make a second request.
 * - The emitted program uses ES5 syntax and ES5 collection primitives. Modern
 *   browser APIs are optional capabilities, not implicit polyfills.
 */

function nanoFoxBootstrap(global: RuntimeHost): void {
  'use strict';

  if (!global || (global.NanoFox && global.NanoFox.__nanofox === true)) return;

  /*
   * Edit this object when deploying an independent copy to a site. It is kept
   * JSON-shaped on purpose: no remote configuration, callbacks, or secrets.
   * The shipped configuration is inert and contains no real advertising data.
   */
  var CONFIG: NanoFoxConfig = {
    enabled: false,
    experiment: { enabled: true, control: 50, treatment: 50, id: 'nanofox-v1' },
    lazy: { enabled: true, rootMargin: '200px' },
    sites: { 'publisher.example': { enabled: false, slots: {} } },
    campaigns: {},
    rotation: { version: 'v1', maxEntries: 100 },
    legacy: {
      enabled: false,
      selector: '.lazy-ad[data-block-id]',
      rootMargin: '200px',
      slots: {},
      excludedBlockIds: []
    },
    analytics: { enabled: true, provider: 'metrika', counterId: null }
  };

  var configured = isObject(global.__NANOFOX_TEST_CONFIG__) ? global.__NANOFOX_TEST_CONFIG__ as NanoFoxConfig : CONFIG;
  var engine = new NanoFoxEngine(global, configured);
  var api: NanoFoxApi = {
    canOwn: function (element: Element): boolean { return engine.canOwn(element); },
    refresh: function (root?: ParentNode | Element | null): SlotRecord[] { return engine.refresh(root); },
    getState: function (element: Element): State | null { return engine.getState(element); },
    __nanofox: true,
    version: '0.1.0'
  };

  // Test access is intentionally absent in production. It has no delivery role.
  if (global.__NANOFOX_TEST__ === true) {
    api.__test = { STATES: STATES, chooseCampaign: function (record: SlotRecord): Campaign | null {
      return engine.chooseCampaign(record);
    }, records: engine.records };
  }
  global.NanoFox = api;
  var document = global.document;
  safe(function (): SlotRecord[] { return engine.refresh(document || null); });
  /* The recommended tag is defer. This extra one-shot hook also supports a
   * legacy loader placed in head before its slots are parsed; the registry
   * makes a later refresh harmless. */
  if (document && document.readyState === 'loading' && typeof document.addEventListener === 'function') {
    var pendingDocument: Document = document;
    safe(function (): void { pendingDocument.addEventListener('DOMContentLoaded', function (): void { engine.refresh(pendingDocument); }); });
  }
}

/* ------------------------------------------------------------------------- */
/* Types are erased from the ES5 artifact. They make invalid state and config
 * relationships visible while retaining a small, direct runtime. */

type State = 'IDLE' | 'REQUESTING' | 'YAN_RENDERED' | 'NO_FILL' |
  'FALLBACK_RENDERED' | 'DONE' | 'ERROR' | 'SKIPPED' | 'DISABLED' | 'UNKNOWN';
type Variant = 'control' | 'treatment';
type Source = 'yandex' | 'fallback' | null;

interface ExperimentConfig { readonly enabled?: boolean; readonly control?: number; readonly treatment?: number; readonly id?: string; }
interface LazyConfig { readonly enabled?: boolean; readonly rootMargin?: string; }
interface SlotConfig {
  readonly yandex?: string;
  /* Fixed fallback format, retained for small fixed slots. */
  readonly width?: number;
  readonly height?: number;
  /* Fluid containers can admit smaller fixed banners without reserving width. */
  readonly fallbackMaxWidth?: number;
  readonly fallbackMaxHeight?: number;
  readonly reserveWidth?: number;
  readonly reserveHeight?: number;
  readonly fallbackAlign?: 'start' | 'center';
  readonly fallback?: readonly string[];
}
interface SiteConfig { readonly enabled?: boolean; readonly slots?: ReadonlyDictionary<SlotConfig>; }
interface CampaignConfig { readonly enabled?: boolean; readonly type?: string; readonly image?: string; readonly url?: string; readonly width?: number; readonly height?: number; readonly weight?: number; readonly label?: string; readonly alt?: string; }
interface RotationConfig { readonly version?: string; readonly maxEntries?: number; }
interface LegacyConfig {
  readonly enabled?: boolean;
  readonly selector?: string;
  readonly rootMargin?: string;
  /* Key: legacy data-block-id; value: an explicitly approved NanoFox slot. */
  readonly slots?: ReadonlyDictionary<string>;
  /* Special formats stay with their existing owner unless explicitly migrated. */
  readonly excludedBlockIds?: readonly string[];
}
interface AnalyticsConfig { readonly enabled?: boolean; readonly provider?: string; readonly counterId?: number | null; }
interface NanoFoxConfig {
  readonly enabled?: boolean;
  readonly experiment?: ExperimentConfig;
  readonly lazy?: LazyConfig;
  readonly sites?: ReadonlyDictionary<SiteConfig>;
  readonly campaigns?: ReadonlyDictionary<CampaignConfig>;
  readonly rotation?: RotationConfig;
  readonly legacy?: LegacyConfig;
  readonly analytics?: AnalyticsConfig;
}
interface ReadonlyDictionary<T> { readonly [key: string]: T | undefined; }
interface Assignment { readonly variant: Variant; readonly persistent: boolean; readonly reason?: string; }
interface Campaign { readonly id: string; readonly enabled: boolean; readonly type: 'image'; readonly image: string; readonly url: string; readonly width: number; readonly height: number; readonly weight: number; readonly label?: string; readonly alt?: string; readonly rotationToken: string; }
interface HistoryEntry { readonly state: State; readonly reason: string | null; }
interface RotationSettings { readonly key: string; readonly maxEntries: number; }
interface CampaignSelection { readonly campaign: Campaign | null; readonly reason: string | null; }
interface SlotRecord {
  readonly element: Element;
  readonly site: string;
  readonly slotName: string;
  readonly slot: SlotConfig;
  readonly variant: Variant;
  readonly experiment: ExperimentConfig;
  mode: 'nanofox' | 'legacy-widget';
  state: State;
  reason: string | null;
  source: Source;
  campaign: Campaign | null;
  reservedToken: string | null;
  fallbackLoaded: boolean;
  fallbackVisible: boolean;
  visibilitySupported: boolean;
  rotationCommitted: boolean;
  visibilityObserver: IntersectionObserver | null;
  removalObserver: MutationObserver | null;
  lazyObserver: IntersectionObserver | null;
  yandexContainer: Element | null;
  yandexCalled: boolean;
  readonly history: HistoryEntry[];
}
interface YandexRenderOptions { blockId: string; renderTo: string; onRender?: () => void; onError?: () => void; }
interface YandexManager { render(options: YandexRenderOptions, noFill: () => void): void; renderWidget?(options: { blockId: string; renderTo: string }): void; }
interface RuntimeHost {
  document?: Document;
  location?: { hostname?: string };
  localStorage?: Storage;
  yaContextCb?: Array<() => void>;
  Ya?: { Context?: { AdvManager?: YandexManager } };
  ym?: (counterId: number, action: string, name: string, params: EventParameters) => void;
  Math?: Math;
  CustomEvent?: typeof CustomEvent;
  IntersectionObserver?: typeof IntersectionObserver;
  MutationObserver?: typeof MutationObserver;
  dispatchEvent?: (event: Event) => boolean;
  NanoFox?: NanoFoxApi;
  __NANOFOX_TEST__?: boolean;
  __NANOFOX_TEST_CONFIG__?: unknown;
  NanoFoxLegacySpecialRenderer?: (element: Element, blockId: string) => void;
}
interface EventParameters { readonly site: string; readonly slot: string; readonly campaign: string | null; readonly source: Source; readonly experiment: string | null; readonly variant: Variant; readonly reason: string | null; }
interface NanoFoxApi {
  readonly __nanofox: true;
  readonly version: string;
  __test?: { readonly STATES: ReadonlyDictionary<State>; readonly chooseCampaign: (record: SlotRecord) => Campaign | null; readonly records: ElementRegistry; };
  canOwn(element: Element): boolean;
  refresh(root?: ParentNode | Element | null): SlotRecord[];
  getState(element: Element): State | null;
}

var STATES: ReadonlyDictionary<State> = {
  IDLE: 'IDLE', REQUESTING: 'REQUESTING', YAN_RENDERED: 'YAN_RENDERED',
  NO_FILL: 'NO_FILL', FALLBACK_RENDERED: 'FALLBACK_RENDERED', DONE: 'DONE',
  ERROR: 'ERROR', SKIPPED: 'SKIPPED', DISABLED: 'DISABLED', UNKNOWN: 'UNKNOWN'
};

/* ES5 has no Map, Set, or WeakMap. These bounded page-lifetime structures are
 * intentionally simple: NanoFox tracks only the elements it initializes and a
 * short list of rotation tokens. They avoid asking sites to ship polyfills. */
class StringSet {
  private values: string[] = [];
  has(value: string): boolean { return this.values.indexOf(value) !== -1; }
  add(value: string): void { if (!this.has(value)) this.values.push(value); }
  delete(value: string): void { var index = this.values.indexOf(value); if (index !== -1) this.values.splice(index, 1); }
  get size(): number { return this.values.length; }
}

class StringArrayStore {
  private entries: Array<{ key: string; values: string[] }> = [];
  get(key: string): string[] {
    var index: number;
    for (index = 0; index < this.entries.length; index += 1) if (this.entries[index].key === key) return this.entries[index].values.slice();
    return [];
  }
  set(key: string, values: string[]): void {
    var index: number;
    for (index = 0; index < this.entries.length; index += 1) {
      if (this.entries[index].key === key) { this.entries[index].values = values.slice(); return; }
    }
    this.entries.push({ key: key, values: values.slice() });
  }
}

class ElementRegistry {
  private entries: Array<{ element: Element; record: SlotRecord }> = [];
  get(element: Element): SlotRecord | null {
    var index: number;
    for (index = 0; index < this.entries.length; index += 1) if (this.entries[index].element === element) return this.entries[index].record;
    return null;
  }
  set(element: Element, record: SlotRecord): void { this.entries.push({ element: element, record: record }); }
}

/** Analytics has no delivery authority: every failure is caught at this edge. */
class AnalyticsReporter {
  constructor(private readonly host: RuntimeHost, private readonly config: NanoFoxConfig) {}

  report(name: string, record: SlotRecord, extra?: Partial<EventParameters>): void {
    var params = eventParameters(record, extra);
    safe((): void => {
      var target: { dispatchEvent?: (event: Event) => boolean } | undefined =
        typeof this.host.dispatchEvent === 'function' ? this.host : this.host.document;
      if (target && typeof target.dispatchEvent === 'function' && typeof this.host.CustomEvent === 'function') {
        target.dispatchEvent(new this.host.CustomEvent(name, { detail: params }));
      }
    });

    var analytics = this.config.analytics;
    if (!analytics || analytics.enabled !== true || analytics.provider !== 'metrika' ||
        !finiteNumber(analytics.counterId) || typeof this.host.ym !== 'function') return;
    var counterId = analytics.counterId;
    safe((): void => { (this.host.ym as NonNullable<RuntimeHost['ym']>)(counterId as number, 'reachGoal', name, params); });
  }
}

/**
 * The rotation store commits a token only after a loaded fallback becomes
 * observable. Until then it reserves that token for this page: a second slot
 * cannot duplicate an unseen campaign, but a failure can release it.
 */
class RotationHistory {
  private readonly memory = new StringArrayStore();
  private readonly reservations = new StringSet();

  constructor(private readonly host: RuntimeHost, private readonly config: NanoFoxConfig) {}

  choose(record: SlotRecord): CampaignSelection {
    var candidates = this.candidates(record);
    if (candidates.length === 0) return { campaign: null, reason: 'no_eligible_campaign' };
    var active = this.activeTokens();
    var settings = this.settings(active.size);
    var history = this.read(settings, active);
    this.save(settings, history, active);
    var seen = new StringSet();
    var index: number;
    for (index = 0; index < history.length; index += 1) seen.add(history[index]);
    var unseen = candidates.filter(function (campaign: Campaign): boolean { return !seen.has(campaign.rotationToken); });
    var available = unseen.filter((campaign: Campaign): boolean => !this.reservations.has(campaign.rotationToken));
    if (available.length === 0 && unseen.length > 0) return { campaign: null, reason: 'unseen_campaign_reserved' };
    if (available.length === 0) {
      available = candidates.filter((campaign: Campaign): boolean => !this.reservations.has(campaign.rotationToken));
      if (available.length === 0) return { campaign: null, reason: 'cycle_campaign_reserved' };
      var current = new StringSet();
      for (index = 0; index < candidates.length; index += 1) current.add(candidates[index].rotationToken);
      history = history.filter(function (token: string): boolean { return !current.has(token); });
      this.save(settings, history, active);
    }
    var campaign = weightedCampaign(this.host, available);
    if (!campaign) return { campaign: null, reason: 'no_eligible_campaign' };
    this.reservations.add(campaign.rotationToken);
    record.reservedToken = campaign.rotationToken;
    return { campaign: campaign, reason: null };
  }

  /* A non-mutating helper used only by the deterministic unit test for the
   * weighted distribution. Normal delivery always goes through choose(). */
  weightedCandidate(record: SlotRecord): Campaign | null { return weightedCampaign(this.host, this.candidates(record)); }

  release(record: SlotRecord): void {
    if (!record.reservedToken) return;
    this.reservations.delete(record.reservedToken);
    record.reservedToken = null;
  }

  commitVisible(record: SlotRecord): void {
    var active = this.activeTokens();
    var settings = this.settings(active.size);
    var history = this.read(settings, active).filter(function (token: string): boolean { return token !== record.reservedToken; });
    if (record.reservedToken && active.has(record.reservedToken)) history.push(record.reservedToken);
    this.save(settings, history, active);
  }

  private candidates(record: SlotRecord): Campaign[] {
    var ids = Array.isArray(record.slot.fallback) ? record.slot.fallback : [];
    var campaigns = this.config.campaigns || {};
    var result: Campaign[] = [];
    var index: number;
    for (index = 0; index < ids.length; index += 1) {
      var id = ids[index];
      var campaign = campaignFromConfig(id, campaigns[id]);
      if (campaign && compatibleCampaign(campaign, record.slot)) result.push(campaign);
    }
    return result;
  }

  private settings(activeCount: number): RotationSettings {
    var rotation = this.config.rotation || {};
    var version = typeof rotation.version === 'string' && rotation.version.length > 0 && rotation.version.length <= 64 ? rotation.version : 'v1';
    var requested = rotation.maxEntries;
    var requestedMax = integerNumber(requested) && requested > 0 ? Math.min(requested, 500) : 100;
    return { key: 'nanofox:rotation:' + version, maxEntries: Math.min(500, Math.max(requestedMax, activeCount || 0)) };
  }

  private activeTokens(): StringSet {
    var set = new StringSet();
    var campaigns = this.config.campaigns || {};
    var ids = Object.keys(campaigns);
    var index: number;
    for (index = 0; index < ids.length; index += 1) {
      var campaign = campaignFromConfig(ids[index], campaigns[ids[index]]);
      if (campaign) set.add(campaign.rotationToken);
    }
    return set;
  }

  private clean(values: unknown, allowed: StringSet, maxEntries: number): string[] {
    var raw = Array.isArray(values) ? values : [];
    var clean: string[] = [];
    var index: number;
    for (index = 0; index < raw.length; index += 1) {
      var value = raw[index];
      if (typeof value === 'string' && value.length <= 256 && allowed.has(value) && clean.indexOf(value) === -1) clean.push(value);
    }
    return clean.slice(-maxEntries);
  }

  private read(settings: RotationSettings, allowed: StringSet): string[] {
    var raw: string | null = null;
    var storage = safe((): Storage | undefined => this.host.localStorage);
    safe(function (): void { if (storage && typeof storage.getItem === 'function') raw = storage.getItem(settings.key); });
    var parsed = raw ? safe(function (): unknown { return JSON.parse(raw as string); }) : undefined;
    var values = isObject(parsed) && parsed.v === 1 && Array.isArray(parsed.seen) ? parsed.seen : this.memory.get(settings.key);
    var clean = this.clean(values, allowed, settings.maxEntries);
    this.memory.set(settings.key, clean);
    return clean;
  }

  private save(settings: RotationSettings, values: string[], allowed: StringSet): void {
    var clean = this.clean(values, allowed, settings.maxEntries);
    this.memory.set(settings.key, clean);
    var storage = safe((): Storage | undefined => this.host.localStorage);
    safe(function (): void { if (storage && typeof storage.setItem === 'function') storage.setItem(settings.key, JSON.stringify({ v: 1, seen: clean })); });
  }
}

/**
 * This adapter is deliberately narrow. It uses the documented render callback
 * for a NanoFox slot; renderWidget is retained only for an explicitly legacy,
 * Yandex-only slot and never enables a partner fallback.
 */
class YandexAdapter {
  constructor(private readonly host: RuntimeHost) {}

  request(record: SlotRecord, handlers: { rendered: () => void; noFill: () => void; error: () => void; unavailable: () => void }): void {
    if (record.yandexCalled || record.state !== 'REQUESTING') return;
    record.yandexCalled = true;
    var manager = this.manager();
    if (!manager || typeof manager.render !== 'function' || !record.yandexContainer) { handlers.unavailable(); return; }
    try {
      manager.render({ blockId: record.slot.yandex as string, renderTo: record.yandexContainer.id,
        onRender: handlers.rendered, onError: handlers.error }, handlers.noFill);
    } catch (_) { handlers.error(); }
  }

  requestLegacyWidget(record: SlotRecord, unavailable: () => void): void {
    if (record.yandexCalled || !record.yandexContainer) return;
    record.yandexCalled = true;
    var manager = this.manager();
    if (!manager || typeof manager.renderWidget !== 'function') { unavailable(); return; }
    try { manager.renderWidget({ blockId: record.slot.yandex as string, renderTo: record.yandexContainer.id }); }
    catch (_) { unavailable(); }
  }

  ready(): boolean { var manager = this.manager(); return !!manager && typeof manager.render === 'function'; }
  widgetReady(): boolean { var manager = this.manager(); return !!manager && typeof manager.renderWidget === 'function'; }
  private manager(): YandexManager | undefined { return safe((): YandexManager | undefined => this.host.Ya && this.host.Ya.Context && this.host.Ya.Context.AdvManager); }
}

/** The engine is the one owner of NanoFox request state and DOM writes. */
class NanoFoxEngine {
  readonly records = new ElementRegistry();
  private sequence = 0;
  private readonly analytics: AnalyticsReporter;
  private readonly rotation: RotationHistory;
  private readonly yandex: YandexAdapter;

  constructor(private readonly host: RuntimeHost, private readonly config: NanoFoxConfig) {
    this.analytics = new AnalyticsReporter(host, config);
    this.rotation = new RotationHistory(host, config);
    this.yandex = new YandexAdapter(host);
  }

  canOwn(element: Element): boolean {
    var site = this.site();
    var siteConfig = this.siteConfig(site);
    var slotName = safe(function (): string | null { return element.getAttribute('data-nanofox'); }) || '';
    var slot = siteConfig && siteConfig.slots ? siteConfig.slots[slotName] : undefined;
    return this.config.enabled === true && !!siteConfig && siteConfig.enabled === true && validSlot(slot);
  }

  getState(element: Element): State | null { var record = this.records.get(element); return record ? record.state : null; }
  chooseCampaign(record: SlotRecord): Campaign | null { return this.rotation.weightedCandidate(record); }

  refresh(root?: ParentNode | Element | null): SlotRecord[] {
    var scope = root || this.host.document || null;
    if (!scope) return [];
    var nodes = nodesFor(scope, '[data-nanofox]');
    var legacy = this.config.legacy;
    if (legacy && legacy.enabled === true) nodes = nodes.concat(nodesFor(scope, legacy.selector || '.lazy-ad[data-block-id]'));
    var result: SlotRecord[] = [];
    var index: number;
    for (index = 0; index < nodes.length; index += 1) {
      var record = this.initialize(nodes[index]);
      if (record) result.push(record);
    }
    return result;
  }

  private initialize(element: Element): SlotRecord | null {
    var existing = this.records.get(element);
    if (existing) return existing;
    var isLegacy = matches(element, this.config.legacy && this.config.legacy.selector || '.lazy-ad[data-block-id]') && !matches(element, '[data-nanofox]');
    return isLegacy ? this.initializeLegacy(element) : this.initializeNanoFox(element);
  }

  private initializeNanoFox(element: Element): SlotRecord {
    var site = this.site();
    var name = safe(function (): string | null { return element.getAttribute('data-nanofox'); }) || '';
    var siteConfig = this.siteConfig(site);
    var slot = siteConfig && siteConfig.slots ? siteConfig.slots[name] : undefined;
    var record = makeRecord(element, site, name, slot || {}, this.assignment(), this.config.experiment || {}, 'nanofox');
    this.records.set(element, record);
    if (this.config.enabled !== true) { transition(record, 'DISABLED', 'disabled'); return record; }
    if (!siteConfig) { transition(record, 'SKIPPED', 'unknown_site'); return record; }
    if (siteConfig.enabled !== true) { transition(record, 'DISABLED', 'site_disabled'); return record; }
    if (!validSlot(slot)) { transition(record, 'SKIPPED', 'unknown_site_or_slot'); return record; }
    this.reserveSpace(record);
    this.analytics.report('nanofox_eligible', record, { source: 'yandex' });
    this.lazyOrRequest(record, this.config.lazy);
    return record;
  }

  /*
   * Compatibility route: existing markup keeps its block id and lazy timing.
   * Only a block explicitly mapped in legacy.slots becomes a full NanoFox slot;
   * unlisted blocks use Yandex renderWidget and are never candidates for
   * fallback. This prevents accidentally changing overlays, video, or tests.
   */
  private initializeLegacy(element: Element): SlotRecord {
    var site = this.site();
    var legacy = this.config.legacy || {};
    var blockId = safe(function (): string | null { return element.getAttribute('data-block-id'); }) || '';
    var mapped = legacy.slots ? legacy.slots[blockId] : undefined;
    var siteConfig = this.siteConfig(site);
    var slot = mapped && siteConfig && siteConfig.slots ? siteConfig.slots[mapped] : undefined;
    var excluded = containsString(legacy.excludedBlockIds || [], blockId);
    var record = makeRecord(element, site, mapped || blockId, slot || { yandex: blockId }, this.assignment(), this.config.experiment || {}, 'legacy-widget');
    this.records.set(element, record);
    if (!blockId) { transition(record, 'SKIPPED', 'legacy_missing_block_id'); return record; }
    if (excluded) {
      transition(record, 'SKIPPED', 'legacy_special_format');
      safe((): void => { if (typeof this.host.NanoFoxLegacySpecialRenderer === 'function') this.host.NanoFoxLegacySpecialRenderer(element, blockId); });
      return record;
    }
    if (this.config.enabled === true && siteConfig && siteConfig.enabled === true && mapped && validSlot(slot) && slot.yandex === blockId) {
      record.mode = 'nanofox';
      this.reserveSpace(record);
      this.analytics.report('nanofox_eligible', record, { source: 'yandex' });
      this.lazyOrRequest(record, legacy);
      return record;
    }
    this.lazyOrLegacyWidget(record, legacy);
    return record;
  }

  private lazyOrRequest(record: SlotRecord, settings?: LazyConfig | LegacyConfig): void {
    this.lazy(record, settings, (): void => { this.requestYandex(record); });
  }
  private lazyOrLegacyWidget(record: SlotRecord, settings?: LazyConfig | LegacyConfig): void {
    this.lazy(record, settings, (): void => { this.requestLegacyWidget(record); });
  }
  private lazy(record: SlotRecord, settings: LazyConfig | LegacyConfig | undefined, start: () => void): void {
    if (!settings || settings.enabled !== true || typeof this.host.IntersectionObserver !== 'function') { start(); return; }
    var observer = safe((): IntersectionObserver => new (this.host.IntersectionObserver as typeof IntersectionObserver)(function (entries: IntersectionObserverEntry[], active: IntersectionObserver): void {
      var index: number;
      for (index = 0; index < entries.length; index += 1) {
        if (entries[index].isIntersecting && entries[index].target === record.element) { safe(function (): void { active.unobserve(record.element); }); record.lazyObserver = null; start(); return; }
      }
    }, { rootMargin: validRootMargin(settings.rootMargin) ? settings.rootMargin : '200px' }));
    if (!observer) { start(); return; }
    var lazyObserver: IntersectionObserver = observer;
    if (safe(function (): boolean { lazyObserver.observe(record.element); return true; }) !== true) { start(); return; }
    record.lazyObserver = lazyObserver;
  }

  private requestYandex(record: SlotRecord): void {
    var container = this.container(record);
    if (!container) { this.error(record, 'dom_unavailable'); return; }
    record.source = 'yandex';
    transition(record, 'REQUESTING', 'yandex_request');
    this.analytics.report('nanofox_yandex_request', record, { source: 'yandex' });
    if (this.yandex.ready()) { this.callYandex(record); return; }
    var queue = this.host.yaContextCb;
    if (!Array.isArray(queue)) { this.unknown(record, 'yandex_api_unavailable'); return; }
    var loaderQueue = queue;
    safe((): void => { loaderQueue.push((): void => { this.callYandex(record); }); });
  }

  private callYandex(record: SlotRecord): void {
    this.yandex.request(record, {
      rendered: (): void => { if (transition(record, 'YAN_RENDERED', 'yandex_rendered')) { record.source = 'yandex'; this.analytics.report('nanofox_yandex_render', record, { source: 'yandex' }); } },
      noFill: (): void => { this.noFill(record); },
      error: (): void => { this.error(record, 'yandex_request_error'); },
      unavailable: (): void => { this.unknown(record, 'yandex_api_unavailable'); }
    });
  }

  private requestLegacyWidget(record: SlotRecord): void {
    var container = this.container(record);
    if (!container) { this.error(record, 'dom_unavailable'); return; }
    record.source = 'yandex';
    transition(record, 'REQUESTING', 'legacy_widget_request');
    var start = (): void => {
      this.yandex.requestLegacyWidget(record, (): void => { this.unknown(record, 'yandex_widget_unavailable'); });
      if (record.state === 'REQUESTING') transition(record, 'DONE', 'legacy_widget_requested');
    };
    if (this.yandex.widgetReady()) { start(); return; }
    var queue = this.host.yaContextCb;
    if (!Array.isArray(queue)) { this.unknown(record, 'yandex_widget_unavailable'); return; }
    var legacyQueue = queue;
    safe(function (): void { legacyQueue.push(start); });
  }

  private noFill(record: SlotRecord): void {
    if (record.state !== 'REQUESTING') return;
    record.source = 'yandex';
    transition(record, 'NO_FILL', 'official_no_fill');
    this.analytics.report('nanofox_no_fill', record, { source: 'yandex' });
    if (record.variant === 'control') { transition(record, 'DONE', 'control_no_fill'); return; }
    this.renderFallback(record);
  }

  private renderFallback(record: SlotRecord): void {
    var selection = this.rotation.choose(record);
    if (!selection.campaign) { transition(record, 'DONE', selection.reason || 'no_eligible_campaign'); return; }
    var document = this.host.document;
    if (!document || typeof document.createElement !== 'function') { this.rotation.release(record); this.error(record, 'dom_unavailable'); return; }
    var campaign = selection.campaign;
    record.campaign = campaign;
    record.source = 'fallback';
    var wrapper = document.createElement('div');
    var label = document.createElement('span');
    var link = document.createElement('a');
    var image = document.createElement('img');
    label.textContent = campaign.label || 'Реклама';
    link.href = campaign.url; link.target = '_blank'; link.rel = 'sponsored noopener noreferrer';
    image.src = campaign.image; image.alt = campaign.alt || ''; image.width = campaign.width; image.height = campaign.height;
    /* Attribute form is safe in old DOMs; properties preserve the native hint
     * where supported and make the intent observable to simple integrations. */
    image.setAttribute('loading', 'lazy'); image.setAttribute('decoding', 'async');
    (image as HTMLImageElement).loading = 'lazy';
    (image as HTMLImageElement).decoding = 'async';
    if (fluidFallback(record.slot)) {
      wrapper.style.textAlign = record.slot.fallbackAlign === 'start' ? 'left' : 'center';
      link.style.display = 'inline-block';
      image.style.maxWidth = '100%';
      image.style.height = 'auto';
    }
    listenOnce(link, 'click', (): void => { this.analytics.report('nanofox_fallback_click', record, { source: 'fallback' }); });
    listenOnce(image, 'error', (): void => { this.rotation.release(record); this.stopObservers(record); if (transition(record, 'ERROR', 'fallback_image_error')) { removeNode(wrapper); this.analytics.report('nanofox_error', record, { source: 'fallback' }); } });
    listenOnce(image, 'load', (): void => {
      record.fallbackLoaded = true; transition(record, 'DONE', 'fallback_image_loaded');
      if (record.visibilitySupported) this.confirmVisible(record); else this.rotation.release(record);
    });
    link.appendChild(image); wrapper.appendChild(label); wrapper.appendChild(link); record.element.appendChild(wrapper);
    transition(record, 'FALLBACK_RENDERED', 'official_no_fill');
    this.analytics.report('nanofox_fallback_render', record, { source: 'fallback' });
    record.visibilitySupported = this.trackVisibility(record, image);
    this.watchRemoval(record, wrapper);
  }

  private trackVisibility(record: SlotRecord, image: Element): boolean {
    if (typeof this.host.IntersectionObserver !== 'function') return false;
    var observer = safe((): IntersectionObserver => new (this.host.IntersectionObserver as typeof IntersectionObserver)((entries: IntersectionObserverEntry[], active: IntersectionObserver): void => {
      var index: number;
      for (index = 0; index < entries.length; index += 1) if (entries[index].isIntersecting) { record.fallbackVisible = true; this.confirmVisible(record); if (record.rotationCommitted) safe(function (): void { active.unobserve(entries[index].target); }); }
    }, { threshold: 0.5 }));
    if (!observer) return false;
    var visibilityObserver: IntersectionObserver = observer;
    if (safe(function (): boolean { visibilityObserver.observe(image); return true; }) !== true) return false;
    record.visibilityObserver = visibilityObserver;
    return true;
  }

  private confirmVisible(record: SlotRecord): void {
    if (!record.fallbackLoaded || !record.fallbackVisible || record.rotationCommitted) return;
    record.rotationCommitted = true; this.rotation.commitVisible(record); this.rotation.release(record); this.stopObservers(record);
    this.analytics.report('nanofox_fallback_visible', record, { source: 'fallback' });
  }

  /* MutationObserver is optional. Without it, image errors still release a
   * reservation; an externally removed pending wrapper can remain reserved for
   * this page. We never poll DOM merely to improve this legacy edge case. */
  private watchRemoval(record: SlotRecord, wrapper: Element): void {
    var document = this.host.document;
    var root = document && document.documentElement;
    if (!root || typeof this.host.MutationObserver !== 'function') return;
    var observedRoot: HTMLElement = root;
    var observer = safe((): MutationObserver => new (this.host.MutationObserver as typeof MutationObserver)((): void => {
      safe((): void => { if (observedRoot.contains(wrapper)) return; this.rotation.release(record); this.stopObservers(record); });
    }));
    if (!observer) return;
    var removalObserver: MutationObserver = observer;
    if (safe(function (): boolean { removalObserver.observe(observedRoot, { childList: true, subtree: true }); return true; }) === true) record.removalObserver = removalObserver;
  }

  private stopObservers(record: SlotRecord): void {
    safe(function (): void { if (record.visibilityObserver) record.visibilityObserver.disconnect(); });
    safe(function (): void { if (record.removalObserver) record.removalObserver.disconnect(); });
    record.visibilityObserver = null; record.removalObserver = null;
  }
  private error(record: SlotRecord, reason: string): void { if (record.state === 'REQUESTING' || record.state === 'FALLBACK_RENDERED' || record.state === 'IDLE') if (transition(record, 'ERROR', reason)) this.analytics.report('nanofox_error', record, { source: record.source || 'yandex' }); }
  private unknown(record: SlotRecord, reason: string): void { if (record.state === 'REQUESTING') if (transition(record, 'UNKNOWN', reason)) this.analytics.report('nanofox_error', record, { source: 'yandex' }); }
  private container(record: SlotRecord): Element | null { var document = this.host.document; if (!document || typeof document.createElement !== 'function') return null; this.sequence += 1; var container = document.createElement('div'); container.id = 'nanofox-yandex-' + this.sequence; record.element.appendChild(container); record.yandexContainer = container; return container; }
  /* A fluid slot reserves height before any source responds, but never forces
   * its desktop max width onto a narrow viewport. Fixed legacy formats retain
   * their historical width × height reservation. */
  private reserveSpace(record: SlotRecord): void {
    var style = (record.element as HTMLElement).style;
    if (!style) return;
    var dimensions = fallbackDimensions(record.slot);
    if (!dimensions) return;
    var reserveWidth = validSize(record.slot.reserveWidth, record.slot.reserveHeight) ? record.slot.reserveWidth : (fluidFallback(record.slot) ? undefined : dimensions.width);
    var reserveHeight = validSize(record.slot.reserveWidth, record.slot.reserveHeight) ? record.slot.reserveHeight : (integerNumber(record.slot.reserveHeight) && record.slot.reserveHeight > 0 ? record.slot.reserveHeight : dimensions.height);
    if (integerNumber(reserveWidth) && reserveWidth > 0) style.minWidth = String(reserveWidth) + 'px';
    if (integerNumber(reserveHeight) && reserveHeight > 0) style.minHeight = String(reserveHeight) + 'px';
  }
  private site(): string { var name = safe((): string | undefined => this.host.location && this.host.location.hostname); return typeof name === 'string' ? name.toLowerCase() : ''; }
  private siteConfig(site: string): SiteConfig | undefined { return this.config.sites ? this.config.sites[site] : undefined; }
  private assignment(): Assignment { return experimentAssignment(this.host, this.config.experiment); }
}

/* Pure helpers: no feature here needs a modern intrinsic. */
function getRuntimeHost(): RuntimeHost {
  /* `globalThis` would itself require a polyfill on older supported browsers. */
  if (typeof window !== 'undefined') return window as unknown as RuntimeHost;
  if (typeof self !== 'undefined') return self as unknown as RuntimeHost;
  return {} as RuntimeHost;
}
function safe<T>(callback: () => T): T | undefined { try { return callback(); } catch (_) { return undefined; } }
function isObject(value: unknown): value is { readonly [key: string]: unknown } { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function finiteNumber(value: unknown): value is number { return typeof value === 'number' && isFinite(value); }
function integerNumber(value: unknown): value is number { return finiteNumber(value) && Math.floor(value) === value; }
function validSize(width: unknown, height: unknown): width is number { return integerNumber(width) && integerNumber(height) && width > 0 && height > 0 && width <= 4096 && height <= 4096; }
function fallbackDimensions(slot: SlotConfig): { width: number; height: number } | null {
  if (validSize(slot.fallbackMaxWidth, slot.fallbackMaxHeight)) return { width: slot.fallbackMaxWidth as number, height: slot.fallbackMaxHeight as number };
  if (validSize(slot.width, slot.height)) return { width: slot.width as number, height: slot.height as number };
  return null;
}
function fluidFallback(slot: SlotConfig): boolean { return validSize(slot.fallbackMaxWidth, slot.fallbackMaxHeight); }
function validSlot(slot: SlotConfig | undefined): slot is SlotConfig { return !!slot && typeof slot.yandex === 'string' && slot.yandex.length > 0 && fallbackDimensions(slot) !== null; }
function safeUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false;
  if (value.charAt(0) === '/' && value.charAt(1) !== '/') return true;
  /* No URL constructor: accepting only ordinary https absolute syntax is both
   * safer and compatible with ES5 engines. URL validation remains conservative. */
  return /^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:[/?#]|$)/.test(value);
}
function validRootMargin(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 64; }
function containsString(values: readonly string[], needle: string): boolean { return values.indexOf(needle) !== -1; }
function matches(element: Element, selector: string): boolean { return typeof element.matches === 'function' && safe(function (): boolean { return element.matches(selector); }) === true; }
function nodesFor(root: ParentNode | Element, selector: string): Element[] {
  var result: Element[] = [];
  /* Do not use instanceof Element: embedded documents and test sandboxes may
   * have a different Element constructor. Capability checking is sufficient. */
  if (matches(root as Element, selector)) result.push(root as Element);
  if (typeof (root as ParentNode).querySelectorAll === 'function') {
    var list = safe(function (): NodeListOf<Element> { return (root as ParentNode).querySelectorAll(selector); });
    if (list) { var index: number; for (index = 0; index < list.length; index += 1) result.push(list[index]); }
  }
  return result;
}
function listenOnce(element: Element, name: string, callback: () => void): void {
  var fired = false;
  element.addEventListener(name, function (): void { if (fired) return; fired = true; callback(); });
}
function removeNode(node: Node): void { if (node.parentNode) node.parentNode.removeChild(node); }
function transition(record: SlotRecord, next: State, reason: string | null): boolean {
  if (terminal(record.state) || record.state === next) return false;
  record.state = next; record.reason = reason; record.history.push({ state: next, reason: reason }); return true;
}
function terminal(state: State): boolean { return state === 'YAN_RENDERED' || state === 'DONE' || state === 'ERROR' || state === 'SKIPPED' || state === 'DISABLED' || state === 'UNKNOWN'; }
function eventParameters(record: SlotRecord, extra?: Partial<EventParameters>): EventParameters {
  var params: EventParameters = { site: record.site, slot: record.slotName, campaign: record.campaign ? record.campaign.id : null, source: record.source, experiment: record.experiment.id || null, variant: record.variant, reason: record.reason };
  if (!extra) return params;
  return { site: extra.site === undefined ? params.site : extra.site, slot: extra.slot === undefined ? params.slot : extra.slot, campaign: extra.campaign === undefined ? params.campaign : extra.campaign, source: extra.source === undefined ? params.source : extra.source, experiment: extra.experiment === undefined ? params.experiment : extra.experiment, variant: extra.variant === undefined ? params.variant : extra.variant, reason: extra.reason === undefined ? params.reason : extra.reason };
}
function makeRecord(element: Element, site: string, slotName: string, slot: SlotConfig, assignment: Assignment, experiment: ExperimentConfig, mode: 'nanofox' | 'legacy-widget'): SlotRecord {
  return { element: element, site: site, slotName: slotName, slot: slot, variant: assignment.variant, experiment: experiment, mode: mode, state: 'IDLE', reason: null, source: null, campaign: null, reservedToken: null, fallbackLoaded: false, fallbackVisible: false, visibilitySupported: false, rotationCommitted: false, visibilityObserver: null, removalObserver: null, lazyObserver: null, yandexContainer: null, yandexCalled: false, history: [{ state: 'IDLE', reason: null }] };
}
function experimentAssignment(host: RuntimeHost, experiment: ExperimentConfig | undefined): Assignment {
  if (!experiment || experiment.enabled !== true) return { variant: 'treatment', persistent: false };
  var id = typeof experiment.id === 'string' && experiment.id ? experiment.id : 'nanofox-v1';
  var control = experiment.control; var treatment = experiment.treatment; var total = finiteNumber(control) && finiteNumber(treatment) ? control + treatment : 0;
  if (!(finiteNumber(control) && finiteNumber(treatment) && control >= 0 && treatment >= 0 && total > 0)) return { variant: 'control', persistent: false, reason: 'invalid_experiment' };
  var key = 'nanofox:experiment:' + id;
  var storage = safe(function (): Storage | undefined { return host.localStorage; });
  var stored = safe(function (): string | null | undefined { return storage && storage.getItem(key); });
  if (stored === 'control' || stored === 'treatment') return { variant: stored, persistent: true };
  var random = safe(function (): number | undefined { return host.Math && host.Math.random(); });
  var variant: Variant = (finiteNumber(random) ? random : 0) * total < control ? 'control' : 'treatment';
  var persisted = safe(function (): boolean { if (!storage || typeof storage.setItem !== 'function') return false; storage.setItem(key, variant); return true; }) === true;
  return { variant: variant, persistent: persisted };
}
function campaignFromConfig(id: string, config: CampaignConfig | undefined): Campaign | null {
  if (!config || config.enabled !== true || config.type !== 'image' || !validSize(config.width, config.height) || !finiteNumber(config.weight) || config.weight <= 0 || !safeUrl(config.image) || !safeUrl(config.url)) return null;
  var image = config.image as string;
  var url = config.url as string;
  var width = config.width as number;
  var height = config.height as number;
  var weight = config.weight as number;
  var token = campaignToken(id, image, url, width, height);
  return { id: id, enabled: true, type: 'image', image: image, url: url, width: width, height: height, weight: weight, label: config.label, alt: config.alt, rotationToken: token };
}
function compatibleCampaign(campaign: Campaign, slot: SlotConfig): boolean {
  var dimensions = fallbackDimensions(slot);
  if (!dimensions) return false;
  /* Fixed slots keep exact matching. A declared fluid max accepts a smaller
   * intrinsic banner, which is centered and constrained in renderFallback. */
  return fluidFallback(slot) ? campaign.width <= dimensions.width && campaign.height <= dimensions.height : campaign.width === dimensions.width && campaign.height === dimensions.height;
}
function campaignToken(id: string, image: string, url: string, width: number, height: number): string {
  var source = [id, image, url, width, height].join('\u001f'); var hash = 5381; var index: number;
  for (index = 0; index < source.length; index += 1) hash = ((hash * 33) ^ source.charCodeAt(index)) >>> 0;
  return id + ':' + hash.toString(36);
}
function weightedCampaign(host: RuntimeHost, candidates: Campaign[]): Campaign | null {
  var total = 0; var index: number; for (index = 0; index < candidates.length; index += 1) total += candidates[index].weight;
  if (!(total > 0)) return null;
  var random = safe(function (): number | undefined { return host.Math && host.Math.random(); });
  var cursor = (finiteNumber(random) ? random : 0) * total;
  for (index = 0; index < candidates.length; index += 1) { cursor -= candidates[index].weight; if (cursor < 0) return candidates[index]; }
  return candidates[candidates.length - 1];
}

/* Invoke after class declarations: ES5 output uses hoisted constructor
 * assignments, while this placement also keeps the source executable as-is. */
nanoFoxBootstrap(getRuntimeHost());
