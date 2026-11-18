import { readStopList } from './stops.mjs?v=badge7';

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
    for (const id of packages) {
      if (ids.has(id)) return { stops: [], error: `Package ${id} is listed at multiple stops. Assign it to one stop before scanning.` };
      ids.add(id);
    }
    stops.push({ ...stop, number, packages });
  }
  if (!stops.some(stop => stop.packages.length)) return { stops, error: 'Add at least one package ID before scanning.' };
  return { stops, error: null };
}

export function pruneReadings(stops, readings) {
  const listed = new Set(stops.flatMap(stop => stop.packages));
  for (const id of readings) {
    if (!listed.has(id)) readings.delete(id);
  }
}

export function stopProgress(stop, readings) {
  const total = stop.packages.length;
  const count = stop.packages.filter(id => readings.has(id)).length;
  return {
    count, total, complete: total > 0 && count === total
  };
}

export function getPackageNotice(stop, readings, shownStops) {
  const { count, total } = stopProgress(stop, readings);
  const position = count + 1;
  return {
    isNew: !shownStops.has(stop.number),
    countLabel: `${position} ${position === 1 ? 'bag' : 'bags'} of ${total} ${total === 1 ? 'bag' : 'bags'}`
  };
}

export function matchBarcode(payload, stops, readings) {
  const barcode = payload.trim();
  if (!/^[A-Za-z0-9_-]{4,}$/.test(barcode)) {
    return { kind: 'check', code: barcode, message: 'This barcode does not contain a supported package ID. Check the package; nothing was assigned.' };
  }
  const code = barcode.slice(-4).toUpperCase();
  const allPackages = stops.flatMap(stop => stop.packages.map(packageId => ({ stop, packageId })));
  const exact = allPackages.filter(item => item.packageId.toUpperCase() === barcode.toUpperCase());
  const matches = exact.length ? exact : stops.flatMap(stop =>
    stop.packages.filter(id => id.length >= 4 && id.slice(-4).toUpperCase() === code)
      .map(packageId => ({ stop, packageId }))
  );
  if (matches.length !== 1) {
    return {
      kind: 'check', code, barcode,
      message: matches.length
        ? 'This four-character code matches multiple listed package IDs. Check the package; nothing was assigned to a stop.'
        : 'This package code is not in the stop list. Check the package; it was not added to any stop.'
    };
  }
  const match = matches[0];
  if (readings.has(match.packageId)) return { kind: 'duplicate', code, barcode };
  return { kind: 'candidate', code, barcode, ...match };
}
