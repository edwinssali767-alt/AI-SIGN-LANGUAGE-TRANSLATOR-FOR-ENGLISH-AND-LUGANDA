// Admin: record hand-landmark sequences (numbers only) for training. Needs recognizer.js + sl-core.js.
(function () {
    const FRAMES = 30;
    const $ = id => document.getElementById(id);
    const els = {
        label: $('lmLabel'), signer: $('lmSigner'), device: $('lmDevice'), consent: $('lmConsent'),
        video: $('lmVideo'), overlay: $('lmOverlay'), status: $('lmStatus'), progress: $('lmProgress'),
        start: $('lmStartBtn'), record: $('lmRecordBtn'), stop: $('lmStopBtn'), summary: $('lmSummary'),
        labelList: $('lmLabelList'),
    };
    if (!els.start) return;

    let stream = null;
    let recognizer = null;
    let recording = false;

    const say = text => { els.status.textContent = text; };
    const token = () => localStorage.getItem('admin_token') || '';
    const auth = () => ({ 'Authorization': token(), 'Content-Type': 'application/json' });

    async function refreshSummary() {
        try {
            const res = await fetch(`${API_BASE}/admin/landmarks/summary`, { headers: auth() });
            if (!res.ok) return;
            const data = await res.json();
            const parts = Object.entries(data.signs).map(([k, v]) => `${k}: ${v}`);
            els.summary.textContent = parts.length
                ? `${parts.join(', ')} (${data.signers.length} signer${data.signers.length === 1 ? '' : 's'})`
                : 'nothing yet';
            els.labelList.innerHTML = '';
            Object.keys(data.signs).forEach(name => {
                const o = document.createElement('option');
                o.value = name.toUpperCase();
                els.labelList.appendChild(o);
            });
        } catch (e) { /* summary is optional */ }
    }

    function updateRecordButton() {
        els.record.disabled = !(stream && !recording && els.consent.checked
            && els.label.value.trim() && els.signer.value.trim());
    }
    ['input', 'change'].forEach(ev => {
        [els.label, els.signer, els.consent].forEach(el => el.addEventListener(ev, updateRecordButton));
    });

    els.start.addEventListener('click', async () => {
        try {
            stream = await requestCameraStream({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
            els.video.srcObject = stream;
            await els.video.play();
            recognizer = new SLRecognizer({ video: els.video, overlay: els.overlay, onStatus: say });
            await recognizer.load();
            els.start.disabled = true;
            els.stop.disabled = false;
            say('Camera ready. Fill in the details, tick consent, then press Record.');
            updateRecordButton();
            refreshSummary();
        } catch (e) {
            say('Could not start: ' + e.message);
        }
    });

    els.stop.addEventListener('click', () => {
        if (stream) stream.getTracks().forEach(t => t.stop());
        stream = null;
        els.video.srcObject = null;
        els.start.disabled = false;
        els.stop.disabled = true;
        els.record.disabled = true;
        say('Camera is off.');
    });

    els.record.addEventListener('click', async () => {
        recording = true;
        updateRecordButton();
        els.progress.hidden = false;
        els.progress.max = FRAMES;
        els.progress.value = 0;
        say('Get ready... hold the sign now.');
        try {
            const frames = await recognizer.captureSequence(FRAMES, (n, total, hint) => {
                els.progress.value = n;
                say(hint ? hint : `Recording ${n}/${total}`);
            });
            const res = await fetch(`${API_BASE}/admin/landmarks`, {
                method: 'POST',
                headers: auth(),
                body: JSON.stringify({
                    label: els.label.value.trim(),
                    signer_id: els.signer.value.trim(),
                    device: els.device.value,
                    consent: els.consent.checked,
                    frames,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Save failed');
            say(`Saved ${data.frames} frames for ${els.label.value.trim().toUpperCase()}. Record again for more variety.`);
            refreshSummary();
        } catch (e) {
            say('Not saved: ' + e.message);
        } finally {
            recording = false;
            els.progress.hidden = true;
            updateRecordButton();
        }
    });
})();
