// Real-browser WCAG AA contrast scan: every visible text element on every page, light and dark theme,
// measured against its actual rendered background (translucent layers are composited).
// Elements sitting on an image/gradient are skipped (reported as "unchecked").
// Run:  node tests/e2e/contrast.e2e.js
const { launch, sleep } = require('./cdp');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';
const PAGES = ['welcome', 'translator', 'text-to-sign', 'letters', 'admin', 'privacy', 'auth', 'gestures', 'profile', 'pricing'];

const SCAN = `(() => {
  const parse = c => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(s => parseFloat(s)); return {r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1}; };
  const over = (top, under) => ({r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1});
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  const bgOf = el => { // composite ancestors' backgrounds from the top element down
    const layers = []; let n = el;
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none') return null;
      const c = parse(cs.backgroundColor); if (c && c.a > 0) layers.push(c);
      if (c && c.a === 1) break; n = n.parentElement;
    }
    let base = {r: 255, g: 255, b: 255, a: 1};
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  };
  const bad = []; let checked = 0, unchecked = 0;
  for (const el of document.body.querySelectorAll('*')) {
    if (!['A','BUTTON','P','H1','H2','H3','H4','LI','LABEL','SPAN','DIV','TD','TH','OUTPUT','FIGCAPTION','LEGEND','TEXTAREA','SELECT','INPUT','OPTION','STRONG','EM'].includes(el.tagName)) continue;
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
    const isField = ['TEXTAREA','SELECT','INPUT'].includes(el.tagName);
    if (!own && !isField) continue;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
    if (el.closest('[hidden], .hidden')) continue;
    if (el.disabled) continue; // disabled controls are exempt from WCAG contrast
    const fg0 = parse(cs.color); if (!fg0) continue;
    const bg = bgOf(el); if (!bg) { unchecked++; continue; }
    const fg = over(fg0, bg);
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5;
    const cr = ratio(fg, bg); checked++;
    if (cr < need - 0.005) bad.push({el: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') + (el.id ? '#' + el.id : ''),
      text: (el.textContent || el.value || '').trim().slice(0, 28), ratio: +cr.toFixed(2), need, size: Math.round(size), fg: cs.color, bg: 'rgb(' + [bg.r, bg.g, bg.b].map(Math.round).join(',') + ')'});
  }
  return {checked, unchecked, bad};
})()`;

(async () => {
    const b = await launch({ port: 9391, width: 1280, height: 900 });
    let total = 0, failures = 0;
    for (const theme of ['light', 'dark']) {
        for (const page of PAGES) {
            await b.goto(`${BASE}/welcome.html`);
            await b.eval(`localStorage.setItem('site_theme', '${theme}')`);
            await b.goto(`${BASE}/${page}.html`);
            await sleep(700);
            const r = await b.eval(SCAN);
            total += r.checked;
            const uniq = [...new Map(r.bad.map(x => [x.el + x.fg + x.bg, x])).values()];
            failures += uniq.length;
            console.log(`${uniq.length === 0 ? 'PASS' : 'FAIL'} ${theme.padEnd(5)} ${page.padEnd(13)} checked ${String(r.checked).padStart(3)}, unchecked ${r.unchecked}`);
            uniq.slice(0, 8).forEach(x => console.log(`       ${x.ratio}:1 (need ${x.need}) ${x.el} "${x.text}" ${x.fg} on ${x.bg}  ${x.size}px`));
        }
    }
    await b.close();
    console.log(`\n${total} text elements checked, ${failures} below WCAG AA`);
    process.exit(failures ? 1 : 0);
})().catch(e => { console.error('crashed', e); process.exit(2); });
