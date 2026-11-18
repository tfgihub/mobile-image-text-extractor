import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStops, mergeStops, formatStops, readStopList, updateStopList } from './stops.mjs';

test('groups noisy OCR package rows under the address, without reading icons as counts', () => {
  const result = parseStops('Edit stop\n@ 1000 125TH PL SE\nExample\n% No Recipient Required\n6 Unknown spTestAlpha1\n®6 Unknown spTestBeta2\nContinue with 2 packages');
  assert.deepEqual(result, {
    stops: [{ address: '1000 125TH PL SE', packages: ['spTestAlpha1', 'spTestBeta2'] }],
    warnings: []
  });
});

test('supports multiple stops, stop-number prefixes, and any number of packages', () => {
  const result = parseStops('1 1000 125TH PL SE\nUnknown spAlphaAAA\nUnknown spBetaBBB\nUnknown spGammaCCC\n2. 200 Example Street NW\nUnknown ABC12345\nUnknown XYZ67890');
  assert.deepEqual(result.stops, [
    { address: '1000 125TH PL SE', packages: ['spAlphaAAA', 'spBetaBBB', 'spGammaCCC'] },
    { address: '200 Example Street NW', packages: ['ABC12345', 'XYZ67890'] }
  ]);
  assert.deepEqual(result.warnings, []);
});

test('handles IDs on following lines and warns about incomplete or unassigned rows', () => {
  const result = parseStops('Unknown spOrphan1\n100 Example Rd\nUnknown\nspWrapped1\nUnknown\nPhoto required\n200 Example Ave\nUnknown');
  assert.deepEqual(result.stops[0].packages, ['spWrapped1']);
  assert.equal(result.stops[1].packages.length, 0);
  assert.equal(result.warnings.length, 3);
  assert.match(result.warnings[0], /before an address/);
  assert.match(result.warnings[1], /2 package row/);
});

test('ignores UI noise, does not invent an address, and detects missing package IDs', () => {
  assert.equal(parseStops('Edit stop\nContinue with 2 packages\nImprove the map').stops.length, 0);
  assert.match(parseStops('Hello world').warnings[0], /No street address/);
  assert.match(parseStops('100 Example Lane').warnings[0], /no recognized package/);
});

test('merges repeated addresses without mutating input or changing package ID case', () => {
  const existing = [{ address: '100 Example St.', packages: ['spCaseAAA'] }];
  const merged = mergeStops(existing, [
    { address: '100  EXAMPLE ST', packages: ['spCaseAAA', 'spcaseAAA'] },
    { address: '200 Example Way', packages: ['spOther12', 'spOther12'] }
  ]);
  assert.deepEqual(merged[0].packages, ['spCaseAAA', 'spcaseAAA']);
  assert.equal(merged[1].packages.length, 1);
  assert.deepEqual(existing[0].packages, ['spCaseAAA']);
  assert.equal(formatStops(merged), '1. 100 Example St.\n   - spCaseAAA\n   - spcaseAAA\n\n2. 200 Example Way\n   - spOther12');
});

test('merges repeated stops within one OCR result', () => {
  const result = parseStops('100 Example St\nUnknown spFirst12\n100 EXAMPLE ST\nUnknown spSecond1\nUnknown spFirst12');
  assert.equal(result.stops.length, 1);
  assert.deepEqual(result.stops[0].packages, ['spFirst12', 'spSecond1']);
});

test('editor text round-trips arbitrary manually entered addresses and package IDs', () => {
  const stops = [
    { address: 'Locker A, Building North', packages: ['ABC123', 'custom_ID-2'] },
    { address: '100 Example Street #4', packages: ['spMixedCase'] }
  ];
  assert.deepEqual(readStopList(formatStops(stops)), { stops, error: null });
  assert.deepEqual(readStopList(''), { stops: [], error: null });
  assert.deepEqual(readStopList('Locker A\nABC123').stops, [{ address: 'Locker A', packages: ['ABC123'] }]);
});

test('scans merge into the edited text, not an outdated hidden copy', () => {
  const updated = updateStopList(
    '1. 100 Example St\n   - corrected_ID\n\n2. Locker A\n   - manual_ID',
    '100 EXAMPLE ST\nUnknown spNewPackage\n200 Example Ave\nUnknown spAnotherID'
  );
  assert.deepEqual(readStopList(updated.text).stops, [
    { address: '100 Example St', packages: ['corrected_ID', 'spNewPackage'] },
    { address: 'Locker A', packages: ['manual_ID'] },
    { address: '200 Example Ave', packages: ['spAnotherID'] }
  ]);
  assert.deepEqual(updated.warnings, []);
});

test('repeated scans do not duplicate IDs and preserve addresses with no packages yet', () => {
  const scan = '100 Example St\nUnknown spPackageABC';
  const first = updateStopList('Locker A', scan);
  const second = updateStopList(first.text, scan);
  assert.equal(first.text, second.text);
  assert.deepEqual(readStopList(second.text).stops[0], { address: 'Locker A', packages: [] });
});

test('unexpected manual formatting is preserved verbatim instead of silently discarded', () => {
  const original = 'Personal address\nPackage ID needs correction\n\nNotes: keep this text\n';
  const updated = updateStopList(original, '100 Example St\nUnknown spPackageABC');
  assert.ok(updated.text.startsWith(original));
  assert.ok(updated.text.includes('spPackageABC'));
  assert.match(updated.warnings[0], /kept as-is/);
});

test('unrecognized scans retain raw OCR in the same box and empty scans leave edits untouched', () => {
  const original = '1. Locker A\n   - corrected_ID';
  const unknown = 'Unrecognized address\nUnknown spPackageABC';
  const updated = updateStopList(original, unknown);
  assert.equal(updated.text, original + '\n\n' + unknown);
  assert.match(updated.warnings.join(' '), /Raw text was kept/);
  assert.deepEqual(updateStopList(original, '  \n'), { text: original, warnings: [] });
});
