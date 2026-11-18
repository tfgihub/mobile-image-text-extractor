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
  await expect(page.locator('#importMessages')).toContainText('Jamie Example #1002: 1 package row unreadable in this image.');
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
    'Alex Sample #1001\nPackage ID\nPhoto required\nJamie Example #1002\nUnknown',
    screenshotText,
    screenshotText
  ]);
  await expect(page.locator('#status')).toHaveText('All 3 images processed. 1 image needs review below.');
  await expect(page.locator('#importMessages > li > strong')).toHaveText(['screenshot-1.png']);
  await expect(page.locator('#importMessages > li > ul > li')).toHaveText([
    'Stop 1: 2 packages listed; 1 package row unreadable in this image.',
    'Stop 2: 1 package listed; 1 package row unreadable in this image.'
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
    await expect(page.locator('#importMessages')).toContainText('Stop 1: 0 packages listed; 1 package row unreadable in this image.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('real OCR recovers obscured all-letter labels and isolated references across overlapping images without losing scans', async ({ app, page }) => {
  await page.evaluate(() => { __appTest.realOCR = true; });
  const generated = await page.evaluate(() => [false, true].map(overlap => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1000;
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    function text(value, x, y, size = 32) {
      context.fillStyle = 'black';
      context.font = `${size}px Arial`;
      context.fillText(value, x, y);
    }
    if (!overlap) text('Alex Sample', 50, 90);
    text('#3001', 1000, 90);
    text('Package ID', 180, 180);
    text('72LM', 180, 230, 40);
    text(overlap ? 'Package' : 'p', 180, 310);
    if (overlap) text(')', 335, 310);
    text('QVZX', 180, 360, 40);
    text('Package ID', 180, 440);
    text('RWKP', 180, 490, 40);
    if (!overlap) text('Jamie Example', 50, 610);
    text('#3002', 1000, 610);
    text(overlap ? 'Dackage ID' : 'Package ID', 180, 690);
    text('CD34', 180, 740, 40);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  const files = generated.map((image, index) => ({
    name: `synthetic-layout-${index + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(image, 'base64')
  }));
  files.push({
    name: 'synthetic-additional-stops.png', mimeType: 'image/png',
    buffer: await app.image([
      'Taylor Sample #4001', 'Package ID', 'P79Q',
      'Casey Example #4002', 'Package ID', 'HPQK'
    ])
  });
  await page.locator('#imageInput').setInputFiles(files);
  await expect(page.locator('#stopOrderDialog')).toBeVisible({ timeout: 30000 });
  await page.locator('#confirmStopOrderButton').click();
  await expect(page.locator('#status')).toHaveText('All 3 images processed. No detection issues found.', { timeout: 30000 });
  await expect(page.locator('#imageInput')).toBeEnabled();
  await expect(page.locator('#importMessages')).toBeHidden();
  const before = await page.locator('#stopList').inputValue();
  expect(readStopList(before).stops.map(stop => stop.packages)).toEqual([
    ['72LM', 'QVZX', 'RWKP'], ['CD34'], ['P79Q'], ['HPQK']
  ]);
  await page.locator('#nextButton').click();
  await app.start();
  await app.scan('QVZX');
  await expect(page.locator('#matchStopNumber')).toHaveText('1');
  await app.acknowledge();
  await app.stop();
  await page.locator('#backButton').click();
  await page.locator('#imageInput').setInputFiles(files.slice(0, 1));
  await expect(page.locator('#status')).toHaveText('1 image processed. No detection issues found.', { timeout: 30000 });
  await expect(page.locator('#imageInput')).toBeEnabled();
  await expect(page.locator('#stopList')).toHaveValue(before);
  await page.locator('#nextButton').click();
  await expect(app.cards.first()).toContainText('1/3 bags scanned');
  await app.start();
  await app.scan('QVZX');
  await expect(page.locator('#matchNewBadge')).toBeHidden();
  await expect(page.locator('#matchCount')).toHaveText('1 bag of 3 bags');
  await app.acknowledge();
  await app.scan('RWKP');
  await expect(page.locator('#matchStopNumber')).toHaveText('1');
  await expect(page.locator('#matchCount')).toHaveText('2 bags of 3 bags');
  await app.acknowledge();
  await app.stop();
});

test('a listed package never hides unreadable rows, and warnings use combined-list counts even after editing', async ({ app, page }) => {
  await app.beginUpload([
    'Taylor Sample #4001\nPackage ID\nP79Q\nCasey Example #4002\nPackage ID\nHPQK',
    'Alex Sample #3001\nPackage ID\n72LM\nPackage ID\nQVZX\nPackage ID\nRWKP\nRecipient #3002\nPackage ID\nCD34\nPackage ID',
    'Unclear Name #3002\nPackage ID\nPhoto required'
  ]);
  await expect(page.locator('#stopOrderDialog')).toBeVisible();
  await page.locator('#confirmStopOrderButton').click();
  await expect(page.locator('#status')).toHaveText('All 3 images processed. 2 images need review below.');
  await expect(page.locator('#importMessages > li > strong')).toHaveText(['screenshot-2.png', 'screenshot-3.png']);
  await expect(page.locator('#importMessages > li > ul > li')).toHaveText([
    'Stop 4: 1 package listed; 1 package row unreadable in this image.',
    'Stop 4: 1 package listed; 1 package row unreadable in this image.'
  ]);
  const before = await page.locator('#stopList').inputValue();
  expect(readStopList(before).stops.map(stop => stop.packages)).toEqual([
    ['P79Q'], ['HPQK'], ['72LM', 'QVZX', 'RWKP'], ['CD34']
  ]);
  await app.edit(before + '\n - EF56');
  await expect(page.locator('#importMessages > li > ul > li')).toHaveText([
    'Stop 4: 2 packages listed; 1 package row unreadable in this image.',
    'Stop 4: 2 packages listed; 1 package row unreadable in this image.'
  ]);
});
