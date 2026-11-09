// Sign renderers. A renderer shows ONE item and resolves when it has finished.
//   render(item, stage, opts) -> Promise<void>      item: {type:'sign'|'fingerspell', gloss|letters, word}
//   cancel() -> void                                  stop immediately (pause / replay / next)
// ClipRenderer plays recorded clips from /static/signs. To use a Three.js landmark-driven avatar later,
// write another class with the same two methods and pass it to SignPlayer: nothing else changes.
(function () {
    const SIGN_BASE = '/static/signs/';
    const cache = new Map();

    // "Found" is remembered for the session; "not found" for 15 s, so newly added clips show up without a reload.
    function exists(url) {
        const hit = cache.get(url);
        if (hit && (hit.ok || Date.now() - hit.at < 15000)) return Promise.resolve(hit.ok);
        return fetch(url, { method: 'HEAD' })
            .then(r => r.ok && !/json|html/i.test(r.headers.get('content-type') || ''))
            .catch(() => false)
            .then(ok => { cache.set(url, { ok, at: Date.now() }); return ok; });
    }

    function wait(ms, ctl) {
        return new Promise(resolve => {
            const t = setTimeout(resolve, ms);
            ctl.stops.push(() => { clearTimeout(t); resolve(); });
        });
    }

    function card(stage, big, small) {
        stage.innerHTML = '';
        const d = document.createElement('div');
        d.className = 'tts-card';
        const b = document.createElement('span');
        b.className = 'tts-card-big';
        b.textContent = big;
        d.appendChild(b);
        if (small) {
            const s = document.createElement('span');
            s.className = 'tts-card-small';
            s.textContent = small;
            d.appendChild(s);
        }
        stage.appendChild(d);
    }

    class ClipRenderer {
        constructor() { this.ctl = { stops: [] }; }

        cancel() {
            const stops = this.ctl.stops;
            this.ctl = { stops: [] };
            stops.forEach(fn => fn());
        }

        async render(item, stage, opts) {
            const ctl = this.ctl;
            const speed = opts.speed || 1;
            if (item.type === 'fingerspell') return this._spell(item, stage, speed, ctl);

            const base = SIGN_BASE + item.gloss.toLowerCase();
            if (await exists(base + '.mp4')) return this._video(base + '.mp4', stage, speed, ctl);
            if (await exists(base + '.png')) return this._image(base + '.png', item, stage, 1800 / speed, ctl);
            // No recorded clip yet: show a clearly labelled caption card instead of pretending.
            card(stage, item.gloss.replace(/_/g, ' '), 'No sign clip recorded yet');
            return wait(1600 / speed, ctl);
        }

        _video(url, stage, speed, ctl) {
            return new Promise(resolve => {
                stage.innerHTML = '';
                const v = document.createElement('video');
                v.src = url;
                v.muted = true;
                v.playsInline = true;
                v.playbackRate = speed;
                v.className = 'tts-media';
                stage.appendChild(v);
                const done = () => resolve();
                v.onended = done;
                v.onerror = done;
                ctl.stops.push(() => { v.pause(); resolve(); });
                v.play().catch(done);
                setTimeout(done, 9000); // safety: never hang on a broken file
            });
        }

        _image(url, item, stage, ms, ctl) {
            stage.innerHTML = '';
            const img = document.createElement('img');
            img.src = url;
            img.alt = 'Sign for ' + item.gloss.replace(/_/g, ' ').toLowerCase();
            img.className = 'tts-media';
            stage.appendChild(img);
            return wait(ms, ctl);
        }

        async _spell(item, stage, speed, ctl) {
            for (const letter of item.letters) {
                if (ctl !== this.ctl) return;
                const url = SIGN_BASE + 'letters/' + letter.toLowerCase();
                if (await exists(url + '.png')) {
                    await this._image(url + '.png', { gloss: 'letter ' + letter }, stage, 800 / speed, ctl);
                } else {
                    card(stage, letter, 'Fingerspelling: ' + item.word);
                    await wait(800 / speed, ctl);
                }
            }
        }
    }

    // Plays a list of items in order with a pause between signs.
    class SignPlayer {
        constructor(opts) {
            this.renderer = opts.renderer;
            this.stage = opts.stage;
            this.onStep = opts.onStep || (() => {});
            this.onEnd = opts.onEnd || (() => {});
            this.items = [];
            this.index = 0;
            this.speed = 1;
            this.gapMs = 400;
            this.playing = false;
            this._run = 0;
        }

        load(items) { this.pause(); this.items = items; this.index = 0; }
        get atEnd() { return this.index >= this.items.length; }

        async play() {
            if (this.playing || !this.items.length) return;
            if (this.atEnd) this.index = 0;
            this.playing = true;
            const run = ++this._run;
            while (this.playing && run === this._run && this.index < this.items.length) {
                const i = this.index;
                this.onStep(i, this.items[i]);
                await this.renderer.render(this.items[i], this.stage, { speed: this.speed });
                if (!this.playing || run !== this._run) return;
                this.index = i + 1;
                if (this.index < this.items.length && this.gapMs) {
                    await new Promise(r => setTimeout(r, this.gapMs));
                }
            }
            if (run === this._run) { this.playing = false; this.onEnd(); }
        }

        pause() { this.playing = false; this._run++; this.renderer.cancel(); }
        replay() { this.pause(); this.index = 0; return this.play(); }

        step(delta) {
            const wasPlaying = this.playing;
            this.pause();
            this.index = Math.max(0, Math.min(this.items.length - 1, this.index + delta));
            this.onStep(this.index, this.items[this.index]);
            return this.renderer.render(this.items[this.index], this.stage, { speed: this.speed })
                .then(() => { if (wasPlaying) { this.index++; return this.play(); } });
        }
    }

    window.ClipRenderer = ClipRenderer;
    window.SignPlayer = SignPlayer;
})();
