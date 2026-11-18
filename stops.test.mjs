import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStops, mergeStops, formatStops, readStopList, updateStopList } from './stops.mjs';

test('clearing a package ID leaves an empty bullet that is ignored rather than a stale package', () => {
  assert.deepEqual(readStopList('1. Example #1234\n -\n - AB12\n *\n - CD34'), {
    stops: [{ address: 'Example #1234', packages: ['AB12', 'CD34'] }], error: null
  });
  assert.deepEqual(readStopList('1. Example #1234\n -').stops[0].packages, []);
});

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
  assert.match(result.warnings[0], /Stop not detected for package spOrphan1/);
  assert.match(result.warnings[1], /100 Example Rd: 1 package ID not detected/);
  assert.match(result.warnings[2], /200 Example Ave: 1 package ID not detected/);
});

test('ignores UI noise, does not invent an address, and detects missing package IDs', () => {
  assert.equal(parseStops('Edit stop\nContinue with 2 packages\nImprove the map').stops.length, 0);
  assert.match(parseStops('Hello world').warnings[0], /No stops detected/);
  assert.match(parseStops('100 Example Lane').warnings[0], /no packages detected/);
});

test('merges repeated addresses without mutating input or changing package ID case', () => {
  const existing = [{ address: '100 Example St.', packages: ['spCaseAAA'] }];
  const merged = mergeStops(existing, [
    { address: '100  EXAMPLE ST', packages: ['spCaseAAA', 'spcaseAAA'] },
    { address: '200 Example Way', packages: ['spOther12', 'spOther12'] }
  ]);
  assert.deepEqual(merged[0].packages, ['spCaseAAA']);
  assert.equal(merged[1].packages.length, 1);
  assert.deepEqual(existing[0].packages, ['spCaseAAA']);
  assert.equal(formatStops(merged), '1. 100 Example St.\n   - spCaseAAA\n\n2. 200 Example Way\n   - spOther12');
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

test('invalid manual formatting blocks imports rather than adding duplicates or losing edits', () => {
  const original = 'Personal address\nPackage ID needs correction\n\nNotes: keep this text\n';
  const updated = updateStopList(original, '100 Example St\nUnknown spPackageABC');
  assert.equal(updated.text, original);
  assert.match(updated.warnings[0], /Nothing was added/);
});

test('unrecognized and empty scans leave edits untouched', () => {
  const original = '1. Locker A\n   - corrected_ID';
  const unknown = 'Unrecognized address\nUnknown spPackageABC';
  const updated = updateStopList(original, unknown);
  assert.equal(updated.text, original);
  assert.match(updated.warnings.join(' '), /Stop not detected for package spPackageABC/);
  assert.deepEqual(updateStopList(original, '  \n'), { text: original, warnings: [] });
});

test('imports recipient references and Package ID rows, including redacted row labels', () => {
  const parsed = parseStops('"Ready - CART_7" 20 OF 40\nExample Person #1234\nPackage ID\nAB12\nv\nCD34\nPackage ID EF56\nOther Person #5678\nPackage ID\n0G78\nPackage ID');
  assert.deepEqual(parsed.stops, [
    { address: 'Example Person #1234', packages: ['AB12', 'CD34', 'EF56'] },
    { address: 'Other Person #5678', packages: ['0G78'] }
  ]);
  assert.match(parsed.warnings.join(' '), /Other Person #5678: 1 package ID not detected/);
});

test('merges overlapping screenshots by reference despite redacted names and repeated codes', () => {
  const first = updateStopList('', 'Example Person\n#1234\nPackage ID\nAB12\nPackage ID\nCD34\nOther Person #5678\nPackage ID');
  const second = updateStopList(first.text, '#1234\nPackage ID\nAB12\nPackage ID\nCD34\nPackage ID\nEF56\n#5678\nPackage ID\n0G78');
  assert.deepEqual(readStopList(second.text).stops, [
    { address: 'Example Person #1234', packages: ['AB12', 'CD34', 'EF56'] },
    { address: 'Other Person #5678', packages: ['0G78'] }
  ]);
  assert.equal(updateStopList(second.text, '#1234\nPackage ID\nAB12\nPackage ID\nCD34\nPackage ID\nEF56').text, second.text);
});

test('does not duplicate a package across different stop headings and reports the conflict', () => {
  const result = updateStopList('1. Example Person #1234\n - AB12', 'Other Person #5678\nPackage ID\nAB12');
  assert.equal(readStopList(result.text).stops.length, 1);
  assert.match(result.warnings.join(' '), /already belongs/);
});

test('short and full forms of the same package at the same stop count once', () => {
  assert.deepEqual(mergeStops(
    [{ address: 'Example #1234', packages: ['ab12'] }],
    [{ address: 'Example #1234', packages: ['trackingAB12', 'AB12'] }]
  ), [{ address: 'Example #1234', packages: ['trackingAB12'] }]);
});

test('reimporting preserves explicit route numbers and appends after the last route number', () => {
  const original = '7. Example #1001\n - AB12\n\n12. Other #1002\n - CD34';
  const duplicate = updateStopList(original, 'Example #1001\nPackage ID\nAB12');
  assert.deepEqual(readStopList(duplicate.text, true).stops.map(stop => stop.number), [7, 12]);
  const appended = updateStopList(duplicate.text, 'New Person #1003\nPackage ID\nEF56');
  assert.deepEqual(readStopList(appended.text, true).stops.map(stop => stop.number), [7, 12, 13]);
});

test('an import never silently repairs or renumbers invalid duplicate route numbers', () => {
  const original = '7. Example #1001\n - AB12\n\n7. Other #1002\n - CD34';
  const result = updateStopList(original, 'New Person #1003\nPackage ID\nEF56');
  assert.equal(result.text, original);
  assert.match(result.warnings.join(' '), /Nothing was added/);
});

test('unlabelled alphabetic screen words are not invented as packages, but labelled IDs remain supported', () => {
  const result = parseStops('Example #1001\nPackage ID\nAB12\nNEXT\nDONE\nALPH\nPackage ID\nHPQK\nPackage ID NEXT');
  assert.deepEqual(result.stops[0].packages, ['AB12', 'HPQK', 'NEXT']);
  assert.match(result.warnings.join(' '), /Unlabelled text "ALPH"/);
  assert.ok(readStopList('1. Example\n - AB1').error);
});

test('missing IDs are grouped by their stop and empty stops are identified without duplicate warnings', () => {
  const parsed = parseStops('Alex Sample #1001\nPackage ID\nPackage ID\nJamie Example #1002\nUnknown\nPhoto required\n100 Example Lane');
  assert.deepEqual(parsed.warnings, [
    'Alex Sample #1001: 2 package IDs not detected.',
    'Jamie Example #1002: 1 package ID not detected.',
    '100 Example Lane: no packages detected.'
  ]);
});

test('packages without a detected stop are identified by their readable IDs', () => {
  const parsed = parseStops('Package ID\nAB12\nUnknown spOrphan2');
  assert.deepEqual(parsed.warnings, ['Stop not detected for packages AB12, spOrphan2.']);
  assert.deepEqual(parsed.stops, []);
});
