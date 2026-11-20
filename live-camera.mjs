import { prepareBarcodeReader, decodeBarcodeFrame } from './barcode.mjs?v=timer13';

export function createLiveCamera({ video, onCodes, onStatus, onActive, onStop, onTiming = () => {}, onEmpty = () => {} }) {
  let session;

  function release(current) {
    for (const track of current.stream?.getTracks() || []) track.stop();
    if (session !== current) return;
    video.pause();
    video.srcObject = null;
    session = null;
    onStop();
    onActive(false);
  }

  function stop(message = 'Camera stopped. You can edit the list or open the camera again.') {
    if (!session || session.cancelled) return;
    const current = session;
    current.cancelled = true;
    release(current);
    onStatus(message);
  }

  async function start() {
    if (session) return;
    const current = { cancelled: false, stream: null };
    session = current;
    onActive(true);
    try {
      if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Live camera requires HTTPS and a browser with camera support.');
      }
      onStatus('Loading Data Matrix / QR decoder...');
      await prepareBarcodeReader();
      if (current.cancelled) return;
      onStatus('Requesting rear camera access...');
      current.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      if (current.cancelled) return;
      for (const track of current.stream.getVideoTracks()) {
        track.addEventListener('ended', () => {
          if (session === current) stop('Camera disconnected. Open the camera again to retry.');
        }, { once: true });
      }
      video.srcObject = current.stream;
      await video.play();
      if (current.cancelled) return;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('This browser could not create a camera frame.');
      onStatus('Scanning Data Matrix / QR codes... Show one whole package label.');
      while (!current.cancelled) {
        if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
          const scale = Math.min(1, 1280 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const start = performance.now();
          const codes = await decodeBarcodeFrame(context.getImageData(0, 0, canvas.width, canvas.height));
          if (current.cancelled) break;
          onTiming(Math.round(performance.now() - start));
          if (codes.length) await onCodes(codes);
          else onEmpty();
        }
        if (!current.cancelled) await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      if (!current.cancelled) {
        console.error('Live camera failed:', error);
        const detail = error instanceof Error ? error.message : String(error);
        onStatus('Live camera error: ' + detail + ' Allow camera access in your browser settings, then retry. Your list and progress are kept.');
      }
    } finally {
      release(current);
    }
  }

  return { start, stop };
}
