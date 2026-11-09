// Full chain, in a real browser with a FAKE CAMERA (a looping video made from sample hand photos):
//   admin page records landmark sequences -> server saves them (consent required) ->
//   training script splits by signer and exports JSON -> translator loads the model ->
//   live recognition -> smoothing -> sign buffer -> sentence.
// It also checks the quality hints (dark / no hand) and that the browser's model maths equals Python's.
// The test data it creates is deleted at the end. Needs ffmpeg and the project venv.
// Run:  node tests/e2e/recognition.e2e.js <dir-with-fine.mjpeg-how.mjpeg-black.mjpeg-nohand.mjpeg>
const { launch, sleep } = require('./cdp');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';
const FEEDS = process.argv[2];
const PY = path.join(ROOT, 'backend', 'venv', 'Scripts', 'python.exe');
const LM_DIR = path.join(ROOT, 'datasets', 'landmarks');
const MODEL = path.join(ROOT, 'frontend', 'models', 'gesture-mlp.json');
const REPORT = path.join(ROOT, 'training', 'reports', 'report.txt');
const TEST_LABELS = ['fine', 'how'];

const results = [];
async function step(name, fn) {
    try { await fn(); results.push({ name, ok: true }); console.log('  PASS', name); }
    catch (e) { results.push({ name, ok: false, err: e.message }); console.log('  FAIL', name, '->', e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }
const feed = n => path.join(FEEDS, n + '.mjpeg');
const noPrompt = 'navigator.permissions.query = () => Promise.resolve({state: "granted"});';

function cleanup() {
    if (process.env.KEEP_E2E_DATA) return;
    for (const l of TEST_LABELS) fs.rmSync(path.join(LM_DIR, l), { recursive: true, force: true });
    fs.rmSync(MODEL, { force: true });
    fs.rmSync(REPORT, { force: true });
}

async function adminToken() {
    const r = spawnSync(PY, ['-c', "import server; print('TOKEN=' + server.sign_token('admin','e2e'))"],
        { cwd: path.join(ROOT, 'backend'), encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    const m = /TOKEN=(\S+)/.exec(r.stdout || '');
    if (!m) throw new Error('could not create admin token: ' + (r.stderr || '').slice(-300));
    return m[1];
}

async function record(label, feedName, signers, token, port) {
    const b = await launch({ port, fakeVideo: feed(feedName) });
    try {
        await b.goto(`${BASE}/admin.html`);
        await b.eval(noPrompt);
        await b.eval(`localStorage.setItem('admin_token', ${JSON.stringify(token)})`);
        await b.goto(`${BASE}/admin.html`);
        await b.eval(noPrompt);
        // As a logged-in admin would see it: the dashboard (and the capture card in it) is visible.
        await b.eval('document.getElementById("loginView").classList.add("hidden"); const d = document.getElementById("dashboardView"); d.classList.remove("hidden"); d.classList.add("active"); d.style.display = "block";');
        await b.click('#lmStartBtn');
        await b.waitFor('/Camera ready/.test(document.getElementById("lmStatus").textContent)', 40000, 'camera + hand tracker ready');
        for (const signer of signers) {
            await b.type('#lmLabel', label);
            await b.type('#lmSigner', signer);
            await b.eval('document.getElementById("lmConsent").checked = true; document.getElementById("lmConsent").dispatchEvent(new Event("change", {bubbles: true}))');
            await b.waitFor('!document.getElementById("lmRecordBtn").disabled', 3000, 'Record to enable');
            await b.click('#lmRecordBtn');
            await b.waitFor('/Saved 30 frames|Not saved/.test(document.getElementById("lmStatus").textContent)', 40000, 'recording to finish');
            const status = await b.eval('document.getElementById("lmStatus").textContent');
            assert(/Saved 30 frames/.test(status), 'recording failed: ' + status);
        }
        return b.consoleErrors.slice();
    } finally { await b.close(); }
}

(async () => {
    cleanup();
    try {
        const token = await adminToken();
        console.log('Recording landmark data through the admin page (3 signers x 2 signs)');

        await step('admin record: consent is mandatory (server rejects without it)', async () => {
            const r = await fetch(`${BASE}/api/admin/landmarks`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: token },
                body: JSON.stringify({ label: 'x', signer_id: 's1', device: 'phone', consent: false, frames: [] }),
            });
            assert(r.status === 400, 'status ' + r.status);
        });

        await step('admin record: "fine" x 3 signers via the real UI + MediaPipe', async () => {
            const errs = await record('fine', 'fine', ['s1', 's2', 's3'], token, 9361);
            assert(errs.length === 0, 'console errors: ' + errs.join(' | '));
        });
        await step('admin record: "how" x 3 signers', async () => { await record('how', 'how', ['s1', 's2', 's3'], token, 9362); });

        await step('saved files hold numbers only: 30 frames x 63 values, consent true, no images', async () => {
            const files = fs.readdirSync(path.join(LM_DIR, 'fine'));
            assert(files.length === 3, 'files ' + files);
            const rec = JSON.parse(fs.readFileSync(path.join(LM_DIR, 'fine', files[0]), 'utf8'));
            assert(rec.consent === true && rec.frames.length === 30 && rec.frames[0].length === 63, 'shape');
            assert(Object.keys(rec).sort().join() === 'captured_at,consent,device,frames,label,signer_id', 'unexpected keys: ' + Object.keys(rec));
            assert(rec.frames.every(f => f.every(v => typeof v === 'number')), 'non-numeric data');
        });

        await step('training script: splits by signer, reports confusion matrix, exports model JSON', async () => {
            const r = spawnSync(PY, ['training/train_landmarks.py', '--aug', '2'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
            const out = (r.stdout || '') + (r.stderr || '');
            console.log(out.split(String.fromCharCode(10)).filter(l => /signers|accuracy|HOW|FINE|how|fine|\[\[|\]\]/.test(l) && !/arn/.test(l)).map(l => '      | ' + l).join(String.fromCharCode(10)));
            assert(r.status === 0, 'exit ' + r.status + ' ' + out.slice(-400));
            assert(/Train signers:.*Test signers:/.test(out), 'no signer split in output');
            assert(/Confusion matrix/.test(out) && /Per-class accuracy/.test(out), 'no report');
            assert(fs.existsSync(MODEL), 'model not exported');
        });

        await step('browser model maths == Python maths on the exported weights', async () => {
            const SL = require(path.join(ROOT, 'frontend', 'sl-core.js'));
            const model = JSON.parse(fs.readFileSync(MODEL, 'utf8'));
            const rec = JSON.parse(fs.readFileSync(path.join(LM_DIR, 'how', fs.readdirSync(path.join(LM_DIR, 'how'))[0]), 'utf8'));
            const pts = [];
            for (let i = 0; i < 21; i++) pts.push({ x: rec.frames[5][i * 3], y: rec.frames[5][i * 3 + 1], z: rec.frames[5][i * 3 + 2] });
            const input = Array.from(SL.normalizeLandmarks(pts));
            const js = SL.mlpPredict(model, input);
            const py = spawnSync(PY, ['-c', `
import json,sys,numpy as np
m=json.load(open(sys.argv[1])); x=np.array(json.loads(sys.argv[2]),dtype=np.float64)
for L in m['layers']:
    x=x@np.array(L['w'])+np.array(L['b'])
    if L['act']=='relu': x=np.maximum(0,x)
e=np.exp(x-x.max()); p=e/e.sum(); print('P='+json.dumps(p.tolist()))`, MODEL, JSON.stringify(input)], { encoding: 'utf8' });
            const pyP = JSON.parse(/P=(.*)/.exec(py.stdout)[1]);
            const maxDiff = Math.max(...pyP.map((v, i) => Math.abs(v - js.probs[i])));
            assert(maxDiff < 1e-4, 'max diff ' + maxDiff);
            assert(js.label === 'how', 'predicted ' + js.label);
        });

        console.log('Live recognition in the translator page');
        const live = async (feedName, port, fn) => {
            const b = await launch({ port, fakeVideo: feed(feedName) });
            try {
                await b.goto(`${BASE}/translator.html`);
                await b.eval(noPrompt);
                await b.waitFor('document.querySelectorAll("#s2sPicker option").length > 0', 8000, 'vocabulary');
                await b.click('#s2sStart');
                await fn(b);
                return b.consoleErrors.slice();
            } finally { await b.close(); }
        };

        await step('live: a real hand sign is recognised, smoothed and added to the sentence', async () => {
            const errs = await live('fine', 9363, async b => {
                await b.waitFor('document.querySelectorAll("#s2sChips li").length >= 1', 45000, 'a recognised sign');
                const chip = await b.eval('document.querySelector("#s2sChips li").textContent');
                assert(/fine/i.test(chip), 'recognised ' + chip);
                // a held sign must be added once, not once per frame
                await sleep(2500);
                const n = await b.eval('document.querySelectorAll("#s2sChips li").length');
                assert(n === 1, 'held sign was added ' + n + ' times');
                await b.click('#s2sDone');
                await b.waitFor('document.getElementById("s2sEnglish").value.length > 0', 4000, 'sentence after Done');
                assert(/fine/i.test(await b.eval('document.getElementById("s2sEnglish").value')), 'sentence text');
            });
            assert(errs.length === 0, 'console errors: ' + errs.join(' | '));
        });

        await step('live: the other sign is recognised as "how" (not just always the first class)', async () => {
            await live('how', 9364, async b => {
                await b.waitFor('document.querySelectorAll("#s2sChips li").length >= 1', 45000, 'a recognised sign');
                const chip = await b.eval('document.querySelector("#s2sChips li").textContent');
                assert(/how/i.test(chip), 'recognised ' + chip);
            });
        });

        await step('live: no hand in view -> hint, nothing is added or invented', async () => {
            await live('nohand', 9365, async b => {
                await b.waitFor('/No hand found/.test(document.getElementById("s2sHint").textContent)', 45000, 'no-hand hint');
                await sleep(1500);
                assert((await b.eval('document.querySelectorAll("#s2sChips li").length')) === 0, 'chips were invented');
            });
        });

        await step('live: dark camera -> "Too dark" hint, nothing is added', async () => {
            await live('black', 9366, async b => {
                await b.waitFor('/Too dark/.test(document.getElementById("s2sHint").textContent)', 45000, 'too-dark hint');
                assert((await b.eval('document.querySelectorAll("#s2sChips li").length')) === 0, 'chips were invented');
            });
        });

        await step('live: stop recognition returns to idle', async () => {
            await live('fine', 9367, async b => {
                await b.waitFor('document.getElementById("s2sStart").textContent === "Stop recognition"', 45000, 'running');
                await b.click('#s2sStart');
                assert(/off/.test(await b.eval('document.getElementById("s2sStatus").textContent')), 'status after stop');
            });
        });
    } finally {
        cleanup();
    }
    const failed = results.filter(r => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed. Test data and the temporary model were deleted.`);
    process.exit(failed.length ? 1 : 0);
})().catch(e => { cleanup(); console.error('E2E crashed:', e); process.exit(2); });
