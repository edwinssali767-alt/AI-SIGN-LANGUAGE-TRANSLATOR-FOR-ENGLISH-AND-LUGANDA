// Pure recognition helpers (no DOM, no camera). Loaded in the browser as window.SLCore
// and in Node for tests via require().
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SLCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    const NUM_LANDMARKS = 21;
    const FEATURES = NUM_LANDMARKS * 3;
    const FRAME_W = 640;
    const FRAME_H = 480;

    // Landmarks -> 63 numbers: wrist at origin, scaled so the farthest point is at distance 1.
    // Input: array of 21 {x, y, z}. Returns Float32Array(63) or null if the hand is degenerate.
    function normalizeLandmarks(landmarks) {
        if (!landmarks || landmarks.length !== NUM_LANDMARKS) return null;
        const w = landmarks[0];
        const out = new Float32Array(FEATURES);
        let maxDist = 0;
        for (let i = 0; i < NUM_LANDMARKS; i++) {
            const dx = landmarks[i].x - w.x;
            const dy = landmarks[i].y - w.y;
            const dz = (landmarks[i].z || 0) - (w.z || 0);
            out[i * 3] = dx;
            out[i * 3 + 1] = dy;
            out[i * 3 + 2] = dz;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d > maxDist) maxDist = d;
        }
        if (!(maxDist > 1e-6)) return null;
        for (let i = 0; i < FEATURES; i++) out[i] /= maxDist;
        return out;
    }

    // Pick `n` frames evenly from a sequence (repeats frames if it is shorter).
    function resampleSequence(frames, n) {
        if (!frames.length) return [];
        const out = [];
        for (let i = 0; i < n; i++) {
            out.push(frames[Math.min(frames.length - 1, Math.round((i * (frames.length - 1)) / Math.max(1, n - 1)))]);
        }
        return out;
    }

    // Scale a source size so it fits inside a box (default 640x480) without distortion.
    function fitToBox(srcW, srcH, boxW = FRAME_W, boxH = FRAME_H) {
        const scale = Math.min(boxW / srcW, boxH / srcH);
        return { width: Math.round(srcW * scale), height: Math.round(srcH * scale), scale };
    }
    const fitTo640x480 = (srcW, srcH) => fitToBox(srcW, srcH, FRAME_W, FRAME_H);

    // Majority vote over the last `windowSize` frames.
    // Shows a label only when it wins >= minVotes frames AND its mean confidence >= minConfidence.
    class PredictionSmoother {
        constructor(opts = {}) {
            this.windowSize = opts.windowSize || 10;
            this.minConfidence = opts.minConfidence ?? 0.8;
            this.minVotes = opts.minVotes || 6;
            this.maxMissing = opts.maxMissing ?? 5;
            this.window = [];
            this.missing = 0;
        }

        reset() {
            this.window = [];
            this.missing = 0;
        }

        // pred: {label, confidence} for a frame, or null when no hand was found.
        push(pred) {
            if (!pred) {
                this.missing++;
                if (this.missing >= this.maxMissing) this.window = [];
                return { state: 'no_hand', label: null, confidence: 0 };
            }
            this.missing = 0;
            this.window.push(pred);
            if (this.window.length > this.windowSize) this.window.shift();

            const votes = new Map();
            for (const p of this.window) {
                const v = votes.get(p.label) || { count: 0, sum: 0 };
                v.count++;
                v.sum += p.confidence;
                votes.set(p.label, v);
            }
            let best = null;
            for (const [label, v] of votes) {
                if (!best || v.count > best.count) best = { label, count: v.count, mean: v.sum / v.count };
            }
            if (best.count >= this.minVotes && best.mean >= this.minConfidence) {
                return { state: 'result', label: best.label, confidence: best.mean };
            }
            return { state: 'unknown', label: null, confidence: best.mean };
        }
    }

    // Quality hints for one frame.
    // brightness: mean luma 0-255. landmarks: array of 21 points (normalized 0-1 image coords) or null.
    function assessQuality(brightness, landmarks, opts = {}) {
        const minBrightness = opts.minBrightness ?? 60;
        const minHandSize = opts.minHandSize ?? 0.18; // hand bbox's longer side as fraction of frame
        if (brightness < minBrightness) return { ok: false, code: 'too_dark', hint: 'Too dark. Move to a brighter place.' };
        if (!landmarks) return { ok: false, code: 'hands_lost', hint: 'No hand found. Show your hand to the camera.' };
        let minX = 1, maxX = 0, minY = 1, maxY = 0;
        for (const p of landmarks) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }
        if (Math.max(maxX - minX, maxY - minY) < minHandSize) {
            return { ok: false, code: 'too_far', hint: 'Too far. Move your hand closer to the camera.' };
        }
        return { ok: true, code: 'ok', hint: '' };
    }

    // Tiny MLP inference from exported JSON: {labels, layers:[{w:[in][out], b:[out], act:'relu'|'softmax'}]}.
    function mlpPredict(model, input) {
        let x = Array.from(input);
        for (const layer of model.layers) {
            const out = layer.b.slice();
            for (let i = 0; i < x.length; i++) {
                const xi = x[i];
                if (xi === 0) continue;
                const row = layer.w[i];
                for (let j = 0; j < out.length; j++) out[j] += xi * row[j];
            }
            if (layer.act === 'relu') for (let j = 0; j < out.length; j++) out[j] = Math.max(0, out[j]);
            x = out;
        }
        const max = Math.max(...x);
        const exps = x.map(v => Math.exp(v - max));
        const sum = exps.reduce((a, b) => a + b, 0);
        const probs = exps.map(v => v / sum);
        let bi = 0;
        for (let i = 1; i < probs.length; i++) if (probs[i] > probs[bi]) bi = i;
        return { label: model.labels[bi], confidence: probs[bi], probs };
    }

    return {
        NUM_LANDMARKS, FEATURES, FRAME_W, FRAME_H,
        normalizeLandmarks, resampleSequence, fitTo640x480, fitToBox,
        PredictionSmoother, assessQuality, mlpPredict,
    };
});
