const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../frontend/sl-core.js');
const Trainer = require('../frontend/landmark-trainer.js');

// Synthetic hands: each sign is a random base pose; each signer adds a personal offset; every frame has jitter.
function makeSamples(labels, signers, perSigner, seed = 3) {
    const rng = Trainer.mulberry32(seed);
    const r = () => rng() * 2 - 1;
    const bases = {};
    labels.forEach(l => {
        bases[l] = Array.from({ length: 21 }, (_, i) => [i * 0.02 + r() * 0.08, r() * 0.1 + (i % 5) * 0.03, r() * 0.05]);
    });
    const out = [];
    signers.forEach(sid => {
        const style = Array.from({ length: 21 }, () => [r() * 0.008, r() * 0.008, r() * 0.004]);
        labels.forEach(l => {
            for (let k = 0; k < perSigner; k++) {
                const frames = Array.from({ length: 30 }, () => {
                    const f = [];
                    bases[l].forEach((p, i) => { f.push(0.5 + p[0] + style[i][0] + r() * 0.006, 0.5 + p[1] + style[i][1] + r() * 0.006, p[2] + style[i][2] + r() * 0.003); });
                    return f;
                });
                out.push({ label: l, signer_id: sid, frames });
            }
        });
    });
    return out;
}

const FAST = { epochs: 12, copies: 1, frameStride: 3, seed: 5 };

test('trains on 3+ signers, holds out whole signers, and is accurate', async () => {
    const samples = makeSamples(['HELLO', 'WATER', 'YES', 'NO'], ['s01', 's02', 's03', 's04'], 3);
    const { model, report } = await Trainer.train(samples, FAST);
    assert.equal(report.split.mode, 'signer');
    assert.equal(report.split.optimistic, false);
    assert.ok(report.split.holdoutSigners.length >= 1);
    assert.ok(report.accuracy > 0.9, `held-out accuracy ${report.accuracy}`);
    assert.equal(report.publishable, true);
    assert.deepEqual(model.labels, ['HELLO', 'NO', 'WATER', 'YES']);
});

test('exported model works with the browser predictor and matches the trainer maths', async () => {
    const samples = makeSamples(['A', 'B', 'C'], ['s01', 's02', 's03'], 2);
    const { model } = await Trainer.train(samples, FAST);
    assert.equal(model.input, 63);
    assert.equal(model.layers.length, 3);
    assert.equal(model.layers[model.layers.length - 1].act, 'softmax');
    assert.equal(model.layers[0].w.length, 63);
    assert.equal(model.layers[model.layers.length - 1].b.length, model.labels.length);

    let right = 0;
    const probe = samples.slice(0, 9);
    for (const s of probe) {
        const pts = Array.from({ length: 21 }, (_, i) => ({ x: s.frames[0][i * 3], y: s.frames[0][i * 3 + 1], z: s.frames[0][i * 3 + 2] }));
        const x = Core.normalizeLandmarks(pts);
        const got = Core.mlpPredict(model, x);
        if (got.label === s.label) right++;
        assert.ok(Math.abs(got.probs.reduce((a, b) => a + b, 0) - 1) < 1e-6);
    }
    assert.ok(right >= 8, `browser predictor got ${right}/9`);
});

test('two signs only (single softmax pair) still works', async () => {
    const samples = makeSamples(['YES', 'NO'], ['s01', 's02', 's03'], 2);
    const { model, report } = await Trainer.train(samples, FAST);
    assert.equal(model.labels.length, 2);
    assert.equal(model.layers[model.layers.length - 1].b.length, 2);
    assert.ok(report.accuracy > 0.9);
});

test('one signer: still trains but says the accuracy is optimistic', async () => {
    const samples = makeSamples(['HELLO', 'WATER'], ['s01'], 6);
    const { report } = await Trainer.train(samples, FAST);
    assert.equal(report.split.mode, 'recording');
    assert.equal(report.split.optimistic, true);
    assert.ok(report.warnings.some(w => /signer/i.test(w)));
});

test('refuses to train with fewer than 2 signs', async () => {
    const samples = makeSamples(['HELLO'], ['s01', 's02', 's03'], 2);
    await assert.rejects(() => Trainer.train(samples, FAST), /at least 2/i);
});

test('skips degenerate and malformed frames instead of crashing', async () => {
    const samples = makeSamples(['A', 'B'], ['s01', 's02', 's03'], 2);
    samples[0].frames.push(new Array(63).fill(0.5)); // all landmarks identical: no hand size
    samples[0].frames.push([1, 2, 3]);               // wrong length
    const { report } = await Trainer.train(samples, FAST);
    assert.ok(report.recordings > 0);
});

test('augmentation keeps hands normalised (wrist at origin, farthest point at distance 1)', () => {
    const rng = Trainer.mulberry32(1);
    const pts = Array.from({ length: 21 }, (_, i) => ({ x: i * 0.02, y: (i % 4) * 0.03, z: 0 }));
    const x = Core.normalizeLandmarks(pts);
    for (let k = 0; k < 20; k++) {
        const a = Trainer.augment(x, rng, 1);
        assert.equal(a.length, 63);
        assert.deepEqual([a[0], a[1], a[2]], [0, 0, 0]);
        let m = 0;
        for (let i = 0; i < 21; i++) m = Math.max(m, Math.hypot(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]));
        assert.ok(Math.abs(m - 1) < 1e-4, `max distance ${m}`);
    }
});
