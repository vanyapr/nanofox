/* Run: node --test tests/nanofox.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'nanofox.js'), 'utf8');

class EventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback, options) {
    const entries = this.listeners.get(type) || [];
    entries.push({ callback, once: options && options.once === true });
    this.listeners.set(type, entries);
  }
  dispatchEvent(event) {
    const entries = (this.listeners.get(event.type) || []).slice();
    entries.forEach((entry) => {
      entry.callback.call(this, event);
      if (entry.once) this.listeners.set(event.type, (this.listeners.get(event.type) || []).filter((item) => item !== entry));
    });
    return true;
  }
  fire(type) { this.dispatchEvent({ type, target: this }); }
}

class Element extends EventTarget {
  constructor(tagName, attrs = {}) {
    super();
    this.tagName = tagName.toUpperCase();
    this.attrs = { ...attrs };
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.textContent = '';
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) {
    this.children = this.children.filter((item) => item !== child);
    child.parentNode = null;
    return child;
  }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  matches(selector) {
    if (selector === '[data-nanofox]') return this.getAttribute('data-nanofox') !== null;
    return selector === '.lazy-ad[data-block-id]' &&
      /(?:^|\s)lazy-ad(?:\s|$)/.test(this.getAttribute('class') || '') &&
      this.getAttribute('data-block-id') !== null;
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      node.children.forEach((child) => {
        if (child.matches && child.matches(selector)) found.push(child);
        visit(child);
      });
    };
    visit(this);
    return found;
  }
}

class Document extends EventTarget {
  constructor(slots) {
    super();
    this.slots = slots;
    this.documentElement = { contains: (target) => this.contains(target) };
  }
  createElement(tagName) { return new Element(tagName); }
  querySelectorAll(selector) { return this.slots.filter((slot) => slot.matches(selector)); }
  contains(target) {
    const visit = (node) => node === target || node.children.some(visit);
    return this.slots.some(visit);
  }
}

class MemoryStorage {
  constructor(values = new Map()) { this.values = values; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

class FailingStorage {
  getItem() { throw new Error('blocked'); }
  setItem() { throw new Error('blocked'); }
}

class TestObserver {
  constructor(callback) { this.callback = callback; this.targets = []; TestObserver.instances.push(this); }
  observe(target) { this.targets.push(target); }
  unobserve(target) { this.targets = this.targets.filter((item) => item !== target); }
  disconnect() { this.targets = []; }
  fire(target) { this.callback([{ target, isIntersecting: true }], this); }
}
TestObserver.instances = [];

class TestMutationObserver {
  constructor(callback) { this.callback = callback; TestMutationObserver.instances.push(this); }
  observe() {}
  disconnect() {}
  fire() { this.callback([], this); }
}
TestMutationObserver.instances = [];

function imageIn(element) {
  const queue = [...element.children];
  while (queue.length) {
    const item = queue.shift();
    if (item.tagName === 'IMG') return item;
    queue.push(...item.children);
  }
  return null;
}

function visible(image) {
  const observer = [...TestObserver.instances].reverse().find((item) => item.targets.includes(image));
  assert.ok(observer, 'visibility observer should exist');
  observer.fire(image);
}

function rotationSeen(values) {
  const entry = [...values.entries()].find(([key]) => key.startsWith('nanofox:rotation:'));
  return entry ? JSON.parse(entry[1]).seen : [];
}

function treatmentConfig() {
  const config = baseConfig();
  config.experiment = { enabled: false, id: 'test-v1', control: 50, treatment: 50 };
  return config;
}

function baseConfig(overrides = {}) {
  const config = {
    enabled: true,
    experiment: { enabled: true, id: 'test-v1', control: 50, treatment: 50 },
    sites: {
      'example.test': {
        enabled: true,
        slots: { article: { yandex: 'R-A-TEST-1', width: 300, height: 250, fallback: ['a', 'b'] } }
      }
    },
    campaigns: {
      a: { enabled: true, type: 'image', image: '/ads/a.webp', url: 'https://partner.example/a?x=1', width: 300, height: 250, weight: 70, label: 'Реклама' },
      b: { enabled: true, type: 'image', image: '/ads/b.webp', url: 'https://partner.example/b?x=2', width: 300, height: 250, weight: 30, label: 'Реклама' }
    },
    rotation: { version: 'tests-v1', maxEntries: 100 },
    analytics: { enabled: true, provider: 'metrika', counterId: 1 }
  };
  return Object.assign(config, overrides);
}

function boot({ config = baseConfig(), slots = [new Element('div', { 'data-nanofox': 'article' })],
  hostname = 'example.test', storage = new MemoryStorage(), random = () => 0.9,
  render = null, withYandex = true, yandexQueue = null, ym = undefined,
  withIntersectionObserver = true, renderWidget = null } = {}) {
  const document = new Document(slots);
  const callbacks = [];
  const renders = [];
  const widgetRenders = [];
  const defaultRender = (options, callback) => { renders.push(options); callbacks.push(callback); };
  const defaultWidget = (options) => { widgetRenders.push(options); };
  const sandbox = {
    document,
    location: { hostname },
    localStorage: storage,
    URL,
    Math: Object.assign(Object.create(Math), { random }),
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    MutationObserver: TestMutationObserver,
    dispatchEvent: (...args) => document.dispatchEvent(...args),
    __NANOFOX_TEST__: true,
    __NANOFOX_TEST_CONFIG__: config,
    console
  };
  if (withIntersectionObserver) sandbox.IntersectionObserver = TestObserver;
  if (typeof ym === 'function') sandbox.ym = ym;
  if (Array.isArray(yandexQueue)) sandbox.yaContextCb = yandexQueue;
  if (withYandex) sandbox.Ya = { Context: { AdvManager: {
    render: render || defaultRender,
    renderWidget: renderWidget || defaultWidget
  } } };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'nanofox.js' });
  return { sandbox, document, slots, callbacks, renders, widgetRenders };
}

test('1. documented Yandex onRender confirms YAN_RENDERED; late no-fill cannot add fallback', () => {
  const env = boot();
  assert.equal(env.renders.length, 1);
  env.renders[0].onRender({ product: 'direct' });
  assert.equal(env.sandbox.NanoFox.getState(env.slots[0]), 'YAN_RENDERED');
  env.callbacks[0]();
  assert.equal(imageIn(env.slots[0]), null);
});

test('2. official no-fill renders one eligible fallback', () => {
  const env = boot();
  env.callbacks[0]();
  const image = imageIn(env.slots[0]);
  assert.ok(image);
  assert.equal(image.loading, 'lazy');
  assert.equal(image.decoding, 'async');
  assert.equal(env.sandbox.NanoFox.getState(env.slots[0]), 'FALLBACK_RENDERED');
  image.fire('load');
  assert.equal(env.sandbox.NanoFox.getState(env.slots[0]), 'DONE');
});

test('a slow or silent Yandex request stays REQUESTING and never guesses no-fill', () => {
  const env = boot();
  // No callback is fired: NanoFox intentionally has no timeout-based fallback.
  assert.equal(env.sandbox.NanoFox.getState(env.slots[0]), 'REQUESTING');
  assert.equal(imageIn(env.slots[0]), null);
  assert.equal(env.callbacks.length, 1);
});

test('3. unavailable Yandex API is UNKNOWN and does not start fallback', () => {
  const env = boot({ withYandex: false });
  assert.equal(env.sandbox.NanoFox.getState(env.slots[0]), 'UNKNOWN');
  assert.equal(imageIn(env.slots[0]), null);
});

test('existing yaContextCb waits for the asynchronous Yandex loader without a timeout', () => {
  const queue = [];
  const env = boot({ withYandex: false, yandexQueue: queue });
  assert.equal(env.sandbox.NanoFox.getState(env.slots[0]), 'REQUESTING');
  assert.equal(queue.length, 1);
  const calls = [];
  env.sandbox.Ya = { Context: { AdvManager: { render(options, callback) {
    calls.push({ options, callback });
  } } } };
  queue.shift()();
  assert.equal(calls.length, 1);
  calls[0].callback();
  assert.ok(imageIn(env.slots[0]));
});

test('4. documented Yandex onError is ERROR and does not start fallback', () => {
  const env = boot();
  env.renders[0].onError({ code: 'test_error' });
  assert.equal(env.sandbox.NanoFox.getState(env.slots[0]), 'ERROR');
  assert.equal(imageIn(env.slots[0]), null);
  env.callbacks[0]();
  assert.equal(imageIn(env.slots[0]), null);
});

test('a synchronous Yandex exception is ERROR and does not start fallback', () => {
  const env = boot({ render: () => { throw new Error('provider failure'); } });
  assert.equal(env.sandbox.NanoFox.getState(env.slots[0]), 'ERROR');
  assert.equal(imageIn(env.slots[0]), null);
});

test('5. disabled fallback campaigns leave slot empty after no-fill', () => {
  const config = baseConfig();
  config.campaigns.a.enabled = false;
  config.campaigns.b.enabled = false;
  const env = boot({ config });
  env.callbacks[0]();
  assert.equal(env.sandbox.NanoFox.getState(env.slots[0]), 'DONE');
  assert.equal(imageIn(env.slots[0]), null);
});

test('6. fallback image error becomes ERROR without a second campaign choice', () => {
  const env = boot();
  env.callbacks[0]();
  const image = imageIn(env.slots[0]);
  image.fire('error');
  assert.equal(env.sandbox.NanoFox.getState(env.slots[0]), 'ERROR');
  assert.equal(imageIn(env.slots[0]), null);
});

test('a late no-fill callback after fallback image failure cannot restart the waterfall', () => {
  const env = boot();
  env.callbacks[0]();
  imageIn(env.slots[0]).fire('error');
  env.callbacks[0]();
  assert.equal(env.sandbox.NanoFox.getState(env.slots[0]), 'ERROR');
  assert.equal(imageIn(env.slots[0]), null);
  assert.equal(env.slots[0].children.length, 1); // only the original Yandex container remains
});

test('7. unknown site is skipped', () => {
  const env = boot({ hostname: 'unknown.test' });
  assert.equal(env.sandbox.NanoFox.getState(env.slots[0]), 'SKIPPED');
  assert.equal(env.renders.length, 0);
});

test('8. unknown slot is skipped', () => {
  const env = boot({ slots: [new Element('div', { 'data-nanofox': 'missing' })] });
  assert.equal(env.sandbox.NanoFox.getState(env.slots[0]), 'SKIPPED');
});

test('9. including NanoFox twice retains the original instance and one request', () => {
  const env = boot();
  vm.runInNewContext(source, env.sandbox, { filename: 'nanofox-second.js' });
  assert.equal(env.renders.length, 1);
});

test('10. five ad slots receive five independent requests', () => {
  const slots = Array.from({ length: 5 }, () => new Element('div', { 'data-nanofox': 'article' }));
  const env = boot({ slots });
  assert.equal(env.renders.length, 5);
  assert.equal(new Set(env.renders.map((item) => item.renderTo)).size, 5);
});

test('11. repeat refresh does not make a second Yandex request', () => {
  const env = boot();
  env.sandbox.NanoFox.refresh(env.document);
  env.sandbox.NanoFox.refresh(env.slots[0]);
  assert.equal(env.renders.length, 1);
});

test('12. blocked localStorage uses a page-only assignment without throwing', () => {
  const env = boot({ storage: new FailingStorage() });
  assert.equal(env.renders.length, 1);
});

test('13. unavailable analytics does not affect rendering', () => {
  const env = boot({ ym: undefined });
  assert.equal(env.renders.length, 1);
  env.callbacks[0]();
  assert.ok(imageIn(env.slots[0]));
});

test('analytics reports stateful non-personal parameters without changing delivery', () => {
  const calls = [];
  const env = boot({ ym: (...args) => calls.push(args) });
  env.callbacks[0]();
  const goals = calls.map((call) => call[2]);
  assert.deepEqual(goals, [
    'nanofox_eligible', 'nanofox_yandex_request', 'nanofox_no_fill', 'nanofox_fallback_render'
  ]);
  const params = calls.at(-1)[3];
  assert.equal(params.site, 'example.test');
  assert.equal(params.slot, 'article');
  assert.equal(params.source, 'fallback');
  assert.equal(params.variant, 'treatment');
  assert.deepEqual(Object.keys(params).sort(), [
    'campaign', 'experiment', 'reason', 'site', 'slot', 'source', 'variant'
  ]);
});

test('14. globally disabled NanoFox does not own the normal Yandex block', () => {
  const config = baseConfig({ enabled: false });
  const env = boot({ config });
  assert.equal(env.sandbox.NanoFox.getState(env.slots[0]), 'DISABLED');
  assert.equal(env.sandbox.NanoFox.canOwn(env.slots[0]), false);
  assert.equal(env.renders.length, 0);
});

test('15. host fail-open path calls legacy renderer when nanofox.js is unavailable', () => {
  let legacyCalls = 0;
  const hostOwnsSlot = (win, legacyRender) => {
    if (win.NanoFox && win.NanoFox.canOwn && win.NanoFox.canOwn({ getAttribute: () => 'article' })) win.NanoFox.refresh();
    else legacyRender();
  };
  hostOwnsSlot({}, () => { legacyCalls += 1; });
  assert.equal(legacyCalls, 1);
});

test('16. experiment assignment persists per origin and does not mix groups', () => {
  const values = new Map();
  const first = boot({ storage: new MemoryStorage(values), random: () => 0.1 });
  const second = boot({ storage: new MemoryStorage(values), random: () => 0.99 });
  const firstRecord = first.sandbox.NanoFox.__test.records.get(first.slots[0]);
  const secondRecord = second.sandbox.NanoFox.__test.records.get(second.slots[0]);
  assert.equal(firstRecord.variant, 'control');
  assert.equal(secondRecord.variant, 'control');
});

test('17. a late duplicate no-fill callback cannot render a second fallback', () => {
  const env = boot();
  env.callbacks[0]();
  env.callbacks[0]();
  assert.equal(env.slots[0].children.length, 2); // Yandex container + one fallback wrapper
  assert.equal(env.sandbox.NanoFox.getState(env.slots[0]), 'FALLBACK_RENDERED');
});

test('18. mobile-compatible dimensions are preserved and safe URLs are enforced', () => {
  const config = baseConfig();
  config.sites['example.test'].slots.article = { yandex: 'R-A-MOBILE-1', width: 320, height: 50, fallback: ['mobile'] };
  config.campaigns = {
    mobile: { enabled: true, type: 'image', image: '/ads/mobile.webp', url: 'https://partner.example/mobile', width: 320, height: 50, weight: 1 }
  };
  const env = boot({ config });
  assert.equal(env.slots[0].style.minWidth, '320px');
  assert.equal(env.slots[0].style.minHeight, '50px');
  env.callbacks[0]();
  assert.equal(imageIn(env.slots[0]).width, 320);
});

test('unsafe campaign image and destination URLs are rejected before rendering', () => {
  const config = baseConfig();
  config.campaigns.a.image = 'javascript:alert(1)';
  config.campaigns.b.url = 'http://partner.example/insecure';
  const env = boot({ config });
  env.callbacks[0]();
  assert.equal(env.sandbox.NanoFox.getState(env.slots[0]), 'DONE');
  assert.equal(imageIn(env.slots[0]), null);
});

test('visible campaigns rotate across reloads and an experiment ID change without mixing histories', () => {
  const values = new Map();
  const firstConfig = treatmentConfig();
  firstConfig.experiment = { enabled: true, id: 'experiment-one', control: 0, treatment: 100 };
  const first = boot({ config: firstConfig, storage: new MemoryStorage(values), random: () => 0 });
  first.callbacks[0]();
  const firstImage = imageIn(first.slots[0]);
  firstImage.fire('load');
  assert.deepEqual(rotationSeen(values), []); // loaded DOM is not a viewed creative
  visible(firstImage);
  assert.equal(rotationSeen(values).length, 1);

  const secondConfig = treatmentConfig();
  secondConfig.experiment = { enabled: true, id: 'experiment-two', control: 0, treatment: 100 };
  const second = boot({ config: secondConfig, storage: new MemoryStorage(values), random: () => 0 });
  second.callbacks[0]();
  const secondImage = imageIn(second.slots[0]);
  assert.equal(secondImage.src, '/ads/b.webp');
  secondImage.fire('load');
  visible(secondImage);

  const third = boot({ config: secondConfig, storage: new MemoryStorage(values), random: () => 0 });
  third.callbacks[0]();
  assert.equal(imageIn(third.slots[0]).src, '/ads/a.webp'); // a new cycle starts only after both were seen
});

test('blocked storage keeps an in-page rotation history after confirmed visibility', () => {
  const config = treatmentConfig();
  const slots = [new Element('div', { 'data-nanofox': 'article' }), new Element('div', { 'data-nanofox': 'article' })];
  const env = boot({ config, slots, storage: new FailingStorage(), random: () => 0 });
  env.callbacks[0]();
  const firstImage = imageIn(slots[0]);
  firstImage.fire('load');
  visible(firstImage);
  env.callbacks[1]();
  assert.equal(imageIn(slots[1]).src, '/ads/b.webp');
});

test('page-level reservations prevent a duplicate while the only unseen campaign is pending', () => {
  const config = treatmentConfig();
  config.campaigns.b.enabled = false;
  const slots = [new Element('div', { 'data-nanofox': 'article' }), new Element('div', { 'data-nanofox': 'article' })];
  const env = boot({ config, slots, random: () => 0 });
  env.callbacks[0]();
  env.callbacks[1]();
  assert.ok(imageIn(slots[0]));
  assert.equal(imageIn(slots[1]), null);
  const secondRecord = env.sandbox.NanoFox.__test.records.get(slots[1]);
  assert.equal(secondRecord.reason, 'unseen_campaign_reserved');
});

test('failed image and removed wrapper release their page reservations', () => {
  const config = treatmentConfig();
  config.campaigns.b.enabled = false;
  const slots = [new Element('div', { 'data-nanofox': 'article' }), new Element('div', { 'data-nanofox': 'article' })];
  const env = boot({ config, slots, random: () => 0 });
  env.callbacks[0]();
  imageIn(slots[0]).fire('error');
  env.callbacks[1]();
  assert.ok(imageIn(slots[1]));

  const laterSlot = new Element('div', { 'data-nanofox': 'article' });
  slots.push(laterSlot);
  env.sandbox.NanoFox.refresh(env.document);
  const wrapper = slots[1].children[1];
  wrapper.remove();
  TestMutationObserver.instances.at(-1).fire();
  env.callbacks[2]();
  assert.ok(imageIn(laterSlot));
});

test('campaign choice excludes incompatible active creatives and falls back safely without IntersectionObserver', () => {
  const config = treatmentConfig();
  config.campaigns.a.width = 728;
  config.campaigns.a.height = 90;
  const slots = [new Element('div', { 'data-nanofox': 'article' }), new Element('div', { 'data-nanofox': 'article' })];
  const env = boot({ config, slots, withIntersectionObserver: false, random: () => 0 });
  env.callbacks[0]();
  const firstImage = imageIn(slots[0]);
  assert.equal(firstImage.src, '/ads/b.webp');
  firstImage.fire('load');
  env.callbacks[1]();
  assert.equal(imageIn(slots[1]).src, '/ads/b.webp');
});

test('changing a creative makes it new while disabled campaigns leave rotation eligibility', () => {
  const values = new Map();
  const firstConfig = treatmentConfig();
  const first = boot({ config: firstConfig, storage: new MemoryStorage(values), random: () => 0 });
  first.callbacks[0]();
  const firstImage = imageIn(first.slots[0]);
  firstImage.fire('load');
  visible(firstImage);

  const changedConfig = treatmentConfig();
  changedConfig.campaigns.a.image = '/ads/a-new.webp';
  const changed = boot({ config: changedConfig, storage: new MemoryStorage(values), random: () => 0 });
  changed.callbacks[0]();
  assert.equal(imageIn(changed.slots[0]).src, '/ads/a-new.webp');

  const disabledConfig = treatmentConfig();
  disabledConfig.campaigns.a.enabled = false;
  const disabled = boot({ config: disabledConfig, storage: new MemoryStorage(values), random: () => 0 });
  disabled.callbacks[0]();
  assert.equal(imageIn(disabled.slots[0]).src, '/ads/b.webp');
});

test('weighted choice honors 70/30 boundaries over independent selections', () => {
  const env = boot();
  const record = env.sandbox.NanoFox.__test.records.get(env.slots[0]);
  const choose = env.sandbox.NanoFox.__test.chooseCampaign;
  let a = 0;
  for (let value = 0; value < 10000; value += 1) {
    env.sandbox.Math.random = () => (value + 0.5) / 10000;
    if (choose(record).id === 'a') a += 1;
  }
  assert.equal(a, 7000);
});

test('lazy NanoFox slot waits for the configured viewport observer before one request', () => {
  const config = baseConfig();
  config.lazy = { enabled: true, rootMargin: '300px' };
  const env = boot({ config });
  assert.equal(env.renders.length, 0);
  const lazyObserver = TestObserver.instances.at(-1);
  lazyObserver.fire(env.slots[0]);
  assert.equal(env.renders.length, 1);
  lazyObserver.fire(env.slots[0]);
  assert.equal(env.renders.length, 1);
});

test('refresh lazily initializes a dynamically inserted slot without duplicating it', () => {
  const config = baseConfig();
  config.lazy = { enabled: true, rootMargin: '200px' };
  const first = new Element('div', { 'data-nanofox': 'article' });
  const env = boot({ config, slots: [first] });
  const second = new Element('div', { 'data-nanofox': 'article' });
  env.slots.push(second);
  env.sandbox.NanoFox.refresh(env.document);
  env.sandbox.NanoFox.refresh(env.document);
  TestObserver.instances.at(-2).fire(first);
  TestObserver.instances.at(-1).fire(second);
  assert.equal(env.renders.length, 2);
});

test('mapped legacy lazy markup can use the documented NanoFox render path after it becomes near', () => {
  const config = baseConfig();
  config.legacy = {
    enabled: true,
    selector: '.lazy-ad[data-block-id]',
    rootMargin: '200px',
    slots: { 'R-A-TEST-1': 'article' }
  };
  const slot = new Element('div', { class: 'lazy-ad', 'data-block-id': 'R-A-TEST-1' });
  const env = boot({ config, slots: [slot] });
  assert.equal(env.renders.length, 0);
  TestObserver.instances.at(-1).fire(slot);
  assert.equal(env.renders.length, 1);
  env.callbacks[0]();
  assert.ok(imageIn(slot));
});

test('unmapped legacy markup preserves a Yandex-only lazy widget path when NanoFox is disabled', () => {
  const config = baseConfig({ enabled: false });
  config.legacy = { enabled: true, selector: '.lazy-ad[data-block-id]', rootMargin: '200px', slots: {} };
  const slot = new Element('div', { class: 'lazy-ad', 'data-block-id': 'R-A-LEGACY-1' });
  const env = boot({ config, slots: [slot] });
  assert.equal(env.widgetRenders.length, 0);
  TestObserver.instances.at(-1).fire(slot);
  assert.equal(env.widgetRenders.length, 1);
  assert.equal(imageIn(slot), null);
});

test('legacy special formats are skipped unless an explicit separate owner is provided', () => {
  const config = baseConfig();
  config.legacy = {
    enabled: true,
    selector: '.lazy-ad[data-block-id]',
    slots: {},
    excludedBlockIds: ['R-A-SPECIAL-1']
  };
  const slot = new Element('div', { class: 'lazy-ad', 'data-block-id': 'R-A-SPECIAL-1' });
  const env = boot({ config, slots: [slot], withIntersectionObserver: false });
  assert.equal(env.widgetRenders.length, 0);
  assert.equal(env.sandbox.NanoFox.getState(slot), 'SKIPPED');
});

test('legacy Yandex-only markup accepts a loader that exposes renderWidget without render', () => {
  const config = baseConfig({ enabled: false });
  config.legacy = { enabled: true, selector: '.lazy-ad[data-block-id]', slots: {} };
  const slot = new Element('div', { class: 'lazy-ad', 'data-block-id': 'R-A-WIDGET-1' });
  const queue = [];
  const env = boot({ config, slots: [slot], withYandex: false, yandexQueue: queue, withIntersectionObserver: false });
  assert.equal(queue.length, 1);
  const calls = [];
  env.sandbox.Ya = { Context: { AdvManager: { renderWidget: (options) => calls.push(options) } } };
  queue.shift()();
  assert.equal(calls.length, 1);
  assert.equal(env.sandbox.NanoFox.getState(slot), 'DONE');
});

test('a 300×250 fallback is valid and centered in a wider responsive slot without reserving desktop width', () => {
  const config = treatmentConfig();
  config.sites['example.test'].slots.article = {
    yandex: 'R-A-RESPONSIVE-1',
    fallbackMaxWidth: 798,
    fallbackMaxHeight: 250,
    reserveHeight: 250,
    fallbackAlign: 'center',
    fallback: ['a']
  };
  config.campaigns.b.enabled = false;
  const env = boot({ config, random: () => 0 });
  assert.equal(env.slots[0].style.minWidth, undefined);
  assert.equal(env.slots[0].style.minHeight, '250px');
  env.callbacks[0]();
  const wrapper = env.slots[0].children[1];
  const link = wrapper.children[1];
  const image = imageIn(env.slots[0]);
  assert.equal(image.width, 300);
  assert.equal(image.height, 250);
  assert.equal(wrapper.style.textAlign, 'center');
  assert.equal(link.style.display, 'inline-block');
  assert.equal(image.style.maxWidth, '100%');
  assert.equal(image.style.height, 'auto');
});
