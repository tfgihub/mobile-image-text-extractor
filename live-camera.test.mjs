import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveCamera } from './live-camera.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function setup(t, overrides = {}) {
  const track = {
    stopped: false,
    stop() { this.stopped = true; },
    addEventListener(name, handler) { this[name] = handler; }
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const worker = {
    calls: 0,
    terminated: false,
    async setParameters() {},
    async recognize() { this.calls++; return { data: { text: 'spExampleABC' } }; },
    async terminate() { this.terminated = true; }
  };
  const video = { readyState: 4, videoWidth: 1000, videoHeight: 500, async play() {}, pause() {}, srcObject: null };
  const globals = {
    isSecureContext: true,
    navigator: { mediaDevices: { getUserMedia: async () => stream } },
    document: { createElement: () => ({ getContext: () => ({ drawImage() {} }) }) },
    Tesseract: { createWorker: async () => worker },
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
  const options = {
    video,
    onText: async () => {},
    onStatus: message => messages.push(message),
    onActive: value => active.push(value),
    onStop: () => {}
  };
  return { track, stream, worker, video, messages, active, options };
}

test('OCR waits for acknowledgement, resumes sequentially, and cleans up on stop', async t => {
  const env = setup(t);
  const firstFrame = deferred();
  const acknowledge = deferred();
  let camera;
  env.options.onText = async () => {
    if (env.worker.calls === 1) {
      firstFrame.resolve();
      await acknowledge.promise;
    } else {
      camera.stop();
    }
  };
  camera = createLiveCamera(env.options);
  const running = camera.start();
  await firstFrame.promise;
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(env.worker.calls, 1);
  acknowledge.resolve();
  await running;
  assert.equal(env.worker.calls, 2);
  assert.equal(env.worker.terminated, true);
  assert.equal(env.track.stopped, true);
  assert.equal(env.video.srcObject, null);
  assert.deepEqual(env.active, [true, false]);
});

test('stopping while camera permission is pending releases a late stream without starting OCR', async t => {
  const permission = deferred();
  const env = setup(t, { navigator: { mediaDevices: { getUserMedia: () => permission.promise } } });
  const camera = createLiveCamera(env.options);
  const running = camera.start();
  camera.stop();
  permission.resolve(env.stream);
  await running;
  assert.equal(env.track.stopped, true);
  assert.equal(env.worker.calls, 0);
  assert.deepEqual(env.active, [true, false]);
});

test('stopping while the OCR worker loads cleans up the late worker', async t => {
  const loading = deferred();
  const started = deferred();
  const env = setup(t, { Tesseract: { createWorker() { started.resolve(); return loading.promise; } } });
  const camera = createLiveCamera(env.options);
  const running = camera.start();
  await started.promise;
  camera.stop();
  loading.resolve(env.worker);
  await running;
  assert.equal(env.worker.calls, 0);
  assert.equal(env.worker.terminated, true);
  assert.equal(env.track.stopped, true);
});

test('permission failures are visible and do not leave the UI active', async t => {
  const env = setup(t, { navigator: { mediaDevices: { getUserMedia: async () => { throw new Error('Permission denied'); } } } });
  t.mock.method(console, 'error', () => {});
  await createLiveCamera(env.options).start();
  assert.match(env.messages.at(-1), /Permission denied/);
  assert.deepEqual(env.active, [true, false]);
  assert.equal(env.worker.calls, 0);
});

test('camera disconnection dismisses a paused notice and releases resources', async t => {
  const env = setup(t);
  const firstFrame = deferred();
  const acknowledge = deferred();
  env.options.onText = async () => { firstFrame.resolve(); await acknowledge.promise; };
  env.options.onStop = () => acknowledge.resolve();
  const camera = createLiveCamera(env.options);
  const running = camera.start();
  await firstFrame.promise;
  env.track.ended();
  await running;
  assert.equal(env.track.stopped, true);
  assert.equal(env.worker.terminated, true);
  assert.match(env.messages.at(-1), /disconnected/);
});

test('recognition errors release the camera and report an explicit failure', async t => {
  const env = setup(t);
  env.worker.recognize = async () => { throw new Error('Recognition failed'); };
  t.mock.method(console, 'error', () => {});
  await createLiveCamera(env.options).start();
  assert.equal(env.track.stopped, true);
  assert.equal(env.worker.terminated, true);
  assert.match(env.messages.at(-1), /Recognition failed/);
  assert.deepEqual(env.active, [true, false]);
});

test('insecure pages reject live scanning without requesting camera access', async t => {
  const env = setup(t, { isSecureContext: false });
  let requested = false;
  navigator.mediaDevices.getUserMedia = async () => { requested = true; return env.stream; };
  t.mock.method(console, 'error', () => {});
  await createLiveCamera(env.options).start();
  assert.equal(requested, false);
  assert.match(env.messages.at(-1), /requires HTTPS/);
  assert.deepEqual(env.active, [true, false]);
});
