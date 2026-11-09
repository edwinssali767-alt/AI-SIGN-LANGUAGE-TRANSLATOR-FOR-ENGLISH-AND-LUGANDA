const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SB = require('../frontend/sentence-builder.js');

const dataDir = path.join(__dirname, '..', 'frontend', 'data');
const vocab = JSON.parse(fs.readFileSync(path.join(dataDir, 'vocabulary.json'), 'utf8'));
const patterns = JSON.parse(fs.readFileSync(path.join(dataDir, 'patterns.json'), 'utf8'));
const builder = SB.create(vocab, patterns);

test('vocabulary: about 80 signs, unique glosses, all flagged unverified', () => {
    assert.ok(vocab.signs.length >= 70);
    assert.equal(new Set(vocab.signs.map(s => s.gloss)).size, vocab.signs.length);
    for (const s of vocab.signs) {
        assert.match(s.status, /needs verification by a deaf USL signer/);
        assert.ok(s.english && s.luganda && s.category && s.media, s.gloss);
    }
});

test('ME WANT WATER -> I want water / Njagala amazzi', () => {
    const r = builder.build(['ME', 'WANT', 'WATER']);
    assert.equal(r.english, 'I want water.');
    assert.equal(r.luganda, 'Njagala amazzi.');
    assert.equal(r.matched, true);
});

test('third person conjugation in English and Luganda', () => {
    const r = builder.build(['HE_SHE', 'WANT', 'FOOD']);
    assert.equal(r.english, 'He/she wants food.');
    assert.equal(r.luganda, 'Ayagala emmere.');
});

test('object article: I need a doctor', () => {
    assert.equal(builder.build(['ME', 'NEED', 'DOCTOR']).english, 'I need a doctor.');
});

test('adjective pattern uses be: I am hungry / we are tired', () => {
    assert.equal(builder.build(['ME', 'HUNGRY']).english, 'I am hungry.');
    assert.equal(builder.build(['ME', 'HUNGRY']).luganda, 'Nnina enjala.');
    assert.equal(builder.build(['WE', 'TIRED']).english, 'We are tired.');
});

test('negation uses the plain verb: He does not go', () => {
    assert.equal(builder.build(['HE_SHE', 'NOT', 'GO']).english, 'He/she does not go.');
    assert.equal(builder.build(['ME', 'NOT', 'UNDERSTAND']).english, 'I do not understand.');
});

test('questions: where is the toilet / where do you go', () => {
    assert.equal(builder.build(['WHERE', 'TOILET']).english, 'Where is the toilet?');
    assert.equal(builder.build(['WHERE', 'YOU', 'GO']).english, 'Where do you go?');
    assert.equal(builder.build(['WHERE', 'YOU', 'GO']).luganda, 'Ogenda wa?');
});

test('exact greeting and fixed phrases', () => {
    assert.equal(builder.build(['HELLO', 'HOW', 'YOU']).luganda, 'Oli otya?');
    assert.equal(builder.build(['YOU', 'NAME', 'WHAT']).english, 'What is your name?');
});

test('no pattern -> readable phrase, never empty', () => {
    const r = builder.build(['WATER', 'TOMORROW', 'DOCTOR']);
    assert.equal(r.matched, false);
    assert.equal(r.english, 'Water tomorrow doctor.');
    assert.ok(r.luganda.length > 0);
});

test('unknown gloss is kept as a word, input is normalised', () => {
    const r = builder.build(['me', 'want', 'zebra']);
    assert.equal(r.glosses[0], 'ME');
    assert.match(r.english, /zebra/);
});

test('empty input', () => {
    assert.equal(builder.build([]).english, '');
});

test('new patterns can be added without code changes', () => {
    const custom = SB.create(vocab, { sentence: [{ id: 't', match: ['WATER', 'PLEASE'], exact: true, english: 'Water please!', luganda: 'Amazzi nsaba!' }] });
    assert.equal(custom.build(['WATER', 'PLEASE']).luganda, 'Amazzi nsaba!');
});

test('SignBuffer: adds each sign once, finishes after 1.5s without a hand', () => {
    const b = new SB.SignBuffer();
    assert.equal(b.update({ state: 'result', label: 'ME' }, 0).added, 'ME');
    assert.equal(b.update({ state: 'result', label: 'ME' }, 100).added, null); // same held sign
    assert.equal(b.update({ state: 'result', label: 'WANT' }, 200).added, 'WANT');
    assert.equal(b.update({ state: 'no_hand' }, 300).finished, null);
    assert.equal(b.update({ state: 'no_hand' }, 1700).finished, null); // 1400ms
    assert.deepEqual(b.update({ state: 'no_hand' }, 1800).finished, ['ME', 'WANT']); // 1500ms
    assert.equal(b.glosses.length, 0);
});

test('SignBuffer: same sign can repeat after the hand drops; unknown is ignored', () => {
    const b = new SB.SignBuffer();
    b.update({ state: 'result', label: 'YES' }, 0);
    b.update({ state: 'unknown' }, 50);
    b.update({ state: 'no_hand' }, 100);
    assert.equal(b.update({ state: 'result', label: 'YES' }, 200).added, 'YES');
    assert.deepEqual(b.finish(), ['YES', 'YES']);
});

test('SignBuffer: no sentence is finished when nothing was signed', () => {
    const b = new SB.SignBuffer();
    assert.equal(b.update({ state: 'no_hand' }, 0).finished, null);
    assert.equal(b.update({ state: 'no_hand' }, 5000).finished, null);
});
