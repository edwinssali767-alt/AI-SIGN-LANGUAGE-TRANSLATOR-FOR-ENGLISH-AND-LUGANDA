const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../frontend/sl-core.js');

function hand(scale = 1, ox = 0, oy = 0) {
    return Array.from({ length: 21 }, (_, i) => ({ x: ox + i * 0.01 * scale, y: oy + (i % 5) * 0.02 * scale, z: 0 }));
}

test('normalize: wrist becomes origin and max distance is 1', () => {
    const f = C.normalizeLandmarks(hand());
    assert.equal(f.length, 63);
    assert.deepEqual([f[0], f[1], f[2]], [0, 0, 0]);
    let max = 0;
    for (let i = 0; i < 21; i++) max = Math.max(max, Math.hypot(f[i * 3], f[i * 3 + 1], f[i * 3 + 2]));
    assert.ok(Math.abs(max - 1) < 1e-5);
});

test('normalize: invariant to translation and scale', () => {
    const a = C.normalizeLandmarks(hand(1, 0, 0));
    const b = C.normalizeLandmarks(hand(2.5, 0.3, 0.4));
    for (let i = 0; i < 63; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-4);
});

test('normalize: rejects bad input', () => {
    assert.equal(C.normalizeLandmarks(null), null);
    assert.equal(C.normalizeLandmarks(hand().slice(0, 20)), null);
    assert.equal(C.normalizeLandmarks(Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }))), null);
});

test('resampleSequence returns exactly n frames, first and last kept', () => {
    const seq = Array.from({ length: 45 }, (_, i) => i);
    const r = C.resampleSequence(seq, 30);
    assert.equal(r.length, 30);
    assert.equal(r[0], 0);
    assert.equal(r[29], 44);
    assert.equal(C.resampleSequence([7], 30).length, 30);
});

test('fitTo640x480 keeps aspect ratio inside the box', () => {
    const r = C.fitTo640x480(1920, 1080);
    assert.ok(r.width <= 640 && r.height <= 480);
    assert.equal(r.width, 640);
    const p = C.fitTo640x480(480, 640);
    assert.ok(p.width <= 640 && p.height <= 480);
});

test('fitToBox: any box, aspect ratio kept (used for the adaptive smaller sizes)', () => {
    const r = C.fitToBox(1280, 720, 320, 240);
    assert.equal(r.width, 320);
    assert.equal(r.height, 180);
    assert.deepEqual(C.fitToBox(640, 480, 480, 360), { width: 480, height: 360, scale: 0.75 });
});

test('smoother: stable confident label is shown', () => {
    const s = new C.PredictionSmoother();
    let r;
    for (let i = 0; i < 10; i++) r = s.push({ label: 'WATER', confidence: 0.92 });
    assert.equal(r.state, 'result');
    assert.equal(r.label, 'WATER');
});

test('smoother: low confidence stays unknown', () => {
    const s = new C.PredictionSmoother();
    let r;
    for (let i = 0; i < 10; i++) r = s.push({ label: 'WATER', confidence: 0.6 });
    assert.equal(r.state, 'unknown');
    assert.equal(r.label, null);
});

test('smoother: flickering labels never reach the vote threshold', () => {
    const s = new C.PredictionSmoother();
    let r;
    for (let i = 0; i < 10; i++) r = s.push({ label: i % 2 ? 'YES' : 'NO', confidence: 0.95 });
    assert.equal(r.state, 'unknown');
});

test('smoother: not shown before enough frames', () => {
    const s = new C.PredictionSmoother();
    let r;
    for (let i = 0; i < 4; i++) r = s.push({ label: 'YES', confidence: 0.99 });
    assert.equal(r.state, 'unknown');
});

test('smoother: reports no_hand and clears after sustained loss', () => {
    const s = new C.PredictionSmoother();
    for (let i = 0; i < 10; i++) s.push({ label: 'YES', confidence: 0.99 });
    let r;
    for (let i = 0; i < 5; i++) r = s.push(null);
    assert.equal(r.state, 'no_hand');
    assert.equal(s.window.length, 0);
});

test('quality: dark, lost and far hints', () => {
    assert.equal(C.assessQuality(20, hand()).code, 'too_dark');
    assert.equal(C.assessQuality(120, null).code, 'hands_lost');
    const tiny = Array.from({ length: 21 }, (_, i) => ({ x: 0.5 + i * 0.001, y: 0.5 + (i % 3) * 0.001 }));
    assert.equal(C.assessQuality(120, tiny).code, 'too_far');
    const big = Array.from({ length: 21 }, (_, i) => ({ x: 0.2 + i * 0.02, y: 0.3 + (i % 5) * 0.05 }));
    assert.equal(C.assessQuality(120, big).ok, true);
});

test('mlpPredict: softmax output picks the right class', () => {
    const model = { labels: ['A', 'B'], layers: [{ w: [[5, 0], [0, 5]], b: [0, 0], act: 'softmax' }] };
    const r = C.mlpPredict(model, [1, 0]);
    assert.equal(r.label, 'A');
    assert.ok(r.confidence > 0.99);
});
