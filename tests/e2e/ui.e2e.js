// End-to-end UI tests in a real headless Edge/Chrome against the running server (http://127.0.0.1:5000).
// Run:  node tests/e2e/ui.e2e.js
const { launch, sleep } = require('./cdp');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';
const results = [];
async function step(name, fn) {
    try { await fn(); results.push({ name, ok: true }); console.log('  PASS', name); }
    catch (e) { results.push({ name, ok: false, err: e.message }); console.log('  FAIL', name, '->', e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const shots = path.join(os.tmpdir(), 'e2e-shots');
fs.mkdirSync(shots, { recursive: true });

(async () => {
    // ------------------------------------------------------------------ desktop
    let b = await launch({ port: 9341, width: 1280, height: 900 });
    console.log('Desktop 1280x900');

    await step('welcome: renders, new hero, no old toy 3D, no console errors', async () => {
        await b.goto(`${BASE}/welcome.html`);
        const h1 = await b.eval('document.querySelector("h1").textContent.replace(/\\s+/g," ").trim()');
        assert(/Sign language to speech/.test(h1), 'h1 was: ' + h1);
        assert(await b.eval('!document.querySelector("canvas#heroCanvas")'), 'old 3D canvas still present');
        const heavy = await b.eval('performance.getEntriesByType("resource").some(r => /three\\.module|gsap|hero3d/.test(r.name))');
        assert(!heavy, 'Three.js/GSAP still loaded on the landing page');
        assert(await b.eval('!!document.querySelector(".demo-hand")'), 'hand diagram missing');
        assert(await b.eval('getComputedStyle(document.querySelector(".hero-copy h1 em")).fontFamily.includes("Newsreader")'), 'serif accent font not applied');
        await b.screenshot(path.join(shots, 'welcome.png'));
        assert(b.consoleErrors.length === 0, 'console errors: ' + b.consoleErrors.join(' | '));
    });

    await step('brand: charcoal / sand / electric blue are applied (light theme)', async () => {
        await b.eval('localStorage.setItem("site_theme","light")');
        await b.goto(`${BASE}/translator.html`);
        const c = await b.eval(`(() => { const cs = s => getComputedStyle(document.querySelector(s));
            return { bg: getComputedStyle(document.body).backgroundColor, nav: cs('.navbar').backgroundColor,
                     btn: cs('#startCameraBtn').backgroundColor, text: cs('body').color }; })()`);
        assert(c.bg === 'rgb(216, 203, 179)', 'page bg ' + c.bg);
        assert(c.nav === 'rgb(30, 30, 28)', 'nav bg ' + c.nav);
        assert(c.btn === 'rgb(46, 106, 255)', 'primary button ' + c.btn); // #2E6AFF: brand #2F6BFF nudged 1 unit so white text reaches 4.5:1
        assert(c.text === 'rgb(30, 30, 28)', 'text ' + c.text);
    });

    await step('brand: dark theme uses charcoal background and sand text', async () => {
        await b.eval('localStorage.setItem("site_theme","dark")');
        await b.goto(`${BASE}/translator.html`);
        await b.waitFor('document.documentElement.getAttribute("data-resolved-theme")==="dark"', 5000, 'dark theme');
        const c = await b.eval('({bg: getComputedStyle(document.body).backgroundColor, text: getComputedStyle(document.body).color})');
        assert(c.bg === 'rgb(30, 30, 28)', 'dark bg ' + c.bg);
        assert(c.text === 'rgb(216, 203, 179)', 'dark text ' + c.text);
        await b.eval('localStorage.setItem("site_theme","light")');
    });

    // ------------------------------------------------------------------ translator: signs -> sentence
    await step('translator: sign picker lists the vocabulary', async () => {
        await b.goto(`${BASE}/translator.html`);
        await b.waitFor('document.querySelectorAll("#s2sPicker option").length >= 70', 8000, 'picker options');
    });

    const addSign = async gloss => {
        await b.eval(`(() => { const p = document.getElementById('s2sPicker'); p.value = ${JSON.stringify(gloss)}; })()`);
        await b.click('#s2sAdd');
        await sleep(100);
    };

    await step('signs -> sentence: ME WANT WATER -> "I want water." / "Njagala amazzi."', async () => {
        for (const g of ['ME', 'WANT', 'WATER']) await addSign(g);
        await b.waitFor('document.getElementById("s2sEnglish").value.length > 0', 4000, 'sentence');
        assert((await b.eval('document.getElementById("s2sEnglish").value')) === 'I want water.', 'english');
        assert((await b.eval('document.getElementById("s2sLuganda").value')) === 'Njagala amazzi.', 'luganda');
        assert((await b.eval('document.querySelectorAll("#s2sChips li").length')) === 3, 'chips');
        assert(/pattern/i.test(await b.eval('document.getElementById("s2sMatch").textContent')), 'match note');
        assert(await b.eval('!document.getElementById("s2sSpeak").disabled'), 'Speak should be enabled');
    });

    await step('confirm-before-speak: nothing is spoken until Speak is pressed; Repeat locked until then', async () => {
        assert(await b.eval('document.getElementById("s2sRepeat").disabled'), 'Repeat enabled too early');
        assert((await b.eval('document.getElementById("s2sVoiceNote").textContent')) === '', 'voice note before speaking');
    });

    await step('speak English: finishes, re-enables controls, Repeat unlocked', async () => {
        await b.click('#s2sSpeak');
        await b.waitFor('!document.getElementById("s2sSpeak").disabled && !document.getElementById("s2sRepeat").disabled', 20000, 'speech to finish');
        await b.click('#s2sRepeat');
        await b.waitFor('!document.getElementById("s2sSpeak").disabled', 20000, 'repeat to finish');
    });

    await step('speak Luganda without a recording -> captions only, with an explanation', async () => {
        await b.click('input[name="s2sLang"][value="luganda"]');
        await b.click('#s2sSpeak');
        await b.waitFor('/captions only/i.test(document.getElementById("s2sVoiceNote").textContent)', 8000, 'captions-only note');
    });

    const audioDir = path.join(__dirname, '..', '..', 'frontend', 'static', 'audio', 'lg');
    const makeMp3 = name => spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', '0.4', path.join(audioDir, name + '.mp3')]);
    const cleanAudio = names => names.forEach(n => fs.rmSync(path.join(audioDir, n + '.mp3'), { force: true }));
    const playedViaFetch = async () => b.eval('performance.getEntriesByType("resource").filter(r => /static\/audio\/lg\//.test(r.name)).map(r => r.name.split("/").pop())');

    await step('speak Luganda with a whole-sentence recording -> plays it (njagala_amazzi.mp3)', async () => {
        makeMp3('njagala_amazzi');
        try {
            await b.goto(`${BASE}/translator.html`); // fresh page: the "not found" answer from the step above is cached for 15 s by design
            await b.waitFor('document.querySelectorAll("#s2sPicker option").length >= 70', 8000, 'picker');
            for (const g of ['ME', 'WANT', 'WATER']) await addSign(g);
            await b.click('input[name="s2sLang"][value="luganda"]');
            await b.click('#s2sSpeak');
            await b.waitFor('/^Done/.test(document.getElementById("s2sVoiceNote").textContent)', 10000, 'audio to finish');
            assert(!/captions only/i.test(await b.eval('document.getElementById("s2sVoiceNote").textContent')), 'fell back to captions');
        } finally { cleanAudio(['njagala_amazzi']); }
    });

    await step('speak Luganda sign by sign when every sign has a file; captions only if one is missing', async () => {
        makeMp3('me'); makeMp3('want');
        try {
            // "water" is missing -> must NOT play a partial sentence
            await b.goto(`${BASE}/translator.html`);
            await b.waitFor('document.querySelectorAll("#s2sPicker option").length >= 70', 8000, 'picker');
            for (const g of ['ME', 'WANT', 'WATER']) await addSign(g);
            await b.click('input[name="s2sLang"][value="luganda"]');
            await b.click('#s2sSpeak');
            await b.waitFor('/captions only/i.test(document.getElementById("s2sVoiceNote").textContent)', 8000, 'captions-only with a missing file');
            makeMp3('water');
            await b.goto(`${BASE}/translator.html`);
            await b.waitFor('document.querySelectorAll("#s2sPicker option").length >= 70', 8000, 'picker');
            for (const g of ['ME', 'WANT', 'WATER']) await addSign(g);
            await b.click('input[name="s2sLang"][value="luganda"]');
            await b.click('#s2sSpeak');
            await b.waitFor('/^Done/.test(document.getElementById("s2sVoiceNote").textContent)', 12000, 'per-sign audio');
        } finally { cleanAudio(['me', 'want', 'water']); }
    });

    await step('editing the caption is respected (signer can correct before speaking)', async () => {
        await b.type('#s2sEnglish', 'I want clean water.');
        assert((await b.eval('document.getElementById("s2sEnglish").value')) === 'I want clean water.', 'edit lost');
        assert(await b.eval('!document.getElementById("s2sSpeak").disabled'), 'Speak disabled after edit');
    });

    await step('undo / clear', async () => {
        await b.click('#s2sUndo');
        assert((await b.eval('document.querySelectorAll("#s2sChips li").length')) === 2, 'undo');
        await b.click('#s2sClear');
        assert((await b.eval('document.querySelectorAll("#s2sChips li").length')) === 0, 'clear chips');
        assert((await b.eval('document.getElementById("s2sEnglish").value')) === '', 'clear text');
        assert(await b.eval('document.getElementById("s2sSpeak").disabled'), 'Speak should be disabled when empty');
    });

    await step('no-pattern sentences still produce a readable phrase', async () => {
        for (const g of ['WATER', 'TOMORROW', 'DOCTOR']) await addSign(g);
        const t = await b.eval('document.getElementById("s2sEnglish").value');
        assert(t === 'Water tomorrow doctor.', 'got ' + t);
        assert(/edit it/i.test(await b.eval('document.getElementById("s2sMatch").textContent')), 'should ask the signer to edit');
        await b.click('#s2sClear');
    });

    await step('translator: no old 3D hand / Three.js loaded; no JS errors', async () => {
        const heavy = await b.eval('performance.getEntriesByType("resource").some(r => /three\\.module/.test(r.name))');
        assert(!heavy, 'Three.js still loads on the translator page');
        assert(b.consoleErrors.length === 0, 'console errors: ' + b.consoleErrors.join(' | '));
    });

    await step('camera dialog: shows custom permission dialog (no emoji), Not now cancels cleanly', async () => {
        await b.goto(`${BASE}/translator.html`);
        await b.eval('navigator.permissions.query = () => Promise.resolve({state: "prompt"})'); // force the dialog
        await b.click('#startCameraBtn');
        await b.waitFor('!!document.querySelector(".cp-dialog")', 4000, 'dialog');
        const txt = await b.eval('document.querySelector(".cp-dialog").textContent');
        assert(/never recorded or stored/i.test(txt), 'privacy wording');
        assert(!/[\u{1F300}-\u{1FAFF}]/u.test(txt), 'emoji in dialog');
        assert(await b.eval('!!document.querySelector(".cp-dialog a[href=\\"privacy.html\\"]")'), 'privacy link');
        await b.click('.cp-dialog [data-act="cancel"]');
        await b.waitFor('!document.querySelector(".cp-dialog")', 3000, 'dialog to close');
        await b.waitFor('!document.getElementById("errorContainer").classList.contains("hidden")', 4000, 'error message');
    });

    // ------------------------------------------------------------------ text to sign
    b.consoleErrors.length = 0;
    await step('text-to-sign: "Where is the toilet?" -> TOILET, WHERE and plays to the end', async () => {
        await b.goto(`${BASE}/text-to-sign.html`);
        await b.type('#ttsText', 'Where is the toilet?');
        await b.click('#ttsShow');
        await b.waitFor('document.querySelectorAll("#ttsList li").length === 2', 6000, 'sign chips');
        const chips = await b.eval('[...document.querySelectorAll("#ttsList li")].map(l => l.textContent)');
        assert(chips.join(',') === 'toilet,where', 'chips ' + chips);
        await b.waitFor('/Finished/.test(document.getElementById("ttsCaption").textContent)', 20000, 'player to finish');
    });

    await step('text-to-sign: missing clips are shown honestly, not faked', async () => {
        await b.click('#ttsReplay');
        await b.waitFor('!!document.querySelector(".tts-card-small")', 6000, 'caption card');
        assert(/No sign clip recorded yet/.test(await b.eval('document.querySelector(".tts-card-small").textContent')), 'should say there is no clip');
        await b.screenshot(path.join(shots, 'text-to-sign.png'));
        await b.click('#ttsPlay'); // pause
    });

    await step('text-to-sign: plays a real MP4 clip and a PNG still when they exist, a captioned card when not', async () => {
        const signs = path.join(__dirname, '..', '..', 'frontend', 'static', 'signs');
        const mk = args => spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
        mk(['-f', 'lavfi', '-i', 'color=c=0x2E6AFF:s=480x360:r=15', '-t', '0.6', '-pix_fmt', 'yuv420p', '-an', path.join(signs, 'toilet.mp4')]);
        mk(['-f', 'lavfi', '-i', 'color=c=0xD8CBB3:s=480x360', '-frames:v', '1', path.join(signs, 'water.png')]);
        try {
            await b.goto(`${BASE}/text-to-sign.html`);
            await b.type('#ttsText', 'toilet water where');
            await b.click('#ttsShow');
            // order after the rules: TOILET, WATER, WHERE
            await b.waitFor('!!document.querySelector("#ttsStage video")', 8000, 'toilet.mp4 in a <video>');
            assert(await b.eval('document.querySelector("#ttsStage video").getAttribute("src") === "/static/signs/toilet.mp4"'), 'wrong clip');
            await b.waitFor('!!document.querySelector("#ttsStage img")', 8000, 'water.png in an <img>');
            assert(/Sign for water/.test(await b.eval('document.querySelector("#ttsStage img").alt')), 'img alt text');
            await b.waitFor('!!document.querySelector("#ttsStage .tts-card-small")', 8000, 'a card for the sign with no clip (where)');
            await b.waitFor('/Finished/.test(document.getElementById("ttsCaption").textContent)', 20000, 'player to finish');
        } finally {
            fs.rmSync(path.join(signs, 'toilet.mp4'), { force: true });
            fs.rmSync(path.join(signs, 'water.png'), { force: true });
        }
    });

    await step('text-to-sign: unknown words are fingerspelled', async () => {
        await b.type('#ttsText', 'My name is Kato');
        await b.click('#ttsShow');
        await b.waitFor('document.querySelectorAll("#ttsList li").length === 3', 6000, 'chips');
        const chips = await b.eval('[...document.querySelectorAll("#ttsList li")].map(l => l.textContent)');
        assert(chips[2] === 'spell: kato', 'chips ' + chips);
        await b.waitFor('/Fingerspelling/.test(document.getElementById("ttsCaption").textContent) || document.querySelector(".tts-card-big")?.textContent.length === 1', 10000, 'fingerspelling');
        await b.click('#ttsPlay');
    });

    await step('text-to-sign: Luganda input maps to signs', async () => {
        await b.click('input[name="ttsLang"][value="luganda"]');
        await b.type('#ttsText', 'ayagala emmere');
        await b.click('#ttsShow');
        await b.waitFor('document.querySelectorAll("#ttsList li").length === 2', 6000, 'chips');
        assert((await b.eval('[...document.querySelectorAll("#ttsList li")].map(l => l.textContent).join(",")')) === 'want,food', 'luganda chips');
        await b.click('#ttsPlay');
    });

    await step('text-to-sign: empty and no-match input give a helpful message', async () => {
        await b.type('#ttsText', '');
        await b.click('#ttsShow');
        await b.waitFor('/Type a sentence first/.test(document.getElementById("ttsCaption").textContent)', 4000, 'empty message');
    });

    await step('text-to-sign: speed and pause sliders update and next/back step through signs', async () => {
        await b.click('input[name="ttsLang"][value="english"]');
        await b.type('#ttsText', 'I want water');
        await b.click('#ttsShow');
        await b.waitFor('document.querySelectorAll("#ttsList li").length === 3', 6000, 'chips');
        await b.click('#ttsPlay'); // pause
        await b.type('#ttsSpeed', '1.5');
        assert((await b.eval('document.getElementById("ttsSpeedOut").textContent')) === '1.5x', 'speed label');
        await b.type('#ttsGap', '1');
        assert((await b.eval('document.getElementById("ttsGapOut").textContent')) === '1.0 s', 'gap label');
        await b.click('#ttsNext');
        await b.waitFor('document.querySelector("#ttsList .is-current")', 4000, 'current sign highlighted');
    });

    await step('text-to-sign: no JS errors', async () => {
        assert(b.consoleErrors.length === 0, 'console errors: ' + b.consoleErrors.join(' | '));
    });

    // ------------------------------------------------------------------ other pages
    await step('privacy page renders and states video is never stored', async () => {
        await b.goto(`${BASE}/privacy.html`);
        assert(/never stored/i.test(await b.eval('document.body.innerText')), 'privacy text');
    });

    await step('admin: landmark capture card has consent, signer id, device and 30-frame record', async () => {
        await b.goto(`${BASE}/admin.html`);
        for (const sel of ['#lmConsent', '#lmSigner', '#lmDevice', '#lmLabel', '#lmRecordBtn', '#lmStartBtn']) {
            assert(await b.eval(`!!document.querySelector(${JSON.stringify(sel)})`), 'missing ' + sel);
        }
        assert(await b.eval('document.getElementById("lmRecordBtn").disabled'), 'Record must be disabled until consent + details');
        assert(/No video or photos are stored/i.test(await b.eval('document.getElementById("landmarkCapture").textContent')), 'notice');
    });

    await step('every page links to Text to Sign and has a working skip of nothing broken (no JS errors)', async () => {
        for (const page of ['welcome', 'translator', 'letters', 'gestures', 'pricing', 'profile', 'auth']) {
            b.consoleErrors.length = 0;
            await b.goto(`${BASE}/${page}.html`);
            const has = await b.eval('!!document.querySelector("a[href=\\"text-to-sign.html\\"]")');
            assert(has, page + ' has no Text to Sign link');
        }
    });

    await b.close();

    // ------------------------------------------------------------------ phone layout
    b = await launch({ port: 9342, mobile: true, width: 360, height: 740 });
    console.log('Phone 360x740');
    for (const page of ['welcome', 'translator', 'text-to-sign', 'letters', 'admin', 'privacy', 'gestures', 'pricing', 'auth']) {
        await step(`phone: ${page} has no horizontal scroll`, async () => {
            await b.goto(`${BASE}/${page}.html`);
            await sleep(500);
            const m = await b.eval('({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth})');
            assert(m.sw <= m.cw + 1, `scrollWidth ${m.sw} > clientWidth ${m.cw}`);
        });
    }
    await step('phone: mobile menu opens, has Text to Sign, closes on Escape', async () => {
        await b.goto(`${BASE}/text-to-sign.html`);
        await b.click('.mobile-menu-btn');
        await b.waitFor('document.getElementById("mobileMenu").classList.contains("active")', 3000, 'menu open');
        assert(await b.eval('!!document.querySelector("#mobileMenu a[href=\\"text-to-sign.html\\"]")'), 'link in menu');
        await b.eval('document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}))');
        await b.waitFor('!document.getElementById("mobileMenu").classList.contains("active")', 3000, 'menu closed');
    });
    await step('phone: touch targets on the translator page are at least 44px tall', async () => {
        await b.goto(`${BASE}/translator.html`);
        const small = await b.eval(`[...document.querySelectorAll('button:not([hidden]), .btn, select')].filter(e => e.offsetParent !== null)
            .map(e => ({t: (e.id || e.textContent || '').trim().slice(0, 20), h: Math.round(e.getBoundingClientRect().height)})).filter(x => x.h < 44)`);
        assert(small.length === 0, 'small targets: ' + JSON.stringify(small));
        await b.screenshot(path.join(shots, 'translator-phone.png'));
    });
    await b.close();

    const failed = results.filter(r => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots in ${shots}`);
    process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('E2E crashed:', e); process.exit(2); });
