// Text to Sign page: sentence -> glosses (text-to-gloss.js) -> SignPlayer (sign-renderer.js).
(function () {
    const $ = id => document.getElementById(id);
    const els = {
        form: $('ttsForm'), text: $('ttsText'), mic: $('ttsMic'), micNote: $('ttsMicNote'),
        list: $('ttsList'), empty: $('ttsListEmpty'), stage: $('ttsStage'), caption: $('ttsCaption'),
        play: $('ttsPlay'), replay: $('ttsReplay'), prev: $('ttsPrev'), next: $('ttsNext'),
        speed: $('ttsSpeed'), speedOut: $('ttsSpeedOut'), gap: $('ttsGap'), gapOut: $('ttsGapOut'), voice: $('ttsVoice'),
    };
    let converter = null;
    let vocab = null;
    let result = null;

    const player = new SignPlayer({
        renderer: new ClipRenderer(),
        stage: els.stage,
        onStep: (i, item) => {
            highlight(i);
            const name = item.type === 'fingerspell' ? `Fingerspelling "${item.word}"` : vocab.byGloss.get(item.gloss).english;
            const lg = item.type === 'sign' ? vocab.byGloss.get(item.gloss).luganda : '';
            els.caption.textContent = lg ? `${name}  /  ${lg}` : name;
        },
        onEnd: () => { setPlayLabel(); els.caption.textContent = 'Finished. Press Replay to watch again.'; },
    });

    const ready = Promise.all([
        fetch('/data/vocabulary.json').then(r => r.json()),
        fetch('/data/patterns.json').then(r => r.json()),
    ]).then(([v, p]) => {
        vocab = { signs: v.signs, byGloss: new Map(v.signs.map(s => [s.gloss, s])) };
        converter = TextToGloss.create(v, p);
    }).catch(() => { els.caption.textContent = 'Could not load the sign list. Reload the page.'; });

    function setPlayLabel() { els.play.textContent = player.playing ? 'Pause' : (player.atEnd ? 'Play again' : 'Play'); }

    function renderList(items) {
        els.list.innerHTML = '';
        items.forEach((it, i) => {
            const li = document.createElement('li');
            li.className = 's2s-chip';
            li.dataset.index = i;
            li.textContent = it.type === 'fingerspell' ? `spell: ${it.word}` : vocab.byGloss.get(it.gloss).english;
            els.list.appendChild(li);
        });
        els.empty.hidden = items.length > 0;
        [els.play, els.replay, els.prev, els.next].forEach(b => { b.disabled = items.length === 0; });
    }

    function highlight(i) {
        els.list.querySelectorAll('.s2s-chip').forEach(li => {
            const on = Number(li.dataset.index) === i;
            li.classList.toggle('is-current', on);
            if (on) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
        });
    }

    async function show(text) {
        await ready;
        const lang = document.querySelector('input[name="ttsLang"]:checked').value;
        result = converter.toGloss(text, lang);
        player.load(result.items);
        renderList(result.items);
        if (!result.items.length) {
            els.stage.innerHTML = '';
            els.caption.textContent = text.trim() ? 'No signs found in that sentence. Try simpler words.' : 'Type a sentence first.';
            return;
        }
        els.caption.textContent = 'Ready. Press Play.';
        if (els.voice.checked && lang === 'english') SignSpeech.speak({ english: text, luganda: '', glosses: [] }, 'english', 1);
        player.play().then(setPlayLabel);
        setPlayLabel();
    }

    els.form.addEventListener('submit', e => { e.preventDefault(); show(els.text.value); });
    els.text.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); show(els.text.value); }
    });
    els.play.addEventListener('click', () => {
        if (player.playing) player.pause(); else player.play().then(setPlayLabel);
        setPlayLabel();
    });
    els.replay.addEventListener('click', () => { player.replay().then(setPlayLabel); setPlayLabel(); });
    els.prev.addEventListener('click', () => player.step(-1));
    els.next.addEventListener('click', () => player.step(1));
    els.speed.addEventListener('input', () => { player.speed = Number(els.speed.value); els.speedOut.textContent = player.speed.toFixed(1) + 'x'; });
    els.gap.addEventListener('input', () => { player.gapMs = Number(els.gap.value) * 1000; els.gapOut.textContent = Number(els.gap.value).toFixed(1) + ' s'; });

    // ---- Speech input (only when the browser has it) ----
    let rec = null;
    if (window.SpeechRecognition || window.webkitSpeechRecognition) {
        els.mic.hidden = false;
        els.mic.addEventListener('click', () => {
            if (rec) { rec.stop(); return; }
            const lang = document.querySelector('input[name="ttsLang"]:checked').value;
            rec = SignSpeech.createRecognizer(lang, {
                onText: (t, final) => { els.text.value = t; if (final) show(t); },
                onError: err => { els.micNote.textContent = err === 'not-allowed' ? 'Microphone permission was refused. You can type instead.'
                    : 'Speech input did not work (' + err + '). You can type instead.'; },
                onEnd: () => { rec = null; els.mic.textContent = 'Speak instead'; },
            });
            els.micNote.textContent = 'Listening... Your browser may use an online speech service for this. Typing works offline.';
            els.mic.textContent = 'Stop listening';
            rec.start();
        });
    }
})();
