import test from 'node:test';
import assert from 'node:assert/strict';
import { planStopOrder, validStopOrder, reorderedStops } from './ordering.mjs';
import { addressKey, parseStops } from './stops.mjs';

const stops = [
  { address: 'Alex Sample #3001', packages: ['AB12'] },
  { address: 'Jamie Example #3002', packages: ['CD34'] },
  { address: 'Taylor Sample #3003', packages: ['EF56'] },
  { address: 'Casey Example #3004', packages: ['GH78'] }
];
const keys = stops.map(stop => addressKey(stop.address));

test('all shuffled upload permutations reconstruct the same order from overlap', () => {
  const sequences = [keys.slice(0, 2), keys.slice(1, 3), keys.slice(2)];
  for (const permutation of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
    const plan = planStopOrder([...stops].reverse(), permutation.map(index => sequences[index]));
    assert.deepEqual(plan.order, keys);
    assert.equal(plan.ambiguous, false);
    assert.equal(plan.conflict, false);
  }
});

test('disconnected chains ask for group order without breaking each image sequence', () => {
  const plan = planStopOrder(stops, [keys.slice(0, 2), keys.slice(2)]);
  assert.equal(plan.ambiguous, true);
  assert.deepEqual(plan.groups, [keys.slice(0, 2), keys.slice(2)]);
  assert.equal(validStopOrder([...keys.slice(2), ...keys.slice(0, 2)], plan), true);
  assert.equal(validStopOrder([keys[1], keys[0], keys[2], keys[3]], plan), false);
});

test('a branching overlap asks instead of guessing and enforces known precedence', () => {
  const plan = planStopOrder(stops.slice(0, 3), [[keys[0], keys[1]], [keys[0], keys[2]]]);
  assert.equal(plan.ambiguous, true);
  assert.equal(plan.conflict, false);
  assert.deepEqual(plan.groups, keys.slice(0, 3).map(key => [key]));
  assert.equal(validStopOrder([keys[0], keys[2], keys[1]], plan), true);
  assert.equal(validStopOrder([keys[2], keys[0], keys[1]], plan), false);
  assert.equal(validStopOrder([keys[0], keys[1]], plan), false);
});

test('contradictory image orders are flagged for an explicit user override', () => {
  const plan = planStopOrder(stops.slice(0, 2), [keys.slice(0, 2), [keys[1], keys[0]]]);
  assert.equal(plan.conflict, true);
  assert.equal(plan.ambiguous, true);
  assert.equal(validStopOrder(plan.order, plan), false);
});

test('repeated and rejected stop observations cannot duplicate or invent numbered stops', () => {
  const plan = planStopOrder(stops.slice(0, 2), [[keys[0], keys[0], 'unknown', keys[1]]]);
  assert.deepEqual(plan.order, keys.slice(0, 2));
  assert.equal(plan.ambiguous, false);
  assert.deepEqual(planStopOrder([], []).order, []);
});

test('reordering keeps package identities and rejects incomplete or duplicate choices', () => {
  const numbered = stops.map((stop, index) => ({ ...stop, number: index + 7 }));
  const ordered = reorderedStops(numbered, [...keys].reverse());
  assert.deepEqual(ordered, [...stops].reverse());
  assert.equal(numbered[0].number, 7);
  assert.throws(() => reorderedStops(stops, keys.slice(0, 3)), /exactly once/);
  assert.throws(() => reorderedStops(stops, [keys[0], keys[0], keys[2], keys[3]]), /exactly once/);
  assert.throws(() => reorderedStops(stops, ['unknown', ...keys.slice(1)]), /unknown stop/);
});

test('camera-photo text above the list header cannot become a stop or package', () => {
  const result = parseStops('Product Photo #9999\nPackage ID\nZZ99\nSCAN 20 BAGS TO VERIFY\n"Ready - CART_7"\n20 OF 40\nAlex Sample #3001\nPackage ID\nAB12\n20 OF 40');
  assert.deepEqual(result, { stops: [stops[0]], warnings: [] });
  assert.deepEqual(parseStops('Alex Sample #3001\nPackage ID\nAB12').stops, [stops[0]]);
});
