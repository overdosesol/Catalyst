import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/refresh/tag-refresher.js', 'utf-8');

test('the animals theme asks for stories, not for cuteness', () => {
  const line = src.split('\n').find(l => l.trim().startsWith('animals:'));
  assert.ok(line, 'animals theme line not found');
  for (const word of ['rescue', 'escape', 'named', 'unusual']) {
    assert.ok(line.toLowerCase().includes(word), `theme must mention ${word}: ${line}`);
  }
  for (const banned of ['cute', 'wholesome']) {
    assert.ok(!line.toLowerCase().includes(banned), `theme must not ask for ${banned}`);
  }
});

test('the system prompt demands a named subject in the typical post', () => {
  assert.ok(
    /NAMED (character|subject)/i.test(src),
    'the litmus test about named subjects must stay in the prompt'
  );
});
