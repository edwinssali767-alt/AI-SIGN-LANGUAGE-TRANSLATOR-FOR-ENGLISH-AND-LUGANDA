// Offline hand-sign recognizer. Runs entirely in the browser: MediaPipe Hand Landmarker (vendored)
// -> normalised landmarks (SLCore) -> small MLP (JSON weights) -> majority-vote smoothing.
// Nothing is uploaded and no video is stored. Requires sl-core.js.
(function () {
    const VENDOR = '/vendor/mediapipe';
    const HAND_MODEL = '/models/hand_landmarker.task';
    const GESTURE_MODEL = '/models/gesture-mlp.json';

    // The model published from the admin page lives in the database (/api/landmark-model); a copy is kept
    // on this device so recognition still works offline. /models/gesture-mlp.json is the file-based fallback
    // used when training is run with training/train_landmarks.py.
    const MODEL_CACHE_KEY = 'sl_sign_model_v1';
    async function fetchModel(url) {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) return null;
        const data = await res.json();
        return data && Array.isArray(data.layers) && Array.isArray(data.labels) ? data : null;
    }
    async function loadSignModel() {
        for (const url of ['/api/landmark-model', GESTURE_MODEL]) {
            try {
                const model = await fetchModel(url);
                if (model) {
                    try { localStorage.setItem(MODEL_CACHE_KEY, JSON.stringify(model)); } catch (e) { /* storage full or blocked */ }
                    return model;
                }
            } catch (e) { /* offline or blocked: try the next source */ }
        }
        try { return JSON.parse(localStorage.getItem(MODEL_CACHE_KEY) || 'null'); } catch (e) { return null; }
    }

    class SLRecognizer {
        // opts: video, fps (default 15; use ~8 on low-end phones), overlay (canvas, optional),
        //       onFrame({hasHand, quality, prediction}), onStatus(text, kind)
        constructor(opts) {
            this.video = opts.video;
            this.fps = opts.fps || 15;
            this.overlay = opts.overlay || null;
            this.onFrame = opts.onFrame || (() => {});
            this.onStatus = opts.onStatus || (() => {});
            this.smoother = new SLCore.PredictionSmoother();
            this.landmarker = null;
            this.model = null;
            this.running = false;
            this._timer = null;
            this._lastVideoTime = -1;
            // Every frame is resized to the same box so all cameras feed the tracker alike: 640x480 by default.
            // On a device that cannot keep up it steps down (480x360, 320x240) rather than lag.
            this._sizes = [[640, 480], [480, 360], [320, 240]];
            this._sizeIdx = 0;
            this._avgMs = 0;
            this._work = document.createElement('canvas');
            this._ctx = null;
            this._applySize();
            this._listeners = [];
        }

        // Lazy: only downloads the engine the first time it is needed.
        async load() {
            if (this.landmarker) return;
            this.onStatus('Loading hand tracker...', 'loading');
            const vision = await import(VENDOR + '/vision_bundle.mjs');
            const fileset = await vision.FilesetResolver.forVisionTasks(VENDOR);
            const base = { modelAssetPath: HAND_MODEL };
            try {
                this.landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
                    baseOptions: { ...base, delegate: 'GPU' }, runningMode: 'VIDEO', numHands: 1,
                });
            } catch (e) {
                this.landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
                    baseOptions: { ...base, delegate: 'CPU' }, runningMode: 'VIDEO', numHands: 1,
                });
            }
            this.model = await loadSignModel();
            // The first detection compiles WebAssembly and takes seconds: do it now, behind the loading message,
            // instead of freezing on the first sign.
            this.onStatus('Warming up...', 'loading');
            try { this.landmarker.detectForVideo(this._work, performance.now()); } catch (e) { /* warm-up only */ }
            this.onStatus(this.model ? 'Ready' : 'Hand tracker ready, but no trained sign model yet.', this.model ? 'ok' : 'warn');
        }

        _applySize() {
            const [w, h] = this._sizes[this._sizeIdx];
            this._work.width = w;
            this._work.height = h;
            this._ctx = this._work.getContext('2d', { willReadFrequently: true });
        }

        get frameSize() { return this._sizes[this._sizeIdx].join('x'); }

        // Called with how long one analysed frame took. Steps the size down when frames are too slow.
        _adapt(ms) {
            // Stability is measured in time, not frames: about 0.6 s of agreement, so a slow device is not
            // asked to hold a sign for many seconds. 10 fps -> 6 frames (the default), 1.6 fps -> 2 frames.
            const now = performance.now();
            if (this._lastFrameAt) {
                const interval = now - this._lastFrameAt;
                this._avgInterval = this._avgInterval ? this._avgInterval * 0.8 + interval * 0.2 : interval;
                const fps = 1000 / this._avgInterval;
                this.smoother.minVotes = Math.max(2, Math.min(6, Math.round(fps * 0.6)));
            }
            this._lastFrameAt = now;
            this._avgMs = this._avgMs ? this._avgMs * 0.8 + ms * 0.2 : ms;
            this._seen = (this._seen || 0) + 1;
            if (this._seen >= 5 && this._avgMs > 220 && this._sizeIdx < this._sizes.length - 1) {
                this._sizeIdx++;
                this._applySize();
                this._avgMs = 0;
                this._seen = 0;
                this.onStatus('This device is slow, so the camera view was reduced to ' + this.frameSize + '.', 'warn');
            }
        }

        get hasModel() { return !!this.model; }

        start() {
            if (this.running) return;
            this.running = true;
            this.smoother.reset();
            this._lastVideoTime = -1;
            this._lastFrameAt = 0;
            this._avgInterval = 0;
            const loop = () => {
                if (!this.running) return;
                this._tick();
                this._timer = setTimeout(loop, 1000 / this.fps);
            };
            loop();
        }

        stop() {
            this.running = false;
            clearTimeout(this._timer);
            this._clearOverlay();
        }

        // One processed frame. Returns {hasHand, raw (63 numbers or null), normalized, quality}.
        _analyse() {
            const v = this.video;
            if (!v || v.readyState < 2 || !v.videoWidth) return null;
            if (v.currentTime === this._lastVideoTime) return null; // no new frame yet
            this._lastVideoTime = v.currentTime;

            // Every frame is resized to fit 640x480 so all cameras feed the tracker the same size.
            const W = this._work.width, H = this._work.height;
            const fit = SLCore.fitToBox(v.videoWidth, v.videoHeight, W, H);
            this._ctx.fillStyle = '#000';
            this._ctx.fillRect(0, 0, W, H);
            const dx = (W - fit.width) / 2;
            const dy = (H - fit.height) / 2;
            this._ctx.drawImage(v, dx, dy, fit.width, fit.height);

            const brightness = this._brightness();
            const result = this.landmarker.detectForVideo(this._work, performance.now());
            const lm = result.landmarks && result.landmarks[0] ? result.landmarks[0] : null;
            // Convert from the letterboxed canvas back to the video's own 0-1 coordinates.
            const pts = lm ? lm.map(p => ({
                x: (p.x * W - dx) / fit.width,
                y: (p.y * H - dy) / fit.height,
                z: p.z,
            })) : null;
            const quality = SLCore.assessQuality(brightness, pts);
            this._draw(pts, quality.ok);
            return {
                hasHand: !!pts,
                quality,
                points: pts,
                raw: pts ? pts.flatMap(p => [p.x, p.y, p.z]) : null,
                normalized: pts ? SLCore.normalizeLandmarks(pts) : null,
            };
        }

        // Mean brightness (0-255) from a 32x24 thumbnail: cheap enough for low-end phones.
        _brightness() {
            if (!this._thumb) {
                this._thumb = document.createElement('canvas');
                this._thumb.width = 32;
                this._thumb.height = 24;
                this._thumbCtx = this._thumb.getContext('2d', { willReadFrequently: true });
            }
            this._thumbCtx.drawImage(this.video, 0, 0, 32, 24);
            const d = this._thumbCtx.getImageData(0, 0, 32, 24).data;
            let sum = 0;
            for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            return sum / (d.length / 4);
        }

        _tick() {
            let a;
            const t0 = performance.now();
            try { a = this._analyse(); } catch (e) { this.onStatus('Recognition error: ' + e.message, 'error'); return; }
            if (!a) return;
            this._adapt(performance.now() - t0);
            let prediction;
            if (!a.hasHand) {
                prediction = this.smoother.push(null);
            } else if (!a.quality.ok || !a.normalized || !this.model) {
                prediction = { state: 'unknown', label: null, confidence: 0 };
            } else {
                const p = SLCore.mlpPredict(this.model, a.normalized);
                prediction = this.smoother.push({ label: p.label, confidence: p.confidence });
            }
            this.onFrame({ hasHand: a.hasHand, quality: a.quality, prediction });
        }

        // Record `count` frames that contain a hand (for the admin page). Resolves with raw 63-vectors.
        captureSequence(count = 30, onProgress = () => {}, timeoutMs = 15000) {
            return new Promise((resolve, reject) => {
                const frames = [];
                const t0 = performance.now();
                const step = () => {
                    if (frames.length >= count) return resolve(frames);
                    if (performance.now() - t0 > timeoutMs) return reject(new Error('Hand not visible long enough. Try again.'));
                    let a = null;
                    try { a = this._analyse(); } catch (e) { return reject(e); }
                    if (a && a.raw && a.quality.ok) {
                        frames.push(a.raw);
                        onProgress(frames.length, count);
                    } else if (a) {
                        onProgress(frames.length, count, a.quality.hint);
                    }
                    setTimeout(step, 1000 / this.fps);
                };
                step();
            });
        }

        _draw(pts, ok) {
            const c = this.overlay;
            if (!c) return;
            const w = this.video.clientWidth, h = this.video.clientHeight;
            if (c.width !== w) c.width = w;
            if (c.height !== h) c.height = h;
            const g = c.getContext('2d');
            g.clearRect(0, 0, c.width, c.height);
            if (!pts) return;
            g.fillStyle = ok ? '#2ecc71' : '#f39c12';
            for (const p of pts) {
                g.beginPath();
                g.arc(p.x * c.width, p.y * c.height, 3, 0, Math.PI * 2);
                g.fill();
            }
        }

        _clearOverlay() {
            if (this.overlay) this.overlay.getContext('2d').clearRect(0, 0, this.overlay.width, this.overlay.height);
        }
    }

    window.SLRecognizer = SLRecognizer;
})();
