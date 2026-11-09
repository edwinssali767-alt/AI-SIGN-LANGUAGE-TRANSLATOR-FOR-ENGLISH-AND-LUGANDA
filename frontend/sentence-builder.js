// Signs -> sentence, fully local. Uses data/vocabulary.json and data/patterns.json (both editable).
// Works in the browser (window.SentenceBuilder) and in Node for tests.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SentenceBuilder = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    const DEFAULT_IDLE_MS = 1500;

    function normGloss(g) {
        return String(g || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    }

    function capitalise(s) {
        return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    }

    function create(vocabulary, patterns) {
        const signs = Array.isArray(vocabulary) ? vocabulary : vocabulary.signs;
        const byGloss = new Map(signs.map(s => [s.gloss, s]));
        const rules = (patterns && patterns.sentence) || [];

        function lookup(gloss) {
            const g = normGloss(gloss);
            return byGloss.get(g) || { gloss: g, category: 'unknown', english: g.toLowerCase().replace(/_/g, ' '), luganda: g.toLowerCase().replace(/_/g, ' ') };
        }

        function tokenMatches(spec, entry) {
            if (spec.charAt(0) === '@') return entry.category === spec.slice(1);
            return entry.gloss === normGloss(spec);
        }

        function firstPronoun(entries) {
            return entries.find(e => e.category === 'pronoun') || null;
        }

        function englishWord(entry, i, entries, subject, mod) {
            const prev = entries[i - 1];
            if (entry.category === 'verb') {
                if (mod === 'base') return entry.english;
                return subject && subject.person === '3s' ? (entry.english_3s || entry.english) : entry.english;
            }
            if (entry.category === 'pronoun' && prev && prev.category === 'verb') return entry.english_object || entry.english;
            if (entry.category === 'noun' && prev && prev.category === 'verb') return entry.english_obj || entry.english;
            return entry.english;
        }

        function lugandaWord(entry, subject) {
            if ((entry.category === 'verb' || entry.category === 'adjective') && entry.forms && subject) {
                return entry.forms[subject.person] || entry.luganda;
            }
            return entry.luganda;
        }

        function fill(template, entries, subject, lang) {
            return template.replace(/\{(be|do|\d+)(?::(\w+))?\}/g, (m, key, mod) => {
                if (key === 'be') return (subject && subject.be) || 'is';
                if (key === 'do') return subject && subject.person === '3s' ? 'does' : 'do';
                const i = Number(key) - 1;
                const entry = entries[i];
                if (!entry) return '';
                return lang === 'english' ? englishWord(entry, i, entries, subject, mod) : lugandaWord(entry, subject);
            });
        }

        function fallback(entries, subject) {
            const isQuestion = entries.some(e => e.category === 'question');
            const end = isQuestion ? '?' : '.';
            const english = entries.map((e, i) => englishWord(e, i, entries, subject)).join(' ');
            const luganda = entries.map(e => lugandaWord(e, subject)).join(' ');
            return { english: capitalise(english) + end, luganda: capitalise(luganda) + end };
        }

        // glosses: ['ME','WANT','WATER'] -> { english, luganda, matched, patternId, glosses }
        function build(glosses) {
            const list = (glosses || []).map(normGloss).filter(Boolean);
            if (!list.length) return { english: '', luganda: '', matched: false, patternId: null, glosses: [] };
            const entries = list.map(lookup);
            const subject = firstPronoun(entries);

            for (const rule of rules) {
                const spec = rule.match;
                if (rule.exact ? spec.length !== entries.length : spec.length > entries.length) continue;
                if (!spec.every((s, i) => tokenMatches(s, entries[i]))) continue;
                let english = fill(rule.english, entries, subject, 'english');
                let luganda = fill(rule.luganda, entries, subject, 'luganda');
                if (!rule.exact && entries.length > spec.length) {
                    const rest = fallback(entries.slice(spec.length), subject);
                    english = english.replace(/[.?]$/, '') + ' ' + rest.english.charAt(0).toLowerCase() + rest.english.slice(1);
                    luganda = luganda.replace(/[.?]$/, '') + ' ' + rest.luganda.charAt(0).toLowerCase() + rest.luganda.slice(1);
                }
                return { english: capitalise(english), luganda: capitalise(luganda), matched: true, patternId: rule.id, glosses: list };
            }
            const f = fallback(entries, subject);
            return { ...f, matched: false, patternId: null, glosses: list };
        }

        return { build, lookup, signs };
    }

    // Collects recognised signs and decides when the sentence is finished:
    // after `idleMs` with no hand, or when finish() is called (the Done button).
    class SignBuffer {
        constructor(opts = {}) {
            this.idleMs = opts.idleMs || DEFAULT_IDLE_MS;
            this.glosses = [];
            this.lastLabel = null;
            this.noHandSince = null;
        }

        // result: {state: 'result'|'unknown'|'no_hand', label}. Returns {added, finished}.
        update(result, now) {
            const out = { added: null, finished: null };
            if (result.state === 'no_hand') {
                this.lastLabel = null; // hand dropped: the same sign may be signed again
                if (this.noHandSince === null) this.noHandSince = now;
                if (this.glosses.length && now - this.noHandSince >= this.idleMs) out.finished = this.finish();
                return out;
            }
            this.noHandSince = null;
            if (result.state === 'result' && result.label && result.label !== this.lastLabel) {
                this.glosses.push(normGloss(result.label));
                this.lastLabel = result.label;
                out.added = normGloss(result.label);
            }
            return out;
        }

        // Done button or idle timeout. Returns the glosses and clears the buffer.
        finish() {
            const done = this.glosses;
            this.glosses = [];
            this.lastLabel = null;
            this.noHandSince = null;
            return done;
        }

        undo() { this.glosses.pop(); this.lastLabel = null; }
        clear() { this.glosses = []; this.lastLabel = null; this.noHandSince = null; }
    }

    return { create, SignBuffer, normGloss };
});
