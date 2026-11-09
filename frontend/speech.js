// Voice in and out, using only what the browser provides.
//  - English output: browser speechSynthesis (works offline when the OS has a voice installed).
//  - Luganda output: recorded files /static/audio/lg/<phrase or gloss>.mp3 if present; otherwise captions only.
//  - Speech input: the browser's SpeechRecognition, if it has one. Chrome/Edge send the audio to the
//    browser vendor's service, so it needs a connection; typing always works offline.
(function () {
    const AUDIO_BASE = '/static/audio/lg/';
    const existsCache = new Map();

    function slug(text) {
        return String(text || '').toLowerCase()
            .normalize('NFKD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    }

    // "Found" is remembered for the session; "not found" only for 15 s, so a recording that was just
    // added is picked up without reloading the page.
    async function fileExists(url) {
        const hit = existsCache.get(url);
        if (hit && (hit.ok || Date.now() - hit.at < 15000)) return hit.ok;
        let ok = false;
        try {
            const res = await fetch(url, { method: 'HEAD' });
            ok = res.ok && /audio|octet-stream|mpeg/i.test(res.headers.get('content-type') || 'audio');
        } catch (e) { ok = false; }
        existsCache.set(url, { ok, at: Date.now() });
        return ok;
    }

    function playUrl(url, rate) {
        return new Promise((resolve, reject) => {
            const a = new Audio(url);
            a.playbackRate = rate || 1;
            a.onended = resolve;
            a.onerror = () => reject(new Error('Could not play ' + url));
            a.play().catch(reject);
        });
    }

    function pickEnglishVoice() {
        const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
        return voices.find(v => /^en[-_](GB|US|UG|KE)/i.test(v.lang) && v.localService)
            || voices.find(v => /^en/i.test(v.lang)) || null;
    }

    const SignSpeech = {
        slug,
        hasEnglishVoice() { return !!window.speechSynthesis; },
        stop() {
            if (window.speechSynthesis) speechSynthesis.cancel();
            if (SignSpeech._audio) { SignSpeech._audio.pause(); SignSpeech._audio = null; }
            SignSpeech._token = (SignSpeech._token || 0) + 1;
        },

        // sentence: {english, luganda, glosses}. lang: 'english' | 'luganda'. rate: 0.5-1.5.
        // Resolves {mode: 'speech'|'audio'|'captions', note}. Captions are always shown by the UI.
        async speak(sentence, lang, rate = 1) {
            SignSpeech.stop();
            const token = SignSpeech._token;
            if (lang === 'english') {
                if (!window.speechSynthesis) return { mode: 'captions', note: 'This browser cannot speak. Read the caption.' };
                const words = sentence.english.split(/\s+/).length;
                const spoken = await new Promise(resolve => {
                    const u = new SpeechSynthesisUtterance(sentence.english);
                    u.rate = rate;
                    u.lang = 'en';
                    const v = pickEnglishVoice();
                    if (v) u.voice = v;
                    // Some browsers never fire onend when no voice is installed: never hang the button.
                    const guard = setTimeout(() => { speechSynthesis.cancel(); resolve(false); }, 3000 + (700 * words) / rate);
                    u.onend = () => { clearTimeout(guard); resolve(true); };
                    u.onerror = () => { clearTimeout(guard); resolve(false); };
                    speechSynthesis.speak(u);
                });
                return spoken ? { mode: 'speech', note: '' }
                    : { mode: 'captions', note: 'No English voice is available on this device. Read the caption.' };
            }

            // Luganda: whole-phrase recording first, then one file per sign.
            const phraseUrl = AUDIO_BASE + slug(sentence.luganda) + '.mp3';
            let queue = (await fileExists(phraseUrl)) ? [phraseUrl] : null;
            if (!queue && sentence.glosses && sentence.glosses.length) {
                const urls = sentence.glosses.map(g => AUDIO_BASE + slug(g) + '.mp3');
                const present = await Promise.all(urls.map(fileExists));
                if (present.every(Boolean)) queue = urls;
            }
            if (!queue) return { mode: 'captions', note: 'No Luganda recording yet for this sentence. Showing captions only.' };
            for (const url of queue) {
                if (token !== SignSpeech._token) break; // stopped meanwhile
                await playUrl(url, rate);
            }
            return { mode: 'audio', note: '' };
        },

        // Speech input. Returns null if the browser has no SpeechRecognition.
        createRecognizer(lang, handlers) {
            const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!Rec) return null;
            const r = new Rec();
            r.lang = lang === 'luganda' ? 'lg-UG' : 'en-UG';
            r.interimResults = true;
            r.maxAlternatives = 1;
            r.onresult = e => {
                const res = e.results[e.results.length - 1];
                handlers.onText(res[0].transcript, res.isFinal);
            };
            r.onerror = e => handlers.onError && handlers.onError(e.error);
            r.onend = () => handlers.onEnd && handlers.onEnd();
            return r;
        },
    };

    window.SignSpeech = SignSpeech;
})();
