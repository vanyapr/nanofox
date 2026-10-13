/* Optional browser QA. Run with: npx -p @playwright/test playwright test tests/playwright.spec.js
 * It uses a mocked Yandex API and a local 1px image only—never a live ad request.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const root = path.join(__dirname, '..');
const nanofox = fs.readFileSync(path.join(root, 'nanofox.js'));
const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
let server;
let origin;

function fixturePage() {
  return `<!doctype html><html><head><meta charset="utf-8">
    <script src="/nanofox.js"></script><script src="/nanofox.js"></script>
  </head><body><main><div id="article" data-nanofox="article"></div></main>
    <script>
      (function () {
        var slot = document.getElementById('article');
        window.legacyCalls = 0;
        function legacyRender() { window.legacyCalls += 1; }
        if (window.NanoFox && window.NanoFox.canOwn(slot)) window.NanoFox.refresh(slot);
        else legacyRender();
      })();
    </script></body></html>`;
}

test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    if (request.url === '/nanofox.js') {
      response.writeHead(200, { 'content-type': 'application/javascript' });
      response.end(nanofox);
      return;
    }
    if (request.url.startsWith('/ads/')) {
      response.writeHead(200, { 'content-type': 'image/gif' });
      response.end(pixel);
      return;
    }
    if (request.url === '/missing.html') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(`<!doctype html><div id="article" data-nanofox="article"></div>
        <script src="/missing.js"></script><script>
          window.legacyCalls = 0;
          if (window.NanoFox && window.NanoFox.canOwn(document.getElementById('article'))) window.NanoFox.refresh();
          else window.legacyCalls += 1;
        </script>`);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(fixturePage());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => new Promise((resolve) => server.close(resolve)));

async function installMock(page, enabled = true) {
  await page.addInitScript(({ enabled: isEnabled }) => {
    window.__callbacks = [];
    window.__yandexCalls = [];
    window.Ya = { Context: { AdvManager: { render(options, noFill) {
      window.__yandexCalls.push(options);
      window.__callbacks.push(noFill);
    } } } };
    window.__NANOFOX_TEST_CONFIG__ = {
      enabled: isEnabled,
      experiment: { enabled: false, id: 'pw-v1', control: 50, treatment: 50 },
      sites: { '127.0.0.1': { enabled: true, slots: {
        article: { yandex: 'R-A-TEST-1', width: 320, height: 50, fallback: ['local'] }
      } } },
      campaigns: { local: {
        enabled: true, type: 'image', image: '/ads/local.gif',
        url: 'https://partner.example/campaign', width: 320, height: 50,
        weight: 1, label: 'Advertisement'
      } },
      analytics: { enabled: false, provider: 'metrika', counterId: null }
    };
  }, { enabled });
}

test('desktop: mock no-fill yields one fallback and duplicate script/refresh make one YAN call', async ({ page }) => {
  await installMock(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin + '/active.html');
  expect(await page.evaluate(() => window.__yandexCalls.length)).toBe(1);
  await page.evaluate(() => { window.NanoFox.refresh(); window.__callbacks[0](); window.__callbacks[0](); });
  await expect(page.locator('#article img')).toHaveCount(1);
  await expect(page.locator('#article img')).toHaveAttribute('loading', 'lazy');
  expect(await page.evaluate(() => window.legacyCalls)).toBe(0);
});

test('desktop: a delayed Yandex decision remains pending and does not trigger a fallback timeout', async ({ page }) => {
  await installMock(page);
  await page.goto(origin + '/slow.html');
  await page.waitForTimeout(80);
  expect(await page.evaluate(() => window.__yandexCalls.length)).toBe(1);
  await expect(page.locator('#article img')).toHaveCount(0);
  expect(await page.evaluate(() => window.NanoFox.getState(document.getElementById('article')))).toBe('REQUESTING');
});

test('mobile: fallback reserves and renders the configured 320×50 creative', async ({ page }) => {
  await installMock(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '/active.html');
  await page.evaluate(() => window.__callbacks[0]());
  const image = page.locator('#article img');
  await expect(image).toHaveCount(1);
  await expect(image).toHaveAttribute('width', '320');
  await expect(image).toHaveAttribute('height', '50');
  await expect(page.locator('#article')).toHaveCSS('min-width', '320px');
});

test('disabled NanoFox uses the host legacy path', async ({ page }) => {
  await installMock(page, false);
  await page.goto(origin + '/disabled.html');
  expect(await page.evaluate(() => window.__yandexCalls.length)).toBe(0);
  expect(await page.evaluate(() => window.legacyCalls)).toBe(1);
});

test('unavailable nanofox.js uses the host legacy path', async ({ page }) => {
  await page.addInitScript(() => { window.Ya = { Context: { AdvManager: { render() {} } } }; });
  await page.goto(origin + '/missing.html');
  expect(await page.evaluate(() => window.legacyCalls)).toBe(1);
});
