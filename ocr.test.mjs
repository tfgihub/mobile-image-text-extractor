import test from 'node:test';
import assert from 'node:assert/strict';
import { screenshotText } from './ocr.mjs';
import { parseStops } from './stops.mjs';

const line = (text, x, y, width = 100, height = 20) => ({
  text, bbox: { x0: x, y0: y, x1: x + width, y1: y + height }
});
const data = lines => ({ text: lines.map(item => item.text).join('\n'), lines });
const rows = [
  line('#3001', 300, 100, 60), line('Alex Sample', 20, 100),
  line('Package ID', 60, 140), line('72LM', 60, 170),
  line('p', 60, 210, 8, 10), line('QVZX', 60, 235),
  line('Package ID', 60, 280), line('RWKP', 60, 310),
  line('#3002', 300, 370, 60), line('Jamie Example', 20, 350, 150, 60),
  line('dackage ID', 60, 420), line('CD34', 60, 450)
];

test('visual rows restore recipient/reference order and recover aligned partial package labels', () => {
  const parsed = parseStops(screenshotText(data(rows)));
  assert.deepEqual(parsed, {
    stops: [
      { address: 'Alex Sample #3001', packages: ['72LM', 'QVZX', 'RWKP'] },
      { address: 'Jamie Example #3002', packages: ['CD34'] }
    ], warnings: []
  });
});

test('a label split into multiple horizontal OCR fragments becomes one visual row', () => {
  const text = screenshotText(data([
    line('e ID', 118, 101, 30), line('Pp', 60, 100, 10), line('kag', 80, 99, 30),
    line('72LM', 60, 130)
  ]));
  assert.equal(text, 'Pp kag e ID\n72LM');
});

test('partial-label recovery requires a nearby full label and matching package column', () => {
  for (const replacement of [
    line('p', 20, 210, 8, 10),
    line('p', 60, 190, 8, 10)
  ]) {
    const changed = rows.map((item, index) => index === 4 ? replacement : item);
    const parsed = parseStops(screenshotText(data(changed)));
    assert.deepEqual(parsed.stops[0].packages, ['72LM', 'RWKP']);
    assert.match(parsed.warnings.join(' '), /Unlabelled text "QVZX"/);
  }
  const noAnchor = screenshotText(data([line('p', 60, 100), line('QVZX', 60, 130)]));
  assert.equal(noAnchor, 'p\nQVZX');
});

test('partial labels and aligned screen words cannot invent packages, but explicit all-letter IDs still work', () => {
  const changed = rows.map((item, index) => index === 5 ? { ...item, text: 'NEXT' } : item);
  const parsed = parseStops(screenshotText(data(changed)));
  assert.deepEqual(parsed.stops[0].packages, ['72LM', 'RWKP']);
  const partial = parseStops('Alex Sample #3001\nPackage\n)\nNEXT\nDONE');
  assert.deepEqual(partial.stops[0].packages, []);
  assert.match(partial.warnings.join(' '), /1 package ID not detected/);
  assert.deepEqual(parseStops('Alex Sample #3001\nPackage ID\nNEXT').stops[0].packages, ['NEXT']);
});

test('unreadable or clipped package rows remain flagged after geometry recovery', () => {
  const parsed = parseStops(screenshotText(data([...rows, line('Package ID', 60, 500)])));
  assert.deepEqual(parsed.warnings, ['Jamie Example #3002: 1 package ID not detected.']);
});

test('text-only OCR results preserve their text without requiring layout metadata', () => {
  const text = 'Alex Sample #3001\nPackage ID\nQVZX';
  assert.equal(screenshotText({ text }), text);
  assert.equal(screenshotText({ text, lines: [] }), text);
});

test('malformed OCR text and geometry fail explicitly', () => {
  assert.throws(() => screenshotText({}), /did not return text/);
  assert.throws(() => screenshotText({ text: '', lines: {} }), /invalid text positions/);
  assert.throws(() => screenshotText(data([{ text: 'QVZX' }])), /invalid text positions/);
  assert.throws(() => screenshotText(data([line('QVZX', 0, 0, 0)])), /invalid text positions/);
});
