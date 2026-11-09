// Typed or spoken sentence -> ordered signs. Local only. Uses vocabulary.json (words and synonyms)
// and patterns.json -> text_to_gloss (word-order rules). Unknown words are fingerspelled.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TextToGloss = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    const MAX_PHRASE_WORDS = 3;

    function tokenize(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/[‘’]/g, "'")
            .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
            .split(/\s+/)
            .filter(Boolean);
    }

    function create(vocabulary, patterns) {
        const signs = Array.isArray(vocabulary) ? vocabulary : vocabulary.signs;
        const rules = Object.assign({
            ignore_words: [], negations: [], move_to_end_categories: ['question'], time_first: true, fingerspell_unknown: true,
        }, (patterns && patterns.text_to_gloss) || {});
        const ignore = new Set(rules.ignore_words);
        const negations = new Set(rules.negations);
        const byGloss = new Map(signs.map(s => [s.gloss, s]));

        // phrase -> gloss, per input language. Longer phrases are matched first.
        const index = { english: new Map(), luganda: new Map() };
        function addPhrase(lang, phrase, gloss) {
            const key = tokenize(phrase).join(' ');
            if (key && !index[lang].has(key)) index[lang].set(key, gloss);
        }
        for (const s of signs) {
            addPhrase('english', s.english, s.gloss);
            (s.synonyms || []).forEach(w => addPhrase('english', w, s.gloss));
            addPhrase('luganda', s.luganda, s.gloss);
            if (s.forms) Object.values(s.forms).forEach(f => addPhrase('luganda', f, s.gloss));
            if (s.english_3s) addPhrase('english', s.english_3s, s.gloss);
        }

        function matchAt(words, i, map) {
            for (let n = Math.min(MAX_PHRASE_WORDS, words.length - i); n >= 1; n--) {
                const gloss = map.get(words.slice(i, i + n).join(' '));
                if (gloss) return { gloss, used: n };
            }
            return null;
        }

        // lang: 'english' or 'luganda' (the language the user typed/spoke)
        function toGloss(text, lang = 'english') {
            const map = index[lang] || index.english;
            const words = tokenize(text);
            const items = [];
            let i = 0;
            while (i < words.length) {
                const hit = matchAt(words, i, map);
                if (hit) {
                    items.push({ type: 'sign', gloss: hit.gloss, word: words.slice(i, i + hit.used).join(' ') });
                    i += hit.used;
                    continue;
                }
                const w = words[i];
                i++;
                if (negations.has(w)) { items.push({ type: 'sign', gloss: 'NOT', word: w }); continue; }
                if (ignore.has(w)) continue;
                if (/^\d+$/.test(w)) { // digits are signed one by one
                    for (const d of w) { const g = map.get(d); if (g) items.push({ type: 'sign', gloss: g, word: d }); }
                    continue;
                }
                const letters = w.replace(/[^a-z]/g, '');
                if (rules.fingerspell_unknown && letters) items.push({ type: 'fingerspell', word: w, letters: letters.toUpperCase().split('') });
            }

            // Word order: time words first, question words last (topic-comment order).
            const cat = it => (it.type === 'sign' && byGloss.get(it.gloss) ? byGloss.get(it.gloss).category : '');
            let ordered = items;
            if (rules.time_first) ordered = [...ordered.filter(it => cat(it) === 'time'), ...ordered.filter(it => cat(it) !== 'time')];
            const tail = new Set(rules.move_to_end_categories);
            ordered = [...ordered.filter(it => !tail.has(cat(it))), ...ordered.filter(it => tail.has(cat(it)))];

            return { items: ordered, glosses: ordered.filter(it => it.type === 'sign').map(it => it.gloss) };
        }

        return { toGloss, tokenize };
    }

    return { create, tokenize };
});
