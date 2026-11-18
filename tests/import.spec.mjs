import { test, expect, screenshotText, routeList } from './fixtures.mjs';
import { readStopList } from '../stops.mjs';

test('real screenshot OCR imports two stops and their package IDs', async ({ app, page }) => {
  await page.evaluate(() => { __appTest.realOCR = true; });
  const buffer = await app.image([
    'Alex Sample #1001', 'Package ID', 'AB12', 'Package ID', 'CD34',
    'Jamie Example #1002', 'Package ID', 'EF56'
  ]);
  await page.locator('#imageInput').setInputFiles({ name: 'two-stops.png', mimeType: 'image/png', buffer });
  await expect(page.locator('#status')).toContainText('1 image(s) read, 0 failed', { timeout: 30_000 });
  const parsed = readStopList(await page.locator('#stopList').inputValue());
  expect(parsed.error).toBeNull();
  expect(parsed.stops.map(stop => stop.packages)).toEqual([['AB12', 'CD34'], ['EF56']]);
  await expect.poll(() => page.evaluate(() => __appTest.metrics.terminations)).toBe(1);
});

test('multiple overlapping screenshots merge stops, short/full IDs and new packages without duplication', async ({ app, page }) => {
  await app.upload([
    screenshotText,
    '#1001\nPackage ID\nP79Q\nPackage ID\nHPQK\nPackage ID\nCD34\n#1002\nPackage ID\nAB12',
    '#1001\nUnknown TRACKINGP79Q'
  ]);
  const first = await page.locator('#stopList').inputValue();
  expect(readStopList(first).stops).toEqual([
    { address: 'Alex Sample #1001', packages: ['TRACKINGP79Q', 'HPQK', 'CD34'] },
    { address: 'Jamie Example #1002', packages: ['AB12'] }
  ]);
  await app.upload([screenshotText]);
  await expect(page.locator('#stopList')).toHaveValue(first);
  expect(await page.evaluate(() => __appTest.metrics)).toMatchObject({
    ocrWorkers: 2, terminations: 2,
    parameters: [{ tessedit_pageseg_mode: '11' }, { tessedit_pageseg_mode: '11' }]
  });
  await expect(page.locator('#imageInput')).toHaveValue('');
});

test('legacy noisy address screenshots merge into the current edited list', async ({ app, page }) => {
  await app.edit('1. 100 Example St.\n - manually_corrected');
  await app.upload([
    'Edit stop\n@ 100 EXAMPLE ST\n% No Recipient Required\n6 Unknown spAlphaAAA\n®6 Unknown spBetaBBB',
    '200 Example Way\nUnknown spGammaCCC\n100 Example St\nUnknown spAlphaAAA'
  ]);
  expect(readStopList(await page.locator('#stopList').inputValue()).stops).toEqual([
    { address: '100 Example St.', packages: ['manually_corrected', 'spAlphaAAA', 'spBetaBBB'] },
    { address: '200 Example Way', packages: ['spGammaCCC'] }
  ]);
});

test('conflicts, orphan rows and clipped IDs are warned about without inventing assignments', async ({ app, page }) => {
  await app.edit('1. Alex Sample #1001\n - AB12');
  await app.upload(['Package ID\nZZ99\nJamie Example #1002\nPackage ID\nAB12\nPackage ID']);
  await expect(page.locator('#importMessages')).toContainText('already belongs');
  await expect(page.locator('#importMessages')).toContainText('no readable ID');
  await expect(page.locator('#importMessages')).toContainText('before a stop heading');
  expect(readStopList(await page.locator('#stopList').inputValue()).stops).toEqual([
    { address: 'Alex Sample #1001', packages: ['AB12'] }
  ]);
});

test('empty and unrecognized OCR keep edits and display import notes', async ({ app, page }) => {
  await app.edit(routeList);
  await app.upload(['', 'This picture contains no delivery information']);
  await expect(page.locator('#stopList')).toHaveValue(routeList);
  await expect(page.locator('#importMessages')).toContainText('No readable text');
  await expect(page.locator('#importMessages')).toContainText('Nothing was added');
});

test('a failed image does not discard edits or stop subsequent images; worker is released', async ({ app, page }) => {
  await app.edit('1. Existing #1234\n - ZZ99');
  await app.upload([{ error: 'Damaged screenshot' }, screenshotText]);
  await expect(page.locator('#status')).toContainText('1 image(s) read, 1 failed');
  await expect(page.locator('#importMessages')).toContainText('Damaged screenshot');
  expect(readStopList(await page.locator('#stopList').inputValue()).stops.map(stop => stop.packages))
    .toEqual([['ZZ99'], ['P79Q', 'HPQK'], ['AB12']]);
  expect(await page.evaluate(() => __appTest.metrics.terminations)).toBe(1);
});

test('a non-image file is rejected explicitly while valid files still import', async ({ app, page }) => {
  const buffer = await app.image();
  await page.evaluate(text => { __appTest.ocrQueue = [text]; }, screenshotText);
  await page.locator('#imageInput').setInputFiles([
    { name: 'not-an-image.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') },
    { name: 'valid.png', mimeType: 'image/png', buffer }
  ]);
  await expect(page.locator('#status')).toContainText('1 image(s) read, 1 failed');
  await expect(page.locator('#importMessages')).toContainText('Select an image file');
  expect(readStopList(await page.locator('#stopList').inputValue()).stops).toHaveLength(2);
});

test('invalid manual formatting blocks imports and preserves the exact editor', async ({ app, page }) => {
  const invalid = 'Personal address\nPackage ID needs correction\n\nNotes: keep this text\n';
  await app.edit(invalid);
  await page.locator('#imageInput').setInputFiles({
    name: 'unused.png', mimeType: 'image/png', buffer: await app.image()
  });
  await expect(page.locator('#status')).toContainText('Fix the list format');
  await expect(page.locator('#stopList')).toHaveValue(invalid);
  expect(await page.evaluate(() => __appTest.metrics.ocrWorkers)).toBe(0);
});

test('import locks editing and navigation until OCR finishes', async ({ app, page }) => {
  await app.edit(routeList);
  await page.evaluate(text => { __appTest.holdOCR = true; __appTest.ocrQueue = [text]; }, screenshotText);
  await page.locator('#imageInput').setInputFiles({
    name: 'pending.png', mimeType: 'image/png', buffer: await app.image()
  });
  await expect.poll(() => page.evaluate(() => typeof __appTest.resolveOCR)).toBe('function');
  await expect(page.locator('#stopList')).toHaveJSProperty('readOnly', true);
  for (const id of ['imageInput', 'copyButton', 'clearButton', 'nextButton', 'step2Button']) {
    await expect(page.locator('#' + id)).toBeDisabled();
  }
  await page.evaluate(() => __appTest.resolveOCR());
  await expect(page.locator('#imageInput')).toBeEnabled();
  await expect(page.locator('#stopList')).toHaveJSProperty('readOnly', false);
});

for (const failure of ['startup', 'cleanup']) {
  test(`OCR ${failure} errors are explicit and leave the editor usable`, async ({ app, page }) => {
    await app.edit(routeList);
    await page.evaluate(failure => {
      __appTest[failure === 'startup' ? 'ocrStartError' : 'cleanupError'] = 'Test OCR failure';
    }, failure);
    if (failure === 'startup') {
      await page.locator('#imageInput').setInputFiles({
        name: 'failed.png', mimeType: 'image/png', buffer: await app.image()
      });
      await expect(page.locator('#status')).toContainText('Import error: Test OCR failure');
    } else {
      await app.upload(['']);
      await expect(page.locator('#importMessages')).toContainText('OCR cleanup failed');
    }
    await expect(page.locator('#stopList')).toHaveValue(routeList);
    await expect(page.locator('#imageInput')).toBeEnabled();
    await expect(page.locator('#stopList')).toHaveJSProperty('readOnly', false);
  });
}
