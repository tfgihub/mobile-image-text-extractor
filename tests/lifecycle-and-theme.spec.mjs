import { test, expect, routeList } from './fixtures.mjs';

function contrastRatio(foreground, background) {
  const luminance = channels => {
    const [red, green, blue] = channels.map(channel => {
      const value = channel / 255;
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    });
    return red * .2126 + green * .7152 + blue * .0722;
  };
  const values = [luminance(foreground), luminance(background)];
  return (Math.max(...values) + .05) / (Math.min(...values) + .05);
}

test('active camera locks editing/import/navigation and Stop releases tracks and restores controls', async ({ app, page }) => {
  await app.open();
  await expect(page.locator('#stopList')).toHaveJSProperty('readOnly', true);
  for (const id of ['imageInput', 'copyButton', 'clearButton', 'backButton', 'step1Button', 'resetProgressButton']) {
    await expect(page.locator('#' + id)).toBeDisabled();
  }
  await app.stop();
  await expect(page.locator('#stopList')).toHaveJSProperty('readOnly', false);
  await expect(page.locator('#imageInput')).toBeEnabled();
  await expect(page.locator('#backButton')).toBeEnabled();
  await expect(page.locator('#stopList')).toHaveValue(routeList);
});

for (const failure of ['permission', 'decoder', 'missing decoder']) {
  test(`${failure} failure surfaces an error, releases resources and preserves progress`, async ({ app, page }) => {
    await app.open();
    await app.scan('P79Q');
    await app.acknowledge();
    await app.stop();
    await page.evaluate(failure => {
      if (failure === 'permission') __appTest.permissionError = 'Camera permission denied';
      else if (failure === 'decoder') __appTest.decoderError = 'Decode failed';
      else window.ZXingWASM = undefined;
    }, failure);
    await page.locator('#cameraButton').click();
    await expect(page.locator('#cameraStatus')).toContainText('Live camera error:');
    await expect(page.locator('#cameraButton')).toHaveText('Open Live Camera');
    await expect(page.locator('#backButton')).toBeEnabled();
    await expect(page.locator('#stopList')).toHaveValue(routeList);
    await expect(app.cards.first()).toContainText('1/2 bags scanned');
    expect(await page.evaluate(() => __appTest.streams.every(stream =>
      stream.getTracks().every(track => track.readyState === 'ended')
    ))).toBe(true);
    if (failure !== 'missing decoder') {
      await page.evaluate(() => { __appTest.permissionError = null; __appTest.decoderError = null; });
      await app.start();
      await app.scan('HPQK');
      await expect(page.locator('#matchCount')).toHaveText('2 bags of 2 bags');
      await app.acknowledge();
      await app.stop();
    }
  });
}

test('Stop during a pending permission request releases the late stream without decoding', async ({ app, page }) => {
  await app.edit(routeList);
  await page.locator('#nextButton').click();
  await page.evaluate(() => { __appTest.deferPermission = true; });
  await page.locator('#cameraButton').click();
  await expect.poll(() => page.evaluate(() => typeof __appTest.resolvePermission)).toBe('function');
  await page.locator('#cameraButton').click();
  await expect(page.locator('#cameraButton')).toHaveText('Open Live Camera');
  await expect(page.locator('#backButton')).toBeEnabled();
  await page.evaluate(() => __appTest.resolvePermission());
  await expect.poll(() => page.evaluate(() => __appTest.streams.length)).toBe(1);
  expect(await page.evaluate(() => __appTest.metrics.decodes)).toBe(0);
  expect(await page.evaluate(() => __appTest.streams[0].getTracks()[0].readyState)).toBe('ended');
  await expect(page.locator('#backButton')).toBeEnabled();
});

for (const event of ['background', 'pagehide', 'disconnection']) {
  test(`${event} closes a pending notice, releases the camera and does not count the package`, async ({ app, page }) => {
    await app.open();
    await app.scan('P79Q');
    await page.evaluate(event => {
      if (event === 'background') {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      } else if (event === 'pagehide') window.dispatchEvent(new PageTransitionEvent('pagehide'));
      else __appTest.streams[0].getVideoTracks()[0].dispatchEvent(new Event('ended'));
    }, event);
    await expect(app.dialog).not.toBeVisible();
    await expect(page.locator('#cameraButton')).toHaveText('Open Live Camera');
    await expect(app.cards.first()).toContainText('0/2 bags scanned');
    expect(await page.evaluate(() => __appTest.streams[0].getTracks()[0].readyState)).toBe('ended');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      __appTest.codes = [];
    });
    await app.start();
    await app.scan('P79Q');
    await expect(page.locator('#matchNewBadge')).toBeHidden();
    await app.acknowledge(true);
    await app.stop();
  });
}

test('Copy uses current editor text; denied clipboard permission selects the list with an explicit fallback', async ({ app, page }) => {
  await app.edit(routeList);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { async writeText(text) { __appTest.copied = text; } }
    });
  });
  await page.locator('#copyButton').click();
  await expect(page.locator('#status')).toHaveText('List copied!');
  expect(await page.evaluate(() => __appTest.copied)).toBe(routeList);
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  });
  await page.locator('#copyButton').click();
  await expect(page.locator('#status')).toContainText('Could not copy automatically');
  expect(await page.locator('#stopList').evaluate(input => [input.selectionStart, input.selectionEnd]))
    .toEqual([0, routeList.length]);
});

test('cancelled Reset and Clear dialogs keep the list, scans and NEW history', async ({ app, page }) => {
  await app.open();
  await app.scan('P79Q');
  await app.acknowledge();
  await app.stop();
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#resetProgressButton').click();
  await expect(app.cards.first()).toContainText('1/2 bags scanned');
  await page.locator('#backButton').click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#clearButton').click();
  await expect(page.locator('#stopList')).toHaveValue(routeList);
  await page.locator('#nextButton').click();
  await app.start();
  await app.scan('HPQK');
  await expect(page.locator('#matchNewBadge')).toBeHidden();
  await expect(page.locator('#matchCount')).toHaveText('2 bags of 2 bags');
  await app.acknowledge();
  await app.stop();
});

for (const width of [320, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`${width}px ${theme} layout keeps a compact scrollable editor and unclipped popup/cards`, async ({ app, page }) => {
      await page.setViewportSize({ width, height: 780 });
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#themeButton').click();
      const longList = routeList + '\n\n' + Array.from({ length: 40 }, (_, index) =>
        `${index + 20}. Example #${index + 2000}\n - CODE${index}`
      ).join('\n\n');
      await app.edit(longList);
      const editor = await page.locator('#stopList').evaluate(input => ({
        height: input.getBoundingClientRect().height, scrollHeight: input.scrollHeight, clientHeight: input.clientHeight
      }));
      expect(editor.height).toBeLessThanOrEqual(240);
      expect(editor.scrollHeight).toBeGreaterThan(editor.clientHeight);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await app.open();
      await app.scan('AB12');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const badge = page.locator('#matchNewBadge');
      await expect(badge).toBeVisible();
      const badgeStyle = await badge.evaluate(node => {
        const style = getComputedStyle(node);
        return {
          fontSize: parseFloat(style.fontSize),
          foreground: style.color.match(/\d+/g).map(Number),
          background: style.backgroundColor.match(/\d+/g).map(Number),
          height: node.getBoundingClientRect().height
        };
      });
      expect(badgeStyle.fontSize).toBeGreaterThanOrEqual(18);
      expect(badgeStyle.height).toBeGreaterThanOrEqual(40);
      expect(badgeStyle.foreground).toHaveLength(3);
      expect(badgeStyle.background).toHaveLength(3);
      expect(Math.max(...badgeStyle.background) - Math.min(...badgeStyle.background)).toBeGreaterThanOrEqual(30);
      expect(contrastRatio(badgeStyle.foreground, badgeStyle.background)).toBeGreaterThanOrEqual(4.5);
      const box = await app.dialog.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.height).toBeLessThanOrEqual(780);
      expect(await app.dialog.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
      await app.acknowledge(true);
      await app.scan('AB12');
      await expect(badge).toBeHidden();
      await app.acknowledge();
      await expect(app.cards.nth(1)).toHaveClass(/complete/);
      expect(await app.cards.nth(1).evaluate(card => getComputedStyle(card).backgroundColor))
        .not.toBe(await app.cards.first().evaluate(card => getComputedStyle(card).backgroundColor));
      await app.stop();
    });
  }
}

test('theme follows the device and explicit choice survives clearing a saved run and reloading', async ({ app, page }) => {
  await app.edit(routeList);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#stopList')).toHaveValue('');
  await expect(page.locator('#restoreDialog')).toBeVisible();
  await page.locator('#clearSavedRunButton').click();
  await page.locator('#themeButton').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#themeButton')).toHaveAttribute('aria-label', 'Switch to black theme');
});

test('unavailable storage logs a warning but still allows switching themes', async ({ app, page }) => {
  const warnings = [];
  page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() { throw new DOMException('Storage blocked', 'SecurityError'); }
    });
  });
  await page.reload();
  const before = await page.locator('html').getAttribute('data-theme');
  await page.locator('#themeButton').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', before === 'dark' ? 'light' : 'dark');
  expect(warnings.some(warning => warning.includes('could not be saved'))).toBe(true);
});
