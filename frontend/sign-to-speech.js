// Translator page: recognised signs -> sentence -> (confirmed by the signer) -> voice.
// Needs sl-core.js, recognizer.js, sentence-builder.js, speech.js. All local, nothing is uploaded.
(function () {
    const $ = id => document.getElementById(id);
    const els = {
        start: $('s2sStart'), done: $('s2sDone'), status: $('s2sStatus'), hint: $('s2sHint'),
        chips: $('s2sChips'), empty: $('s2sEmpty'), picker: $('s2sPicker'), add: $('s2sAdd'),
        undo: $('s2sUndo'), clear: $('s2sClear'), english: $('s2sEnglish'), luganda: $('s2sLuganda'),
        match: $('s2sMatch'), rate: $('s2sRate'), rateOut: $('s2sRateOut'), speak: $('s2sSpeak'),
        repeat: $('s2sRepeat'), note: $('s2sVoiceNote'), video: $('cameraFeed'), overlay: $('landmarkCanvas'),
        cameraBtn: $('startCameraBtn'),
    };
    if (!els.start) return;

    const buffer = new SentenceBuilder.SignBuffer();
    let builder = null;
    let vocab = null;
    let recognizer = null;
    let lastSentence = null;
    let speaking = false;

    // Load the vocabulary and patterns once (small JSON files, editable by hand).
    const ready = Promise.all([
        fetch('/data/vocabulary.json').then(r => r.json()),
        fetch('/data/patterns.json').then(r => r.json()),
    ]).then(([v, p]) => {
        vocab = v;
        builder = SentenceBuilder.create(v, p);
        const groups = {};
        v.signs.forEach(s => (groups[s.category] = groups[s.category] || []).push(s));
        els.picker.innerHTML = '';
        Object.keys(groups).forEach(cat => {
            const og = document.createElement('optgroup');
            og.label = cat.charAt(0).toUpperCase() + cat.slice(1);
            groups[cat].forEach(s => {
                const o = document.createElement('option');
                o.value = s.gloss;
                o.textContent = `${s.english} / ${s.luganda}`;
                og.appendChild(o);
            });
            els.picker.appendChild(og);
        });
    }).catch(() => {
        els.status.textContent = 'Could not load the sign list. Check your connection and reload.';
    });

    function setStatus(text) { els.status.textContent = text; }

    function renderChips() {
        els.chips.innerHTML = '';
        buffer.glosses.forEach(g => {
            const li = document.createElement('li');
            li.className = 's2s-chip';
            const s = builder && builder.lookup(g);
            li.textContent = s ? s.english : g;
            li.title = g;
            els.chips.appendChild(li);
        });
        els.empty.hidden = buffer.glosses.length > 0;
        els.done.disabled = buffer.glosses.length === 0;
    }

    function showSentence(glosses) {
        const s = builder.build(glosses);
        lastSentence = s;
        els.english.value = s.english;
        els.luganda.value = s.luganda;
        els.match.textContent = s.matched
            ? 'Built from a sentence pattern. Please check it.'
            : 'No sentence pattern matched, so the words were joined. Please edit it before speaking.';
        els.speak.disabled = !s.english;
        els.repeat.disabled = true;
        els.note.textContent = '';
        els.english.focus({ preventScroll: true });
    }

    function finishSentence() {
        const glosses = buffer.finish();
        renderChips();
        if (glosses.length) showSentence(glosses);
    }

    async function speak() {
        if (speaking) return;
        const lang = document.querySelector('input[name="s2sLang"]:checked').value;
        // The signer may have edited the captions: speak exactly what is on screen.
        const sentence = { english: els.english.value.trim(), luganda: els.luganda.value.trim(),
            glosses: lastSentence && !wasEdited(lang) ? lastSentence.glosses : [] };
        if (!sentence[lang]) { els.note.textContent = 'There is nothing to speak yet.'; return; }
        speaking = true;
        els.speak.disabled = true;
        els.note.textContent = 'Speaking...';
        try {
            const r = await SignSpeech.speak(sentence, lang, Number(els.rate.value));
            els.note.textContent = r.note || (r.mode === 'captions' ? 'Captions only.' : 'Done.');
        } catch (e) {
            els.note.textContent = 'Could not play audio. Read the caption instead.';
        } finally {
            speaking = false;
            els.speak.disabled = false;
            els.repeat.disabled = false;
        }
    }

    function wasEdited(lang) {
        return !lastSentence || (els[lang].value.trim() !== lastSentence[lang]);
    }

    // ---- Controls ----
    els.rate.addEventListener('input', () => { els.rateOut.textContent = Number(els.rate.value).toFixed(1) + 'x'; });
    els.speak.addEventListener('click', speak);
    els.repeat.addEventListener('click', speak);
    els.done.addEventListener('click', finishSentence);
    els.add.addEventListener('click', async () => {
        await ready;
        if (!els.picker.value) return;
        buffer.glosses.push(els.picker.value);
        buffer.lastLabel = null;
        renderChips();
        showSentence(buffer.glosses.slice());
    });
    els.undo.addEventListener('click', () => { buffer.undo(); renderChips(); if (buffer.glosses.length) showSentence(buffer.glosses.slice()); });
    els.clear.addEventListener('click', () => {
        buffer.clear(); renderChips();
        els.english.value = ''; els.luganda.value = ''; els.match.textContent = ''; els.speak.disabled = true;
        els.repeat.disabled = true; SignSpeech.stop();
    });
    [els.english, els.luganda].forEach(t => t.addEventListener('input', () => { els.speak.disabled = !els.english.value.trim() && !els.luganda.value.trim(); }));
    els.english.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) speak(); });

    // ---- Live recognition ----
    function onFrame(f) {
        const pred = f.prediction;
        els.hint.textContent = f.quality && !f.quality.ok ? f.quality.hint
            : pred.state === 'unknown' ? 'Not sure. Please repeat the sign.' : '';
        const r = buffer.update(pred, performance.now());
        if (r.added) { renderChips(); setStatus('Recognised: ' + (builder.lookup(r.added).english)); }
        if (r.finished && r.finished.length) { renderChips(); showSentence(r.finished); setStatus('Sentence ready. Check it, then press Speak.'); }
    }

    async function startRecognition() {
        els.start.disabled = true;
        try {
            await ready;
            if (!els.video.srcObject) {
                setStatus('Starting the camera...');
                els.cameraBtn.click();
                for (let i = 0; i < 100 && !els.video.srcObject; i++) await new Promise(r => setTimeout(r, 100));
                if (!els.video.srcObject) throw new Error('Camera did not start.');
                await new Promise(r => setTimeout(r, 400));
            }
            recognizer = recognizer || new SLRecognizer({
                video: els.video, overlay: null, fps: /Android|iPhone|iPad/i.test(navigator.userAgent) ? 10 : 15,
                onFrame, onStatus: setStatus,
            });
            await recognizer.load();
            if (!recognizer.hasModel) {
                setStatus('No trained sign model yet. Use "Add a sign by hand" until signers have recorded data and the model is trained.');
                els.start.disabled = false;
                return;
            }
            recognizer.start();
            els.start.textContent = 'Stop recognition';
            els.start.disabled = false;
            els.start.onclick = stopRecognition;
            setStatus('Listening for signs...');
        } catch (e) {
            setStatus('Could not start recognition: ' + e.message);
            els.start.disabled = false;
        }
    }

    function stopRecognition() {
        if (recognizer) recognizer.stop();
        els.start.textContent = 'Start recognition';
        els.start.onclick = startRecognition;
        els.hint.textContent = '';
        setStatus('Offline recognition is off.');
    }

    els.start.onclick = startRecognition;
    renderChips();
})();
