import { test, expect, routeList } from './fixtures.mjs';
import { runStorageKey, parseSavedRun, serializeRun } from '../saved-run.mjs';

const stored = page => page.evaluate(key => localStorage.getItem(key), runStorageKey);

async function frozenNotice(app, page, code = 'P79Q', list = routeList) {
  await app.open(list);
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 60000));
  await page.evaluate(code => {
    const timeout = window.setTimeout.bind(window);
    __appTest.noticeDeadlines = [];
    window.setTimeout = (callback, delay, ...args) => {
      if (delay === 2000) __appTest.noticeDeadlines.push(performance.now() + delay);
      return timeout(callback, delay, ...args);
    };
    __appTest.codes = [code];
  }, code);
  await page.clock.runFor(250);
  await expect(app.dialog).toBeVisible();
}

async function reachDeadline(page, offset = 0, index = -1) {
  const remaining = await page.evaluate(({ offset, index }) =>
    __appTest.noticeDeadlines.at(index) + offset - performance.now(), { offset, index });
  expect(remaining).toBeGreaterThanOrEqual(0);
  await page.clock.runFor(remaining);
}

test('a popup closes and confirms without user input or advancing the test clock', async ({ app, page }) => {
  await app.open();
  await app.scan('P79Q');
  await expect(app.dialog.locator('button')).toHaveCount(0);
  await expect(app.dialog).not.toBeVisible();
  await expect(app.cards.first()).toContainText('1/2 bags scanned');
  expect([...parseSavedRun(await stored(page)).readings]).toEqual(['P79Q']);
  await app.stop();
});

test('the 2-second timer confirms exactly at expiry, resumes decoding, and never recounts a held label', async ({ app, page }) => {
  await frozenNotice(app, page);
  await expect(app.dialog.locator('button')).toHaveCount(0);
  await expect(page.getByRole('timer')).toHaveText('Confirming in 2 seconds');
  const decodes = await page.evaluate(() => __appTest.metrics.decodes);
  await reachDeadline(page, -1000);
  await expect(page.getByRole('timer')).toHaveText('Confirming in 1 second');
  await reachDeadline(page, -1);
  await expect(app.dialog).toBeVisible();
  await expect(app.cards.first()).toContainText('0/2 bags scanned');
  expect(parseSavedRun(await stored(page)).readings.size).toBe(0);
  expect(await page.evaluate(() => __appTest.metrics.decodes)).toBe(decodes);
  await reachDeadline(page);
  await expect(app.dialog).not.toBeVisible();
  await expect(app.cards.first()).toContainText('1/2 bags scanned');
  expect([...parseSavedRun(await stored(page)).readings]).toEqual(['P79Q']);
  await page.clock.runFor(700);
  expect(await page.evaluate(() => __appTest.metrics.decodes)).toBeGreaterThan(decodes);
  await expect(app.dialog).not.toBeVisible();
  expect(parseSavedRun(await stored(page)).readings.size).toBe(1);
  await app.stop();
});

test('the final single-bag stop and entire run complete only at timer expiry', async ({ app, page }) => {
  await frozenNotice(app, page, 'AB12', '12. Example\n - AB12');
  await expect(app.dialog).toHaveClass('single-bag');
  await expect(page.locator('#matchCount')).toHaveText('1 bag of 1 bag');
  await expect(page.locator('#matchCompleteMessage')).toHaveText('Last package - confirming automatically');
  await reachDeadline(page, -1);
  await expect(page.locator('#completionStatus')).toBeHidden();
  await expect(app.cards.first()).not.toHaveClass(/complete/);
  await reachDeadline(page);
  await expect(page.locator('#completionStatus')).toBeVisible();
  await expect(app.cards.first()).toHaveClass(/complete/);
  expect(parseSavedRun(await stored(page)).readings.size).toBe(1);
  await app.stop();
});

test('an interrupted timer cannot confirm its package or dismiss a newer session popup', async ({ app, page }) => {
  await frozenNotice(app, page);
  await page.clock.runFor(400);
  const restarting = app.interruptNotice();
  await expect.poll(() => page.evaluate(() => __appTest.streams.length)).toBe(2);
  await page.clock.runFor(250);
  await restarting;
  await page.evaluate(() => { __appTest.codes = ['HPQK']; });
  await page.clock.runFor(250);
  await expect(app.dialog).toBeVisible();
  await expect(page.locator('#matchCode')).toHaveText('HPQK');
  await reachDeadline(page, 0, 0);
  await expect(app.dialog).toBeVisible();
  expect(parseSavedRun(await stored(page)).readings.size).toBe(0);
  await reachDeadline(page);
  expect([...parseSavedRun(await stored(page)).readings]).toEqual(['HPQK']);
  await expect(app.cards.first()).toContainText('1/2 bags scanned');
  await app.stop();
});

test('a backgrounded document cancels confirmation even before its visibility event arrives', async ({ app, page }) => {
  await frozenNotice(app, page);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); });
  await reachDeadline(page);
  await expect(app.dialog).not.toBeVisible();
  await expect(page.locator('#cameraButton')).toHaveText('Open Live Camera');
  expect(parseSavedRun(await stored(page)).readings.size).toBe(0);
  expect(await page.evaluate(() => __appTest.streams[0].getTracks()[0].readyState)).toBe('ended');
});

test('another tab changing the saved run cancels the timer and cannot be overwritten later', async ({ app, page, context }) => {
  await frozenNotice(app, page);
  const other = await context.newPage();
  try {
    await other.goto('/');
    await other.locator('#clearSavedRunButton').click();
    await expect(app.dialog).not.toBeVisible();
    await page.clock.runFor(5000);
    await expect(page.locator('#saveStatus')).toContainText('Another tab changed');
    await expect(page.locator('#cameraButton')).toBeDisabled();
    await expect(app.cards.first()).toContainText('0/2 bags scanned');
    expect(await stored(page)).toBeNull();
  } finally { await other.close(); }
});

test('expiry rechecks saved records before counting if the storage event has not arrived', async ({ app, page }) => {
  await frozenNotice(app, page);
  const newList = '99. New run\n - ZX98';
  const newer = serializeRun(newList, new Set(), new Set(), newList);
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: runStorageKey, value: newer });
  await reachDeadline(page);
  await expect(app.dialog).not.toBeVisible();
  await expect(page.locator('#saveStatus')).toContainText('Another tab changed');
  await expect(app.cards.first()).toContainText('0/2 bags scanned');
  expect(await stored(page)).toBe(newer);
});
