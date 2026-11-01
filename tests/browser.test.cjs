const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { once } = require('node:events');
const { chromium } = require('playwright');
const { project, plain, loadDomain, richState } = require('./helpers.cjs');
const artifacts = process.env.LIANJI_TEST_OUTPUT || path.join(os.tmpdir(), 'lianji-test-artifacts');
let server, browser, origin;

test.before(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  server = http.createServer(async (req, res) => {
    if (req.url === '/favicon.ico') { res.writeHead(204).end(); return; }
    const html = await fs.readFile(path.join(project, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function app(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {
    assert.deepEqual(errors, [], 'No unhandled browser errors');
    await context.close();
  });
  await page.goto(origin);
  return page;
}
async function stored(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('lianji-v1'))); }
async function seed(page, state) {
  await page.evaluate(value => localStorage.setItem('lianji-v1', JSON.stringify(value)), state);
  await page.reload();
}
async function nav(page, name) { await page.locator(`[data-nav="${name}"]:visible`).first().click(); }
async function generate(page, ingredients = '鸡胸肉、洋葱、鸡蛋、杂粮馒头') {
  await nav(page, 'nutrition');
  await page.locator('#cook-form [name="ingredients"]').fill(ingredients);
  await page.locator('#cook-form [name="tools"][value="wok"]').check();
  await page.locator('#cook-form [name="tools"][value="airfryer"]').check();
  await page.locator('#cook-form [name="servings"]').fill('2');
  await page.locator('#cook-form [name="oil"]').fill('5');
  await page.locator('#cook-form button[type="submit"]').click();
  await page.locator('#cook-results [data-cook-detail]').first().waitFor();
}
async function importBackup(page, value) {
  await page.locator('#import-file').setInputFiles({ name: 'test-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
}

test('training input saves before blur; reload, set completion and partial save retain the entered weight', async t => {
  const page = await app(t);
  await page.locator('[data-start]').first().click();
  await page.locator('[data-input="weight"]').first().fill('42.5');
  let state = await stored(page);
  assert.equal(state.active.items[0].sets[0].weight, 42.5);
  await page.reload();
  await page.locator('[data-action="resume"]').first().click();
  assert.equal(await page.locator('[data-input="weight"]').first().inputValue(), '42.5');
  await page.locator('[data-set-check]').first().click();
  assert.equal((await stored(page)).active.items[0].sets[0].done, true);
  await page.locator('[data-action="finish"]').click();
  await page.locator('[data-action="finish-partial"]').click();
  state = await stored(page);
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].completed, false);
  assert.equal(state.history[0].items[0].sets[0].weight, 42.5);
  assert.equal(state.active, null);
  assert.equal(state.timer, null);
  assert.equal(await page.locator('dialog[open]').count(), 0);
});

test('the existing 12 week picker and 17 exercise teaching entries remain reachable', async t => {
  const page = await app(t);
  await nav(page, 'plan');
  assert.equal(await page.locator('[data-week]').count(), 12);
  await page.locator('[data-week="12"]').click();
  assert.equal(await page.locator('.plan-session').count(), 4);
  await nav(page, 'videos');
  assert.equal(await page.locator('#video-grid .video-info').count(), 17);
  await page.locator('#video-grid [data-detail]').first().click();
  const link = await page.locator('#video-direct').getAttribute('href');
  assert.match(link, /^https:\/\/www\.bilibili\.com\/video\/BV[A-Za-z0-9]{10}\/$/);
});

test('recipe generation, detail, favorite reload and meal recording preserve existing training and nutrition', async t => {
  const page = await app(t);
  const { FitCore: C } = loadDomain();
  const baseline = richState(C);
  baseline.timer = null;
  await seed(page, baseline);
  await generate(page);
  const expectedNutrition = await page.evaluate(() => FitCook.generate(JSON.parse(localStorage.getItem('lianji-v1')).cooking).recipes[0].nutrition);
  assert.equal(await page.locator('#cook-results [data-cook-detail]').count(), 2);
  await page.locator('#cook-results [data-cook-detail]').first().click();
  assert.match(await page.locator('dialog[open]').innerText(), /鸡胸肉|步骤|做法/);
  await page.locator('dialog [data-close]').click();
  await page.locator('#cook-results [data-cook-favorite]').first().click();
  const saved = await stored(page);
  assert.equal(saved.cooking.favorites.length, 1);
  assert.equal(saved.cooking.servings, 2);
  const favorite = saved.cooking.favorites[0];
  await page.reload();
  await nav(page, 'nutrition');
  await page.locator('[data-action="cook-favorites"]').click();
  assert.ok((await page.locator('dialog[open]').innerText()).includes(favorite.title));
  await page.locator('[data-cook-open]').first().click();
  assert.equal(await page.locator('dialog[open] h2').innerText(), favorite.title);
  assert.ok((await page.locator('dialog[open] .recipe-ingredients').innerText()).includes('鸡胸肉'));
  await page.locator('dialog [data-close]').click();
  await generate(page);
  await page.locator('#cook-results [data-cook-record]').first().click();
  await page.locator('#recipe-log-form [name="portions"]').fill('1.5');
  await page.locator('#recipe-log-form [name="recipeDate"]').fill('2026-11-01');
  await page.locator('#recipe-log-form button[type="submit"]').click();
  await page.locator('#recipe-log-form').waitFor({ state: 'detached' });
  assert.equal(await page.locator('#recipe-log-form').count(), 0, 'Successful submit removes form to prevent a second submit');
  assert.equal(await page.locator('dialog[open]').count(), 0);
  const final = await stored(page);
  assert.equal(final.meals.length, baseline.meals.length + 1);
  assert.deepEqual(final.meals[0], baseline.meals[0]);
  assert.equal(final.meals[1].date, '2026-11-01');
  for (const key of ['kcal', 'protein', 'carbs', 'fat']) {
    assert.ok(Number.isFinite(final.meals[1][key]) && final.meals[1][key] >= 0);
    assert.ok(Math.abs(final.meals[1][key] - expectedNutrition[key] * 1.5) <= 0.1, `${key} should record 1.5 portions`);
  }
  for (const key of ['profile', 'history', 'active', 'body', 'recovery', 'videoOverrides']) assert.deepEqual(final[key], baseline[key], key);
  assert.equal(final.cooking.favorites.length, 1);
  await page.screenshot({ path: path.join(artifacts, 'nutrition-desktop.png'), fullPage: true });
});

test('exported JSON restores every record and recipe favorite after explicit import confirmation', async t => {
  const page = await app(t);
  const { FitCore: C } = loadDomain();
  const source = richState(C);
  source.timer = null;
  source.cooking.favorites.push({ key: 'recipe-test', title: '鸡胸肉快手餐', recipeId: 'wok-meal', config: { ingredients: source.cooking.ingredients, tools: ['wok'], servings: 2, oil: 5 } });
  await seed(page, source);
  await page.locator('[data-action="backup"]:visible').first().click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-action="export-json"]').click();
  const download = await downloadPromise;
  const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  assert.deepEqual(exported, source);
  const empty = plain(C.defaults('2026-11-01'));
  await seed(page, empty);
  await importBackup(page, exported);
  await page.locator('[data-action="import-confirm"]').waitFor();
  assert.deepEqual(await stored(page), empty, 'Selecting a file must not overwrite until confirmation');
  await page.locator('[data-action="import-confirm"]').click();
  assert.deepEqual(await stored(page), source);
  await page.reload();
  assert.equal((await stored(page)).cooking.favorites.length, 1);
});

test('legacy backup without cooking imports full history and receives cooking defaults', async t => {
  const page = await app(t);
  const { FitCore: C } = loadDomain();
  const legacy = richState(C);
  delete legacy.cooking;
  await importBackup(page, legacy);
  await page.locator('[data-action="import-confirm"]').click();
  const restored = await stored(page);
  for (const key of ['profile', 'history', 'active', 'body', 'meals', 'recovery', 'videoOverrides']) assert.deepEqual(restored[key], legacy[key]);
  assert.equal(restored.timer, null);
  assert.deepEqual(restored.cooking, plain(C.defaults().cooking));
});

test('invalid cooking import is rejected without modifying the current saved data', async t => {
  const page = await app(t);
  const { FitCore: C } = loadDomain();
  const source = richState(C);
  source.timer = null;
  await seed(page, source);
  await importBackup(page, { ...source, cooking: { ...source.cooking, tools: ['invalid'] } });
  await page.getByRole('heading', { name: '备份未导入' }).waitFor();
  assert.deepEqual(await stored(page), source);
  assert.equal(await page.locator('[data-action="import-confirm"]').count(), 0);
});

test('malformed original storage remains recoverable even when a new meal is attempted', async t => {
  const page = await app(t);
  const raw = '{"schema":1,"valuable_unrecoverable_record":"原始记录","truncated":';
  await page.evaluate(value => localStorage.setItem('lianji-v1', value), raw);
  await page.reload();
  await page.getByRole('heading', { name: '原有数据暂未载入' }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('lianji-v1')), raw);
  await page.locator('dialog [data-close]').click();
  await page.locator('[data-action="meal"]').first().click();
  for (const [name, value] of Object.entries({ foodName: '保护测试餐', foodKcal: '400', foodProtein: '30', foodCarbs: '45', foodFat: '12' })) await page.locator(`#meal-form [name="${name}"]`).fill(value);
  await page.locator('#meal-form button[type="submit"]').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('lianji-v1')), raw, 'A failed load must never silently replace raw storage');
});

test('missing tools are rejected and unknown-only ingredients produce an honest empty result', async t => {
  const page = await app(t);
  const { FitCore: C } = loadDomain();
  const source = plain(C.defaults('2026-11-01'));
  await seed(page, source);
  await nav(page, 'nutrition');
  await page.locator('#cook-form [name="tools"][value="wok"]').uncheck();
  await page.locator('#cook-form [name="tools"][value="airfryer"]').uncheck();
  await page.locator('#cook-form button[type="submit"]').click();
  assert.match(await page.locator('#cook-error').innerText(), /选择|工具|器具/);
  assert.deepEqual(await stored(page), source);
  await page.locator('#cook-form [name="tools"][value="wok"]').check();
  await page.locator('#cook-form [name="ingredients"]').fill('火龙果');
  await page.locator('#cook-form button[type="submit"]').click();
  assert.match(await page.locator('#cook-results').innerText(), /未识别.*火龙果/);
  assert.equal(await page.locator('#cook-results [data-cook-detail]').count(), 0);
  assert.equal((await stored(page)).meals.length, 0, 'Generating an empty result must not log a meal');
});

test('storage quota failures roll back cooking changes and keep meal form available for retry', async t => {
  const page = await app(t);
  await generate(page);
  const source = await stored(page);
  await page.evaluate(() => {
    window.originalStorageSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw new DOMException('Test quota limit', 'QuotaExceededError'); };
  });
  await page.locator('#cook-results [data-cook-favorite]').first().click();
  assert.deepEqual(await stored(page), source);
  assert.match(await page.locator('#toast').innerText(), /未能保存/);
  await page.locator('#cook-results [data-cook-record]').first().click();
  await page.locator('#recipe-log-form button[type="submit"]').click();
  assert.match(await page.locator('#form-error').innerText(), /未能保存/);
  assert.equal(await page.locator('dialog[open] #recipe-log-form').count(), 1);
  assert.deepEqual(await stored(page), source);
  await page.evaluate(() => { Storage.prototype.setItem = window.originalStorageSet; delete window.originalStorageSet; });
  await page.locator('#recipe-log-form button[type="submit"]').click();
  await page.locator('#recipe-log-form').waitFor({ state: 'detached' });
  const restored = await stored(page);
  assert.equal(restored.meals.length, source.meals.length + 1, 'Retry writes exactly one meal');
  assert.deepEqual(restored.cooking.favorites, source.cooking.favorites, 'Failed favorite remains rolled back in memory');
});

for (const malformed of [false, true]) test(`backup import quota failure preserves ${malformed ? 'malformed raw storage' : 'current saved state'} and remains retryable`, async t => {
  const page = await app(t);
  const { FitCore: C } = loadDomain();
  const current = plain(C.defaults('2026-11-01'));
  current.profile.weight = 101;
  const replacement = plain(C.defaults('2026-11-01'));
  replacement.profile.weight = 88;
  replacement.cooking.ingredients = '鸡胸肉、洋葱';
  const raw = malformed ? '{"schema":1,"recoverable":"原始记录","truncated":' : JSON.stringify(current);
  await page.evaluate(value => localStorage.setItem('lianji-v1', value), raw);
  await page.reload();
  if (malformed) {
    await page.getByRole('heading', { name: '原有数据暂未载入' }).waitFor();
    await page.locator('dialog [data-close]').click();
  }
  const originalWeightText = await page.locator('#main .stat-value').first().innerText();
  await importBackup(page, replacement);
  await page.locator('[data-action="import-confirm"]').waitFor();
  await page.evaluate(() => {
    window.originalImportStorageSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw new DOMException('Test import quota limit', 'QuotaExceededError'); };
  });
  await page.locator('[data-action="import-confirm"]').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('lianji-v1')), raw, 'Failed import preserves the exact old bytes');
  assert.equal(await page.locator('#main .stat-value').first().innerText(), originalWeightText, 'Failed import must not replace the live in-memory profile');
  assert.equal(await page.locator('dialog[open] [data-action="import-confirm"]').count(), 1, 'Import confirmation stays open with pending data available for retry');
  assert.doesNotMatch(await page.locator('#toast').innerText(), /已恢复备份/);
  await page.evaluate(() => { Storage.prototype.setItem = window.originalImportStorageSet; delete window.originalImportStorageSet; });
  await page.locator('[data-action="import-confirm"]').click();
  await page.locator('dialog[open]').waitFor({ state: 'hidden' });
  assert.deepEqual(await stored(page), replacement);
  assert.match(await page.locator('#main .stat-value').first().innerText(), /^88/);
  await generate(page, '鸡蛋、洋葱');
  const final = await stored(page);
  assert.equal(final.profile.weight, 88);
  assert.equal(final.cooking.ingredients, '鸡蛋、洋葱', 'Successful retry clears prior load-error lock and permits new saves');
});

for (const width of [320, 375, 390]) test(`cooking form and results fit ${width}px mobile viewport and remain operable`, async t => {
  const page = await app(t, { viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
  await generate(page);
  const bounds = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
  await page.screenshot({ path: path.join(artifacts, `nutrition-mobile-${width}.png`), fullPage: true });
  assert.ok(bounds.content <= bounds.width + 1, JSON.stringify(bounds));
  assert.equal(await page.locator('#cook-results [data-cook-record]').count(), 2);
});
