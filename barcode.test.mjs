import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBarcodeReader, decodeBarcodeFrame } from './barcode.mjs';

test('uses the WASM Data Matrix/QR reader and ignores invalid or duplicate results', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'ZXingWASM');
  Object.defineProperty(globalThis, 'ZXingWASM', { configurable: true, value: {
    async prepareZXingModule(options) { assert.equal(options.fireImmediately, true); },
    async readBarcodes(image, options) {
      assert.deepEqual(options.formats, ['DataMatrix', 'QRCode']);
      assert.equal(options.returnErrors, undefined);
      return [{ text: 'validAB12', isValid: true }, { text: 'validAB12' }, { text: 'invalidCD34', isValid: false }, { text: 'errorEF56', error: 'Checksum error' }];
    }
  } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'ZXingWASM', original);
    else delete globalThis.ZXingWASM;
  });
  await prepareBarcodeReader();
  assert.deepEqual(await decodeBarcodeFrame({}), ['validAB12']);
});
