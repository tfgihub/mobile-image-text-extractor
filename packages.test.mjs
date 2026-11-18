import test from 'node:test';
import assert from 'node:assert/strict';
import { getScanStops, findNextPackage, stopProgress } from './packages.mjs';

const text = '7. 100 Example Street\n - spAlphaABC\n - spBetaDEF\n\n12. Locker North\n - ID-123_ABC';

test('preserves explicit stop numbers and validates the editable list', () => {
  const parsed = getScanStops(text);
  assert.equal(parsed.error, null);
  assert.deepEqual(parsed.stops.map(stop => stop.number), [7, 12]);
  assert.match(getScanStops('').error, /Add stops/);
  assert.match(getScanStops('1. Locker\n - ID with spaces').error, /format/);
  assert.match(getScanStops('1. Locker').error, /at least one/);
  assert.match(getScanStops('1. A\n - ABC\n\n1. B\n - DEF').error, /unique/);
  assert.match(getScanStops('0. A\n - ABC').error, /positive/);
  assert.match(getScanStops('1. A\n - ABC\n\n2. B\n - ABC').error, /multiple stops/);
});

test('matches full IDs exactly, including case, hyphens, and underscores', () => {
  const { stops } = getScanStops(text);
  assert.equal(findNextPackage('AlphaABC', stops, new Set()), null);
  assert.equal(findNextPackage('XspAlphaABC', stops, new Set()), null);
  assert.equal(findNextPackage('spAlphaABC9', stops, new Set()), null);
  assert.equal(findNextPackage('SPALPHAABC', stops, new Set()), null);
  assert.equal(findNextPackage('ID-123', stops, new Set()), null);
  assert.equal(findNextPackage('Package: spAlphaABC.', stops, new Set()).stop.number, 7);
  assert.equal(findNextPackage('(ID-123_ABC)', stops, new Set()).stop.number, 12);
});

test('counts each ID once and presents multiple IDs one at a time', () => {
  const { stops } = getScanStops(text);
  const found = new Set();
  const frame = 'spAlphaABC spAlphaABC spBetaDEF';
  const first = findNextPackage(frame, stops, found);
  found.add(first.packageId);
  assert.deepEqual(stopProgress(first.stop, found), { count: 1, total: 2, complete: false });
  const second = findNextPackage(frame, stops, found);
  assert.equal(second.packageId, 'spBetaDEF');
  found.add(second.packageId);
  assert.deepEqual(stopProgress(second.stop, found), { count: 2, total: 2, complete: true });
  assert.equal(findNextPackage(frame, stops, found), null);
  assert.deepEqual(stopProgress(stops[1], found), { count: 0, total: 1, complete: false });
});

test('deduplicates repeated IDs within a stop and recomputes completion after editing', () => {
  const parsed = getScanStops('1. A\n - ABC123\n - ABC123');
  assert.equal(parsed.stops[0].packages.length, 1);
  const found = new Set(['ABC123']);
  assert.equal(stopProgress(parsed.stops[0], found).complete, true);
  const edited = getScanStops('1. A\n - ABC123\n - XYZ789');
  assert.deepEqual(stopProgress(edited.stops[0], found), { count: 1, total: 2, complete: false });
  assert.equal(stopProgress({ packages: [] }, found).complete, false);
});
