import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSavedRun, serializeRun } from './saved-run.mjs';

const list = '7. Example #1001\n - AB12';

test('saved runs round-trip list, confirmed IDs, appearance history and the last accepted assignment', () => {
  const raw = serializeRun(list, new Set(['AB12']), new Set([7]));
  assert.deepEqual(parseSavedRun(raw), {
    list, acceptedList: list, readings: new Set(['AB12']), shownStops: new Set([7])
  });
});

test('partially edited text can be restored without losing the previous confirmed assignment', () => {
  const raw = serializeRun('7. Example #1001\n - AB1', new Set(['AB12']), new Set([7]), list);
  assert.equal(parseSavedRun(raw).acceptedList, list);
  assert.match(parseSavedRun(raw).list, /AB1$/);
});

test('corrupt, unsupported, or invalid saved records fail explicitly', () => {
  const valid = JSON.parse(serializeRun(list, new Set(), new Set()));
  for (const raw of [
    '{broken', 'null', '[]',
    JSON.stringify({ ...valid, version: 2 }),
    JSON.stringify({ ...valid, list: '' }),
    JSON.stringify({ ...valid, acceptedList: null }),
    JSON.stringify({ ...valid, readings: ['AB1'] }),
    JSON.stringify({ ...valid, readings: [1234] }),
    JSON.stringify({ ...valid, shownStops: [0] }),
    JSON.stringify({ ...valid, shownStops: ['7'] })
  ]) assert.throws(() => parseSavedRun(raw));
});
