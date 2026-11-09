// Low-end phone profile: Android user agent, 360x740, 4x slower CPU, "Slow 4G" network.
// Checks page weight, that heavy engines load lazily, load time, and recogniser speed.
// Run:  node tests/e2e/perf.e2e.js <dir-with-fine.mjpeg>
const { launch, sleep } = require('./cdp');
const path = require('node:path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';
const FEED = path.join(process.argv[2] || '.', 'fine.mjpeg');
const results = [];
async function step(name, fn) {
    try { const note = await fn(); results.push({ ok: true }); console.log('  PASS', name, note ? '-> ' + note : ''); }
    catch (e) { results.push({ ok: false }); console.log('  FAIL', name, '->', e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const kb = n => Math.round(n / 1024);

(async () => {
    const b = await launch({ port: 9395, mobile: true, width: 360, height: 740, fakeVideo: FEED });
    await b.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await b.send('Network.enable');
    await b.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await b.send('Network.setCacheDisabled', { cacheDisabled: true });
    await b.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-A105F) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36' });
    console.log('Low-end phone profile: 360x740, Android UA, 4x CPU slowdown, 1.6 Mbps / 150 ms latency, cold cache');

    const weight = async page => {
        const t0 = Date.now();
        await b.goto(`${BASE}/${page}.html`);
        const ms = Date.now() - t0;
        const res = await b.eval(`(() => { const r = performance.getEntriesByType('resource'); const nav = performance.getEntriesByType('navigation')[0];
            return { bytes: r.reduce((a, e) => a + (e.transferSize || e.encodedBodySize || 0), 0) + (nav.transferSize || 0), names: r.map(e => e.name.split('/').pop()) }; })()`);
        return { ms, ...res };
    };

    await step('welcome: loads under 500 KB and 6 s', async () => {
        const r = await weight('welcome');
        assert(r.bytes < 500 * 1024, kb(r.bytes) + ' KB');
        assert(r.ms < 6000, r.ms + ' ms');
        return `${kb(r.bytes)} KB, ${r.ms} ms`;
    });
    await step('translator: loads under 600 KB and 6 s, and does NOT fetch the recognition engine yet', async () => {
        const r = await weight('translator');
        assert(r.bytes < 600 * 1024, kb(r.bytes) + ' KB');
        assert(r.ms < 6000, r.ms + ' ms');
        const heavy = r.names.filter(n => /vision_bundle|wasm|hand_landmarker|three\.module|gesture-mlp/.test(n));
        assert(heavy.length === 0, 'eagerly loaded: ' + heavy.join(', '));
        return `${kb(r.bytes)} KB, ${r.ms} ms (engine lazy)`;
    });
    await step('text-to-sign: loads under 500 KB', async () => {
        const r = await weight('text-to-sign');
        assert(r.bytes < 500 * 1024, kb(r.bytes) + ' KB');
        return `${kb(r.bytes)} KB`;
    });

    await step('recognition engine size is bounded (loaded only when recognition starts)', async () => {
        await b.goto(`${BASE}/translator.html`);
        const sizes = await b.eval(`Promise.all(['/vendor/mediapipe/vision_bundle.mjs','/vendor/mediapipe/vision_wasm_internal.wasm','/models/hand_landmarker.task'].map(u => fetch(u).then(r => r.arrayBuffer()).then(a => a.byteLength)))`);
        const total = sizes.reduce((a, c) => a + c, 0);
        assert(total < 20 * 1024 * 1024, kb(total) + ' KB');
        return `${(total / 1048576).toFixed(1)} MB one-time, then cached for offline use`;
    });

    await step('recogniser on the slow phone: warm-up happens while loading, then still usable (>= 1 frame/s (measured 1.2-2.0 on this PC), stability scaled to the frame rate)', async () => {
        await b.goto(`${BASE}/translator.html`);
        await b.eval('navigator.permissions.query = () => Promise.resolve({state: "granted"});');
        const r = await b.eval(`(async () => {
            const s = await navigator.mediaDevices.getUserMedia({video: true});
            const v = document.createElement('video'); v.srcObject = s; v.muted = true; v.playsInline = true; document.body.appendChild(v); await v.play();
            const notes = []; let frames = 0; let withHand = 0;
            const rec = new SLRecognizer({video: v, fps: 10, onStatus: t => notes.push(t), onFrame: f => { frames++; if (f.hasHand) withHand++; }});
            const tl = performance.now(); await rec.load(); const loadMs = performance.now() - tl;
            rec.start(); const t0 = performance.now();
            await new Promise(x => setTimeout(x, 10000));
            rec.stop();
            return {frames, withHand, secs: (performance.now() - t0) / 1000, loadMs, size: rec.frameSize, minVotes: rec.smoother.minVotes, notes: notes.filter(n => /slow/.test(n))};
        })()`);
        const fps = r.frames / r.secs;
        assert(fps >= 1.0, `only ${fps.toFixed(1)} frames/s at ${r.size}`);
        assert(r.minVotes <= Math.max(2, Math.round(fps * 0.6) + 1), `stability not scaled: needs ${r.minVotes} frames at ${fps.toFixed(1)} fps`);
        assert(r.withHand > r.frames * 0.5, 'hand rarely found: ' + r.withHand + '/' + r.frames);
        return `${fps.toFixed(1)} fps at ${r.size}${r.notes.length ? ' (stepped down automatically)' : ''}; needs ${r.minVotes} agreeing frames; load+warm-up ${(r.loadMs / 1000).toFixed(1)} s`;
    });

    await b.close();
    const failed = results.filter(r => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('crashed', e); process.exit(2); });
