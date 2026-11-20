import { test, expect, routeList } from './fixtures.mjs';
import { runStorageKey, parseSavedRun } from '../saved-run.mjs';

const stored = page => page.evaluate(key => localStorage.getItem(key), runStorageKey);
const movedList = '7. Alex Sample #1001\n - HPQK\n\n12. Jamie Example #1002\n - AB12\n - P79Q';

async function resume(page) {
  await expect(page.locator('#restoreDialog')).toBeVisible();
  await page.locator('#resumeRunButton').click();
  await expect(page.locator('#restoreDialog')).not.toBeVisible();
}

test('reopening offers a non-destructive choice and restores list, counts and NEW history with camera off', async ({ app, page }) => {
  await app.open();
  await app.scan('P79Q');
  await app.waitForNotice();
  const before = await stored(page);
  await app.reload();
  await expect(page.locator('#restoreDialog')).toBeVisible();
  await expect(page.locator('#stopList')).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(page.locator('#restoreDialog')).toBeVisible();
  expect(await stored(page)).toBe(before);
  await resume(page);
  await expect(page.locator('#stopList')).toHaveValue(routeList);
  await expect(app.cards.first()).toContainText('1/2 bags scanned');
  await expect(page.locator('#cameraButton')).toHaveText('Open Live Camera');
  expect(await page.evaluate(() => __appTest.streams.length)).toBe(0);
  await app.start();
  await app.scan('P79Q');
  await expect(page.locator('#matchNewBadge')).toBeHidden();
  await expect(page.locator('#matchCount')).toHaveText('1 bag of 2 bags');
  await app.waitForNotice();
  expect(parseSavedRun(await stored(page)).readings.size).toBe(1);
  await app.stop();
});

test('clear on reopening removes package records but preserves the chosen theme', async ({ app, page }) => {
  await page.locator('#themeButton').click();
  const theme = await page.locator('html').getAttribute('data-theme');
  await app.edit(routeList);
  await app.reload();
  await page.locator('#clearSavedRunButton').click();
  await expect(page.locator('#stopList')).toHaveValue('');
  expect(await stored(page)).toBeNull();
  await app.reload();
  await expect(page.locator('#restoreDialog')).not.toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
});

test('a pending package saves appearance but is never confirmed by reload or an interrupted countdown', async ({ app, page }) => {
  await app.open('7. Example\n - AB12');
  await app.scan('AB12');
  expect([...parseSavedRun(await stored(page)).readings]).toEqual([]);
  expect([...parseSavedRun(await stored(page)).shownStops]).toEqual([7]);
  await app.reload();
  await resume(page);
  await expect(app.cards.first()).toContainText('0/1 bags scanned');
  await expect(page.locator('#completionStatus')).toBeHidden();
  await app.start();
  await app.scan('AB12');
  await expect(page.locator('#matchNewBadge')).toBeHidden();
  await expect(page.locator('#matchCompleteMessage')).toHaveText('Last package - confirming automatically');
  await app.interruptNotice();
  await expect(page.locator('#completionStatus')).toBeHidden();
  expect(parseSavedRun(await stored(page)).readings.size).toBe(0);
  await app.stop();
});

test('only final countdown expiry completes the run; an already complete repeat does not add another bag', async ({ app, page }) => {
  await app.open('7. Empty\n -\n\n12. Example\n - AB12');
  await app.scan('AB12');
  await expect(page.locator('#matchCompleteMessage')).toHaveText('Last package - confirming automatically');
  await expect(page.locator('#completionStatus')).toBeHidden();
  await app.interruptNotice();
  await expect(app.cards.nth(1)).not.toHaveClass(/complete/);
  await app.scan('AB12');
  await app.waitForNotice();
  await expect(page.locator('#completionStatus')).toBeVisible();
  await expect(app.cards.first()).not.toHaveClass(/complete/);
  await app.stop();
  await app.reload();
  await resume(page);
  await expect(page.locator('#completionStatus')).toBeVisible();
  await app.start();
  await app.scan('AB12');
  await expect(page.locator('#matchCompleteMessage')).toHaveText('All packages scanned');
  await expect(page.locator('#matchCount')).toHaveText('1 bag of 1 bag');
  await app.waitForNotice();
  expect(parseSavedRun(await stored(page)).readings.size).toBe(1);
  await app.stop();
});

test('a held confirmed label and brief blank flicker stay suppressed; a deliberate absence rearms it', async ({ app, page }) => {
  await app.open();
  await app.scan('P79Q');
  await app.waitForNotice({ keepLabel: true });
  const count = await page.evaluate(() => __appTest.metrics.decodes);
  await expect.poll(() => page.evaluate(() => __appTest.metrics.decodes)).toBeGreaterThan(count + 3);
  await expect(app.dialog).not.toBeVisible();
  await page.evaluate(() => { __appTest.codes = []; });
  await page.waitForTimeout(200);
  await page.evaluate(() => { __appTest.codes = ['P79Q']; });
  await expect.poll(() => page.evaluate(() => __appTest.metrics.decodes)).toBeGreaterThan(count + 8);
  await expect(app.dialog).not.toBeVisible();
  await app.clearFrame();
  await app.scan('P79Q');
  await expect(page.locator('#matchCount')).toHaveText('1 bag of 2 bags');
  await expect(page.locator('#matchNewBadge')).toBeHidden();
  await app.waitForNotice();
  await app.scan('HPQK');
  await app.interruptNotice();
  await app.scan('P79Q');
  await expect(page.locator('#matchCount')).toHaveText('1 bag of 2 bags');
  await app.interruptNotice();
  await expect(app.cards.first()).toContainText('1/2 bags scanned');
  await app.stop();
});

test('overlapping import preserves route numbers and confirmed progress when a short ID becomes full', async ({ app, page }) => {
  await app.open();
  await app.scan('P79Q');
  await app.waitForNotice();
  await app.stop();
  await page.locator('#backButton').click();
  await app.upload(['Alex Sample #1001\nUnknown TRACKINGP79Q\nNEXT\nALPH']);
  await expect(page.locator('#stopList')).toHaveValue(/^7\. Alex Sample #1001\n.*TRACKINGP79Q[\s\S]*12\. Jamie Example #1002/);
  await expect(page.locator('#stopList')).not.toHaveValue(/NEXT|ALPH/);
  await expect(page.locator('#importMessages')).toContainText('Unlabelled text "ALPH"');
  await page.locator('#nextButton').click();
  await expect(app.cards.first()).toContainText('1/2 bags scanned');
  await expect(app.cards.first()).toContainText('TRACKINGP79Q - Found');
  await app.reload();
  await resume(page);
  await expect(app.cards.first()).toContainText('TRACKINGP79Q - Found');
});

test('manual case and short/full duplicates never inflate the saved bag total', async ({ app, page }) => {
  await app.open('7. Example\n - p79q\n - TRACKINGP79Q\n - trackingp79q');
  await app.scan('TRACKINGP79Q');
  await expect(page.locator('#matchCount')).toHaveText('1 bag of 1 bag');
  await app.waitForNotice();
  await expect(app.cards.first()).toContainText('1/1 bags scanned');
  await app.stop();
  await app.reload();
  await resume(page);
  await expect(app.cards.first()).toContainText('1/1 bags scanned');
});

test('an ambiguous upgrade explains why the old short-code confirmation must be scanned again', async ({ app, page }) => {
  await app.open('7. Example\n - AB12');
  await app.scan('AB12');
  await app.waitForNotice();
  await app.stop();
  await page.locator('#backButton').click();
  await app.edit('7. Example\n - FIRSTAB12\n - SECONDAB12');
  await expect(page.locator('#listError')).toContainText('matches multiple package IDs');
  expect(parseSavedRun(await stored(page)).readings.size).toBe(0);
  await page.locator('#nextButton').click();
  await expect(app.cards.first()).toContainText('0/2 bags scanned');
});

test('a confirmed package cannot change stops; reset explicitly allows a corrected assignment', async ({ app, page }) => {
  await app.open();
  await app.scan('P79Q');
  await app.waitForNotice();
  await app.stop();
  await page.locator('#backButton').click();
  await app.edit(movedList);
  await expect(page.locator('#listError')).toContainText('cannot move to stop 12');
  await expect(page.locator('#stopList')).toHaveValue(routeList);
  expect(parseSavedRun(await stored(page)).list).toBe(routeList);
  await page.locator('#nextButton').click();
  await app.confirmDialog('#resetProgressButton');
  await page.locator('#backButton').click();
  await app.edit(movedList);
  await expect(page.locator('#listError')).toBeEmpty();
  await expect(page.locator('#stopList')).toHaveValue(movedList);
  expect(parseSavedRun(await stored(page)).readings.size).toBe(0);
  expect(parseSavedRun(await stored(page)).shownStops.size).toBe(0);
});

test('a partially invalid saved editor cannot bypass confirmed assignment protection after reopening', async ({ app, page }) => {
  await app.open();
  await app.scan('P79Q');
  await app.waitForNotice();
  await app.stop();
  await page.locator('#backButton').click();
  await app.edit(routeList.replace('P79Q', 'P79'));
  await expect(page.locator('#nextButton')).toBeDisabled();
  await app.reload();
  await resume(page);
  await expect(page.locator('#stopList')).toHaveValue(routeList.replace('P79Q', 'P79'));
  await app.edit(movedList.replace('P79Q', 'TRACKINGp79q'));
  await expect(page.locator('#listError')).toContainText('cannot move to stop 12');
  await expect(page.locator('#stopList')).toHaveValue(routeList);
  await expect(page.locator('#nextButton')).toBeEnabled();
  expect(parseSavedRun(await stored(page)).list).toBe(routeList);
  await page.locator('#nextButton').click();
  await expect(app.cards.first()).toContainText('1/2 bags scanned');
});

test('blocked storage shows a visible memory-only warning without blocking the workflow', async ({ app, page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() { throw new DOMException('Storage blocked', 'SecurityError'); }
    });
  });
  await app.reload();
  await expect(page.locator('#saveStatus')).toContainText('Browser storage is unavailable');
  await app.open();
  await app.scan('P79Q');
  await app.waitForNotice();
  await expect(app.cards.first()).toContainText('1/2 bags scanned');
  await expect(page.locator('#saveStatus')).toContainText('only in this page');
  await app.stop();
});

test('a quota failure reports unsaved changes explicitly and does not replace older saved records', async ({ app, page }) => {
  await app.edit(routeList);
  const before = await stored(page);
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name, value) {
      if (name === key) throw new DOMException('Full', 'QuotaExceededError');
      return original.call(this, name, value);
    };
  }, runStorageKey);
  await app.edit(routeList.replace('P79Q', 'XY56'));
  await expect(page.locator('#saveStatus')).toContainText('Could not save or clear records');
  expect(await stored(page)).toBe(before);
  await app.reload();
  await resume(page);
  await expect(page.locator('#stopList')).toHaveValue(routeList);
});

for (const raw of ['{broken', '{"version":99}']) {
  test(`invalid saved record ${raw} requires explicit clearing without being overwritten`, async ({ app, page }) => {
    await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: runStorageKey, raw });
    await app.reload();
    await expect(page.locator('#restoreTitle')).toHaveText('Saved records need attention');
    await expect(page.locator('#resumeRunButton')).toBeDisabled();
    expect(await stored(page)).toBe(raw);
    await page.locator('#clearSavedRunButton').click();
    expect(await stored(page)).toBeNull();
    await expect(page.locator('#stopList')).toBeEditable();
  });
}

test('failed startup clearing keeps the original records and offers retry or Continue', async ({ app, page }) => {
  await app.edit(routeList);
  const before = await stored(page);
  await app.reload();
  await page.evaluate(key => {
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function(name) {
      if (name === key) throw new DOMException('Blocked', 'SecurityError');
      return original.call(this, name);
    };
  }, runStorageKey);
  await page.locator('#clearSavedRunButton').click();
  await expect(page.locator('#restoreMessage')).toContainText('Could not clear the saved records');
  await expect(page.locator('#restoreDialog')).toBeVisible();
  expect(await stored(page)).toBe(before);
  await resume(page);
  await expect(page.locator('#stopList')).toHaveValue(routeList);
});

test('another tab clearing the run stops scanning, freezes stale edits, and cannot be overwritten', async ({ app, page, context }) => {
  await app.open();
  const other = await context.newPage();
  try {
    await other.goto('/');
    await other.locator('#clearSavedRunButton').click();
    await expect(page.locator('#saveStatus')).toContainText('Another tab changed');
    await expect(page.locator('#cameraButton')).toHaveText('Open Live Camera');
    await expect(page.locator('#cameraButton')).toBeDisabled();
    await expect(page.locator('#stopList')).not.toBeEditable();
    await expect(page.locator('#copyButton')).toBeEnabled();
    expect(await stored(page)).toBeNull();
    expect(await page.evaluate(() => __appTest.streams.every(stream =>
      stream.getTracks().every(track => track.readyState === 'ended')
    ))).toBe(true);
  } finally { await other.close(); }
  await app.reload();
  await expect(page.locator('#restoreDialog')).not.toBeVisible();
  await expect(page.locator('#stopList')).toHaveValue('');
  await expect(page.locator('#stopList')).toBeEditable();
});

test('another tab changing records invalidates a stale startup choice instead of clearing the newer run', async ({ app, page, context }) => {
  await app.edit(routeList);
  const other = await context.newPage();
  try {
    await other.goto('/');
    await expect(other.locator('#restoreDialog')).toBeVisible();
    await app.edit(routeList.replace('P79Q', 'XY56'));
    await expect(other.locator('#restoreMessage')).toContainText('Another tab changed');
    await expect(other.locator('#clearSavedRunButton')).toBeDisabled();
    await expect(other.locator('#resumeRunButton')).toBeDisabled();
    expect(parseSavedRun(await stored(page)).list).toContain('XY56');
  } finally { await other.close(); }
});

for (const theme of ['light', 'dark']) {
  test(`320px ${theme} restore and final-package dialogs remain readable without overflow`, async ({ app, page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#themeButton').click();
    await app.edit('7. Example\n - AB12');
    await app.reload();
    const restore = await page.locator('#restoreDialog').boundingBox();
    expect(restore.x).toBeGreaterThanOrEqual(0);
    expect(restore.x + restore.width).toBeLessThanOrEqual(320);
    expect(restore.height).toBeLessThanOrEqual(640);
    await resume(page);
    await app.start();
    await app.scan('AB12');
    await expect(page.locator('#matchCompleteMessage')).toBeVisible();
    const match = await app.dialog.boundingBox();
    expect(match.x).toBeGreaterThanOrEqual(0);
    expect(match.x + match.width).toBeLessThanOrEqual(320);
    expect(match.height).toBeLessThanOrEqual(640);
    expect(await app.dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await app.waitForNotice();
    await app.stop();
  });
}
