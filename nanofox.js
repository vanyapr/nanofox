"use strict";
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
function nanoFoxBootstrap(global) {
    'use strict';
    if (!global || (global.NanoFox && global.NanoFox.__nanofox === true))
        return;
    /*
     * Edit this object when deploying an independent copy to a site. It is kept
     * JSON-shaped on purpose: no remote configuration, callbacks, or secrets.
     * The shipped configuration is inert and contains no real advertising data.
     */
    var CONFIG = {
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
    var configured = isObject(global.__NANOFOX_TEST_CONFIG__) ? global.__NANOFOX_TEST_CONFIG__ : CONFIG;
    var engine = new NanoFoxEngine(global, configured);
    var api = {
        canOwn: function (element) { return engine.canOwn(element); },
        refresh: function (root) { return engine.refresh(root); },
        getState: function (element) { return engine.getState(element); },
        __nanofox: true,
        version: '0.1.0'
    };
    // Test access is intentionally absent in production. It has no delivery role.
    if (global.__NANOFOX_TEST__ === true) {
        api.__test = { STATES: STATES, chooseCampaign: function (record) {
                return engine.chooseCampaign(record);
            }, records: engine.records };
    }
    global.NanoFox = api;
    var document = global.document;
    safe(function () { return engine.refresh(document || null); });
    /* The recommended tag is defer. This extra one-shot hook also supports a
     * legacy loader placed in head before its slots are parsed; the registry
     * makes a later refresh harmless. */
    if (document && document.readyState === 'loading' && typeof document.addEventListener === 'function') {
        var pendingDocument = document;
        safe(function () { pendingDocument.addEventListener('DOMContentLoaded', function () { engine.refresh(pendingDocument); }); });
    }
}
var STATES = {
    IDLE: 'IDLE', REQUESTING: 'REQUESTING', YAN_RENDERED: 'YAN_RENDERED',
    NO_FILL: 'NO_FILL', FALLBACK_RENDERED: 'FALLBACK_RENDERED', DONE: 'DONE',
    ERROR: 'ERROR', SKIPPED: 'SKIPPED', DISABLED: 'DISABLED', UNKNOWN: 'UNKNOWN'
};
/* ES5 has no Map, Set, or WeakMap. These bounded page-lifetime structures are
 * intentionally simple: NanoFox tracks only the elements it initializes and a
 * short list of rotation tokens. They avoid asking sites to ship polyfills. */
var StringSet = /** @class */ (function () {
    function StringSet() {
        this.values = [];
    }
    StringSet.prototype.has = function (value) { return this.values.indexOf(value) !== -1; };
    StringSet.prototype.add = function (value) { if (!this.has(value))
        this.values.push(value); };
    StringSet.prototype.delete = function (value) { var index = this.values.indexOf(value); if (index !== -1)
        this.values.splice(index, 1); };
    Object.defineProperty(StringSet.prototype, "size", {
        get: function () { return this.values.length; },
        enumerable: false,
        configurable: true
    });
    return StringSet;
}());
var StringArrayStore = /** @class */ (function () {
    function StringArrayStore() {
        this.entries = [];
    }
    StringArrayStore.prototype.get = function (key) {
        var index;
        for (index = 0; index < this.entries.length; index += 1)
            if (this.entries[index].key === key)
                return this.entries[index].values.slice();
        return [];
    };
    StringArrayStore.prototype.set = function (key, values) {
        var index;
        for (index = 0; index < this.entries.length; index += 1) {
            if (this.entries[index].key === key) {
                this.entries[index].values = values.slice();
                return;
            }
        }
        this.entries.push({ key: key, values: values.slice() });
    };
    return StringArrayStore;
}());
var ElementRegistry = /** @class */ (function () {
    function ElementRegistry() {
        this.entries = [];
    }
    ElementRegistry.prototype.get = function (element) {
        var index;
        for (index = 0; index < this.entries.length; index += 1)
            if (this.entries[index].element === element)
                return this.entries[index].record;
        return null;
    };
    ElementRegistry.prototype.set = function (element, record) { this.entries.push({ element: element, record: record }); };
    return ElementRegistry;
}());
/** Analytics has no delivery authority: every failure is caught at this edge. */
var AnalyticsReporter = /** @class */ (function () {
    function AnalyticsReporter(host, config) {
        this.host = host;
        this.config = config;
    }
    AnalyticsReporter.prototype.report = function (name, record, extra) {
        var _this = this;
        var params = eventParameters(record, extra);
        safe(function () {
            var target = typeof _this.host.dispatchEvent === 'function' ? _this.host : _this.host.document;
            if (target && typeof target.dispatchEvent === 'function' && typeof _this.host.CustomEvent === 'function') {
                target.dispatchEvent(new _this.host.CustomEvent(name, { detail: params }));
            }
        });
        var analytics = this.config.analytics;
        if (!analytics || analytics.enabled !== true || analytics.provider !== 'metrika' ||
            !finiteNumber(analytics.counterId) || typeof this.host.ym !== 'function')
            return;
        var counterId = analytics.counterId;
        safe(function () { _this.host.ym(counterId, 'reachGoal', name, params); });
    };
    return AnalyticsReporter;
}());
/**
 * The rotation store commits a token only after a loaded fallback becomes
 * observable. Until then it reserves that token for this page: a second slot
 * cannot duplicate an unseen campaign, but a failure can release it.
 */
var RotationHistory = /** @class */ (function () {
    function RotationHistory(host, config) {
        this.host = host;
        this.config = config;
        this.memory = new StringArrayStore();
        this.reservations = new StringSet();
    }
    RotationHistory.prototype.choose = function (record) {
        var _this = this;
        var candidates = this.candidates(record);
        if (candidates.length === 0)
            return { campaign: null, reason: 'no_eligible_campaign' };
        var active = this.activeTokens();
        var settings = this.settings(active.size);
        var history = this.read(settings, active);
        this.save(settings, history, active);
        var seen = new StringSet();
        var index;
        for (index = 0; index < history.length; index += 1)
            seen.add(history[index]);
        var unseen = candidates.filter(function (campaign) { return !seen.has(campaign.rotationToken); });
        var available = unseen.filter(function (campaign) { return !_this.reservations.has(campaign.rotationToken); });
        if (available.length === 0 && unseen.length > 0)
            return { campaign: null, reason: 'unseen_campaign_reserved' };
        if (available.length === 0) {
            available = candidates.filter(function (campaign) { return !_this.reservations.has(campaign.rotationToken); });
            if (available.length === 0)
                return { campaign: null, reason: 'cycle_campaign_reserved' };
            var current = new StringSet();
            for (index = 0; index < candidates.length; index += 1)
                current.add(candidates[index].rotationToken);
            history = history.filter(function (token) { return !current.has(token); });
            this.save(settings, history, active);
        }
        var campaign = weightedCampaign(this.host, available);
        if (!campaign)
            return { campaign: null, reason: 'no_eligible_campaign' };
        this.reservations.add(campaign.rotationToken);
        record.reservedToken = campaign.rotationToken;
        return { campaign: campaign, reason: null };
    };
    /* A non-mutating helper used only by the deterministic unit test for the
     * weighted distribution. Normal delivery always goes through choose(). */
    RotationHistory.prototype.weightedCandidate = function (record) { return weightedCampaign(this.host, this.candidates(record)); };
    RotationHistory.prototype.release = function (record) {
        if (!record.reservedToken)
            return;
        this.reservations.delete(record.reservedToken);
        record.reservedToken = null;
    };
    RotationHistory.prototype.commitVisible = function (record) {
        var active = this.activeTokens();
        var settings = this.settings(active.size);
        var history = this.read(settings, active).filter(function (token) { return token !== record.reservedToken; });
        if (record.reservedToken && active.has(record.reservedToken))
            history.push(record.reservedToken);
        this.save(settings, history, active);
    };
    RotationHistory.prototype.candidates = function (record) {
        var ids = Array.isArray(record.slot.fallback) ? record.slot.fallback : [];
        var campaigns = this.config.campaigns || {};
        var result = [];
        var index;
        for (index = 0; index < ids.length; index += 1) {
            var id = ids[index];
            var campaign = campaignFromConfig(id, campaigns[id]);
            if (campaign && compatibleCampaign(campaign, record.slot))
                result.push(campaign);
        }
        return result;
    };
    RotationHistory.prototype.settings = function (activeCount) {
        var rotation = this.config.rotation || {};
        var version = typeof rotation.version === 'string' && rotation.version.length > 0 && rotation.version.length <= 64 ? rotation.version : 'v1';
        var requested = rotation.maxEntries;
        var requestedMax = integerNumber(requested) && requested > 0 ? Math.min(requested, 500) : 100;
        return { key: 'nanofox:rotation:' + version, maxEntries: Math.min(500, Math.max(requestedMax, activeCount || 0)) };
    };
    RotationHistory.prototype.activeTokens = function () {
        var set = new StringSet();
        var campaigns = this.config.campaigns || {};
        var ids = Object.keys(campaigns);
        var index;
        for (index = 0; index < ids.length; index += 1) {
            var campaign = campaignFromConfig(ids[index], campaigns[ids[index]]);
            if (campaign)
                set.add(campaign.rotationToken);
        }
        return set;
    };
    RotationHistory.prototype.clean = function (values, allowed, maxEntries) {
        var raw = Array.isArray(values) ? values : [];
        var clean = [];
        var index;
        for (index = 0; index < raw.length; index += 1) {
            var value = raw[index];
            if (typeof value === 'string' && value.length <= 256 && allowed.has(value) && clean.indexOf(value) === -1)
                clean.push(value);
        }
        return clean.slice(-maxEntries);
    };
    RotationHistory.prototype.read = function (settings, allowed) {
        var _this = this;
        var raw = null;
        var storage = safe(function () { return _this.host.localStorage; });
        safe(function () { if (storage && typeof storage.getItem === 'function')
            raw = storage.getItem(settings.key); });
        var parsed = raw ? safe(function () { return JSON.parse(raw); }) : undefined;
        var values = isObject(parsed) && parsed.v === 1 && Array.isArray(parsed.seen) ? parsed.seen : this.memory.get(settings.key);
        var clean = this.clean(values, allowed, settings.maxEntries);
        this.memory.set(settings.key, clean);
        return clean;
    };
    RotationHistory.prototype.save = function (settings, values, allowed) {
        var _this = this;
        var clean = this.clean(values, allowed, settings.maxEntries);
        this.memory.set(settings.key, clean);
        var storage = safe(function () { return _this.host.localStorage; });
        safe(function () { if (storage && typeof storage.setItem === 'function')
            storage.setItem(settings.key, JSON.stringify({ v: 1, seen: clean })); });
    };
    return RotationHistory;
}());
/**
 * This adapter is deliberately narrow. It uses the documented render callback
 * for a NanoFox slot; renderWidget is retained only for an explicitly legacy,
 * Yandex-only slot and never enables a partner fallback.
 */
var YandexAdapter = /** @class */ (function () {
    function YandexAdapter(host) {
        this.host = host;
    }
    YandexAdapter.prototype.request = function (record, handlers) {
        if (record.yandexCalled || record.state !== 'REQUESTING')
            return;
        record.yandexCalled = true;
        var manager = this.manager();
        if (!manager || typeof manager.render !== 'function' || !record.yandexContainer) {
            handlers.unavailable();
            return;
        }
        try {
            manager.render({ blockId: record.slot.yandex, renderTo: record.yandexContainer.id,
                onRender: handlers.rendered, onError: handlers.error }, handlers.noFill);
        }
        catch (_) {
            handlers.error();
        }
    };
    YandexAdapter.prototype.requestLegacyWidget = function (record, unavailable) {
        if (record.yandexCalled || !record.yandexContainer)
            return;
        record.yandexCalled = true;
        var manager = this.manager();
        if (!manager || typeof manager.renderWidget !== 'function') {
            unavailable();
            return;
        }
        try {
            manager.renderWidget({ blockId: record.slot.yandex, renderTo: record.yandexContainer.id });
        }
        catch (_) {
            unavailable();
        }
    };
    YandexAdapter.prototype.ready = function () { var manager = this.manager(); return !!manager && typeof manager.render === 'function'; };
    YandexAdapter.prototype.widgetReady = function () { var manager = this.manager(); return !!manager && typeof manager.renderWidget === 'function'; };
    YandexAdapter.prototype.manager = function () {
        var _this = this;
        return safe(function () { return _this.host.Ya && _this.host.Ya.Context && _this.host.Ya.Context.AdvManager; });
    };
    return YandexAdapter;
}());
/** The engine is the one owner of NanoFox request state and DOM writes. */
var NanoFoxEngine = /** @class */ (function () {
    function NanoFoxEngine(host, config) {
        this.host = host;
        this.config = config;
        this.records = new ElementRegistry();
        this.sequence = 0;
        this.analytics = new AnalyticsReporter(host, config);
        this.rotation = new RotationHistory(host, config);
        this.yandex = new YandexAdapter(host);
    }
    NanoFoxEngine.prototype.canOwn = function (element) {
        var site = this.site();
        var siteConfig = this.siteConfig(site);
        var slotName = safe(function () { return element.getAttribute('data-nanofox'); }) || '';
        var slot = siteConfig && siteConfig.slots ? siteConfig.slots[slotName] : undefined;
        return this.config.enabled === true && !!siteConfig && siteConfig.enabled === true && validSlot(slot);
    };
    NanoFoxEngine.prototype.getState = function (element) { var record = this.records.get(element); return record ? record.state : null; };
    NanoFoxEngine.prototype.chooseCampaign = function (record) { return this.rotation.weightedCandidate(record); };
    NanoFoxEngine.prototype.refresh = function (root) {
        var scope = root || this.host.document || null;
        if (!scope)
            return [];
        var nodes = nodesFor(scope, '[data-nanofox]');
        var legacy = this.config.legacy;
        if (legacy && legacy.enabled === true)
            nodes = nodes.concat(nodesFor(scope, legacy.selector || '.lazy-ad[data-block-id]'));
        var result = [];
        var index;
        for (index = 0; index < nodes.length; index += 1) {
            var record = this.initialize(nodes[index]);
            if (record)
                result.push(record);
        }
        return result;
    };
    NanoFoxEngine.prototype.initialize = function (element) {
        var existing = this.records.get(element);
        if (existing)
            return existing;
        var isLegacy = matches(element, this.config.legacy && this.config.legacy.selector || '.lazy-ad[data-block-id]') && !matches(element, '[data-nanofox]');
        return isLegacy ? this.initializeLegacy(element) : this.initializeNanoFox(element);
    };
    NanoFoxEngine.prototype.initializeNanoFox = function (element) {
        var site = this.site();
        var name = safe(function () { return element.getAttribute('data-nanofox'); }) || '';
        var siteConfig = this.siteConfig(site);
        var slot = siteConfig && siteConfig.slots ? siteConfig.slots[name] : undefined;
        var record = makeRecord(element, site, name, slot || {}, this.assignment(), this.config.experiment || {}, 'nanofox');
        this.records.set(element, record);
        if (this.config.enabled !== true) {
            transition(record, 'DISABLED', 'disabled');
            return record;
        }
        if (!siteConfig) {
            transition(record, 'SKIPPED', 'unknown_site');
            return record;
        }
        if (siteConfig.enabled !== true) {
            transition(record, 'DISABLED', 'site_disabled');
            return record;
        }
        if (!validSlot(slot)) {
            transition(record, 'SKIPPED', 'unknown_site_or_slot');
            return record;
        }
        this.reserveSpace(record);
        this.analytics.report('nanofox_eligible', record, { source: 'yandex' });
        this.lazyOrRequest(record, this.config.lazy);
        return record;
    };
    /*
     * Compatibility route: existing markup keeps its block id and lazy timing.
     * Only a block explicitly mapped in legacy.slots becomes a full NanoFox slot;
     * unlisted blocks use Yandex renderWidget and are never candidates for
     * fallback. This prevents accidentally changing overlays, video, or tests.
     */
    NanoFoxEngine.prototype.initializeLegacy = function (element) {
        var _this = this;
        var site = this.site();
        var legacy = this.config.legacy || {};
        var blockId = safe(function () { return element.getAttribute('data-block-id'); }) || '';
        var mapped = legacy.slots ? legacy.slots[blockId] : undefined;
        var siteConfig = this.siteConfig(site);
        var slot = mapped && siteConfig && siteConfig.slots ? siteConfig.slots[mapped] : undefined;
        var excluded = containsString(legacy.excludedBlockIds || [], blockId);
        var record = makeRecord(element, site, mapped || blockId, slot || { yandex: blockId }, this.assignment(), this.config.experiment || {}, 'legacy-widget');
        this.records.set(element, record);
        if (!blockId) {
            transition(record, 'SKIPPED', 'legacy_missing_block_id');
            return record;
        }
        if (excluded) {
            transition(record, 'SKIPPED', 'legacy_special_format');
            safe(function () { if (typeof _this.host.NanoFoxLegacySpecialRenderer === 'function')
                _this.host.NanoFoxLegacySpecialRenderer(element, blockId); });
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
    };
    NanoFoxEngine.prototype.lazyOrRequest = function (record, settings) {
        var _this = this;
        this.lazy(record, settings, function () { _this.requestYandex(record); });
    };
    NanoFoxEngine.prototype.lazyOrLegacyWidget = function (record, settings) {
        var _this = this;
        this.lazy(record, settings, function () { _this.requestLegacyWidget(record); });
    };
    NanoFoxEngine.prototype.lazy = function (record, settings, start) {
        var _this = this;
        if (!settings || settings.enabled !== true || typeof this.host.IntersectionObserver !== 'function') {
            start();
            return;
        }
        var observer = safe(function () { return new _this.host.IntersectionObserver(function (entries, active) {
            var index;
            for (index = 0; index < entries.length; index += 1) {
                if (entries[index].isIntersecting && entries[index].target === record.element) {
                    safe(function () { active.unobserve(record.element); });
                    record.lazyObserver = null;
                    start();
                    return;
                }
            }
        }, { rootMargin: validRootMargin(settings.rootMargin) ? settings.rootMargin : '200px' }); });
        if (!observer) {
            start();
            return;
        }
        var lazyObserver = observer;
        if (safe(function () { lazyObserver.observe(record.element); return true; }) !== true) {
            start();
            return;
        }
        record.lazyObserver = lazyObserver;
    };
    NanoFoxEngine.prototype.requestYandex = function (record) {
        var _this = this;
        var container = this.container(record);
        if (!container) {
            this.error(record, 'dom_unavailable');
            return;
        }
        record.source = 'yandex';
        transition(record, 'REQUESTING', 'yandex_request');
        this.analytics.report('nanofox_yandex_request', record, { source: 'yandex' });
        if (this.yandex.ready()) {
            this.callYandex(record);
            return;
        }
        var queue = this.host.yaContextCb;
        if (!Array.isArray(queue)) {
            this.unknown(record, 'yandex_api_unavailable');
            return;
        }
        var loaderQueue = queue;
        safe(function () { loaderQueue.push(function () { _this.callYandex(record); }); });
    };
    NanoFoxEngine.prototype.callYandex = function (record) {
        var _this = this;
        this.yandex.request(record, {
            rendered: function () { if (transition(record, 'YAN_RENDERED', 'yandex_rendered')) {
                record.source = 'yandex';
                _this.analytics.report('nanofox_yandex_render', record, { source: 'yandex' });
            } },
            noFill: function () { _this.noFill(record); },
            error: function () { _this.error(record, 'yandex_request_error'); },
            unavailable: function () { _this.unknown(record, 'yandex_api_unavailable'); }
        });
    };
    NanoFoxEngine.prototype.requestLegacyWidget = function (record) {
        var _this = this;
        var container = this.container(record);
        if (!container) {
            this.error(record, 'dom_unavailable');
            return;
        }
        record.source = 'yandex';
        transition(record, 'REQUESTING', 'legacy_widget_request');
        var start = function () {
            _this.yandex.requestLegacyWidget(record, function () { _this.unknown(record, 'yandex_widget_unavailable'); });
            if (record.state === 'REQUESTING')
                transition(record, 'DONE', 'legacy_widget_requested');
        };
        if (this.yandex.widgetReady()) {
            start();
            return;
        }
        var queue = this.host.yaContextCb;
        if (!Array.isArray(queue)) {
            this.unknown(record, 'yandex_widget_unavailable');
            return;
        }
        var legacyQueue = queue;
        safe(function () { legacyQueue.push(start); });
    };
    NanoFoxEngine.prototype.noFill = function (record) {
        if (record.state !== 'REQUESTING')
            return;
        record.source = 'yandex';
        transition(record, 'NO_FILL', 'official_no_fill');
        this.analytics.report('nanofox_no_fill', record, { source: 'yandex' });
        if (record.variant === 'control') {
            transition(record, 'DONE', 'control_no_fill');
            return;
        }
        this.renderFallback(record);
    };
    NanoFoxEngine.prototype.renderFallback = function (record) {
        var _this = this;
        var selection = this.rotation.choose(record);
        if (!selection.campaign) {
            transition(record, 'DONE', selection.reason || 'no_eligible_campaign');
            return;
        }
        var document = this.host.document;
        if (!document || typeof document.createElement !== 'function') {
            this.rotation.release(record);
            this.error(record, 'dom_unavailable');
            return;
        }
        var campaign = selection.campaign;
        record.campaign = campaign;
        record.source = 'fallback';
        var wrapper = document.createElement('div');
        var label = document.createElement('span');
        var link = document.createElement('a');
        var image = document.createElement('img');
        label.textContent = campaign.label || 'Реклама';
        link.href = campaign.url;
        link.target = '_blank';
        link.rel = 'sponsored noopener noreferrer';
        image.src = campaign.image;
        image.alt = campaign.alt || '';
        image.width = campaign.width;
        image.height = campaign.height;
        /* Attribute form is safe in old DOMs; properties preserve the native hint
         * where supported and make the intent observable to simple integrations. */
        image.setAttribute('loading', 'lazy');
        image.setAttribute('decoding', 'async');
        image.loading = 'lazy';
        image.decoding = 'async';
        if (fluidFallback(record.slot)) {
            wrapper.style.textAlign = record.slot.fallbackAlign === 'start' ? 'left' : 'center';
            link.style.display = 'inline-block';
            image.style.maxWidth = '100%';
            image.style.height = 'auto';
        }
        listenOnce(link, 'click', function () { _this.analytics.report('nanofox_fallback_click', record, { source: 'fallback' }); });
        listenOnce(image, 'error', function () { _this.rotation.release(record); _this.stopObservers(record); if (transition(record, 'ERROR', 'fallback_image_error')) {
            removeNode(wrapper);
            _this.analytics.report('nanofox_error', record, { source: 'fallback' });
        } });
        listenOnce(image, 'load', function () {
            record.fallbackLoaded = true;
            transition(record, 'DONE', 'fallback_image_loaded');
            if (record.visibilitySupported)
                _this.confirmVisible(record);
            else
                _this.rotation.release(record);
        });
        link.appendChild(image);
        wrapper.appendChild(label);
        wrapper.appendChild(link);
        record.element.appendChild(wrapper);
        transition(record, 'FALLBACK_RENDERED', 'official_no_fill');
        this.analytics.report('nanofox_fallback_render', record, { source: 'fallback' });
        record.visibilitySupported = this.trackVisibility(record, image);
        this.watchRemoval(record, wrapper);
    };
    NanoFoxEngine.prototype.trackVisibility = function (record, image) {
        var _this = this;
        if (typeof this.host.IntersectionObserver !== 'function')
            return false;
        var observer = safe(function () { return new _this.host.IntersectionObserver(function (entries, active) {
            var index;
            for (index = 0; index < entries.length; index += 1)
                if (entries[index].isIntersecting) {
                    record.fallbackVisible = true;
                    _this.confirmVisible(record);
                    if (record.rotationCommitted)
                        safe(function () { active.unobserve(entries[index].target); });
                }
        }, { threshold: 0.5 }); });
        if (!observer)
            return false;
        var visibilityObserver = observer;
        if (safe(function () { visibilityObserver.observe(image); return true; }) !== true)
            return false;
        record.visibilityObserver = visibilityObserver;
        return true;
    };
    NanoFoxEngine.prototype.confirmVisible = function (record) {
        if (!record.fallbackLoaded || !record.fallbackVisible || record.rotationCommitted)
            return;
        record.rotationCommitted = true;
        this.rotation.commitVisible(record);
        this.rotation.release(record);
        this.stopObservers(record);
        this.analytics.report('nanofox_fallback_visible', record, { source: 'fallback' });
    };
    /* MutationObserver is optional. Without it, image errors still release a
     * reservation; an externally removed pending wrapper can remain reserved for
     * this page. We never poll DOM merely to improve this legacy edge case. */
    NanoFoxEngine.prototype.watchRemoval = function (record, wrapper) {
        var _this = this;
        var document = this.host.document;
        var root = document && document.documentElement;
        if (!root || typeof this.host.MutationObserver !== 'function')
            return;
        var observedRoot = root;
        var observer = safe(function () { return new _this.host.MutationObserver(function () {
            safe(function () { if (observedRoot.contains(wrapper))
                return; _this.rotation.release(record); _this.stopObservers(record); });
        }); });
        if (!observer)
            return;
        var removalObserver = observer;
        if (safe(function () { removalObserver.observe(observedRoot, { childList: true, subtree: true }); return true; }) === true)
            record.removalObserver = removalObserver;
    };
    NanoFoxEngine.prototype.stopObservers = function (record) {
        safe(function () { if (record.visibilityObserver)
            record.visibilityObserver.disconnect(); });
        safe(function () { if (record.removalObserver)
            record.removalObserver.disconnect(); });
        record.visibilityObserver = null;
        record.removalObserver = null;
    };
    NanoFoxEngine.prototype.error = function (record, reason) { if (record.state === 'REQUESTING' || record.state === 'FALLBACK_RENDERED' || record.state === 'IDLE')
        if (transition(record, 'ERROR', reason))
            this.analytics.report('nanofox_error', record, { source: record.source || 'yandex' }); };
    NanoFoxEngine.prototype.unknown = function (record, reason) { if (record.state === 'REQUESTING')
        if (transition(record, 'UNKNOWN', reason))
            this.analytics.report('nanofox_error', record, { source: 'yandex' }); };
    NanoFoxEngine.prototype.container = function (record) { var document = this.host.document; if (!document || typeof document.createElement !== 'function')
        return null; this.sequence += 1; var container = document.createElement('div'); container.id = 'nanofox-yandex-' + this.sequence; record.element.appendChild(container); record.yandexContainer = container; return container; };
    /* A fluid slot reserves height before any source responds, but never forces
     * its desktop max width onto a narrow viewport. Fixed legacy formats retain
     * their historical width × height reservation. */
    NanoFoxEngine.prototype.reserveSpace = function (record) {
        var style = record.element.style;
        if (!style)
            return;
        var dimensions = fallbackDimensions(record.slot);
        if (!dimensions)
            return;
        var reserveWidth = validSize(record.slot.reserveWidth, record.slot.reserveHeight) ? record.slot.reserveWidth : (fluidFallback(record.slot) ? undefined : dimensions.width);
        var reserveHeight = validSize(record.slot.reserveWidth, record.slot.reserveHeight) ? record.slot.reserveHeight : (integerNumber(record.slot.reserveHeight) && record.slot.reserveHeight > 0 ? record.slot.reserveHeight : dimensions.height);
        if (integerNumber(reserveWidth) && reserveWidth > 0)
            style.minWidth = String(reserveWidth) + 'px';
        if (integerNumber(reserveHeight) && reserveHeight > 0)
            style.minHeight = String(reserveHeight) + 'px';
    };
    NanoFoxEngine.prototype.site = function () {
        var _this = this;
        var name = safe(function () { return _this.host.location && _this.host.location.hostname; });
        return typeof name === 'string' ? name.toLowerCase() : '';
    };
    NanoFoxEngine.prototype.siteConfig = function (site) { return this.config.sites ? this.config.sites[site] : undefined; };
    NanoFoxEngine.prototype.assignment = function () { return experimentAssignment(this.host, this.config.experiment); };
    return NanoFoxEngine;
}());
/* Pure helpers: no feature here needs a modern intrinsic. */
function getRuntimeHost() {
    /* `globalThis` would itself require a polyfill on older supported browsers. */
    if (typeof window !== 'undefined')
        return window;
    if (typeof self !== 'undefined')
        return self;
    return {};
}
function safe(callback) { try {
    return callback();
}
catch (_) {
    return undefined;
} }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function finiteNumber(value) { return typeof value === 'number' && isFinite(value); }
function integerNumber(value) { return finiteNumber(value) && Math.floor(value) === value; }
function validSize(width, height) { return integerNumber(width) && integerNumber(height) && width > 0 && height > 0 && width <= 4096 && height <= 4096; }
function fallbackDimensions(slot) {
    if (validSize(slot.fallbackMaxWidth, slot.fallbackMaxHeight))
        return { width: slot.fallbackMaxWidth, height: slot.fallbackMaxHeight };
    if (validSize(slot.width, slot.height))
        return { width: slot.width, height: slot.height };
    return null;
}
function fluidFallback(slot) { return validSize(slot.fallbackMaxWidth, slot.fallbackMaxHeight); }
function validSlot(slot) { return !!slot && typeof slot.yandex === 'string' && slot.yandex.length > 0 && fallbackDimensions(slot) !== null; }
function safeUrl(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 2048)
        return false;
    if (value.charAt(0) === '/' && value.charAt(1) !== '/')
        return true;
    /* No URL constructor: accepting only ordinary https absolute syntax is both
     * safer and compatible with ES5 engines. URL validation remains conservative. */
    return /^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:[/?#]|$)/.test(value);
}
function validRootMargin(value) { return typeof value === 'string' && value.length > 0 && value.length <= 64; }
function containsString(values, needle) { return values.indexOf(needle) !== -1; }
function matches(element, selector) { return typeof element.matches === 'function' && safe(function () { return element.matches(selector); }) === true; }
function nodesFor(root, selector) {
    var result = [];
    /* Do not use instanceof Element: embedded documents and test sandboxes may
     * have a different Element constructor. Capability checking is sufficient. */
    if (matches(root, selector))
        result.push(root);
    if (typeof root.querySelectorAll === 'function') {
        var list = safe(function () { return root.querySelectorAll(selector); });
        if (list) {
            var index;
            for (index = 0; index < list.length; index += 1)
                result.push(list[index]);
        }
    }
    return result;
}
function listenOnce(element, name, callback) {
    var fired = false;
    element.addEventListener(name, function () { if (fired)
        return; fired = true; callback(); });
}
function removeNode(node) { if (node.parentNode)
    node.parentNode.removeChild(node); }
function transition(record, next, reason) {
    if (terminal(record.state) || record.state === next)
        return false;
    record.state = next;
    record.reason = reason;
    record.history.push({ state: next, reason: reason });
    return true;
}
function terminal(state) { return state === 'YAN_RENDERED' || state === 'DONE' || state === 'ERROR' || state === 'SKIPPED' || state === 'DISABLED' || state === 'UNKNOWN'; }
function eventParameters(record, extra) {
    var params = { site: record.site, slot: record.slotName, campaign: record.campaign ? record.campaign.id : null, source: record.source, experiment: record.experiment.id || null, variant: record.variant, reason: record.reason };
    if (!extra)
        return params;
    return { site: extra.site === undefined ? params.site : extra.site, slot: extra.slot === undefined ? params.slot : extra.slot, campaign: extra.campaign === undefined ? params.campaign : extra.campaign, source: extra.source === undefined ? params.source : extra.source, experiment: extra.experiment === undefined ? params.experiment : extra.experiment, variant: extra.variant === undefined ? params.variant : extra.variant, reason: extra.reason === undefined ? params.reason : extra.reason };
}
function makeRecord(element, site, slotName, slot, assignment, experiment, mode) {
    return { element: element, site: site, slotName: slotName, slot: slot, variant: assignment.variant, experiment: experiment, mode: mode, state: 'IDLE', reason: null, source: null, campaign: null, reservedToken: null, fallbackLoaded: false, fallbackVisible: false, visibilitySupported: false, rotationCommitted: false, visibilityObserver: null, removalObserver: null, lazyObserver: null, yandexContainer: null, yandexCalled: false, history: [{ state: 'IDLE', reason: null }] };
}
function experimentAssignment(host, experiment) {
    if (!experiment || experiment.enabled !== true)
        return { variant: 'treatment', persistent: false };
    var id = typeof experiment.id === 'string' && experiment.id ? experiment.id : 'nanofox-v1';
    var control = experiment.control;
    var treatment = experiment.treatment;
    var total = finiteNumber(control) && finiteNumber(treatment) ? control + treatment : 0;
    if (!(finiteNumber(control) && finiteNumber(treatment) && control >= 0 && treatment >= 0 && total > 0))
        return { variant: 'control', persistent: false, reason: 'invalid_experiment' };
    var key = 'nanofox:experiment:' + id;
    var storage = safe(function () { return host.localStorage; });
    var stored = safe(function () { return storage && storage.getItem(key); });
    if (stored === 'control' || stored === 'treatment')
        return { variant: stored, persistent: true };
    var random = safe(function () { return host.Math && host.Math.random(); });
    var variant = (finiteNumber(random) ? random : 0) * total < control ? 'control' : 'treatment';
    var persisted = safe(function () { if (!storage || typeof storage.setItem !== 'function')
        return false; storage.setItem(key, variant); return true; }) === true;
    return { variant: variant, persistent: persisted };
}
function campaignFromConfig(id, config) {
    if (!config || config.enabled !== true || config.type !== 'image' || !validSize(config.width, config.height) || !finiteNumber(config.weight) || config.weight <= 0 || !safeUrl(config.image) || !safeUrl(config.url))
        return null;
    var image = config.image;
    var url = config.url;
    var width = config.width;
    var height = config.height;
    var weight = config.weight;
    var token = campaignToken(id, image, url, width, height);
    return { id: id, enabled: true, type: 'image', image: image, url: url, width: width, height: height, weight: weight, label: config.label, alt: config.alt, rotationToken: token };
}
function compatibleCampaign(campaign, slot) {
    var dimensions = fallbackDimensions(slot);
    if (!dimensions)
        return false;
    /* Fixed slots keep exact matching. A declared fluid max accepts a smaller
     * intrinsic banner, which is centered and constrained in renderFallback. */
    return fluidFallback(slot) ? campaign.width <= dimensions.width && campaign.height <= dimensions.height : campaign.width === dimensions.width && campaign.height === dimensions.height;
}
function campaignToken(id, image, url, width, height) {
    var source = [id, image, url, width, height].join('\u001f');
    var hash = 5381;
    var index;
    for (index = 0; index < source.length; index += 1)
        hash = ((hash * 33) ^ source.charCodeAt(index)) >>> 0;
    return id + ':' + hash.toString(36);
}
function weightedCampaign(host, candidates) {
    var total = 0;
    var index;
    for (index = 0; index < candidates.length; index += 1)
        total += candidates[index].weight;
    if (!(total > 0))
        return null;
    var random = safe(function () { return host.Math && host.Math.random(); });
    var cursor = (finiteNumber(random) ? random : 0) * total;
    for (index = 0; index < candidates.length; index += 1) {
        cursor -= candidates[index].weight;
        if (cursor < 0)
            return candidates[index];
    }
    return candidates[candidates.length - 1];
}
/* Invoke after class declarations: ES5 output uses hoisted constructor
 * assignments, while this placement also keeps the source executable as-is. */
nanoFoxBootstrap(getRuntimeHost());
