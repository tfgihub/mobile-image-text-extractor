import test from 'node:test';
import assert from 'node:assert/strict';
import { getScanStops, readBagCount, matchBarcode, validateBagMatch, stopProgress } from './packages.mjs';

const text = '7. Example #1234\n - J4K8\n - L9M2\n - N5R6\n\n12. Other #5678\n - X7Y8';
const record = (code, bagNumber, totalBags = 3) => ({ code, bagNumber, totalBags });

test('validates explicit stop numbers separately from recipient reference numbers', () => {
  const parsed = getScanStops(text);
  assert.deepEqual(parsed.stops.map(stop => stop.number), [7, 12]);
  assert.match(getScanStops('').error, /Add stops/);
  assert.match(getScanStops('1. A\n - ID with spaces').error, /format/);
  assert.match(getScanStops('1. A').error, /at least one/);
  assert.match(getScanStops('1. A\n - ABC\n\n1. B\n - DEF').error, /unique/);
  assert.match(getScanStops('0. A\n - ABC').error, /positive/);
  assert.match(getScanStops('1. A\n - ABC\n\n2. B\n - ABC').error, /multiple stops/);
});

test('reads only bag counts from OCR; printed ID errors cannot change barcode identity', () => {
  assert.deepEqual(readBagCount('1 of 3 bags\nWeight: 3 lbs\nWR0N'), { bagNumber: 1, totalBags: 3, error: null });
  assert.deepEqual(readBagCount('_10f 3 bags'), { bagNumber: 1, totalBags: 3, error: null });
  assert.deepEqual(readBagCount('3of3bags'), { bagNumber: 3, totalBags: 3, error: null });
  assert.match(readBagCount('No count').error, /not readable/);
  assert.match(readBagCount('0 of 3 bags').error, /invalid/);
  assert.match(readBagCount('4 of 3 bags').error, /invalid/);
  assert.match(readBagCount('1 of 3 bags\n2 of 4 bags').error, /Multiple/);
});

test('matches decoded payloads to listed short IDs and never guesses O/0/Q', () => {
  const { stops } = getScanStops(text);
  const readings = new Map();
  const match = matchBarcode('EXAMPLETRACK12345J4K8', stops, readings);
  assert.equal(match.kind, 'candidate');
  assert.equal(match.packageId, 'J4K8');
  assert.equal(match.stop.number, 7);
  assert.equal(readings.size, 0);
  assert.equal(matchBarcode('EXAMPLETRACK12345J4KB', stops, readings).kind, 'check');
  assert.equal(matchBarcode('https://example.test/J4K8', stops, readings).kind, 'check');
});

test('prefers a full exact ID and rejects ambiguous suffixes without assigning', () => {
  const stops = getScanStops('1. A\n - fullFirstJ4K8\n\n2. B\n - fullSecondJ4K8').stops;
  assert.equal(matchBarcode('fullSecondJ4K8', stops, new Map()).stop.number, 2);
  assert.match(matchBarcode('otherPrefixJ4K8', stops, new Map()).message, /multiple/);
  assert.match(matchBarcode('unknownIDAB12', stops, new Map()).message, /not in the stop list/);
});

test('bags 1 and 3 of 3 remain incomplete until bag 2 is confirmed', () => {
  const { stops } = getScanStops(text);
  const readings = new Map([['J4K8', record('J4K8', 1)], ['L9M2', record('L9M2', 3)]]);
  assert.deepEqual(stopProgress(stops[0], readings), {
    count: 2, total: 3, listedFound: 2, listedTotal: 3, conflict: false, complete: false
  });
  const candidate = matchBarcode('trackingN5R6', stops, readings);
  const confirmed = validateBagMatch(candidate, 2, 3, readings);
  assert.equal(confirmed.kind, 'match');
  assert.equal(readings.size, 2);
  readings.set(confirmed.packageId, confirmed);
  assert.equal(stopProgress(stops[0], readings).complete, true);
  assert.equal(matchBarcode('trackingN5R6', stops, readings).kind, 'duplicate');
});

test('conflicting totals, repeated positions, invalid detected counts never count', () => {
  const { stops } = getScanStops(text);
  const readings = new Map([['J4K8', record('J4K8', 1)]]);
  const candidate = matchBarcode('trackingL9M2', stops, readings);
  for (const [bag, total] of [[0, 3], [4, 3], [1.5, 3], [1, 3], [2, 4], [NaN, 3]]) {
    assert.equal(validateBagMatch(candidate, bag, total, readings).kind, 'check');
  }
  assert.equal(readings.size, 1);
});

test('screenshot package rows set the total before scanning and reject a first-label mismatch', () => {
  const { stops } = getScanStops(text);
  const readings = new Map();
  assert.equal(stopProgress(stops[0], readings).total, 3);
  assert.equal(stopProgress(stops[1], readings).total, 1);
  const candidate = matchBarcode('trackingX7Y8', stops, readings);
  const mismatch = validateBagMatch(candidate, 1, 3, readings);
  assert.equal(mismatch.kind, 'check');
  assert.match(mismatch.message, /screenshot list has 1 package\(s\).*label says 3 bags/);
  assert.equal(readings.size, 0);
  assert.equal(stopProgress(stops[1], readings).total, 1);
  const accepted = validateBagMatch(candidate, 1, 1, readings);
  assert.equal(accepted.kind, 'match');
  readings.set(accepted.packageId, accepted);
  assert.equal(stopProgress(stops[1], readings).complete, true);
});

test('missing IDs, editing, and mixed groups prevent premature green completion', () => {
  const stop = getScanStops(text).stops[0];
  stop.packages.pop();
  const readings = new Map([['J4K8', record('J4K8', 1)], ['L9M2', record('L9M2', 3)]]);
  assert.deepEqual(stopProgress(stop, readings), {
    count: 2, total: 2, listedFound: 2, listedTotal: 2, conflict: true, complete: false
  });
  readings.set('L9M2', record('L9M2', 2, 4));
  assert.equal(stopProgress(stop, readings).conflict, true);
  assert.equal(stopProgress({ packages: [] }, readings).complete, false);
});
