export function createLiveCamera({ video, onText, onStatus, onActive, onStop }) {
  let session;

  function stop(message = 'Camera stopped. You can edit the list or open the camera again.') {
    if (!session || session.cancelled) return;
    session.cancelled = true;
    for (const track of session.stream?.getTracks() || []) track.stop();
    video.pause();
    onStop();
    onStatus(message);
  }

  async function start() {
    if (session) return;
    const current = { cancelled: false, stream: null, worker: null };
    session = current;
    onActive(true);
    try {
      if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Live camera requires HTTPS and a browser with camera support.');
      }
      if (!globalThis.Tesseract) {
        throw new Error('OCR could not load. Check your internet connection. Copy your list before reloading.');
      }
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
      onStatus('Loading live OCR... The first start downloads English language data.');
      current.worker = await Tesseract.createWorker('eng');
      if (current.cancelled) return;
      await current.worker.setParameters({ tessedit_pageseg_mode: '11' });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser could not create a camera frame.');
      onStatus('Scanning full package IDs... Hold the printed ID steady and in focus.');
      while (!current.cancelled) {
        if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
          const scale = Math.min(1, 1600 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const result = await current.worker.recognize(canvas);
          if (current.cancelled) break;
          await onText(result.data.text);
        }
        if (!current.cancelled) await new Promise(resolve => setTimeout(resolve, 350));
      }
    } catch (error) {
      if (!current.cancelled) {
        console.error('Live camera failed:', error);
        const detail = error instanceof Error ? error.message : String(error);
        onStatus('Live camera error: ' + detail + ' Allow camera access in your browser settings, then retry. Your list and progress are kept.');
      }
    } finally {
      for (const track of current.stream?.getTracks() || []) track.stop();
      video.pause();
      video.srcObject = null;
      onStop();
      if (current.worker) {
        try {
          await current.worker.terminate();
        } catch (error) {
          console.error('Live OCR cleanup failed:', error);
          onStatus('Live OCR cleanup failed. Copy your list before reloading; progress will reset on reload.');
        }
      }
      session = null;
      onActive(false);
    }
  }

  return { start, stop };
}
