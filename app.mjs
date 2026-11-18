import { readStopList, updateStopList, formatImportWarnings } from './stops.mjs?v=rows11';
import { getScanStops, matchBarcode, stopProgress, pruneReadings, getPackageNotice, isRunComplete, movedConfirmedPackage } from './packages.mjs?v=rows11';
import { createLiveCamera } from './live-camera.mjs?v=rows11';
import { packageKey } from './identity.mjs?v=rows11';
import { runStorageKey, serializeRun, parseSavedRun } from './saved-run.mjs?v=rows11';
import { screenshotText } from './ocr.mjs?v=rows11';

const byId = id => document.getElementById(id);
const stopList = byId('stopList');
const imageInput = byId('imageInput');
const status = byId('status');
const cameraStatus = byId('cameraStatus');
const dialog = byId('matchDialog');
const restoreDialog = byId('restoreDialog');
const themeButton = byId('themeButton');
const readings = new Set();
const alerted = new Set();
const shownStops = new Set();
let stops = [];
let valid = false;
let processing = false;
let importReports = [];
let cameraActive = false;
let pending;
let releaseNotice;
let acceptedText = '';
let acceptedStops = [];
let assignmentError = '';
let lastPresentedId = null;
let emptySince = null;
let awaitingRestore = true;
let savedRun = null;
let lastStoredValue = null;
let storageConflict = false;
let persistenceDisabled = false;

function storageStatus(message, failed = false) {
  const node = byId('saveStatus');
  if (node.textContent !== message) node.textContent = message;
  node.classList.toggle('storage-error', failed);
}

function savedRecordsChanged() {
  if (storageConflict) return;
  storageConflict = true;
  camera.stop('Camera stopped because saved records changed in another tab.');
  storageStatus('Another tab changed the saved records. Copy any unsaved edits, then reload this tab before continuing.', true);
  if (restoreDialog.open) {
    byId('restoreMessage').textContent = 'Another tab changed the saved records. Reload this tab to use the latest records.';
    byId('resumeRunButton').disabled = byId('clearSavedRunButton').disabled = true;
  }
  updateButtons();
}

function persistRun() {
  if (awaitingRestore || persistenceDisabled || storageConflict) return;
  try {
    if (localStorage.getItem(runStorageKey) !== lastStoredValue) {
      savedRecordsChanged();
      return;
    }
    const raw = stopList.value.trim() ? serializeRun(stopList.value, readings, shownStops, acceptedText) : null;
    if (raw !== lastStoredValue) {
      if (raw === null) localStorage.removeItem(runStorageKey);
      else localStorage.setItem(runStorageKey, raw);
      lastStoredValue = raw;
    }
    storageStatus(raw === null ? 'No saved package records.' : 'Saved on this device.');
  } catch (error) {
    console.error('Package records could not be saved:', error);
    storageStatus('Could not save or clear records on this device. Changes are kept only in this page; old records may return after reopening. Copy your list before closing.', true);
  }
}

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
  const busy = processing || cameraActive || awaitingRestore || storageConflict;
  imageInput.disabled = stopList.readOnly = busy;
  byId('copyButton').disabled = processing || cameraActive || awaitingRestore || !stopList.value.trim();
  byId('clearButton').disabled = busy || !stopList.value.trim();
  byId('nextButton').disabled = byId('step2Button').disabled = processing || awaitingRestore || storageConflict || !valid;
  byId('step1Button').disabled = byId('backButton').disabled = busy;
  byId('cameraButton').disabled = processing || awaitingRestore || storageConflict || (!cameraActive && !valid);
  byId('cameraButton').textContent = cameraActive ? 'Stop Camera' : 'Open Live Camera';
  byId('resetProgressButton').disabled = busy || (!readings.size && !shownStops.size);
}

function renderProgress() {
  let parsed = getScanStops(stopList.value);
  const moved = movedConfirmedPackage(acceptedStops, parsed.stops, readings);
  if (moved) {
    stopList.value = acceptedText;
    assignmentError = `Package ${moved.id} is confirmed at stop ${moved.from} and cannot move to stop ${moved.to}. Reset found-package progress first if the assignment needs correction. Your previous list was kept.`;
    parsed = getScanStops(stopList.value);
  }
  stops = parsed.stops;
  valid = !parsed.error;
  if (stops.length || !stopList.value.trim()) {
    const ambiguous = pruneReadings(stops, readings);
    if (ambiguous.length) assignmentError = `Saved confirmation for ${ambiguous.join(', ')} matches multiple package IDs. It was cleared; scan these packages again.`;
  }
  if (!stopList.value.trim()) {
    shownStops.clear();
    assignmentError = '';
  }
  if (stops.length || !stopList.value.trim()) {
    acceptedText = stopList.value;
    acceptedStops = stops;
  }
  byId('listError').textContent = assignmentError || (stopList.value.trim() ? parsed.error || '' : '');
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
      const found = readings.has(packageKey(id));
      item.textContent = id + (found ? ' - Found' : ' - Not found');
      if (found) item.className = 'found';
      list.append(item);
    }
    card.append(heading, summary, list);
    byId('stopProgress').append(card);
  }
  byId('completionStatus').hidden = !isRunComplete(stops, readings);
  renderImportMessages();
  updateButtons();
  persistRun();
}

function showStep(number) {
  if (processing || cameraActive || awaitingRestore || storageConflict) return;
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
  onStop() {
    lastPresentedId = null;
    emptySince = null;
    dismissNotice();
  },
  onEmpty() {
    if (emptySince === null) emptySince = performance.now();
    if (performance.now() - emptySince >= 500) lastPresentedId = null;
  },
  async onCodes(codes) {
    emptySince = null;
    const result = codes.length === 1
      ? matchBarcode(codes[0], stops, readings)
      : { kind: 'check', code: 'Multiple barcodes', message: 'Show only one package label. Nothing was assigned.' };
    if (result.kind === 'duplicate' && lastPresentedId === packageKey(result.packageId)) return;
    const key = JSON.stringify(codes);
    if (result.kind === 'check' && alerted.has(key)) return;
    if (result.kind === 'check') alerted.add(key);
    pending = result;
    const matched = result.kind === 'candidate' || result.kind === 'duplicate';
    const notice = matched ? getPackageNotice(result.stop, readings, shownStops, result.packageId) : null;
    byId('matchTitle').textContent = matched ? `${notice.isNew ? 'New stop' : 'Stop'} ${result.stop.number}` : 'Check this package';
    byId('matchTitle').classList.toggle('sr-only', matched);
    byId('matchNewBadge').hidden = !matched || !notice.isNew;
    byId('matchStopNumber').hidden = !matched;
    byId('matchStopNumber').textContent = matched ? String(result.stop.number) : '';
    byId('matchCode').textContent = result.code;
    byId('matchCount').textContent = matched ? notice.countLabel : '';
    const finishesRun = matched && isRunComplete(stops, readings, result.packageId);
    byId('matchCompleteMessage').hidden = !finishesRun;
    byId('matchCompleteMessage').textContent = finishesRun
      ? (isRunComplete(stops, readings) ? 'All packages scanned' : 'Last package - OK completes the run')
      : '';
    byId('matchMessage').textContent = matched ? '' : result.message;
    byId('matchOkButton').textContent = 'OK';
    byId('matchOkButton').setAttribute('aria-label', matched ? 'Confirm package and resume scanning' : 'Resume scanning');
    byId('matchOkButton').disabled = false;
    cameraStatus.textContent = result.kind === 'duplicate'
      ? 'This package is already counted. Scanning paused; OK resumes without changing progress.'
      : 'Barcode decoded. Scanning paused; nothing is counted until confirmation.';
    const acknowledgement = new Promise(resolve => { releaseNotice = resolve; });
    dialog.showModal();
    if (matched) {
      shownStops.add(result.stop.number);
      lastPresentedId = packageKey(result.packageId);
      persistRun();
    }
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
    if (valid && !storageConflict && !awaitingRestore) { alerted.clear(); camera.start(); }
  }
});
dialog.addEventListener('cancel', event => event.preventDefault());
byId('rescanButton').addEventListener('click', () => {
  cameraStatus.textContent = pending?.kind === 'duplicate'
    ? 'Rescanning. This package was already counted; progress is unchanged.'
    : 'Rescanning. This package was not counted.';
  dismissNotice();
});
byId('matchOkButton').addEventListener('click', () => {
  if (!pending) return;
  if (pending.kind === 'candidate' || pending.kind === 'duplicate') {
    const result = matchBarcode(pending.barcode, stops, readings);
    if (result.kind === 'check') {
      cameraStatus.textContent = result.message;
      dismissNotice();
      return;
    }
    if (result.kind === 'candidate') readings.add(packageKey(result.packageId));
    renderProgress();
    if (storageConflict) return;
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
window.addEventListener('storage', event => {
  if ((event.key === runStorageKey && event.newValue !== lastStoredValue) ||
      (event.key === null && lastStoredValue !== null)) savedRecordsChanged();
});
stopList.addEventListener('input', () => {
  if (stopList.value !== acceptedText) assignmentError = '';
  renderProgress();
});
stopList.addEventListener('change', renderProgress);

function importMessage(label, messages = []) {
  const item = document.createElement('li');
  const heading = document.createElement('strong');
  heading.textContent = label;
  item.append(heading);
  if (messages.length) {
    const list = document.createElement('ul');
    for (const message of new Set(messages)) {
      const detail = document.createElement('li');
      detail.textContent = message;
      list.append(detail);
    }
    item.append(list);
  }
  byId('importMessages').append(item);
}

function renderImportMessages() {
  byId('importMessages').replaceChildren();
  if (processing) return;
  for (const report of importReports) {
    importMessage(report.name, formatImportWarnings(report.result, stops));
  }
}

imageInput.addEventListener('change', async () => {
  const files = [...imageInput.files];
  if (!files.length || processing || cameraActive || awaitingRestore || storageConflict) return;
  importReports = [];
  renderImportMessages();
  if (readStopList(stopList.value).error) {
    status.textContent = 'No images processed. Fix the list format first.';
    imageInput.value = '';
    return;
  }
  processing = true;
  updateButtons();
  let worker;
  let succeeded = 0;
  let failed = 0;
  let reviewImages = 0;
  let startupFailed = false;
  let cleanupFailed = false;
  const imageCount = count => `${count} image${count === 1 ? '' : 's'}`;
  status.textContent = `Processing ${imageCount(files.length)}...`;
  try {
    if (!globalThis.Tesseract) throw new Error('Screenshot OCR could not load. Check your connection.');
    worker = await Tesseract.createWorker('eng');
    await worker.setParameters({ tessedit_pageseg_mode: '11' });
    for (const [index, file] of files.entries()) {
      if (storageConflict) {
        break;
      }
      status.textContent = `Processing image ${index + 1} of ${files.length}...`;
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
        if (storageConflict) {
          break;
        }
        const text = screenshotText(result.data);
        const updated = updateStopList(stopList.value, text);
        stopList.value = updated.text;
        succeeded++;
        const issues = text.trim() ? updated.warnings : ['No stops or packages detected. Try a clearer image.'];
        if (issues.length) {
          reviewImages++;
          importReports.push({ name: file.name, result: { warnings: issues, unreadableRows: updated.unreadableRows } });
        }
        renderProgress();
      } catch (error) {
        failed++;
        reviewImages++;
        console.error('Screenshot import failed:', error);
        const message = file.type && !file.type.startsWith('image/')
          ? 'Not an image. Choose a screenshot.'
          : 'Could not read image. Try again or choose another screenshot.';
        importReports.push({ name: file.name, result: { warnings: [message] } });
      } finally {
        if (bitmap) bitmap.close();
      }
    }
  } catch (error) {
    startupFailed = true;
    console.error('Screenshot import could not start:', error);
  } finally {
    if (worker) {
      try { await worker.terminate(); }
      catch (error) {
        cleanupFailed = true;
        console.error('Screenshot OCR cleanup failed:', error);
      }
    }
    processing = false;
    imageInput.value = '';
    renderProgress();
    if (startupFailed) {
      status.textContent = 'No images processed. Could not start the screenshot reader. Try again.';
    } else if (storageConflict) {
      status.textContent = `${succeeded}/${files.length} images processed. Reload to continue.`;
      const remaining = files.slice(succeeded + failed);
      if (remaining.length) importMessage('Not processed', remaining.map(file => file.name));
    } else {
      const completed = succeeded === files.length
        ? `${files.length > 1 ? 'All ' : ''}${imageCount(files.length)} processed.`
        : `${succeeded}/${files.length} images processed.`;
      let result = reviewImages
        ? `${imageCount(reviewImages)} ${reviewImages === 1 ? 'needs' : 'need'} review below.`
        : 'No detection issues found.';
      if (cleanupFailed) result = `${reviewImages ? result + ' ' : ''}Reader could not close. Reload before importing again.`;
      status.textContent = `${completed} ${result}`;
    }
  }
});

byId('clearButton').addEventListener('click', () => {
  if (!confirm('Clear the list and found-package progress?')) return;
  stopList.value = '';
  readings.clear();
  alerted.clear();
  shownStops.clear();
  importReports = [];
  status.textContent = '';
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

restoreDialog.addEventListener('cancel', event => event.preventDefault());
byId('resumeRunButton').addEventListener('click', () => {
  if (!savedRun || storageConflict) return;
  stopList.value = savedRun.list;
  acceptedText = savedRun.acceptedList;
  acceptedStops = getScanStops(acceptedText).stops;
  for (const id of savedRun.readings) readings.add(packageKey(id));
  for (const number of savedRun.shownStops) shownStops.add(number);
  savedRun = null;
  awaitingRestore = false;
  restoreDialog.close();
  showStep(2);
});
byId('clearSavedRunButton').addEventListener('click', () => {
  if (storageConflict) return;
  try {
    if (localStorage.getItem(runStorageKey) !== lastStoredValue) {
      savedRecordsChanged();
      return;
    }
    localStorage.removeItem(runStorageKey);
  } catch (error) {
    console.error('Saved package records could not be cleared:', error);
    byId('restoreMessage').textContent = 'Could not clear the saved records. They have been kept. Allow browser storage and try again.';
    return;
  }
  savedRun = null;
  lastStoredValue = null;
  awaitingRestore = false;
  restoreDialog.close();
  renderProgress();
});

function initializeSavedRun() {
  try {
    lastStoredValue = localStorage.getItem(runStorageKey);
  } catch (error) {
    console.error('Saved package records could not be read:', error);
    persistenceDisabled = true;
    awaitingRestore = false;
    storageStatus('Browser storage is unavailable. Records are kept only in this page. Copy your list before closing.', true);
    renderProgress();
    return;
  }
  if (lastStoredValue !== null) {
    try {
      savedRun = parseSavedRun(lastStoredValue);
    } catch (error) {
      console.error('Saved package records are invalid:', error);
      byId('restoreTitle').textContent = 'Saved records need attention';
      byId('restoreMessage').textContent = 'Saved records could not be loaded. They have not been changed. Clear them to start a new run.';
      byId('resumeRunButton').disabled = true;
    }
    renderProgress();
    restoreDialog.showModal();
  } else {
    awaitingRestore = false;
    renderProgress();
  }
}

initializeSavedRun();
