import test from 'node:test';
import assert from 'node:assert/strict';
import { getScanStops, readBagLabel, inspectPackageLabel, stopProgress } from './packages.mjs';

const text = '7. 100 Example Street\n - packageExampleJ4K8\n - packageExampleL9M2\n - packageExampleN5R6\n\n12. Locker North\n - packageExampleX7Y8';
const frame = (code, number = 1, total = 3) => `1 Nov | EXAMPLETRACK12345${code} | 2-hour\nExample\n${number} of ${total} bags\nSp #: AbC9\nWeight: 3.6 lbs\n${code}`;
const record = (code, bagNumber, totalBags = 3) => ({ code, bagNumber, totalBags });

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

test('reads the bottom label code and bag position, not Sp # or tracking text', () => {
  assert.deepEqual(readBagLabel(frame('J4K8')), { kind: 'label', code: 'J4K8', bagNumber: 1, totalBags: 3 });
  assert.deepEqual(readBagLabel(frame('L9M2', 3)), { kind: 'label', code: 'L9M2', bagNumber: 3, totalBags: 3 });
  assert.deepEqual(readBagLabel('3of3bags\nl9m2'), { kind: 'label', code: 'L9M2', bagNumber: 3, totalBags: 3 });
  assert.deepEqual(readBagLabel('_10f 3 bags\nJ4K8'), { kind: 'label', code: 'J4K8', bagNumber: 1, totalBags: 3 });
  assert.equal(readBagLabel('J4K8').kind, 'reading');
  assert.equal(readBagLabel('1 of 3 bags').kind, 'reading');
  assert.equal(readBagLabel('Weight: 1 lb\nJ4K8\n0 of 3 bags').kind, 'check');
  assert.equal(readBagLabel('4 of 3 bags\nJ4K8').kind, 'check');
  assert.equal(readBagLabel('1 of 3 bags\nJ4K8\n2 of 3 bags\nL9M2').kind, 'check');
  assert.equal(readBagLabel('1 of 3 bags\nJ4K8\n1 of 4 bags').kind, 'check');
});

test('requires a unique four-character suffix match without fuzzy character substitutions', () => {
  const { stops } = getScanStops(text);
  const readings = new Map();
  const match = inspectPackageLabel(frame('j4k8'), stops, readings);
  assert.equal(match.kind, 'match');
  assert.equal(match.packageId, 'packageExampleJ4K8');
  assert.equal(match.stop.number, 7);
  assert.equal(inspectPackageLabel(frame('ZZ99'), stops, readings).kind, 'check');
  assert.equal(readings.size, 0);
  const collision = getScanStops('1. A\n - firstJ4K8\n\n2. B\n - secondJ4K8').stops;
  assert.match(inspectPackageLabel(frame('J4K8'), collision, readings).message, /multiple/);
  assert.equal(inspectPackageLabel(frame('J4KB'), stops, readings).kind, 'check');
});

test('bags 1 and 3 of 3 mean 2/3 found, not complete; bag 2 completes the group', () => {
  const stop = getScanStops(text).stops[0];
  const readings = new Map([
    ['packageExampleJ4K8', record('J4K8', 1)],
    ['packageExampleL9M2', record('L9M2', 3)]
  ]);
  assert.deepEqual(stopProgress(stop, readings), {
    count: 2, total: 3, listedFound: 2, listedTotal: 3, conflict: false, complete: false
  });
  const next = inspectPackageLabel(frame('N5R6', 2), [stop], readings);
  assert.equal(next.kind, 'match');
  readings.set(next.packageId, record(next.code, next.bagNumber, next.totalBags));
  assert.equal(stopProgress(stop, readings).complete, true);
  assert.equal(inspectPackageLabel(frame('N5R6', 2), [stop], readings).kind, 'duplicate');
  assert.equal(readings.size, 3);
});

test('label total prevents premature completion when the list is missing a package', () => {
  const stop = getScanStops(text).stops[0];
  stop.packages.pop();
  const readings = new Map([
    ['packageExampleJ4K8', record('J4K8', 1)],
    ['packageExampleL9M2', record('L9M2', 3)]
  ]);
  const progress = stopProgress(stop, readings);
  assert.equal(progress.listedFound, 2);
  assert.equal(progress.listedTotal, 2);
  assert.equal(progress.total, 3);
  assert.equal(progress.complete, false);
});

test('conflicting totals, repeated bag positions, and changed package readings do not get assigned', () => {
  const { stops } = getScanStops(text);
  const readings = new Map([['packageExampleJ4K8', record('J4K8', 1)]]);
  assert.equal(inspectPackageLabel(frame('L9M2', 2, 4), stops, readings).kind, 'check');
  assert.equal(inspectPackageLabel(frame('L9M2', 1), stops, readings).kind, 'check');
  assert.equal(inspectPackageLabel(frame('J4K8', 2), stops, readings).kind, 'check');
  assert.equal(readings.size, 1);
  readings.set('packageExampleL9M2', record('L9M2', 2, 4));
  assert.equal(stopProgress(stops[0], readings).conflict, true);
  assert.equal(stopProgress(stops[0], readings).complete, false);
});

test('progress remains separate per stop and adding a listed ID removes completion', () => {
  const { stops } = getScanStops(text);
  const readings = new Map([['packageExampleX7Y8', record('X7Y8', 1, 1)]]);
  assert.equal(stopProgress(stops[1], readings).complete, true);
  assert.equal(stopProgress(stops[0], readings).count, 0);
  stops[1].packages.push('addedID');
  assert.equal(stopProgress(stops[1], readings).complete, false);
  assert.equal(stopProgress({ packages: [] }, readings).complete, false);
});
