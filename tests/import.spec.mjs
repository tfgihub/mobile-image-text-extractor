import { test, expect, screenshotText, routeList } from './fixtures.mjs';
import { readStopList } from '../stops.mjs';

test('real screenshot OCR imports two stops and their package IDs', async ({ app, page }) => {
  await page.evaluate(() => { __appTest.realOCR = true; });
  const buffer = await app.image([
    'Alex Sample #1001', 'Package ID', 'AB12', 'Package ID', 'CD34',
    'Jamie Example #1002', 'Package ID', 'EF56'
  ]);
  await page.locator('#imageInput').setInputFiles({ name: 'two-stops.png', mimeType: 'image/png', buffer });
  await expect(page.locator('#status')).toHaveText('1 image processed. No detection issues found.', { timeout: 30_000 });
  await expect(page.locator('#importMessages')).toBeHidden();
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
  await expect(page.locator('#status')).toHaveText('All 3 images processed. No detection issues found.');
  await expect(page.locator('#importMessages')).toBeHidden();
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
  await expect(page.locator('#importMessages')).toContainText('Jamie Example #1002: 1 package ID not detected.');
  await expect(page.locator('#importMessages')).toContainText('Stop not detected for package ZZ99.');
  await expect(page.locator('#importMessages > li')).toHaveCount(1);
  await expect(page.locator('#importMessages > li > strong')).toHaveText('screenshot-1.png');
  await expect(page.locator('#status')).toHaveText('1 image processed. 1 image needs review below.');
  expect(readStopList(await page.locator('#stopList').inputValue()).stops).toEqual([
    { address: 'Alex Sample #1001', packages: ['AB12'] }
  ]);
});

test('empty and unrecognized OCR keep edits and display import notes', async ({ app, page }) => {
  await app.edit(routeList);
  await app.upload(['', 'This picture contains no delivery information']);
  await expect(page.locator('#stopList')).toHaveValue(routeList);
  await expect(page.locator('#importMessages')).toContainText('No stops or packages detected.');
  await expect(page.locator('#importMessages')).toContainText('No stops detected.');
  await expect(page.locator('#importMessages > li > strong')).toHaveText(['screenshot-1.png', 'screenshot-2.png']);
  await expect(page.locator('#status')).toHaveText('All 2 images processed. 2 images need review below.');
});

test('a failed image does not discard edits or stop subsequent images; worker is released', async ({ app, page }) => {
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await app.edit('1. Existing #1234\n - ZZ99');
  await app.upload([{ error: 'Damaged screenshot' }, screenshotText]);
  await expect(page.locator('#status')).toHaveText('1/2 images processed. 1 image needs review below.');
  await expect(page.locator('#importMessages > li > strong')).toHaveText(['screenshot-1.png']);
  await expect(page.locator('#importMessages')).toContainText('Could not read image. Try again or choose another screenshot.');
  await expect(page.locator('#importMessages')).not.toContainText('Damaged screenshot');
  expect(errors.some(message => message.includes('Damaged screenshot'))).toBe(true);
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
  await expect(page.locator('#status')).toHaveText('1/2 images processed. 1 image needs review below.');
  await expect(page.locator('#importMessages')).toContainText('Not an image. Choose a screenshot.');
  expect(readStopList(await page.locator('#stopList').inputValue()).stops).toHaveLength(2);
});

test('invalid manual formatting blocks imports and preserves the exact editor', async ({ app, page }) => {
  await app.upload(['']);
  await expect(page.locator('#importMessages')).toBeVisible();
  const invalid = 'Personal address\nPackage ID needs correction\n\nNotes: keep this text\n';
  await app.edit(invalid);
  await page.locator('#imageInput').setInputFiles({
    name: 'unused.png', mimeType: 'image/png', buffer: await app.image()
  });
  await expect(page.locator('#status')).toContainText('Fix the list format');
  await expect(page.locator('#importMessages')).toBeHidden();
  await expect(page.locator('#stopList')).toHaveValue(invalid);
  expect(await page.evaluate(() => __appTest.metrics.ocrWorkers)).toBe(1);
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
      await expect(page.locator('#status')).toHaveText('No images processed. Could not start the screenshot reader. Try again.');
      await expect(page.locator('#status')).not.toContainText('Test OCR failure');
    } else {
      await app.upload(['']);
      await expect(page.locator('#status')).toContainText('Reader could not close. Reload before importing again.');
    }
    await expect(page.locator('#stopList')).toHaveValue(routeList);
    await expect(page.locator('#imageInput')).toBeEnabled();
    await expect(page.locator('#stopList')).toHaveJSProperty('readOnly', false);
  });
}

test('only images needing review are listed, with the affected stop, and a clean import clears old notices', async ({ app, page }) => {
  await app.upload([
    screenshotText,
    'Alex Sample #1001\nPackage ID\nPhoto required\nJamie Example #1002\nUnknown',
    screenshotText
  ]);
  await expect(page.locator('#status')).toHaveText('All 3 images processed. 1 image needs review below.');
  await expect(page.locator('#importMessages > li > strong')).toHaveText(['screenshot-2.png']);
  await expect(page.locator('#importMessages > li > ul > li')).toHaveText([
    'Alex Sample #1001: 1 package ID not detected.',
    'Jamie Example #1002: 1 package ID not detected.'
  ]);
  await app.upload([screenshotText]);
  await expect(page.locator('#status')).toHaveText('1 image processed. No detection issues found.');
  await expect(page.locator('#importMessages')).toBeHidden();
  await app.confirmDialog('#clearButton');
  await expect(page.locator('#status')).toBeEmpty();
});

test('failure to read every image never reports a successful import', async ({ app, page }) => {
  await app.edit(routeList);
  await app.upload([{ error: 'First image unreadable' }, { error: 'Second image unreadable' }]);
  await expect(page.locator('#status')).toHaveText('0/2 images processed. 2 images need review below.');
  await expect(page.locator('#importMessages > li > strong')).toHaveText(['screenshot-1.png', 'screenshot-2.png']);
  await expect(page.locator('#stopList')).toHaveValue(routeList);
});

test('a reader cleanup failure never reports no detection issues or displays technical logs', async ({ app, page }) => {
  await page.evaluate(() => { __appTest.cleanupError = 'Technical cleanup failure'; });
  await app.upload([screenshotText]);
  await expect(page.locator('#status')).toHaveText('1 image processed. Reader could not close. Reload before importing again.');
  await expect(page.locator('#importMessages')).toBeHidden();
  await expect(page.locator('#status')).not.toContainText('Technical cleanup failure');
});

test('an interrupted batch identifies every unprocessed image without claiming it was completed', async ({ app, page, context }) => {
  await app.edit(routeList);
  await page.evaluate(text => { __appTest.holdOCR = true; __appTest.ocrQueue = [text, text]; }, screenshotText);
  const buffer = await app.image();
  await page.locator('#imageInput').setInputFiles([
    { name: 'first.png', mimeType: 'image/png', buffer },
    { name: 'second.png', mimeType: 'image/png', buffer }
  ]);
  await expect.poll(() => page.evaluate(() => typeof __appTest.resolveOCR)).toBe('function');
  const other = await context.newPage();
  try {
    await other.goto('/');
    await other.locator('#clearSavedRunButton').click();
    await expect(page.locator('#saveStatus')).toContainText('Another tab changed');
    await page.evaluate(() => __appTest.resolveOCR());
    await expect(page.locator('#status')).toHaveText('0/2 images processed. Reload to continue.');
    await expect(page.locator('#importMessages')).toContainText('first.png');
    await expect(page.locator('#importMessages')).toContainText('second.png');
    await expect(page.locator('#stopList')).toHaveValue(routeList);
    expect(await page.evaluate(() => __appTest.metrics.terminations)).toBe(1);
  } finally { await other.close(); }
});

for (const theme of ['light', 'dark']) {
  test(`320px ${theme} image-review notices remain readable without horizontal overflow`, async ({ app, page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#themeButton').click();
    await page.evaluate(() => { __appTest.ocrQueue = ['Alex Sample #1001\nPackage ID']; });
    await page.locator('#imageInput').setInputFiles({
      name: 'a-very-long-screenshot-filename-'.repeat(4) + '.png',
      mimeType: 'image/png', buffer: await app.image()
    });
    await expect(page.locator('#status')).toHaveText('1 image processed. 1 image needs review below.');
    await expect(page.locator('#importMessages')).toContainText('Alex Sample #1001: 1 package ID not detected.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
