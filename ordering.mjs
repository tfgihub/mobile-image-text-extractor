import { addressKey } from './stops.mjs?v=timer13';

export function planStopOrder(stops, sequences) {
  const keys = stops.map(stop => addressKey(stop.address));
  const edges = new Map(keys.map(key => [key, new Set()]));
  const neighbors = new Map(keys.map(key => [key, new Set()]));
  for (const sequence of sequences) {
    const observed = [...new Set(sequence)].filter(key => edges.has(key));
    for (let index = 1; index < observed.length; index++) {
      const before = observed[index - 1];
      const after = observed[index];
      edges.get(before).add(after);
      neighbors.get(before).add(after);
      neighbors.get(after).add(before);
    }
  }

  function sort(members) {
    const remaining = new Set(members);
    const incoming = new Map(members.map(key => [key, 0]));
    for (const before of members) {
      for (const after of edges.get(before)) incoming.set(after, incoming.get(after) + 1);
    }
    const result = [];
    let ambiguous = false;
    while (remaining.size) {
      const ready = members.filter(key => remaining.has(key) && incoming.get(key) === 0);
      if (!ready.length) return { order: members, ambiguous: true, conflict: true };
      if (ready.length > 1) ambiguous = true;
      result.push(ready[0]);
      remaining.delete(ready[0]);
      for (const after of edges.get(ready[0])) incoming.set(after, incoming.get(after) - 1);
    }
    return { order: result, ambiguous, conflict: false };
  }

  const remaining = new Set(keys);
  const components = [];
  for (const key of keys) {
    if (!remaining.has(key)) continue;
    const found = new Set([key]);
    const queue = [key];
    remaining.delete(key);
    for (let index = 0; index < queue.length; index++) {
      for (const neighbor of neighbors.get(queue[index])) {
        if (!remaining.delete(neighbor)) continue;
        found.add(neighbor);
        queue.push(neighbor);
      }
    }
    components.push(sort(keys.filter(item => found.has(item))));
  }
  const conflict = components.some(component => component.conflict);
  const internalAmbiguity = components.some(component => component.ambiguous);
  const groups = internalAmbiguity
    ? sort(keys).order.map(key => [key])
    : components.map(component => component.order);
  return {
    order: groups.flat(), groups, conflict,
    ambiguous: components.length > 1 || internalAmbiguity,
    edges: [...edges].flatMap(([before, after]) => [...after].map(key => [before, key]))
  };
}

export function validStopOrder(order, plan) {
  const positions = new Map(order.map((key, index) => [key, index]));
  return order.length === plan.order.length && positions.size === order.length &&
    plan.order.every(key => positions.has(key)) &&
    plan.edges.every(([before, after]) => positions.get(before) < positions.get(after));
}

export function reorderedStops(stops, order) {
  const listed = new Map(stops.map(stop => [addressKey(stop.address), stop]));
  if (listed.size !== stops.length || order.length !== stops.length || new Set(order).size !== order.length) {
    throw new Error('The selected stop order must include each stop exactly once.');
  }
  return order.map(key => {
    const stop = listed.get(key);
    if (!stop) throw new Error('The selected stop order contains an unknown stop.');
    return { address: stop.address, packages: stop.packages };
  });
}
