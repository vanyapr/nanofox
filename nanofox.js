/* NanoFox v0.1 | MIT */
(function nanoFoxBootstrap(global) {
  'use strict';

  if (!global || (global.NanoFox && global.NanoFox.__nanofox === true)) return;

  const CONFIG = {
    enabled: false,
    experiment: { enabled: true, control: 50, treatment: 50, id: 'nanofox-v1' },
    sites: {
      'publisher.example': { enabled: false, slots: {} }
    },
    campaigns: {},
    rotation: { version: 'v1', maxEntries: 100 },
    analytics: { enabled: true, provider: 'metrika', counterId: null }
  };

  const config = isObject(global.__NANOFOX_TEST_CONFIG__)
    ? global.__NANOFOX_TEST_CONFIG__
    : CONFIG;
  const records = new WeakMap();
  const rotationMemory = new Map();
  const reservations = new Set();
  let sequence = 0;

  const STATES = Object.freeze({
    IDLE: 'IDLE',
    REQUESTING: 'REQUESTING',
    YAN_RENDERED: 'YAN_RENDERED',
    NO_FILL: 'NO_FILL',
    FALLBACK_RENDERED: 'FALLBACK_RENDERED',
    DONE: 'DONE',
    ERROR: 'ERROR',
    SKIPPED: 'SKIPPED',
    DISABLED: 'DISABLED',
    UNKNOWN: 'UNKNOWN'
  });
  const TERMINAL = new Set([
    STATES.YAN_RENDERED, STATES.DONE, STATES.ERROR, STATES.SKIPPED, STATES.DISABLED, STATES.UNKNOWN
  ]);

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function safe(fn) {
    try { return fn(); } catch (_) { return undefined; }
  }

  function validSize(width, height) {
    return Number.isInteger(width) && Number.isInteger(height) &&
      width > 0 && height > 0 && width <= 4096 && height <= 4096;
  }

  function safeUrl(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false;
    if (value.startsWith('/') && !value.startsWith('//')) return true;
    const url = safe(function () { return new URL(value); });
    return Boolean(url && url.protocol === 'https:');
  }

  function siteName() {
    const hostname = safe(function () { return global.location.hostname; });
    return typeof hostname === 'string' ? hostname.toLowerCase() : '';
  }

  function experimentAssignment() {
    const experiment = isObject(config.experiment) ? config.experiment : {};
    if (experiment.enabled !== true) return { variant: 'treatment', persistent: false };
    const id = typeof experiment.id === 'string' && experiment.id ? experiment.id : 'nanofox-v1';
    const control = Number(experiment.control);
    const treatment = Number(experiment.treatment);
    const total = control + treatment;
    if (!(control >= 0 && treatment >= 0 && total > 0)) {
      return { variant: 'control', persistent: false, reason: 'invalid_experiment' };
    }
    const key = 'nanofox:experiment:' + id;
    const storage = safe(function () { return global.localStorage; });
    const stored = safe(function () { return storage && storage.getItem(key); });
    if (stored === 'control' || stored === 'treatment') {
      return { variant: stored, persistent: true };
    }
    const variant = (safe(function () { return global.Math.random(); }) || 0) * total < control
      ? 'control' : 'treatment';
    const saved = safe(function () {
      if (!storage || typeof storage.setItem !== 'function') return false;
      storage.setItem(key, variant);
      return true;
    });
    return { variant: variant, persistent: saved === true };
  }

  function transition(record, next, reason) {
    if (TERMINAL.has(record.state) || record.state === next) return false;
    record.state = next;
    record.reason = reason || null;
    record.history.push({ state: next, reason: record.reason });
    return true;
  }

  function eventParams(record, extra) {
    const base = {
      site: record.site,
      slot: record.slotName,
      campaign: record.campaign ? record.campaign.id : null,
      source: record.source || null,
      experiment: record.experiment.id || null,
      variant: record.variant,
      reason: record.reason || null
    };
    return Object.assign(base, extra || {});
  }

  function observe(name, record, extra) {
    const params = eventParams(record, extra);
    safe(function () {
      const target = typeof global.dispatchEvent === 'function' ? global : global.document;
      if (target && typeof target.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
        target.dispatchEvent(new global.CustomEvent(name, { detail: params }));
      }
    });
    const analytics = isObject(config.analytics) ? config.analytics : {};
    if (analytics.enabled !== true || analytics.provider !== 'metrika' ||
        !Number.isFinite(analytics.counterId) || typeof global.ym !== 'function') return;
    safe(function () { global.ym(analytics.counterId, 'reachGoal', name, params); });
  }

  function createRecord(element, site, slotName, slot, assignment) {
    return {
      element: element,
      site: site,
      slotName: slotName,
      slot: slot,
      variant: assignment.variant,
      experiment: isObject(config.experiment) ? config.experiment : {},
      state: STATES.IDLE,
      reason: null,
      source: null,
      campaign: null,
      reservedToken: null,
      fallbackLoaded: false,
      fallbackVisible: false,
      visibilitySupported: false,
      rotationCommitted: false,
      visibilityObserver: null,
      removalObserver: null,
      yandexContainer: null,
      yandexCalled: false,
      history: [{ state: STATES.IDLE, reason: null }]
    };
  }

  function reserveSpace(element, slot) {
    if (!element || !element.style || !validSize(slot.width, slot.height)) return;
    element.style.minWidth = String(slot.width) + 'px';
    element.style.minHeight = String(slot.height) + 'px';
  }

  function validCampaign(campaign) {
    return campaign && campaign.enabled === true && campaign.type === 'image' &&
      validSize(campaign.width, campaign.height) && Number.isFinite(campaign.weight) &&
      campaign.weight > 0 && safeUrl(campaign.image) && safeUrl(campaign.url);
  }

  function campaignToken(campaign) {
    const source = [campaign.id, campaign.image, campaign.url, campaign.width, campaign.height].join('\u001f');
    let hash = 5381;
    for (let index = 0; index < source.length; index += 1) hash = ((hash * 33) ^ source.charCodeAt(index)) >>> 0;
    return campaign.id + ':' + hash.toString(36);
  }

  function candidateCampaigns(record) {
    const ids = Array.isArray(record.slot.fallback) ? record.slot.fallback : [];
    const campaigns = isObject(config.campaigns) ? config.campaigns : {};
    return ids.map(function (id) {
      const campaign = campaigns[id];
      return isObject(campaign) ? Object.assign({ id: id }, campaign) : null;
    }).filter(function (campaign) {
      return validCampaign(campaign) &&
        campaign.width === record.slot.width && campaign.height === record.slot.height;
    }).map(function (campaign) {
      campaign.rotationToken = campaignToken(campaign);
      return campaign;
    });
  }

  function weightedCampaign(candidates) {
    const total = candidates.reduce(function (sum, campaign) { return sum + campaign.weight; }, 0);
    if (!(total > 0)) return null;
    let cursor = (safe(function () { return global.Math.random(); }) || 0) * total;
    for (let index = 0; index < candidates.length; index += 1) {
      cursor -= candidates[index].weight;
      if (cursor < 0) return candidates[index];
    }
    return candidates[candidates.length - 1];
  }

  function chooseCampaign(record) {
    return weightedCampaign(candidateCampaigns(record));
  }

  function rotationSettings(activeCount) {
    const rotation = isObject(config.rotation) ? config.rotation : {};
    const version = typeof rotation.version === 'string' && rotation.version.length > 0 && rotation.version.length <= 64
      ? rotation.version : 'v1';
    const requested = Number(rotation.maxEntries);
    const requestedMax = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 500) : 100;
    return { key: 'nanofox:rotation:' + version, maxEntries: Math.min(500, Math.max(requestedMax, activeCount || 0)) };
  }

  function activeRotationTokens() {
    const campaigns = isObject(config.campaigns) ? config.campaigns : {};
    return new Set(Object.keys(campaigns).map(function (id) {
      const campaign = isObject(campaigns[id]) ? Object.assign({ id: id }, campaigns[id]) : null;
      return validCampaign(campaign) ? campaignToken(campaign) : null;
    }).filter(Boolean));
  }

  function cleanHistory(values, allowed, maxEntries) {
    const unique = [];
    (Array.isArray(values) ? values : []).forEach(function (value) {
      if (typeof value !== 'string' || value.length > 256 || !allowed.has(value) || unique.indexOf(value) !== -1) return;
      unique.push(value);
    });
    return unique.slice(-maxEntries);
  }

  function readRotation(settings, allowed) {
    const memory = rotationMemory.get(settings.key) || [];
    let raw = null;
    const storage = safe(function () { return global.localStorage; });
    try {
      if (storage && typeof storage.getItem === 'function') {
        raw = storage.getItem(settings.key);
      }
    } catch (_) {}
    const parsed = raw && safe(function () { return JSON.parse(raw); });
    const values = parsed && parsed.v === 1 && Array.isArray(parsed.seen) ? parsed.seen : memory;
    const clean = cleanHistory(values, allowed, settings.maxEntries);
    rotationMemory.set(settings.key, clean);
    return clean;
  }

  function saveRotation(settings, values, allowed) {
    const clean = cleanHistory(values, allowed, settings.maxEntries);
    rotationMemory.set(settings.key, clean);
    const storage = safe(function () { return global.localStorage; });
    safe(function () {
      if (storage && typeof storage.setItem === 'function') storage.setItem(settings.key, JSON.stringify({ v: 1, seen: clean }));
    });
  }

  function releaseReservation(record) {
    if (!record.reservedToken) return;
    reservations.delete(record.reservedToken);
    record.reservedToken = null;
  }

  function selectCampaign(record) {
    const candidates = candidateCampaigns(record);
    if (candidates.length === 0) return { campaign: null, reason: 'no_eligible_campaign' };
    const active = activeRotationTokens();
    const settings = rotationSettings(active.size);
    let history = readRotation(settings, active);
    saveRotation(settings, history, active);
    const seen = new Set(history);
    const unseen = candidates.filter(function (campaign) { return !seen.has(campaign.rotationToken); });
    let available = unseen.filter(function (campaign) { return !reservations.has(campaign.rotationToken); });
    if (available.length === 0 && unseen.length > 0) return { campaign: null, reason: 'unseen_campaign_reserved' };
    if (available.length === 0) {
      available = candidates.filter(function (campaign) { return !reservations.has(campaign.rotationToken); });
      if (available.length === 0) return { campaign: null, reason: 'cycle_campaign_reserved' };
      const currentTokens = new Set(candidates.map(function (campaign) { return campaign.rotationToken; }));
      history = history.filter(function (token) { return !currentTokens.has(token); });
      saveRotation(settings, history, active);
    }
    const campaign = weightedCampaign(available);
    if (!campaign) return { campaign: null, reason: 'no_eligible_campaign' };
    reservations.add(campaign.rotationToken);
    record.reservedToken = campaign.rotationToken;
    return { campaign: campaign, reason: null };
  }

  function markSeen(record) {
    const active = activeRotationTokens();
    const settings = rotationSettings(active.size);
    const history = readRotation(settings, active).filter(function (token) { return token !== record.reservedToken; });
    if (record.reservedToken && active.has(record.reservedToken)) history.push(record.reservedToken);
    saveRotation(settings, history, active);
  }

  function stopObservers(record) {
    safe(function () { record.visibilityObserver && record.visibilityObserver.disconnect(); });
    safe(function () { record.removalObserver && record.removalObserver.disconnect(); });
    record.visibilityObserver = null;
    record.removalObserver = null;
  }

  function confirmVisibility(record) {
    if (!record.fallbackLoaded || !record.fallbackVisible || record.rotationCommitted) return;
    record.rotationCommitted = true;
    markSeen(record);
    releaseReservation(record);
    stopObservers(record);
    observe('nanofox_fallback_visible', record, { source: 'fallback' });
  }

  function trackVisibility(record, image) {
    if (typeof global.IntersectionObserver !== 'function') return false;
    const observer = safe(function () {
      return new global.IntersectionObserver(function (entries, activeObserver) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          record.fallbackVisible = true;
          confirmVisibility(record);
          if (record.rotationCommitted) safe(function () { activeObserver.unobserve(entry.target); });
        });
      }, { threshold: 0.5 });
    });
    if (!observer) return false;
    const observed = safe(function () { observer.observe(image); return true; });
    if (observed !== true) return false;
    record.visibilityObserver = observer;
    return true;
  }

  function watchRemoval(record, wrapper) {
    const document = global.document;
    const root = document && document.documentElement;
    if (!root || typeof global.MutationObserver !== 'function') return;
    const observer = safe(function () {
      return new global.MutationObserver(function () {
        safe(function () {
          const attached = typeof wrapper.isConnected === 'boolean' ? wrapper.isConnected : root.contains(wrapper);
          if (attached) return;
          releaseReservation(record);
          stopObservers(record);
        });
      });
    });
    if (!observer) return;
    const watching = safe(function () { observer.observe(root, { childList: true, subtree: true }); return true; });
    if (watching === true) record.removalObserver = observer;
  }

  function renderFallback(record) {
    const selection = selectCampaign(record);
    const campaign = selection.campaign;
    if (!campaign) {
      transition(record, STATES.DONE, selection.reason);
      return;
    }
    const document = global.document;
    if (!document || typeof document.createElement !== 'function') {
      releaseReservation(record);
      transition(record, STATES.ERROR, 'dom_unavailable');
      observe('nanofox_error', record, { source: 'fallback' });
      return;
    }
    record.campaign = campaign;
    record.source = 'fallback';
    const wrapper = document.createElement('div');
    const label = document.createElement('span');
    const link = document.createElement('a');
    const image = document.createElement('img');
    label.textContent = typeof campaign.label === 'string' && campaign.label ? campaign.label : 'Реклама';
    link.href = campaign.url;
    link.target = '_blank';
    link.rel = 'sponsored noopener noreferrer';
    image.src = campaign.image;
    image.alt = typeof campaign.alt === 'string' ? campaign.alt : '';
    image.width = campaign.width;
    image.height = campaign.height;
    image.loading = 'lazy';
    image.decoding = 'async';
    link.addEventListener('click', function () {
      observe('nanofox_fallback_click', record, { source: 'fallback' });
    }, { once: true });
    image.addEventListener('error', function () {
      releaseReservation(record);
      stopObservers(record);
      if (!transition(record, STATES.ERROR, 'fallback_image_error')) return;
      safe(function () { wrapper.remove(); });
      observe('nanofox_error', record, { source: 'fallback' });
    }, { once: true });
    image.addEventListener('load', function () {
      record.fallbackLoaded = true;
      transition(record, STATES.DONE, 'fallback_image_loaded');
      if (record.visibilitySupported) confirmVisibility(record);
      else releaseReservation(record);
    }, { once: true });
    link.appendChild(image);
    wrapper.appendChild(label);
    wrapper.appendChild(link);
    record.element.appendChild(wrapper);
    transition(record, STATES.FALLBACK_RENDERED, 'official_no_fill');
    observe('nanofox_fallback_render', record, { source: 'fallback' });
    record.visibilitySupported = trackVisibility(record, image);
    watchRemoval(record, wrapper);
  }

  function noFill(record) {
    if (record.state !== STATES.REQUESTING) return;
    record.source = 'yandex';
    transition(record, STATES.NO_FILL, 'official_no_fill');
    observe('nanofox_no_fill', record, { source: 'yandex' });
    if (record.variant === 'control') {
      transition(record, STATES.DONE, 'control_no_fill');
      return;
    }
    renderFallback(record);
  }

  function confirmedYandexRender(record) {
    if (!transition(record, STATES.YAN_RENDERED, 'yandex_rendered')) return;
    record.source = 'yandex';
    observe('nanofox_yandex_render', record, { source: 'yandex' });
  }

  function yandexRequestError(record) {
    if (record.state !== STATES.REQUESTING) return;
    if (!transition(record, STATES.ERROR, 'yandex_request_error')) return;
    observe('nanofox_error', record, { source: 'yandex' });
  }

  function callYandex(record) {
    if (record.yandexCalled || record.state !== STATES.REQUESTING) return;
    record.yandexCalled = true;
    const manager = safe(function () { return global.Ya.Context.AdvManager; });
    if (!manager || typeof manager.render !== 'function') {
      transition(record, STATES.UNKNOWN, 'yandex_api_unavailable');
      observe('nanofox_error', record, { source: 'yandex' });
      return;
    }
    try {
      manager.render({
        blockId: record.slot.yandex,
        renderTo: record.yandexContainer.id,
        onRender: function () { confirmedYandexRender(record); },
        onError: function () { yandexRequestError(record); }
      }, function () {
        noFill(record);
      });
    } catch (_) {
      if (!transition(record, STATES.ERROR, 'yandex_render_throw')) return;
      observe('nanofox_error', record, { source: 'yandex' });
    }
  }

  function requestYandex(record) {
    const document = global.document;
    const container = document && document.createElement ? document.createElement('div') : null;
    if (!container) {
      transition(record, STATES.ERROR, 'dom_unavailable');
      observe('nanofox_error', record, { source: 'yandex' });
      return;
    }
    sequence += 1;
    container.id = 'nanofox-yandex-' + sequence;
    record.element.appendChild(container);
    record.yandexContainer = container;
    record.source = 'yandex';
    transition(record, STATES.REQUESTING, 'yandex_request');
    observe('nanofox_yandex_request', record, { source: 'yandex' });
    const manager = safe(function () { return global.Ya.Context.AdvManager; });
    if (manager && typeof manager.render === 'function') {
      callYandex(record);
      return;
    }
    const queue = global.yaContextCb;
    if (!Array.isArray(queue)) {
      transition(record, STATES.UNKNOWN, 'yandex_api_unavailable');
      observe('nanofox_error', record, { source: 'yandex' });
      return;
    }
    safe(function () { queue.push(function () { callYandex(record); }); });
  }

  function canOwn(element) {
    const siteConfig = isObject(config.sites) ? config.sites[siteName()] : null;
    const slotName = safe(function () { return element && element.getAttribute('data-nanofox'); });
    const slot = siteConfig && isObject(siteConfig.slots) ? siteConfig.slots[slotName] : null;
    return config.enabled === true && siteConfig && siteConfig.enabled === true &&
      slot && typeof slot.yandex === 'string' && slot.yandex.length > 0 &&
      validSize(slot.width, slot.height);
  }

  function initialize(element) {
    if (!element || records.has(element)) return records.get(element) || null;
    const site = siteName();
    const slotName = safe(function () { return element.getAttribute('data-nanofox'); });
    const siteConfig = isObject(config.sites) ? config.sites[site] : null;
    const slot = siteConfig && isObject(siteConfig.slots) ? siteConfig.slots[slotName] : null;
    const record = createRecord(element, site, slotName, slot || {}, experimentAssignment());
    records.set(element, record);
    if (config.enabled !== true) {
      transition(record, STATES.DISABLED, 'disabled');
      return record;
    }
    if (!siteConfig) {
      transition(record, STATES.SKIPPED, 'unknown_site');
      return record;
    }
    if (siteConfig.enabled !== true) {
      transition(record, STATES.DISABLED, 'site_disabled');
      return record;
    }
    if (!slot || typeof slot.yandex !== 'string' || !slot.yandex || !validSize(slot.width, slot.height)) {
      transition(record, STATES.SKIPPED, 'unknown_site_or_slot');
      return record;
    }
    reserveSpace(element, slot);
    observe('nanofox_eligible', record, { source: 'yandex' });
    requestYandex(record);
    return record;
  }

  function roots(root) {
    const list = [];
    if (!root) return list;
    if (typeof root.matches === 'function' && root.matches('[data-nanofox]')) list.push(root);
    if (typeof root.querySelectorAll === 'function') {
      safe(function () { root.querySelectorAll('[data-nanofox]').forEach(function (item) { list.push(item); }); });
    }
    return list;
  }

  function refresh(root) {
    const scope = root || global.document;
    return roots(scope).map(initialize).filter(Boolean);
  }

  const api = {
    canOwn: canOwn,
    refresh: refresh,
    getState: function (element) {
      const record = records.get(element);
      return record ? record.state : null;
    },
    __nanofox: true,
    version: '0.1.0'
  };
  if (global.__NANOFOX_TEST__ === true) {
    api.__test = { STATES: STATES, chooseCampaign: chooseCampaign, records: records };
  }
  global.NanoFox = api;
  safe(function () { refresh(global.document); });
})(typeof window !== 'undefined' ? window : globalThis);
