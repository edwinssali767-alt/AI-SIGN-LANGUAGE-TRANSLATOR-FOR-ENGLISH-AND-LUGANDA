// Trains the sign classifier in the browser, so training works on Vercel (no server, no Python).
// Input : recordings [{label, signer_id, frames: [[63 raw MediaPipe numbers], ...]}]
// Output: {model, report}. `model` is {version, input, labels, layers:[{w:[in][out], b, act}]}, exactly what
//         SLCore.mlpPredict reads. Same recipe as training/train_landmarks.py: normalise by wrist and hand size,
//         augment (rotate, scale, stretch, mirror, noise, low-res), hold out whole recordings (or whole signers
//         when there are 3+) to measure accuracy honestly, then fit the final model on everything.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./sl-core.js'));
    else root.LandmarkTrainer = factory(root.SLCore);
})(typeof self !== 'undefined' ? self : this, function (SLCore) {
    const NUM_LM = 21;
    const AUG = { rotateDeg: 15, scale: 0.10, stretch: 0.06, noise: 0.01, mirrorP: 0.5, lowresP: 0.3, lowresSteps: [0.01, 0.02], lowresJitter: 0.004 };
    const DEFAULTS = {
        hidden: [64, 32], epochs: 40, batch: 64, lr: 0.003, l2: 1e-4, copies: 3, augStrength: 1,
        frameStride: 2, holdout: 0.25, seed: 7, patience: 4, minImprove: 0.002, confidence: 0.8,
    };

    // ---- small helpers ----
    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    const uniform = (rng, lo, hi) => lo + (hi - lo) * rng();
    function gauss(rng) {
        let u = 0;
        while (u === 0) u = rng();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
    }
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));

    function rawToPoints(raw) {
        const pts = new Array(NUM_LM);
        for (let i = 0; i < NUM_LM; i++) pts[i] = { x: raw[i * 3], y: raw[i * 3 + 1], z: raw[i * 3 + 2] };
        return pts;
    }

    // One augmented copy of a normalised 63-vector (mirrors augment() in train_landmarks.py).
    function augment(x, rng, strength) {
        const p = Float64Array.from(x);
        const a = uniform(rng, -AUG.rotateDeg, AUG.rotateDeg) * strength * Math.PI / 180;
        const c = Math.cos(a), s = Math.sin(a);
        const sc = 1 + uniform(rng, -AUG.scale, AUG.scale) * strength;
        const st = 1 + uniform(rng, -AUG.stretch, AUG.stretch) * strength;
        const mirror = rng() < AUG.mirrorP;
        for (let i = 0; i < NUM_LM; i++) {
            const px = p[i * 3], py = p[i * 3 + 1];
            p[i * 3] = (c * px - s * py) * sc * st;
            p[i * 3 + 1] = (s * px + c * py) * sc;
            p[i * 3 + 2] *= sc;
            if (mirror) p[i * 3] *= -1;
        }
        const noise = AUG.noise * strength;
        for (let i = 0; i < 63; i++) p[i] += gauss(rng) * noise;
        if (strength > 0 && rng() < AUG.lowresP) {
            const step = AUG.lowresSteps[rng() < 0.5 ? 0 : 1] * strength;
            const jitter = AUG.lowresJitter * strength;
            for (let i = 0; i < 63; i++) p[i] = Math.round(p[i] / step) * step + gauss(rng) * jitter;
        }
        let m = 0;
        for (let i = 1; i < NUM_LM; i++) {
            const dx = p[i * 3] - p[0], dy = p[i * 3 + 1] - p[1], dz = p[i * 3 + 2] - p[2];
            m = Math.max(m, Math.sqrt(dx * dx + dy * dy + dz * dz));
        }
        const out = new Float32Array(63);
        const w0 = p[0], w1 = p[1], w2 = p[2];
        const div = m > 1e-6 ? m : 1;
        for (let i = 0; i < NUM_LM; i++) {
            out[i * 3] = (p[i * 3] - w0) / div;
            out[i * 3 + 1] = (p[i * 3 + 1] - w1) / div;
            out[i * 3 + 2] = (p[i * 3 + 2] - w2) / div;
        }
        return out;
    }

    // ---- dataset ----
    function buildDataset(samples, opts) {
        // The server stores labels lower-case; the app's sign names (glosses) are upper-case, e.g. WATER.
        const gloss = s => String(s.label).trim().toUpperCase();
        const labels = Array.from(new Set(samples.map(gloss))).sort();
        const index = new Map(labels.map((l, i) => [l, i]));
        const recs = [];
        samples.forEach((s, r) => {
            const frames = [];
            (s.frames || []).forEach((raw, f) => {
                if (f % opts.frameStride !== 0 || !raw || raw.length !== 63) return;
                const x = SLCore.normalizeLandmarks(rawToPoints(raw));
                if (x) frames.push(x);
            });
            if (frames.length) recs.push({ r, y: index.get(gloss(s)), signer: String(s.signer_id), frames });
        });
        return { labels, recs };
    }

    // Decide which recordings are held out for the honest accuracy test.
    function splitRecordings(recs, labelCount, opts, rng) {
        const signers = Array.from(new Set(recs.map(r => r.signer)));
        const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
        const labelsIn = set => new Set(recs.filter(r => set.has(r.r)).map(r => r.y));

        if (signers.length >= 3) {
            const k = Math.max(1, Math.round(signers.length * opts.holdout));
            for (let attempt = 0; attempt < 30; attempt++) {
                const hold = new Set(shuffle(signers.slice()).slice(0, k));
                const test = new Set(recs.filter(r => hold.has(r.signer)).map(r => r.r));
                const train = new Set(recs.filter(r => !hold.has(r.signer)).map(r => r.r));
                if (test.size && labelsIn(train).size === labelCount) {
                    return { mode: 'signer', optimistic: false, train, test, holdoutSigners: Array.from(hold) };
                }
            }
        }
        // Fewer than 3 signers (or an unlucky signer split): hold out recordings of each sign. Same people appear in
        // training and test, so the number is optimistic and the report says so.
        const train = new Set(), test = new Set();
        for (let y = 0; y < labelCount; y++) {
            const mine = shuffle(recs.filter(r => r.y === y).map(r => r.r));
            const nTest = mine.length >= 2 ? Math.max(1, Math.round(mine.length * opts.holdout)) : 0;
            mine.forEach((id, i) => (i < nTest ? test : train).add(id));
        }
        return { mode: 'recording', optimistic: true, train, test, holdoutSigners: [] };
    }

    function flatten(recs, ids, augmentCopies, strength, rng) {
        const X = [], y = [];
        for (const r of recs) {
            if (!ids.has(r.r)) continue;
            for (const f of r.frames) {
                X.push(f); y.push(r.y);
                for (let c = 0; c < augmentCopies; c++) { X.push(augment(f, rng, strength)); y.push(r.y); }
            }
        }
        return { X, y };
    }

    // ---- the network: 63 -> hidden... -> K, ReLU, softmax, Adam ----
    function initNet(sizes, rng) {
        const layers = [];
        for (let l = 0; l < sizes.length - 1; l++) {
            const nIn = sizes[l], nOut = sizes[l + 1];
            const w = new Float64Array(nIn * nOut);
            const std = Math.sqrt(2 / nIn);
            for (let i = 0; i < w.length; i++) w[i] = gauss(rng) * std;
            layers.push({ nIn, nOut, w, b: new Float64Array(nOut) });
        }
        return layers;
    }

    function forward(layers, x, acts) {
        let a = x;
        acts[0] = a;
        for (let l = 0; l < layers.length; l++) {
            const { nIn, nOut, w, b } = layers[l];
            const z = acts[l + 1] || (acts[l + 1] = new Float64Array(nOut));
            for (let j = 0; j < nOut; j++) z[j] = b[j];
            for (let i = 0; i < nIn; i++) {
                const ai = a[i];
                if (ai === 0) continue;
                const base = i * nOut;
                for (let j = 0; j < nOut; j++) z[j] += ai * w[base + j];
            }
            if (l < layers.length - 1) for (let j = 0; j < nOut; j++) if (z[j] < 0) z[j] = 0;
            a = z;
        }
        let max = -Infinity;
        for (let j = 0; j < a.length; j++) if (a[j] > max) max = a[j];
        let sum = 0;
        for (let j = 0; j < a.length; j++) { a[j] = Math.exp(a[j] - max); sum += a[j]; }
        for (let j = 0; j < a.length; j++) a[j] /= sum;
        return a; // probabilities (same array as acts[last])
    }

    async function fit(X, y, K, opts, rng, onEpoch) {
        const sizes = [63, ...opts.hidden, K];
        const layers = initNet(sizes, rng);
        const L = layers.length;
        const m = layers.map(l => ({ w: new Float64Array(l.w.length), b: new Float64Array(l.b.length) }));
        const v = layers.map(l => ({ w: new Float64Array(l.w.length), b: new Float64Array(l.b.length) }));
        const g = layers.map(l => ({ w: new Float64Array(l.w.length), b: new Float64Array(l.b.length) }));
        const acts = new Array(L + 1);
        const deltas = layers.map(l => new Float64Array(l.nOut));
        const order = Array.from({ length: X.length }, (_, i) => i);
        const b1 = 0.9, b2 = 0.999, eps = 1e-8;
        let step = 0, prevLoss = Infinity, stale = 0, lastLoss = 0;

        for (let epoch = 0; epoch < opts.epochs; epoch++) {
            for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
            let lossSum = 0;
            for (let start = 0; start < order.length; start += opts.batch) {
                const end = Math.min(order.length, start + opts.batch);
                const n = end - start;
                for (const gl of g) { gl.w.fill(0); gl.b.fill(0); }
                for (let k = start; k < end; k++) {
                    const idx = order[k];
                    const p = forward(layers, X[idx], acts);
                    lossSum -= Math.log(Math.max(p[y[idx]], 1e-12));
                    for (let j = 0; j < K; j++) deltas[L - 1][j] = p[j] - (j === y[idx] ? 1 : 0);
                    for (let l = L - 1; l >= 0; l--) {
                        const { nIn, nOut, w } = layers[l];
                        const prev = acts[l], d = deltas[l], gw = g[l].w, gb = g[l].b;
                        for (let j = 0; j < nOut; j++) gb[j] += d[j];
                        for (let i = 0; i < nIn; i++) {
                            const pi = prev[i];
                            if (pi === 0 && l > 0) continue;
                            const base = i * nOut;
                            for (let j = 0; j < nOut; j++) gw[base + j] += pi * d[j];
                        }
                        if (l > 0) {
                            const dp = deltas[l - 1];
                            for (let i = 0; i < nIn; i++) {
                                if (prev[i] <= 0) { dp[i] = 0; continue; }
                                const base = i * nOut;
                                let s = 0;
                                for (let j = 0; j < nOut; j++) s += w[base + j] * d[j];
                                dp[i] = s;
                            }
                        }
                    }
                }
                step++;
                const c1 = 1 - Math.pow(b1, step), c2 = 1 - Math.pow(b2, step);
                for (let l = 0; l < L; l++) {
                    const { w, b } = layers[l];
                    for (let i = 0; i < w.length; i++) {
                        const gi = g[l].w[i] / n + opts.l2 * w[i];
                        m[l].w[i] = b1 * m[l].w[i] + (1 - b1) * gi;
                        v[l].w[i] = b2 * v[l].w[i] + (1 - b2) * gi * gi;
                        w[i] -= opts.lr * (m[l].w[i] / c1) / (Math.sqrt(v[l].w[i] / c2) + eps);
                    }
                    for (let i = 0; i < b.length; i++) {
                        const gi = g[l].b[i] / n;
                        m[l].b[i] = b1 * m[l].b[i] + (1 - b1) * gi;
                        v[l].b[i] = b2 * v[l].b[i] + (1 - b2) * gi * gi;
                        b[i] -= opts.lr * (m[l].b[i] / c1) / (Math.sqrt(v[l].b[i] / c2) + eps);
                    }
                }
                if ((step & 31) === 0) await tick(); // keep the page responsive
            }
            lastLoss = lossSum / order.length;
            if (onEpoch) onEpoch(epoch + 1, opts.epochs, lastLoss);
            if (prevLoss - lastLoss < opts.minImprove * Math.max(prevLoss, 1e-9) && epoch > 5) { if (++stale >= opts.patience) break; } else stale = 0;
            prevLoss = Math.min(prevLoss, lastLoss);
            await tick();
        }
        return layers;
    }

    function predictProbs(layers, x) {
        return Array.from(forward(layers, x, new Array(layers.length + 1)));
    }

    function exportModel(layers, labels) {
        const round = v => Math.round(v * 1e5) / 1e5;
        return {
            version: 1,
            input: 63,
            labels: labels.slice(),
            layers: layers.map((l, idx) => {
                const w = [];
                for (let i = 0; i < l.nIn; i++) {
                    const row = new Array(l.nOut);
                    for (let j = 0; j < l.nOut; j++) row[j] = round(l.w[i * l.nOut + j]);
                    w.push(row);
                }
                return { w, b: Array.from(l.b, round), act: idx === layers.length - 1 ? 'softmax' : 'relu' };
            }),
        };
    }

    function evaluate(layers, recs, ids, labels, confidence) {
        const K = labels.length;
        const confusion = Array.from({ length: K }, () => new Array(K).fill(0));
        let n = 0, correct = 0, confident = 0, confidentRight = 0;
        for (const r of recs) {
            if (!ids.has(r.r)) continue;
            for (const f of r.frames) {
                const p = predictProbs(layers, f);
                let bi = 0;
                for (let i = 1; i < K; i++) if (p[i] > p[bi]) bi = i;
                confusion[r.y][bi]++;
                n++;
                if (bi === r.y) correct++;
                if (p[bi] >= confidence) { confident++; if (bi === r.y) confidentRight++; }
            }
        }
        const perSign = labels.map((label, i) => {
            const total = confusion[i].reduce((a, b) => a + b, 0);
            return { label, frames: total, recall: total ? confusion[i][i] / total : null };
        });
        return {
            frames: n,
            accuracy: n ? correct / n : null,
            confidentShare: n ? confident / n : null,
            confidentAccuracy: confident ? confidentRight / confident : null,
            perSign, confusion,
        };
    }

    // ---- main entry ----
    async function train(samples, options, onProgress) {
        const opts = Object.assign({}, DEFAULTS, options || {});
        const say = (stage, fraction, text) => { if (onProgress) onProgress({ stage, fraction, text }); };
        const rng = mulberry32(opts.seed);

        const { labels, recs } = buildDataset(samples, opts);
        const K = labels.length;
        if (K < 2) throw new Error('Record at least 2 different signs before training.');
        const signers = Array.from(new Set(recs.map(r => r.signer)));
        const perLabel = labels.map((label, i) => ({ label, recordings: recs.filter(r => r.y === i).length }));
        const warnings = [];
        if (signers.length < 3) warnings.push(`Only ${signers.length} signer${signers.length === 1 ? '' : 's'}. The accuracy below is optimistic: it was tested on the same people. Record at least 3 different signers for a trustworthy model.`);
        const thin = perLabel.filter(p => p.recordings < 5).map(p => p.label);
        if (thin.length) warnings.push(`Few recordings (under 5) for: ${thin.join(', ')}. Record more of each.`);

        const split = splitRecordings(recs, K, opts, rng);
        let evalReport = null;
        if (split.test.size) {
            say('evaluate', 0, 'Training a test model on part of the data...');
            const tr = flatten(recs, split.train, opts.copies, opts.augStrength, rng);
            const layers = await fit(tr.X, tr.y, K, opts, rng, (e, total, loss) =>
                say('evaluate', 0.5 * e / total, `Testing accuracy: round ${e}/${total} (loss ${loss.toFixed(3)})`));
            evalReport = evaluate(layers, recs, split.test, labels, opts.confidence);
        } else {
            warnings.push('Not enough recordings to hold any back for testing, so accuracy could not be measured.');
        }

        say('final', 0.5, 'Training the final model on all data...');
        const all = new Set(recs.map(r => r.r));
        const full = flatten(recs, all, opts.copies, opts.augStrength, rng);
        const finalLayers = await fit(full.X, full.y, K, opts, rng, (e, total, loss) =>
            say('final', 0.5 + 0.5 * e / total, `Final model: round ${e}/${total} (loss ${loss.toFixed(3)})`));
        const model = exportModel(finalLayers, labels);

        const accuracy = evalReport ? evalReport.accuracy : null;
        if (accuracy !== null && accuracy < 0.8) warnings.push(`Held-back accuracy is ${(accuracy * 100).toFixed(0)}%. Record more varied examples before relying on it.`);
        const confusedPairs = [];
        if (evalReport) {
            evalReport.confusion.forEach((row, i) => row.forEach((c, j) => {
                const total = row.reduce((a, b) => a + b, 0);
                if (i !== j && total && c / total >= 0.15) confusedPairs.push(`${labels[i]} is often read as ${labels[j]} (${Math.round(100 * c / total)}%)`);
            }));
        }
        if (confusedPairs.length) warnings.push(...confusedPairs);

        const report = {
            trainedAt: new Date().toISOString(),
            labels, perLabel,
            recordings: recs.length, signers: signers.length, trainingFrames: full.X.length,
            split: { mode: split.mode, optimistic: split.optimistic, holdoutSigners: split.holdoutSigners },
            accuracy,
            confidentShare: evalReport ? evalReport.confidentShare : null,
            confidentAccuracy: evalReport ? evalReport.confidentAccuracy : null,
            perSign: evalReport ? evalReport.perSign : [],
            warnings,
            publishable: accuracy !== null && accuracy >= 0.7,
        };
        say('done', 1, 'Training finished.');
        return { model, report };
    }

    return { train, augment, buildDataset, splitRecordings, exportModel, predictProbs, DEFAULTS, mulberry32 };
});
