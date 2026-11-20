import { test, expect, routeList } from './fixtures.mjs';
import { runStorageKey, parseSavedRun } from '../saved-run.mjs';

const records = [
  ['Alex Sample #1001', 'P79Q'],
  ['Jamie Example #1002', 'AB12'],
  ['Taylor Sample #1003', 'CD34'],
  ['Casey Example #1004', 'EF56']
];
const image = indices => indices.map(index => `${records[index][0]}\nPackage ID\n${records[index][1]}`).join('\n');
const list = indices => indices.map((index, number) => `${number + 1}. ${records[index][0]}\n   - ${records[index][1]}`).join('\n\n');
const stored = page => page.evaluate(key => localStorage.getItem(key), runStorageKey);

async function awaitingChoice(app, page, images = [image([0, 1]), image([2, 3])]) {
  await app.beginUpload(images);
  await expect(page.locator('#stopOrderDialog')).toBeVisible();
}

test('shuffled overlapping screenshots below the photo reconstruct route order and scan numbers automatically', async ({ app, page }) => {
  const withPhoto = text => 'Product photo #9999\nPackage ID\nZZ99\nSCAN 20 BAGS TO VERIFY\nReady - CART_7\n20 OF 40\n' + text;
  await app.upload([
    withPhoto(image([1, 2])),
    withPhoto(image([2, 3])),
    withPhoto(image([0, 1]).replace('Jamie Example', 'Recipient'))
  ]);
  await expect(page.locator('#stopOrderDialog')).not.toBeVisible();
  await expect(page.locator('#stopList')).toHaveValue(list([0, 1, 2, 3]));
  expect(parseSavedRun(await stored(page)).list).toBe(list([0, 1, 2, 3]));
  await page.locator('#nextButton').click();
  await app.start();
  await app.scan('CD34');
  await expect(page.locator('#matchStopNumber')).toHaveText('3');
  await app.waitForNotice();
  await app.stop();
});

test('disconnected image groups require a choice before saving, preserve internal order, and restore the chosen route', async ({ app, page }) => {
  await page.evaluate(key => {
    const setItem = Storage.prototype.setItem;
    __appTest.savedWrites = [];
    Storage.prototype.setItem = function (name, value) {
      if (name === key) __appTest.savedWrites.push(value);
      return setItem.call(this, name, value);
    };
  }, runStorageKey);
  await awaitingChoice(app, page);
  const groups = page.locator('.order-group');
  await expect(groups).toHaveCount(2);
  await expect(groups.first()).toContainText('Alex Sample');
  await expect(groups.first()).toContainText('Jamie Example');
  expect(await stored(page)).toBeNull();
  expect(await page.evaluate(() => __appTest.savedWrites.length)).toBe(0);
  expect(await page.evaluate(() => __appTest.metrics.terminations)).toBe(1);
  await expect(page.locator('#stopList')).not.toBeEditable();
  for (const id of ['imageInput', 'copyButton', 'clearButton', 'nextButton', 'step2Button']) {
    await expect(page.locator('#' + id)).toBeDisabled();
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#stopOrderDialog')).toBeVisible();
  await groups.nth(1).getByRole('button', { name: 'Move earlier' }).click();
  await expect(groups.first()).toContainText('Taylor Sample');
  await page.locator('#confirmStopOrderButton').click();
  await expect(page.locator('#imageInput')).toBeEnabled();
  await expect(page.locator('#stopList')).toHaveValue(list([2, 3, 0, 1]));
  expect(parseSavedRun(await stored(page)).list).toBe(list([2, 3, 0, 1]));
  expect(await page.evaluate(() => __appTest.savedWrites.length)).toBe(1);
  await app.reload();
  await expect(page.locator('#restoreDialog')).toBeVisible();
  await page.locator('#resumeRunButton').click();
  await expect(page.locator('#stopList')).toHaveValue(list([2, 3, 0, 1]));
});

test('cancel discards unresolved ordering without caching a partial route and allows a fresh import', async ({ app, page }) => {
  await awaitingChoice(app, page);
  await page.locator('#cancelStopOrderButton').click();
  await expect(page.locator('#status')).toHaveText('Import cancelled. No stops were added.');
  await expect(page.locator('#stopList')).toHaveValue('');
  await expect(page.locator('#stopList')).toBeEditable();
  expect(await stored(page)).toBeNull();
  await app.upload([image([0])]);
  await expect(page.locator('#stopList')).toHaveValue(list([0]));
});

test('reload before order confirmation never resumes provisional first-seen numbering', async ({ app, page }) => {
  await awaitingChoice(app, page);
  await app.reload();
  await expect(page.locator('#restoreDialog')).not.toBeVisible();
  await expect(page.locator('#stopOrderDialog')).not.toBeVisible();
  await expect(page.locator('#stopList')).toHaveValue('');
  expect(await stored(page)).toBeNull();
});

test('cancelling still surfaces an OCR cleanup failure', async ({ app, page }) => {
  await page.evaluate(() => { __appTest.cleanupError = 'Test cleanup failure'; });
  await awaitingChoice(app, page);
  await page.locator('#cancelStopOrderButton').click();
  await expect(page.locator('#status')).toHaveText('Import cancelled. No stops were added. Reader could not close. Reload before importing again.');
  expect(await stored(page)).toBeNull();
});

test('branching overlap allows choosing missing precedence but prevents reversing known precedence', async ({ app, page }) => {
  await awaitingChoice(app, page, [image([0, 1]), image([0, 2])]);
  const groups = page.locator('.order-group');
  await expect(groups).toHaveCount(3);
  await expect(groups.first().getByRole('button', { name: 'Move later' })).toBeDisabled();
  await expect(groups.nth(1).getByRole('button', { name: 'Move earlier' })).toBeDisabled();
  await groups.nth(2).getByRole('button', { name: 'Move earlier' }).click();
  await page.locator('#confirmStopOrderButton').click();
  await expect(page.locator('#stopList')).toHaveValue(list([0, 2, 1]));
});

test('contradictory screenshots explicitly require the user to override image order', async ({ app, page }) => {
  await awaitingChoice(app, page, [image([1, 0]), image([0, 1])]);
  await expect(page.locator('#stopOrderMessage')).toContainText('Images disagree');
  await expect(page.locator('#stopOrderMessage')).toContainText('override');
  await page.locator('.order-group').nth(1).getByRole('button', { name: 'Move earlier' }).click();
  await page.locator('#confirmStopOrderButton').click();
  await expect(page.locator('#stopList')).toHaveValue(list([0, 1]));
});

test('an existing confirmed run keeps manual numbers and appends new stops without an order prompt', async ({ app, page }) => {
  await app.open();
  await app.scan('P79Q');
  await app.waitForNotice();
  await app.stop();
  await page.locator('#backButton').click();
  await app.upload([image([2, 0]), image([1, 0])]);
  await expect(page.locator('#stopOrderDialog')).not.toBeVisible();
  await expect(page.locator('#stopList')).toHaveValue(routeList.replaceAll('\n - ', '\n   - ') + '\n\n13. Taylor Sample #1003\n   - CD34');
  expect([...parseSavedRun(await stored(page)).readings]).toEqual(['P79Q']);
  await page.locator('#nextButton').click();
  await app.start();
  await app.scan('P79Q');
  await expect(page.locator('#matchStopNumber')).toHaveText('7');
  await app.waitForNotice();
  await app.scan('CD34');
  await expect(page.locator('#matchStopNumber')).toHaveText('13');
  await app.waitForNotice();
  await app.stop();
});

test('another tab saving during ordering closes the prompt and protects the newer run', async ({ app, page, context }) => {
  await awaitingChoice(app, page);
  const other = await context.newPage();
  try {
    await other.goto('/');
    await other.locator('#stopList').fill(routeList);
    await expect(page.locator('#saveStatus')).toContainText('Another tab changed');
    await expect(page.locator('#stopOrderDialog')).not.toBeVisible();
    await expect(page.locator('#status')).toContainText('Reload to continue.');
    await expect(page.locator('#stopList')).not.toBeEditable();
    await expect(page.locator('#imageInput')).toBeDisabled();
    await expect(page.locator('#copyButton')).toBeEnabled();
    expect(parseSavedRun(await stored(page)).list).toBe(routeList);
  } finally { await other.close(); }
});

test('a failed order dialog rolls back rather than saving guessed numbering', async ({ app, page }) => {
  await page.evaluate(() => {
    document.getElementById('stopOrderDialog').showModal = () => { throw new Error('Test dialog failure'); };
  });
  await app.beginUpload([image([0, 1]), image([2, 3])]);
  await expect(page.locator('#status')).toHaveText('Could not finish stop ordering. No stops were added. Try importing again.');
  await expect(page.locator('#stopList')).toHaveValue('');
  await expect(page.locator('#imageInput')).toBeEnabled();
  expect(await stored(page)).toBeNull();
});

for (const theme of ['light', 'dark']) {
  test(`320px ${theme} order dialog handles long names and scrolling without horizontal overflow`, async ({ app, page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#themeButton').click();
    await awaitingChoice(app, page, Array.from({ length: 6 }, (_, index) =>
      `${'Long-Recipient-Name-'.repeat(4)} #${8100 + index}\nPackage ID\nAA0${index}`
    ));
    const dialog = page.locator('#stopOrderDialog');
    const box = await dialog.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect(box.height).toBeLessThanOrEqual(640);
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.locator('#cancelStopOrderButton').click();
    await expect(dialog).not.toBeVisible();
  });
}
