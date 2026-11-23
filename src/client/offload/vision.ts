import type { OffloadFrame, OffloadResult } from '@shared/types';

const W = 160, H = 284;
let detectorPromise: Promise<{ detectForVideo: (v: HTMLVideoElement, t: number) => Array<{ boundingBox: { x: number; y: number; width: number; height: number }; score: number }> } | null> | null = null;
let ocrPromise: Promise<{ recognize: (canvas: HTMLCanvasElement) => Promise<{ data: { text: string } }> } | null> | null = null;

async function getDetector() {
  if (!detectorPromise) detectorPromise = (async () => {
    try {
      const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const files = await FilesetResolver.forVisionTasks('/wasm');
      const d = await FaceDetector.createFromOptions(files, {
        baseOptions: { modelAssetPath: '/models/face_detector.tflite', delegate: 'GPU' },
        runningMode: 'VIDEO', minDetectionConfidence: .5,
      });
      return d as unknown as NonNullable<Awaited<typeof detectorPromise>>;
    } catch {
      try {
        const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
        const files = await FilesetResolver.forVisionTasks('/wasm');
        const d = await FaceDetector.createFromOptions(files, {
          baseOptions: { modelAssetPath: '/models/face_detector.tflite', delegate: 'CPU' }, runningMode: 'VIDEO',
        });
        return d as unknown as NonNullable<Awaited<typeof detectorPromise>>;
      } catch { return null; }
    }
  })();
  return detectorPromise;
}

async function getOcr() {
  if (!ocrPromise) ocrPromise = (async () => {
    try {
      const Tesseract = await import('tesseract.js');
      const worker = await Tesseract.createWorker('eng', 1, {
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
        workerPath: '/tesseract/worker.min.js',
        corePath: '/tesseract/tesseract-core-simd.wasm.js',
        logger: () => {},
      });
      return { recognize: (canvas: HTMLCanvasElement) => worker.recognize(canvas) };
    } catch { return null; }
  })();
  return ocrPromise;
}

function grayscale(data: Uint8ClampedArray) {
  const g = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) g[j] = (data[i]! * 77 + data[i + 1]! * 150 + data[i + 2]! * 29) >> 8;
  return g;
}

/** 64-bit perceptual hash via 8x8 DCT of the grayscale frame. */
function pHash(g: Uint8Array): string {
  const N = 32, vals: number[] = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    let s = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const px = g[(Math.floor(j * H / N) * W) + Math.floor(i * W / N)] ?? 0;
      s += px * Math.cos((2 * i + 1) * x * Math.PI / (2 * N)) * Math.cos((2 * j + 1) * y * Math.PI / (2 * N));
    }
    vals.push(s);
  }
  const med = [...vals].sort((a, b) => a - b)[32] ?? 0;
  return vals.map((v) => v > med ? '1' : '0').join('');
}

function stats(g: Uint8Array) {
  const region = (x0: number, y0: number, x1: number, y1: number) => {
    let s = 0, s2 = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const v = g[y * W + x] ?? 0; s += v; s2 += v * v; n++; }
    const m = s / Math.max(1, n);
    return { mean: m, variance: Math.max(0, s2 / Math.max(1, n) - m * m) / 65025 };
  };
  const corners = region(0, 0, Math.round(W * .28), Math.round(H * .12));
  const lower = region(0, Math.round(H * .74), Math.round(W * .6), Math.round(H * .9));
  const cornerBlob = region(0, 0, Math.round(W * .3), Math.round(H * .22));
  const bottom = region(8, H - 12, W - 8, H - 4).mean;
  const above = region(8, H - 32, W - 8, H - 20).mean;
  const right = region(W - 14, 40, W - 3, H - 60).mean;
  const left = region(3, 40, 14, H - 60).mean;
  // saliency: strongest local horizontal gradient in a coarse grid
  let bestX = .5, bestY = .5, best = -1;
  for (let y = 8; y < H - 8; y += 12) for (let x = 8; x < W - 8; x += 12) {
    let e = 0;
    for (let k = 0; k < 8; k++) e += Math.abs((g[y * W + x + k] ?? 0) - (g[y * W + x + k + 1] ?? 0));
    if (e > best) { best = e; bestX = x / W; bestY = y / H; }
  }
  return {
    roi: { corners: corners.variance, lowerThird: lower.variance, frameChange: 0, staticCorner: cornerBlob.variance < .004 ? .9 : .1 },
    chrome: {
      bottomBar: Math.min(1, Math.abs(bottom - above) / 90),
      rightRail: Math.min(1, Math.abs(right - left) / 90),
      handleChip: cornerBlob.variance > .01 ? .85 : .1,
    },
    bars: {
      letterbox: region(0, 0, W, 6).mean < 12 && region(0, H - 6, W, H).mean < 12 ? .14 : 0,
      pillarbox: region(0, 0, 6, H).mean < 12 && region(W - 6, 0, W, H).mean < 12 ? .14 : 0,
    },
    saliency: { x: bestX, y: bestY },
  };
}

export interface OffloadProgress { frame: number; total: number; phase: string }

/** Analyse a local video/blob in the browser at 2 fps and post measured results. */
export async function analyzeVideo(source: string | File, onProgress?: (p: OffloadProgress) => void, signal?: AbortSignal): Promise<OffloadResult> {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D unavailable');
  const video = document.createElement('video');
  video.preload = 'auto'; video.muted = true; video.playsInline = true; video.crossOrigin = 'anonymous';
  video.src = typeof source === 'string' ? source : URL.createObjectURL(source);
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Could not read the video in the browser'));
    setTimeout(() => reject(new Error('Video decode timed out')), 30_000);
  });
  const duration = video.duration;
  const total = Math.max(1, Math.min(600, Math.floor(duration * 2)));
  const [detector, ocr] = await Promise.all([getDetector(), getOcr()]);
  const frames: OffloadFrame[] = [];
  let prev: Uint8Array | null = null;
  let faceEngine = detector ? 'MediaPipe FaceDetector (browser)' : 'frame-diff saliency (fallback)';
  let ocrEngine = ocr ? 'tesseract.js (browser)' : 'unavailable — OCR skipped';

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) break;
    const t = Math.min(duration - .05, i / 2);
    video.currentTime = t;
    await new Promise<void>((resolve) => { video.onseeked = () => resolve(); setTimeout(resolve, 2000); });
    ctx.drawImage(video, 0, 0, W, H);
    const g = grayscale(ctx.getImageData(0, 0, W, H).data);
    const s = stats(g);
    let frameChange = 0;
    if (prev) { for (let j = 0; j < g.length; j++) frameChange += Math.abs(g[j]! - prev[j]!); frameChange = Math.min(1, frameChange / g.length / 255); }
    prev = g;

    let faces: OffloadFrame['faces'] = [];
    if (detector) {
      try {
        const res = detector.detectForVideo(video, performance.now());
        faces = res.map((f) => ({
          x: f.boundingBox.x / W, y: f.boundingBox.y / H,
          w: f.boundingBox.width / W, h: f.boundingBox.height / H, score: f.score,
        }));
      } catch { faceEngine = 'frame-diff saliency (fallback)'; }
    }
    let text: string[] = [];
    // OCR on every 6th frame keeps the main thread usable; stable across frames is
    // computed by the server from the sampled texts.
    if (ocr && i % 6 === 0) {
      try {
        const r = await ocr.recognize(canvas);
        text = r.data.text.split('\n').map((x) => x.trim()).filter((x) => x.length > 2).slice(0, 6);
      } catch { ocrEngine = 'unavailable — OCR skipped'; }
    }
    frames.push({ t, faces, ocr: text, phash: pHash(g), saliency: s.saliency, chrome: s.chrome, bars: s.bars, roi: { ...s.roi, frameChange } });
    if (i % 4 === 0) onProgress?.({ frame: i + 1, total, phase: 'Reading frames' });
  }
  if (typeof source !== 'string') URL.revokeObjectURL(video.src);
  return { frames, engine: detector || ocr ? 'browser' : 'fallback', faceEngine, ocrEngine };
}
