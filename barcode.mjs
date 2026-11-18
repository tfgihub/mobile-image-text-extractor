export async function prepareBarcodeReader() {
  if (!globalThis.ZXingWASM) {
    throw new Error('The barcode decoder could not load. Check your connection; copy your list before reloading.');
  }
  await ZXingWASM.prepareZXingModule({ fireImmediately: true });
}

export async function decodeBarcodeFrame(imageData) {
  const results = await ZXingWASM.readBarcodes(imageData, {
    formats: ['DataMatrix', 'QRCode'],
    tryHarder: true,
    tryRotate: true,
    maxNumberOfSymbols: 2,
    textMode: 'Plain'
  });
  return [...new Set(results.filter(result => result.isValid !== false && !result.error).map(result => result.text))];
}
