import { test, expect, routeList } from './fixtures.mjs';

for (const format of ['QRCode', 'DataMatrix']) {
  test(`real ${format} camera frames decode a full tracking ID without OCR or printed bag counts`, async ({ app, page }) => {
    await app.drawBarcode('SYNTHETIC00000000P79Q', format);
    await app.open();
    await expect(app.dialog).toBeVisible();
    await expect(page.locator('#matchStopNumber')).toHaveText('7');
    await expect(page.locator('#matchCode')).toHaveText('P79Q');
    await expect(page.locator('#matchCount')).toHaveText('1 bag of 2 bags');
    expect(await page.evaluate(() => __appTest.metrics.ocrWorkers)).toBe(0);
    expect(await page.evaluate(() => __appTest.metrics.constraints[0])).toEqual({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    await app.acknowledge();
    await expect(app.cards.first()).toContainText('1/2 bags scanned');
    await app.stop();
  });
}

test('matched popup contains only the NEW badge, stop, code, progress and controls; decoding pauses', async ({ app, page }) => {
  await app.open();
  await app.scan('synthetic00000000p79q');
  await expect(app.dialog).toHaveAccessibleName('New stop 7');
  await expect(app.dialog).toHaveAccessibleDescription('P79Q 1 bag of 2 bags');
  await expect(page.locator('#matchTitle')).toHaveCSS('clip-path', 'inset(50%)');
  const visibleContents = await app.dialog.evaluate(dialog => [...dialog.children]
    .filter(node => getComputedStyle(node).display !== 'none' && getComputedStyle(node).clipPath !== 'inset(50%)')
    .map(node => node.textContent.trim()));
  expect(visibleContents).toEqual(['NEW', '7', 'P79Q', '1 bag of 2 bags', 'OK', 'Rescan']);
  const badge = await page.locator('#matchNewBadge').boundingBox();
  const number = await page.locator('#matchStopNumber').boundingBox();
  expect(badge.y + badge.height).toBeLessThanOrEqual(number.y);
  const decodes = await page.evaluate(() => __appTest.metrics.decodes);
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => __appTest.metrics.decodes)).toBe(decodes);
  await expect(app.cards.first()).toContainText('0/2 bags scanned');
  await expect(app.cards.first()).not.toHaveClass(/complete/);
  await page.keyboard.press('Escape');
  await expect(app.dialog).toBeVisible();
  await app.acknowledge(true);
  await app.scan('P79Q');
  await expect(page.locator('#matchNewBadge')).toBeHidden();
  await expect(app.dialog).toHaveAccessibleName('Stop 7');
  await expect(app.dialog).not.toContainText('Seen before');
  await expect(page.locator('#matchCount')).toHaveText('1 bag of 2 bags');
  await app.acknowledge();
  await expect(app.cards.first()).toContainText('1/2 bags scanned');
  const resumed = await page.evaluate(() => __appTest.metrics.decodes);
  await page.evaluate(() => { __appTest.codes = ['P79Q']; });
  await expect.poll(() => page.evaluate(() => __appTest.metrics.decodes)).toBeGreaterThan(resumed + 2);
  await expect(app.dialog).not.toBeVisible();
  await expect(app.cards.first()).toContainText('1/2 bags scanned');
  await app.stop();
});

test('out-of-order multi-bag and single-package stops complete only after OK, with independent totals', async ({ app, page }) => {
  await app.open();
  await app.scan('HPQK');
  await expect(page.locator('#matchCount')).toHaveText('1 bag of 2 bags');
  await app.acknowledge();
  await app.scan('AB12');
  await expect(page.locator('#matchStopNumber')).toHaveText('12');
  await expect(page.locator('#matchNewBadge')).toBeVisible();
  await expect(page.locator('#matchCount')).toHaveText('1 bag of 1 bag');
  await expect(app.cards.nth(1)).not.toHaveClass(/complete/);
  await app.acknowledge();
  await expect(app.cards.nth(1)).toHaveClass(/complete/);
  await app.scan('P79Q');
  await expect(page.locator('#matchNewBadge')).toBeHidden();
  await expect(page.locator('#matchCount')).toHaveText('2 bags of 2 bags');
  await expect(app.cards.first()).not.toHaveClass(/complete/);
  await app.acknowledge();
  await expect(page.locator('.stop-card.complete')).toHaveCount(2);
  await app.stop();
});

test('barcode scanning works when screenshot OCR is unavailable', async ({ app, page }) => {
  await page.evaluate(() => { window.Tesseract = undefined; });
  await app.open();
  await app.scan('P79Q');
  await expect(page.locator('#matchCount')).toHaveText('1 bag of 2 bags');
  await app.acknowledge();
  await expect(app.cards.first()).toContainText('1/2 bags scanned');
  expect(await page.evaluate(() => __appTest.metrics.ocrWorkers)).toBe(0);
  await app.stop();
});

test('appearance survives Rescan, camera restart and step changes; Reset works without confirmations', async ({ app, page }) => {
  await app.open();
  await app.scan('P79Q');
  await app.acknowledge(true);
  await app.stop();
  await page.locator('#backButton').click();
  await page.locator('#nextButton').click();
  await app.start();
  await app.scan('HPQK');
  await expect(page.locator('#matchNewBadge')).toBeHidden();
  await app.acknowledge(true);
  await app.stop();
  await expect(page.locator('#resetProgressButton')).toBeEnabled();
  await app.confirmDialog('#resetProgressButton');
  await expect(page.locator('#stopList')).toHaveValue(routeList);
  await expect(page.locator('#resetProgressButton')).toBeDisabled();
  await app.start();
  await app.scan('P79Q');
  await expect(page.locator('#matchNewBadge')).toBeVisible();
  await app.acknowledge();
  await app.stop();
  await app.confirmDialog('#resetProgressButton');
  await expect(app.cards.first()).toContainText('0/2 bags scanned');
});

for (const method of ['Clear', 'empty editor', 'reload']) {
  test(`${method} starts a new sorting run without saved matches`, async ({ app, page }) => {
    await app.open();
    await app.scan('P79Q');
    await app.acknowledge();
    await app.stop();
    await page.locator('#backButton').click();
    if (method === 'Clear') await app.confirmDialog('#clearButton');
    else if (method === 'empty editor') await app.edit('');
    else await page.reload();
    await expect(page.locator('#stopList')).toHaveValue('');
    await expect(page.locator('#nextButton')).toBeDisabled();
    await expect(page.locator('#resetProgressButton')).toBeDisabled();
    if (method !== 'reload') {
      await app.open();
      await app.scan('P79Q');
      await expect(page.locator('#matchNewBadge')).toBeVisible();
      await expect(page.locator('#matchCount')).toHaveText('1 bag of 2 bags');
      await app.acknowledge();
      await app.stop();
    }
  });
}

const ambiguousList = '7. Alex #1001\n - TRACKONEP79Q\n\n12. Jamie #1002\n - TRACKTWOP79Q';
for (const scenario of [
  { name: 'unknown', codes: ['ZZ99'], message: 'not in the stop list' },
  { name: 'Q/0 mismatch', codes: ['P790'], message: 'not in the stop list' },
  { name: 'unsupported', codes: ['https://example.test/AB12'], message: 'supported package ID' },
  { name: 'ambiguous suffix', codes: ['P79Q'], list: ambiguousList, message: 'multiple listed package IDs' },
  { name: 'multiple labels', codes: ['P79Q', 'AB12'], message: 'Show only one package label' }
]) {
  test(`${scenario.name} barcode warns explicitly without a stop or count`, async ({ app, page }) => {
    await app.open(scenario.list || routeList);
    await app.scan(scenario.codes);
    await expect(app.dialog).toHaveAccessibleName('Check this package');
    await expect(page.locator('#matchTitle')).not.toHaveClass(/sr-only/);
    await expect(page.locator('#matchMessage')).toContainText(scenario.message);
    for (const id of ['matchStopNumber', 'matchNewBadge', 'matchCount']) {
      await expect(page.locator('#' + id)).toBeHidden();
    }
    await app.acknowledge();
    await expect(page.locator('.found')).toHaveCount(0);
    await expect(page.locator('.stop-card.complete')).toHaveCount(0);
    await expect(page.locator('#stopList')).toHaveValue(scenario.list || routeList);
    await app.stop();
  });
}

test('full exact ID wins over ambiguous suffix matches', async ({ app, page }) => {
  await app.open(ambiguousList);
  await app.scan('trackonep79q');
  await expect(page.locator('#matchStopNumber')).toHaveText('7');
  await expect(page.locator('#matchCount')).toHaveText('1 bag of 1 bag');
  await app.acknowledge();
  await expect(app.cards.first()).toHaveClass(/complete/);
  await expect(app.cards.nth(1)).toContainText('0/1 bags scanned');
  await app.stop();
});

test('unknown notices are suppressed per camera session and do not consume NEW history', async ({ app, page }) => {
  await app.open();
  await app.scan('ZZ99');
  await app.acknowledge();
  const decodes = await page.evaluate(() => __appTest.metrics.decodes);
  await page.evaluate(() => { __appTest.codes = ['ZZ99']; });
  await expect.poll(() => page.evaluate(() => __appTest.metrics.decodes)).toBeGreaterThan(decodes + 2);
  await expect(app.dialog).not.toBeVisible();
  await app.stop();
  await app.start();
  await expect(app.dialog).toBeVisible();
  await expect(page.locator('#matchMessage')).toContainText('not in the stop list');
  await app.acknowledge();
  await app.scan('P79Q');
  await expect(page.locator('#matchNewBadge')).toBeVisible();
  await expect(page.locator('#matchMessage')).toBeHidden();
  await app.acknowledge();
  await app.stop();
});

test('deleting a confirmed ID or clearing its bullet updates camera totals and re-add requires scanning again', async ({ app, page }) => {
  await app.open();
  await app.scan('P79Q');
  await app.acknowledge();
  await app.stop();
  await page.locator('#backButton').click();
  await app.edit(routeList.replace(' - P79Q', ' -'));
  await page.locator('#nextButton').click();
  await expect(app.cards.first()).toContainText('0/1 bags scanned');
  await expect(app.cards.first()).not.toContainText('P79Q');
  await app.start();
  await app.scan('P79Q');
  await expect(page.locator('#matchMessage')).toContainText('not in the stop list');
  await app.acknowledge();
  await app.stop();
  await page.locator('#backButton').click();
  await app.edit(routeList);
  await page.locator('#nextButton').click();
  await expect(app.cards.first()).toContainText('0/2 bags scanned');
  await app.start();
  await app.scan('P79Q');
  await expect(page.locator('#matchCount')).toHaveText('1 bag of 2 bags');
  await app.acknowledge();
  await app.stop();
});

test('deleting unscanned IDs recomputes completion and removing a stop prunes only its scans', async ({ app, page }) => {
  await app.open();
  for (const code of ['P79Q', 'AB12']) {
    await app.scan(code);
    await app.acknowledge();
  }
  await app.stop();
  await page.locator('#backButton').click();
  const reduced = routeList.replace('\n - HPQK', '');
  await app.edit(reduced);
  await page.locator('#nextButton').click();
  await expect(page.locator('.stop-card.complete')).toHaveCount(2);
  await page.locator('#backButton').click();
  await app.edit('12. Jamie Example #1002\n - AB12');
  await page.locator('#nextButton').click();
  await expect(app.cards).toHaveCount(1);
  await expect(app.cards.first()).toHaveClass(/complete/);
  await page.locator('#backButton').click();
  await app.edit(reduced);
  await page.locator('#nextButton').click();
  await expect(app.cards.first()).toContainText('0/1 bags scanned');
  await expect(app.cards.nth(1)).toHaveClass(/complete/);
});

test('empty stops are skipped and never complete; all-empty headings clear prior scans', async ({ app, page }) => {
  await app.open('7. Empty #1001\n -\n\n12. Jamie #1002\n - AB12');
  await expect(app.cards.first()).toContainText('No packages listed - skipped');
  await expect(app.cards.first()).not.toHaveClass(/complete/);
  await app.scan('AB12');
  await expect(page.locator('#matchStopNumber')).toHaveText('12');
  await app.acknowledge();
  await app.stop();
  await page.locator('#backButton').click();
  await app.edit('7. Empty #1001\n -\n\n12. Jamie #1002\n -');
  await expect(page.locator('#listError')).toContainText('Add at least one package');
  await expect(page.locator('#nextButton')).toBeDisabled();
  await expect(page.locator('.stop-card.complete')).toHaveCount(0);
  await app.edit('7. Empty #1001\n -\n\n12. Jamie #1002\n - AB12');
  await page.locator('#nextButton').click();
  await expect(app.cards.nth(1)).toContainText('0/1 bags scanned');
  await app.start();
  await app.scan('AB12');
  await expect(page.locator('#matchCount')).toHaveText('1 bag of 1 bag');
  await app.acknowledge();
  await app.stop();
});

for (const invalid of [
  { name: 'duplicate stop numbers', list: '7. A\n - AB12\n\n7. B\n - CD34', error: 'Stop numbers must be unique' },
  { name: 'zero stop number', list: '0. A\n - AB12', error: 'positive whole numbers' },
  { name: 'package assigned twice', list: '7. A\n - AB12\n\n8. B\n - AB12', error: 'multiple stops' },
  { name: 'bad formatting', list: 'Personal address\nPackage ID needs correction\n\nNotes: keep this text', error: 'Fix the list format' }
]) {
  test(`${invalid.name} blocks the scan step before camera access`, async ({ app, page }) => {
    await app.edit(invalid.list);
    await expect(page.locator('#listError')).toContainText(invalid.error);
    await expect(page.locator('#nextButton')).toBeDisabled();
    await expect(page.locator('#step2Button')).toBeDisabled();
    expect(await page.evaluate(() => __appTest.metrics.constraints)).toEqual([]);
  });
}
