import { test as base, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { prepareZXingModule, writeBarcode } from 'zxing-wasm/writer';

await prepareZXingModule({
  overrides: { wasmBinary: await readFile(new URL('../node_modules/zxing-wasm/dist/writer/zxing_writer.wasm', import.meta.url)) },
  fireImmediately: true
});

export const routeList = '7. Alex Sample #1001\n - P79Q\n - HPQK\n\n12. Jamie Example #1002\n - AB12';
export const screenshotText = 'Alex Sample #1001\nPackage ID\nP79Q\nPackage ID\nHPQK\nJamie Example #1002\nPackage ID\nAB12';

export const test = base.extend({
  app: async ({ page, context }, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === 'http://127.0.0.1:4173') return route.continue();
      let asset;
      if (['cdn.jsdelivr.net', 'fastly.jsdelivr.net'].includes(url.hostname)) {
        if (url.pathname === '/npm/zxing-wasm@2.2.2/dist/iife/reader/index.js') asset = 'zxing-wasm/dist/iife/reader/index.js';
        else if (url.pathname === '/npm/zxing-wasm@2.2.2/dist/reader/zxing_reader.wasm') asset = 'zxing-wasm/dist/reader/zxing_reader.wasm';
        else if (/^\/npm\/tesseract\.js@v?5\.1\.1\/dist\/(tesseract\.min|worker\.min)\.js$/.test(url.pathname)) asset = 'tesseract.js/dist/' + url.pathname.split('/').pop();
        else if (/^\/npm\/tesseract\.js-core@v?5\.1\.1\/tesseract-core[\w.-]+$/.test(url.pathname)) asset = 'tesseract.js-core/' + url.pathname.split('/').pop();
        else if (url.pathname.endsWith('/eng.traineddata.gz')) asset = '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz';
      }
      if (!asset) {
        errors.push('Unexpected external request: ' + url.href);
        return route.abort();
      }
      await route.fulfill({
        path: fileURLToPath(new URL('../node_modules/' + asset, import.meta.url)),
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    });
    await page.goto('/');
    await expect(page.locator('#themeButton')).toHaveAttribute('aria-label', /Switch to/);
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 800;
      const context = canvas.getContext('2d');
      const h = window.__appTest = {
        codes: [], streams: [], ocrQueue: [],
        metrics: { decodes: 0, ocrWorkers: 0, terminations: 0, parameters: [], constraints: [] }
      };
      function draw() {
        context.fillStyle = 'white';
        context.fillRect(0, 0, 800, 800);
        if (h.image) context.drawImage(h.image, 180, 160, 440, 440);
        context.fillStyle = 'black';
        context.font = '32px Arial';
        context.fillText('3 of 99 bags', 260, 700);
      }
      draw();
      const timer = setInterval(draw, 50);
      h.cleanup = () => {
        clearInterval(timer);
        for (const stream of h.streams) for (const track of stream.getTracks()) track.stop();
      };
      navigator.mediaDevices.getUserMedia = async constraints => {
        h.metrics.constraints.push(constraints);
        if (h.permissionError) throw new DOMException(h.permissionError, 'NotAllowedError');
        if (h.deferPermission) await new Promise(resolve => { h.resolvePermission = resolve; });
        const stream = canvas.captureStream(10);
        h.streams.push(stream);
        return stream;
      };
      const readBarcodes = ZXingWASM.readBarcodes.bind(ZXingWASM);
      ZXingWASM.readBarcodes = async (...args) => {
        h.metrics.decodes++;
        if (h.decoderError) throw new Error(h.decoderError);
        return h.realBarcode ? readBarcodes(...args) : h.codes.map(text => ({ text, isValid: true }));
      };
      const createWorker = Tesseract.createWorker.bind(Tesseract);
      Tesseract.createWorker = async (...args) => {
        h.metrics.ocrWorkers++;
        if (h.ocrStartError) throw new Error(h.ocrStartError);
        if (h.realOCR) {
          const worker = await createWorker(...args);
          const terminate = worker.terminate.bind(worker);
          worker.terminate = async () => { h.metrics.terminations++; return terminate(); };
          return worker;
        }
        return {
          async setParameters(parameters) { h.metrics.parameters.push(parameters); },
          async recognize() {
            if (h.holdOCR) await new Promise(resolve => { h.resolveOCR = resolve; });
            const result = h.ocrQueue.shift();
            if (typeof result === 'object' && result.error) throw new Error(result.error);
            if (typeof result !== 'string') throw new Error('No OCR result configured for this screenshot');
            return { data: { text: result } };
          },
          async terminate() {
            h.metrics.terminations++;
            if (h.cleanupError) throw new Error(h.cleanupError);
          }
        };
      };
    });

    const app = {
      page,
      dialog: page.locator('#matchDialog'),
      cards: page.locator('.stop-card'),
      async edit(text) { await page.locator('#stopList').fill(text); },
      async open(text = routeList) {
        await app.edit(text);
        await page.locator('#nextButton').click();
        await app.start();
      },
      async start() {
        await page.locator('#cameraButton').click();
        await expect(page.locator('#cameraStatus')).toContainText(/Scanning Data Matrix|Barcode decoded/);
      },
      async stop() {
        await page.locator('#cameraButton').click();
        await expect(page.locator('#cameraButton')).toHaveText('Open Live Camera');
        await expect(page.locator('#cameraPreview')).toBeHidden();
        await expect.poll(() => page.evaluate(() =>
          __appTest.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))
        )).toBe(true);
      },
      async scan(codes) {
        await page.evaluate(codes => { __appTest.codes = codes; }, Array.isArray(codes) ? codes : [codes]);
        await expect(app.dialog).toBeVisible();
      },
      async acknowledge(rescan = false) {
        await page.evaluate(() => { __appTest.codes = []; });
        await page.locator(rescan ? '#rescanButton' : '#matchOkButton').click();
        await expect(app.dialog).not.toBeVisible();
      },
      async confirmDialog(button) {
        page.once('dialog', dialog => dialog.accept());
        await page.locator(button).click();
      },
      async image(lines = ['Screenshot']) {
        const data = await page.evaluate(lines => {
          const canvas = document.createElement('canvas');
          canvas.width = 1200;
          canvas.height = Math.max(900, 120 + lines.length * 100);
          const context = canvas.getContext('2d');
          context.fillStyle = 'white';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = 'black';
          context.font = '50px Arial';
          lines.forEach((line, index) => context.fillText(line, 70, 90 + index * 100));
          return canvas.toDataURL('image/png').split(',')[1];
        }, lines);
        return Buffer.from(data, 'base64');
      },
      async upload(texts) {
        await page.evaluate(texts => { __appTest.ocrQueue = texts; }, texts);
        const buffer = await app.image();
        await page.locator('#imageInput').setInputFiles(texts.map((_, index) => ({
          name: `screenshot-${index + 1}.png`, mimeType: 'image/png', buffer
        })));
        await expect(page.locator('#status')).toContainText('Import finished:');
        await expect(page.locator('#imageInput')).toBeEnabled();
      },
      async drawBarcode(payload, format) {
        const result = await writeBarcode(payload, { format, scale: 10, withQuietZones: true });
        if (result.error || !result.image) throw new Error('Barcode fixture generation failed: ' + result.error);
        const data = Buffer.from(await result.image.arrayBuffer()).toString('base64');
        await page.evaluate(async data => {
          const image = new Image();
          image.src = 'data:image/png;base64,' + data;
          await image.decode();
          __appTest.image = image;
          __appTest.realBarcode = true;
        }, data);
      }
    };
    try { await use(app); }
    finally {
      await page.evaluate(() => window.__appTest?.cleanup());
      expect(errors, 'No uncaught errors or unprovisioned network dependencies').toEqual([]);
    }
  }
});

export { expect };
