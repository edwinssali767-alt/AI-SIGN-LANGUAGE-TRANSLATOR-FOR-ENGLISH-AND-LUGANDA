const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const TG = require('../frontend/text-to-gloss.js');

const dataDir = path.join(__dirname, '..', 'frontend', 'data');
const vocab = JSON.parse(fs.readFileSync(path.join(dataDir, 'vocabulary.json'), 'utf8'));
const patterns = JSON.parse(fs.readFileSync(path.join(dataDir, 'patterns.json'), 'utf8'));
const t = TG.create(vocab, patterns);

test('plain sentence drops filler words', () => {
    assert.deepEqual(t.toGloss('I want the water').glosses, ['ME', 'WANT', 'WATER']);
});

test('synonyms and verb forms map to the same sign', () => {
    assert.deepEqual(t.toGloss('She needs a doctor').glosses, ['HE_SHE', 'NEED', 'DOCTOR']);
    assert.deepEqual(t.toGloss('thanks').glosses, ['THANK_YOU']);
});

test('multi-word phrases are matched whole', () => {
    assert.deepEqual(t.toGloss('Thank you').glosses, ['THANK_YOU']);
});

test('question words move to the end', () => {
    assert.deepEqual(t.toGloss('Where is the toilet?').glosses, ['TOILET', 'WHERE']);
});

test('time words move to the front', () => {
    assert.deepEqual(t.toGloss('I go home tomorrow').glosses, ['TOMORROW', 'ME', 'GO', 'HOME']);
});

test('negation becomes NOT', () => {
    assert.deepEqual(t.toGloss("I don't understand").glosses, ['ME', 'NOT', 'UNDERSTAND']);
    assert.deepEqual(t.toGloss('I do not want food').glosses, ['ME', 'NOT', 'WANT', 'FOOD']);
});

test('digits are signed one by one', () => {
    assert.deepEqual(t.toGloss('5').glosses, ['FIVE']);
    assert.deepEqual(t.toGloss('12').glosses, ['ONE', 'TWO']);
});

test('unknown words are fingerspelled letter by letter', () => {
    const r = t.toGloss('My name is Kato');
    assert.deepEqual(r.glosses, ['ME', 'NAME']);
    const fs = r.items.find(i => i.type === 'fingerspell');
    assert.equal(fs.word, 'kato');
    assert.deepEqual(fs.letters, ['K', 'A', 'T', 'O']);
});

test('fingerspelling can be switched off in patterns.json', () => {
    const off = TG.create(vocab, { text_to_gloss: { fingerspell_unknown: false } });
    assert.equal(off.toGloss('zebra').items.length, 0);
});

test('Luganda input maps back to signs', () => {
    assert.deepEqual(t.toGloss('amazzi', 'luganda').glosses, ['WATER']);
    assert.deepEqual(t.toGloss('weebale', 'luganda').glosses, ['THANK_YOU']);
    assert.deepEqual(t.toGloss('ayagala emmere', 'luganda').glosses, ['WANT', 'FOOD']);
});

test('punctuation, case and empty input', () => {
    assert.deepEqual(t.toGloss('  HELLO!!  ').glosses, ['HELLO']);
    assert.deepEqual(t.toGloss('').items, []);
    assert.deepEqual(t.toGloss('?!').items, []);
});

test('round trip: signs -> sentence -> signs keeps the meaning', () => {
    const SB = require('../frontend/sentence-builder.js');
    const b = SB.create(vocab, patterns);
    const sentence = b.build(['ME', 'WANT', 'WATER']).english;
    assert.deepEqual(t.toGloss(sentence).glosses, ['ME', 'WANT', 'WATER']);
});
