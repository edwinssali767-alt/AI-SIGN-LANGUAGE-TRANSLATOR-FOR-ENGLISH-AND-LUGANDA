// Minimal Chrome DevTools Protocol driver (no dependencies): launches Edge/Chrome headless and
// lets a test navigate, evaluate JavaScript, wait for conditions and take screenshots.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BROWSERS = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch({ port = 9333, width = 1280, height = 900, fakeVideo = null, mobile = false } = {}) {
    const exe = BROWSERS.find(p => fs.existsSync(p));
    if (!exe) throw new Error('No Edge or Chrome found');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-profile-'));
    const args = [
        '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`, `--window-size=${width},${height}`,
        '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required', '--mute-audio', 'about:blank',
    ];
    if (fakeVideo) args.splice(args.length - 1, 0, `--use-file-for-fake-video-capture=${fakeVideo}`);
    // E2E_BROWSER_ARGS: extra flags, e.g. --host-resolver-rules="MAP 127.0.0.1 127.0.0.1:5055" to test against a server on another port.
    if (process.env.E2E_BROWSER_ARGS) args.push(...(process.env.E2E_BROWSER_ARGS.match(/(?:[^\s"]+|"[^"]*")+/g) || []).map(a => a.replace(/"/g, '')));
    const proc = spawn(exe, args, { stdio: 'ignore' });

    let targets = null;
    for (let i = 0; i < 50 && !targets; i++) {
        await sleep(200);
        try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch (e) { /* not up yet */ }
    }
    if (!targets) { proc.kill(); throw new Error('Browser did not start'); }
    const page = targets.find(t => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let id = 0;
    const pending = new Map();
    const consoleErrors = [];
    ws.onmessage = ev => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
        } else if (msg.method === 'Runtime.exceptionThrown') {
            consoleErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
        } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
            consoleErrors.push(msg.params.args.map(a => a.value || a.description).join(' '));
        }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const i = ++id;
        pending.set(i, { resolve, reject });
        ws.send(JSON.stringify({ id: i, method, params }));
    });
    await send('Page.enable');
    await send('Runtime.enable');
    if (mobile) {
        await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 2, mobile: true });
    }

    const api = {
        consoleErrors,
        send,
        async goto(url) {
            await send('Page.navigate', { url });
            await sleep(300);
            for (let i = 0; i < 100; i++) {
                if ((await api.eval('document.readyState')) === 'complete') break;
                await sleep(100);
            }
        },
        async eval(expr) {
            const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
            if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
            return r.result.value;
        },
        async waitFor(expr, timeoutMs = 15000, what = expr) {
            const t0 = Date.now();
            while (Date.now() - t0 < timeoutMs) {
                try { if (await api.eval(expr)) return true; } catch (e) { /* page changing */ }
                await sleep(150);
            }
            throw new Error('Timed out waiting for: ' + what);
        },
        async click(selector) {
            const ok = await api.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.scrollIntoView({block:'center'}); el.click(); return true; })()`);
            if (!ok) throw new Error('No element ' + selector);
        },
        async type(selector, text) {
            await api.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', {bubbles:true})); })()`);
        },
        async screenshot(file) {
            const r = await send('Page.captureScreenshot', { format: 'png' });
            fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
        },
        async close() {
            try { ws.close(); } catch (e) { /* ignore */ }
            proc.kill();
            await sleep(300);
            try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* locked on Windows: ignore */ }
        },
    };
    return api;
}

module.exports = { launch, sleep };
