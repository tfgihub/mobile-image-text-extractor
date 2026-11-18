import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveCamera } from './live-camera.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function setup(t, overrides = {}) {
  const track = { stopped: false, stop() { this.stopped = true; }, addEventListener(name, fn) { this[name] = fn; } };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  let ocrWorkers = 0;
  const video = { readyState: 4, videoWidth: 1000, videoHeight: 500, async play() {}, pause() {}, srcObject: null };
  let decodes = 0;
  const globals = {
    isSecureContext: true,
    navigator: { mediaDevices: { getUserMedia: async () => stream } },
    document: { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({}) }) }) },
    Tesseract: { createWorker() { ocrWorkers++; throw new Error('Camera OCR must not run'); } },
    ZXingWASM: {
      async prepareZXingModule() {},
      async readBarcodes() { decodes++; return [{ text: 'trackingAB12', isValid: true }]; }
    },
    ...overrides
  };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    });
  }
  const messages = [];
  const active = [];
  return {
    track, stream, video, messages, active, decodes: () => decodes, ocrWorkers: () => ocrWorkers,
    options: { video, onCodes: async () => {}, onStatus: message => messages.push(message), onActive: value => active.push(value), onStop() {} }
  };
}

test('barcode detection pauses for confirmation, then resumes; no package ID OCR runs', async t => {
  const env = setup(t);
  const first = deferred();
  const acknowledge = deferred();
  let camera;
  env.options.onCodes = async codes => {
    assert.deepEqual(codes, ['trackingAB12']);
    if (env.decodes() === 1) { first.resolve(); await acknowledge.promise; }
    else camera.stop();
  };
  camera = createLiveCamera(env.options);
  const running = camera.start();
  await first.promise;
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(env.decodes(), 1);
  assert.equal(env.ocrWorkers(), 0);
  acknowledge.resolve();
  await running;
  assert.equal(env.decodes(), 2);
  assert.equal(env.track.stopped, true);
  assert.deepEqual(env.active, [true, false]);
});

test('barcode camera works without Tesseract and never offers a bag-OCR callback', async t => {
  const env = setup(t, { Tesseract: undefined });
  let camera;
  env.options.onCodes = async (...args) => {
    assert.deepEqual(args, [['trackingAB12']]);
    camera.stop();
  };
  camera = createLiveCamera(env.options);
  await camera.start();
  assert.equal(env.ocrWorkers(), 0);
  assert.equal(env.track.stopped, true);
});

test('stopping during pending permission releases the late camera stream', async t => {
  const permission = deferred();
  const requested = deferred();
  const env = setup(t, { navigator: { mediaDevices: { getUserMedia() { requested.resolve(); return permission.promise; } } } });
  const camera = createLiveCamera(env.options);
  const running = camera.start();
  await requested.promise;
  camera.stop();
  permission.resolve(env.stream);
  await running;
  assert.equal(env.track.stopped, true);
  assert.equal(env.decodes(), 0);
});

test('permission and decoder errors are explicit and release the camera', async t => {
  const env = setup(t);
  t.mock.method(console, 'error', () => {});
  navigator.mediaDevices.getUserMedia = async () => { throw new Error('Permission denied'); };
  await createLiveCamera(env.options).start();
  assert.match(env.messages.at(-1), /Permission denied/);
  navigator.mediaDevices.getUserMedia = async () => env.stream;
  ZXingWASM.readBarcodes = async () => { throw new Error('Decoder failed'); };
  await createLiveCamera(env.options).start();
  assert.match(env.messages.at(-1), /Decoder failed/);
  assert.equal(env.track.stopped, true);
  assert.equal(env.active.at(-1), false);
});

test('disconnection dismisses a paused notice and releases resources', async t => {
  const env = setup(t);
  const first = deferred();
  const acknowledge = deferred();
  env.options.onCodes = async () => { first.resolve(); await acknowledge.promise; };
  env.options.onStop = () => acknowledge.resolve();
  const camera = createLiveCamera(env.options);
  const running = camera.start();
  await first.promise;
  env.track.ended();
  await running;
  assert.equal(env.track.stopped, true);
  assert.match(env.messages.at(-1), /disconnected/);
});

test('insecure pages never request the camera', async t => {
  const env = setup(t, { isSecureContext: false });
  let requested = false;
  navigator.mediaDevices.getUserMedia = async () => { requested = true; return env.stream; };
  t.mock.method(console, 'error', () => {});
  await createLiveCamera(env.options).start();
  assert.equal(requested, false);
  assert.match(env.messages.at(-1), /requires HTTPS/);
});
