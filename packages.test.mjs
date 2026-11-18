import test from 'node:test';
import assert from 'node:assert/strict';
import { getScanStops, matchBarcode, stopProgress, pruneReadings, getPackageNotice } from './packages.mjs';

const text = '7. Example #1234\n - J4K8\n - L9M2\n - N5R6\n\n12. Other #5678\n - X7Y8';

test('new-stop notices depend on prior appearances, not confirmations', () => {
  const stop = getScanStops(text).stops[0];
  const readings = new Set();
  const shown = new Set();
  assert.deepEqual(getPackageNotice(stop, readings, shown), { isNew: true, countLabel: '1 bag of 3 bags' });
  assert.equal(shown.size, 0);
  shown.add(stop.number);
  assert.deepEqual(getPackageNotice(stop, readings, shown), { isNew: false, countLabel: '1 bag of 3 bags' });
  assert.equal(readings.size, 0);
  shown.clear();
  assert.equal(getPackageNotice(stop, readings, shown).isNew, true);
});

test('notices show only pluralized bag progress for single and multi-package stops', () => {
  const [multiple, single] = getScanStops(text).stops;
  const shown = new Set([multiple.number]);
  const readings = new Set(['J4K8']);
  assert.deepEqual(getPackageNotice(multiple, readings, shown), { isNew: false, countLabel: '2 bags of 3 bags' });
  readings.add('L9M2');
  assert.deepEqual(getPackageNotice(multiple, readings, shown), { isNew: false, countLabel: '3 bags of 3 bags' });
  assert.deepEqual(getPackageNotice(single, readings, shown), { isNew: true, countLabel: '1 bag of 1 bag' });
  assert.equal(stopProgress(single, readings).complete, false);
  readings.add('X7Y8');
  assert.equal(stopProgress(single, readings).complete, true);
});

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

test('matches decoded payloads to listed short IDs and never guesses O/0/Q', () => {
  const { stops } = getScanStops(text);
  const readings = new Set();
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
  assert.equal(matchBarcode('fullSecondJ4K8', stops, new Set()).stop.number, 2);
  assert.match(matchBarcode('otherPrefixJ4K8', stops, new Set()).message, /multiple/);
  assert.match(matchBarcode('unknownIDAB12', stops, new Set()).message, /not in the stop list/);
});

test('counts unique confirmed barcodes in scan order, without printed bag positions', () => {
  const { stops } = getScanStops(text);
  const readings = new Set(['J4K8', 'L9M2']);
  assert.deepEqual(stopProgress(stops[0], readings), {
    count: 2, total: 3, complete: false
  });
  const candidate = matchBarcode('trackingN5R6', stops, readings);
  assert.equal(candidate.kind, 'candidate');
  assert.equal(readings.size, 2);
  readings.add(candidate.packageId);
  readings.add(candidate.packageId);
  assert.equal(stopProgress(stops[0], readings).complete, true);
  assert.equal(stopProgress(stops[0], readings).count, 3);
  assert.equal(matchBarcode('trackingN5R6', stops, readings).kind, 'duplicate');
});

test('a one-package stop completes from its barcode alone', () => {
  const stop = getScanStops(text).stops[1];
  assert.deepEqual(stopProgress(stop, new Set()), { count: 0, total: 1, complete: false });
  assert.deepEqual(stopProgress(stop, new Set(['X7Y8'])), { count: 1, total: 1, complete: true });
});

test('deleting a package updates totals and removes its saved scan, including on re-add', () => {
  const readings = new Set(['J4K8', 'L9M2']);
  const { stops } = getScanStops('7. Example #1234\n - J4K8\n - N5R6\n\n12. Other #5678\n - X7Y8');
  pruneReadings(stops, readings);
  assert.deepEqual([...readings], ['J4K8']);
  assert.deepEqual(stopProgress(stops[0], readings), { count: 1, total: 2, complete: false });
  const readded = getScanStops(text).stops;
  assert.equal(matchBarcode('trackingL9M2', readded, readings).kind, 'candidate');
  assert.equal(stopProgress(readded[0], readings).total, 3);
});

test('deleting an unscanned package recomputes completion; deleting a stop prunes only its scans', () => {
  const readings = new Set(['J4K8', 'L9M2', 'X7Y8']);
  const remaining = getScanStops('7. Example #1234\n - J4K8\n - L9M2').stops;
  pruneReadings(remaining, readings);
  assert.deepEqual([...readings], ['J4K8', 'L9M2']);
  assert.deepEqual(stopProgress(remaining[0], readings), { count: 2, total: 2, complete: true });
  pruneReadings([], readings);
  assert.equal(readings.size, 0);
});

test('deleting the last ID at one stop leaves other stops scannable and preserves stop numbers', () => {
  const result = getScanStops('7. Example #1234\n -\n\n12. Other #5678\n - X7Y8');
  assert.equal(result.error, null);
  assert.deepEqual(result.stops.map(stop => stop.number), [7, 12]);
  assert.deepEqual(stopProgress(result.stops[0], new Set()), { count: 0, total: 0, complete: false });
  assert.equal(matchBarcode('trackingX7Y8', result.stops, new Set()).stop.number, 12);
  assert.match(getScanStops('7. Example #1234\n -').error, /at least one/);
});

test('deleting all packages but keeping headings still clears saved scans', () => {
  const readings = new Set(['J4K8', 'X7Y8']);
  const emptied = getScanStops('7. Example #1234\n -\n\n12. Other #5678\n -');
  assert.match(emptied.error, /at least one/);
  assert.equal(emptied.stops.length, 2);
  pruneReadings(emptied.stops, readings);
  assert.equal(readings.size, 0);
  assert.equal(matchBarcode('trackingJ4K8', getScanStops(text).stops, readings).kind, 'candidate');
});
