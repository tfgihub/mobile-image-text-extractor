import { readStopList } from './stops.mjs';

export function getScanStops(text) {
  const parsed = readStopList(text);
  if (parsed.error) {
    return { stops: [], error: 'Fix the list format before opening the camera: address first, package IDs below it, and a blank line between stops.' };
  }
  if (!parsed.stops.length) return { stops: [], error: 'Add stops and package IDs to use the live camera.' };
  const headings = text.trim().split(/\n\s*\n/).map(block => block.trim().split(/\r?\n/)[0]);
  const numbers = new Set();
  const ids = new Set();
  const stops = [];
  for (const [index, stop] of parsed.stops.entries()) {
    const explicitNumber = headings[index].match(/^(\d+)[.)]\s+/);
    const number = explicitNumber ? Number(explicitNumber[1]) : index + 1;
    if (!Number.isSafeInteger(number) || number < 1 || numbers.has(number)) {
      return { stops: [], error: 'Stop numbers must be unique positive whole numbers.' };
    }
    numbers.add(number);
    const packages = [...new Set(stop.packages)];
    if (!packages.length) return { stops: [], error: `Add at least one package ID for stop ${number}.` };
    for (const id of packages) {
      if (ids.has(id)) return { stops: [], error: `Package ${id} is listed at multiple stops. Assign it to one stop before scanning.` };
      ids.add(id);
    }
    stops.push({ ...stop, number, packages });
  }
  return { stops, error: null };
}

export function findNextPackage(text, stops, found) {
  const tokens = new Set(text.match(/[A-Za-z0-9_-]+/g) || []);
  for (const stop of stops) {
    for (const packageId of stop.packages) {
      if (!found.has(packageId) && tokens.has(packageId)) return { stop, packageId };
    }
  }
  return null;
}

export function stopProgress(stop, found) {
  const total = stop.packages.length;
  const count = stop.packages.filter(id => found.has(id)).length;
  return { count, total, complete: total > 0 && count === total };
}
