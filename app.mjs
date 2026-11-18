import { readStopList, updateStopList } from './stops.mjs?v=barcode1';
import { getScanStops, matchBarcode, readBagCount, validateBagMatch, stopProgress } from './packages.mjs?v=barcode1';
import { createLiveCamera } from './live-camera.mjs?v=barcode1';

const byId = id => document.getElementById(id);
const stopList = byId('stopList');
const imageInput = byId('imageInput');
const status = byId('status');
const cameraStatus = byId('cameraStatus');
const dialog = byId('matchDialog');
const readings = new Map();
const alerted = new Set();
let stops = [];
let valid = false;
let processing = false;
let cameraActive = false;
let pending;
let releaseNotice;

function updateButtons() {
  const busy = processing || cameraActive;
  imageInput.disabled = stopList.readOnly = busy;
  byId('copyButton').disabled = byId('clearButton').disabled = busy || !stopList.value.trim();
  byId('nextButton').disabled = byId('step2Button').disabled = processing || !valid;
  byId('step1Button').disabled = byId('backButton').disabled = busy;
  byId('cameraButton').disabled = processing || (!cameraActive && !valid);
  byId('cameraButton').textContent = cameraActive ? 'Stop Camera' : 'Open Live Camera';
  byId('resetProgressButton').disabled = busy || !readings.size;
}

function renderProgress() {
  const parsed = getScanStops(stopList.value);
  stops = parsed.stops;
  valid = !parsed.error;
  byId('listError').textContent = parsed.error || '';
  byId('stopProgress').replaceChildren();
  for (const stop of stops) {
    const progress = stopProgress(stop, readings);
    const card = document.createElement('div');
    card.className = 'stop-card' + (progress.complete ? ' complete' : '');
    const heading = document.createElement('h3');
    heading.textContent = `Stop ${stop.number}: ${stop.address}`;
    const summary = document.createElement('p');
    summary.textContent = `${progress.count}/${progress.total} bags found; ${progress.listedFound}/${progress.listedTotal} listed IDs matched` +
      (progress.complete ? ' - Complete' : '') + (progress.conflict ? ' - Conflicting bag groups: check the list and reset progress.' : '');
    const list = document.createElement('ul');
    for (const id of stop.packages) {
      const item = document.createElement('li');
      const label = readings.get(id);
      item.textContent = id + (label ? ` - bag ${label.bagNumber}/${label.totalBags} - Found` : ' - Not found');
      if (label) item.className = 'found';
      list.append(item);
    }
    card.append(heading, summary, list);
    byId('stopProgress').append(card);
  }
  updateButtons();
}

function showStep(number) {
  if (processing || cameraActive || (number === 2 && !valid)) return;
  byId('uploadStep').hidden = number !== 1;
  byId('groupStep').hidden = number !== 2;
  for (const value of [1, 2]) {
    const button = byId(`step${value}Button`);
    button.classList.toggle('secondary', number !== value);
    if (number === value) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }
}

function dismissNotice() {
  pending = null;
  if (dialog.open) dialog.close();
  const resolve = releaseNotice;
  releaseNotice = null;
  if (resolve) resolve();
}

function validateNotice() {
  if (!pending) return;
  if (pending.kind === 'check') {
    byId('matchOkButton').disabled = false;
    return;
  }
  const result = validateBagMatch(pending, Number(byId('bagNumber').value), Number(byId('totalBags').value), readings);
  byId('matchOkButton').disabled = result.kind !== 'match';
  if (result.kind !== 'match') {
    byId('matchCount').textContent = '';
    byId('matchMessage').textContent = result.message;
    return;
  }
  const preview = new Map(readings);
  preview.set(result.packageId, result);
  const progress = stopProgress(result.stop, preview);
  byId('matchCount').textContent = `After confirmation: ${progress.count}/${progress.total} bags`;
  byId('matchMessage').textContent = 'Check the bag number and total against the printed label before confirming.';
}

const camera = createLiveCamera({
  video: byId('cameraPreview'),
  onActive(active) {
    cameraActive = active;
    byId('cameraPreview').hidden = !active;
    updateButtons();
  },
  onStatus(message) { cameraStatus.textContent = message; },
  onTiming(milliseconds) { byId('decodeTiming').textContent = `Last barcode decode: ${milliseconds} ms (this device)`; },
  onStop: dismissNotice,
  async onCodes(codes, readBags) {
    const result = codes.length === 1
      ? matchBarcode(codes[0], stops, readings)
      : { kind: 'check', code: 'Multiple barcodes', message: 'Show only one package label. Nothing was assigned.' };
    if (result.kind === 'duplicate') return;
    const key = JSON.stringify(codes);
    if (result.kind === 'check' && alerted.has(key)) return;
    if (result.kind === 'check') alerted.add(key);
    pending = result;
    const notice = result;
    const matched = result.kind === 'candidate';
    byId('matchTitle').textContent = matched ? 'Package found at stop' : 'Check this package';
    byId('matchStopNumber').hidden = !matched;
    byId('matchStopNumber').textContent = matched ? String(result.stop.number) : '';
    byId('matchCode').textContent = result.code;
    byId('matchPackageId').textContent = matched ? `Listed ID: ${result.packageId}` : '';
    byId('matchAddress').textContent = matched ? result.stop.address : 'Not assigned to any stop.';
    byId('bagFields').hidden = !matched;
    byId('bagNumber').value = byId('totalBags').value = '';
    byId('matchCount').textContent = '';
    byId('matchMessage').textContent = matched ? 'Reading bag count... You can also enter it from the label.' : result.message;
    byId('matchOkButton').textContent = matched ? 'Confirm & Resume' : 'OK - Resume';
    byId('matchOkButton').disabled = matched;
    cameraStatus.textContent = 'Barcode decoded. Scanning paused; nothing is counted until confirmation.';
    const acknowledgement = new Promise(resolve => { releaseNotice = resolve; });
    dialog.showModal();
    byId('matchTitle').focus({ preventScroll: true });
    const bagTask = matched ? (async () => {
      try {
        const text = await readBags();
        if (pending !== notice) return;
        const count = readBagCount(text);
        if (count.error) {
          byId('matchMessage').textContent = count.error;
        } else if (!byId('bagNumber').value && !byId('totalBags').value) {
          byId('bagNumber').value = String(count.bagNumber);
          byId('totalBags').value = String(count.totalBags);
          validateNotice();
        }
      } catch (error) {
        console.error('Bag-count OCR failed:', error);
        if (pending === notice) byId('matchMessage').textContent = 'Bag-count OCR failed. Enter the numbers from the label or rescan. ' + (error instanceof Error ? error.message : String(error));
      }
    })() : Promise.resolve();
    await Promise.all([acknowledgement, bagTask]);
  }
});

for (const id of ['step1Button', 'backButton']) byId(id).addEventListener('click', () => showStep(1));
for (const id of ['step2Button', 'nextButton']) byId(id).addEventListener('click', () => showStep(2));
byId('cameraButton').addEventListener('click', () => {
  if (cameraActive) camera.stop();
  else if (valid) { alerted.clear(); camera.start(); }
});
dialog.addEventListener('cancel', event => event.preventDefault());
for (const id of ['bagNumber', 'totalBags']) byId(id).addEventListener('input', validateNotice);
byId('rescanButton').addEventListener('click', () => {
  cameraStatus.textContent = 'Rescanning. This package was not counted.';
  dismissNotice();
});
byId('matchOkButton').addEventListener('click', () => {
  if (!pending) return;
  if (pending.kind === 'candidate') {
    const result = validateBagMatch(pending, Number(byId('bagNumber').value), Number(byId('totalBags').value), readings);
    if (result.kind !== 'match') { byId('matchMessage').textContent = result.message; return; }
    readings.set(result.packageId, result);
    renderProgress();
  }
  cameraStatus.textContent = 'Scanning Data Matrix / QR codes... Show one whole package label.';
  dismissNotice();
});
byId('resetProgressButton').addEventListener('click', () => {
  if (!confirm('Reset found-package progress? The list will be kept.')) return;
  readings.clear();
  alerted.clear();
  renderProgress();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) camera.stop('Camera stopped in the background. Open it again to resume.');
});
window.addEventListener('pagehide', () => camera.stop());
stopList.addEventListener('input', renderProgress);

function importMessage(text) {
  const item = document.createElement('li');
  item.textContent = text;
  byId('importMessages').append(item);
}

imageInput.addEventListener('change', async () => {
  const files = [...imageInput.files];
  if (!files.length || processing || cameraActive) return;
  if (readStopList(stopList.value).error) {
    status.textContent = 'Fix the list format before importing more screenshots. Your list was not changed.';
    imageInput.value = '';
    return;
  }
  processing = true;
  updateButtons();
  byId('importMessages').replaceChildren();
  let worker;
  let succeeded = 0;
  let failed = 0;
  try {
    if (!globalThis.Tesseract) throw new Error('Screenshot OCR could not load. Check your connection.');
    worker = await Tesseract.createWorker('eng');
    await worker.setParameters({ tessedit_pageseg_mode: '11' });
    for (const [index, file] of files.entries()) {
      status.textContent = `Reading screenshot ${index + 1}/${files.length}: ${file.name}`;
      let bitmap;
      try {
        if (file.type && !file.type.startsWith('image/')) throw new Error('Select an image file.');
        bitmap = await createImageBitmap(file);
        const scale = bitmap.width < 900 ? Math.min(3, 1200 / bitmap.width) : Math.min(1, 1800 / bitmap.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not prepare the screenshot.');
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const result = await worker.recognize(canvas);
        const updated = updateStopList(stopList.value, result.data.text);
        stopList.value = updated.text;
        succeeded++;
        if (!result.data.text.trim()) importMessage(`${file.name}: No readable text. Nothing added.`);
        for (const warning of updated.warnings) importMessage(`${file.name}: ${warning}`);
        renderProgress();
      } catch (error) {
        failed++;
        console.error('Screenshot import failed:', error);
        importMessage(`${file.name}: Failed - ${error instanceof Error ? error.message : String(error)}. Other screenshots and existing edits are kept.`);
      } finally {
        if (bitmap) bitmap.close();
      }
    }
    status.textContent = `Import finished: ${succeeded} image(s) read, ${failed} failed. Review the list and import notes, then continue to Step 2.`;
  } catch (error) {
    console.error('Screenshot import could not start:', error);
    status.textContent = 'Import error: ' + (error instanceof Error ? error.message : String(error)) + ' Your existing list was kept.';
  } finally {
    if (worker) {
      try { await worker.terminate(); }
      catch (error) {
        console.error('Screenshot OCR cleanup failed:', error);
        importMessage('OCR cleanup failed. Copy your list before reloading.');
      }
    }
    processing = false;
    imageInput.value = '';
    renderProgress();
  }
});

byId('clearButton').addEventListener('click', () => {
  if (!confirm('Clear the list and found-package progress?')) return;
  stopList.value = '';
  readings.clear();
  alerted.clear();
  byId('importMessages').replaceChildren();
  renderProgress();
});
byId('copyButton').addEventListener('click', async () => {
  try {
    if (!navigator.clipboard || !globalThis.isSecureContext) throw new Error('Clipboard requires HTTPS and browser permission.');
    await navigator.clipboard.writeText(stopList.value);
    status.textContent = 'List copied!';
  } catch (error) {
    console.error('Clipboard copy failed:', error);
    stopList.focus();
    stopList.select();
    stopList.setSelectionRange(0, stopList.value.length);
    status.textContent = 'Could not copy automatically. Touch and hold the selected list and choose Copy.';
  }
});
renderProgress();
