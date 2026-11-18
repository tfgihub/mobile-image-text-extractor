import { readStopList, updateStopList } from './stops.mjs?v=badge7';
import { getScanStops, matchBarcode, stopProgress, pruneReadings, getPackageNotice } from './packages.mjs?v=badge7';
import { createLiveCamera } from './live-camera.mjs?v=badge7';

const byId = id => document.getElementById(id);
const stopList = byId('stopList');
const imageInput = byId('imageInput');
const status = byId('status');
const cameraStatus = byId('cameraStatus');
const dialog = byId('matchDialog');
const themeButton = byId('themeButton');
const readings = new Set();
const alerted = new Set();
const shownStops = new Set();
let stops = [];
let valid = false;
let processing = false;
let cameraActive = false;
let pending;
let releaseNotice;

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const action = theme === 'dark' ? 'Switch to white theme' : 'Switch to black theme';
  themeButton.setAttribute('aria-label', action);
  themeButton.title = action;
  document.querySelector('meta[name="theme-color"]').content =
    getComputedStyle(document.documentElement).getPropertyValue('--page').trim();
}

applyTheme(document.documentElement.dataset.theme);
themeButton.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(theme);
  try {
    localStorage.setItem('package-sort-theme', theme);
  } catch (error) {
    console.warn('Theme changed for this page, but the preference could not be saved.', error);
  }
});

function updateButtons() {
  const busy = processing || cameraActive;
  imageInput.disabled = stopList.readOnly = busy;
  byId('copyButton').disabled = byId('clearButton').disabled = busy || !stopList.value.trim();
  byId('nextButton').disabled = byId('step2Button').disabled = processing || !valid;
  byId('step1Button').disabled = byId('backButton').disabled = busy;
  byId('cameraButton').disabled = processing || (!cameraActive && !valid);
  byId('cameraButton').textContent = cameraActive ? 'Stop Camera' : 'Open Live Camera';
  byId('resetProgressButton').disabled = busy || (!readings.size && !shownStops.size);
}

function renderProgress() {
  const parsed = getScanStops(stopList.value);
  stops = parsed.stops;
  valid = !parsed.error;
  if (stops.length || !stopList.value.trim()) pruneReadings(stops, readings);
  if (!stopList.value.trim()) shownStops.clear();
  byId('listError').textContent = stopList.value.trim() ? parsed.error || '' : '';
  byId('stopProgress').replaceChildren();
  for (const stop of stops) {
    const progress = stopProgress(stop, readings);
    const card = document.createElement('div');
    card.className = 'stop-card' + (progress.complete ? ' complete' : '');
    const heading = document.createElement('h3');
    heading.textContent = `Stop ${stop.number}: ${stop.address}`;
    const summary = document.createElement('p');
    summary.textContent = progress.total
      ? `${progress.count}/${progress.total} bags scanned` + (progress.complete ? ' - Complete' : '')
      : 'No packages listed - skipped while scanning.';
    const list = document.createElement('ul');
    for (const id of stop.packages) {
      const item = document.createElement('li');
      const found = readings.has(id);
      item.textContent = id + (found ? ' - Found' : ' - Not found');
      if (found) item.className = 'found';
      list.append(item);
    }
    card.append(heading, summary, list);
    byId('stopProgress').append(card);
  }
  updateButtons();
}

function showStep(number) {
  if (processing || cameraActive) return;
  renderProgress();
  if (number === 2 && !valid) return;
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
  async onCodes(codes) {
    const result = codes.length === 1
      ? matchBarcode(codes[0], stops, readings)
      : { kind: 'check', code: 'Multiple barcodes', message: 'Show only one package label. Nothing was assigned.' };
    if (result.kind === 'duplicate') return;
    const key = JSON.stringify(codes);
    if (result.kind === 'check' && alerted.has(key)) return;
    if (result.kind === 'check') alerted.add(key);
    pending = result;
    const matched = result.kind === 'candidate';
    const notice = matched ? getPackageNotice(result.stop, readings, shownStops) : null;
    byId('matchTitle').textContent = matched ? `${notice.isNew ? 'New stop' : 'Stop'} ${result.stop.number}` : 'Check this package';
    byId('matchTitle').classList.toggle('sr-only', matched);
    byId('matchNewBadge').hidden = !matched || !notice.isNew;
    byId('matchStopNumber').hidden = !matched;
    byId('matchStopNumber').textContent = matched ? String(result.stop.number) : '';
    byId('matchCode').textContent = result.code;
    byId('matchCount').textContent = matched ? notice.countLabel : '';
    byId('matchMessage').textContent = matched ? '' : result.message;
    byId('matchOkButton').textContent = 'OK';
    byId('matchOkButton').setAttribute('aria-label', matched ? 'Confirm package and resume scanning' : 'Resume scanning');
    byId('matchOkButton').disabled = false;
    cameraStatus.textContent = 'Barcode decoded. Scanning paused; nothing is counted until confirmation.';
    const acknowledgement = new Promise(resolve => { releaseNotice = resolve; });
    dialog.showModal();
    if (matched) shownStops.add(result.stop.number);
    byId('matchTitle').focus({ preventScroll: true });
    await acknowledgement;
  }
});

for (const id of ['step1Button', 'backButton']) byId(id).addEventListener('click', () => showStep(1));
for (const id of ['step2Button', 'nextButton']) byId(id).addEventListener('click', () => showStep(2));
byId('cameraButton').addEventListener('click', () => {
  if (cameraActive) camera.stop();
  else {
    renderProgress();
    if (valid) { alerted.clear(); camera.start(); }
  }
});
dialog.addEventListener('cancel', event => event.preventDefault());
byId('rescanButton').addEventListener('click', () => {
  cameraStatus.textContent = 'Rescanning. This package was not counted.';
  dismissNotice();
});
byId('matchOkButton').addEventListener('click', () => {
  if (!pending) return;
  if (pending.kind === 'candidate') {
    const result = matchBarcode(pending.barcode, stops, readings);
    if (result.kind === 'check') {
      cameraStatus.textContent = result.message;
      dismissNotice();
      return;
    }
    if (result.kind === 'candidate') readings.add(result.packageId);
    renderProgress();
  }
  cameraStatus.textContent = 'Scanning Data Matrix / QR codes... Show one whole package label.';
  dismissNotice();
});
byId('resetProgressButton').addEventListener('click', () => {
  if (!confirm('Reset found-package progress? The list will be kept.')) return;
  readings.clear();
  alerted.clear();
  shownStops.clear();
  renderProgress();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) camera.stop('Camera stopped in the background. Open it again to resume.');
});
window.addEventListener('pagehide', () => camera.stop());
stopList.addEventListener('input', renderProgress);
stopList.addEventListener('change', renderProgress);

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
  shownStops.clear();
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
