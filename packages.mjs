import { readStopList } from './stops.mjs?v=bags2';

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

export function readBagCount(text) {
  const fractions = [...text.matchAll(/(?:^|[^A-Za-z0-9])(\d+)\s*(?:[o0]f|\/)\s*(\d+)\s*bags?\b/gi)];
  if (!fractions.length) return { error: 'Bag count was not readable. Nothing was counted. Rescan with the whole label clearly visible.' };
  if (new Set(fractions.map(item => `${Number(item[1])}/${Number(item[2])}`)).size > 1) {
    return { error: 'Multiple bag counts were read. Nothing was counted. Rescan one whole label at a time.' };
  }
  const bagNumber = Number(fractions[0][1]);
  const totalBags = Number(fractions[0][2]);
  if (!Number.isSafeInteger(bagNumber) || !Number.isSafeInteger(totalBags) || bagNumber < 1 || totalBags < 1 || bagNumber > totalBags) {
    return { error: 'The detected bag number or total is invalid. Nothing was counted. Rescan the label.' };
  }
  return { bagNumber, totalBags, error: null };
}

export function stopProgress(stop, readings) {
  const labels = stop.packages.filter(id => readings.has(id)).map(id => readings.get(id));
  const positions = new Set(labels.map(label => label.bagNumber));
  const total = stop.packages.length;
  const conflict = positions.size !== labels.length || labels.some(label =>
    label.totalBags !== total || !Number.isSafeInteger(label.bagNumber) || label.bagNumber < 1 || label.bagNumber > total
  );
  const count = positions.size;
  return {
    count, total, listedFound: labels.length, listedTotal: stop.packages.length, conflict,
    complete: !conflict && total > 0 && count === total && labels.length === stop.packages.length
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

export function validateBagMatch(candidate, bagNumber, totalBags, readings) {
  const label = { code: candidate.code, bagNumber, totalBags };
  if (!Number.isSafeInteger(bagNumber) || !Number.isSafeInteger(totalBags) || bagNumber < 1 || totalBags < 1 || bagNumber > totalBags) {
    return { kind: 'check', message: 'The detected bag information is invalid. Nothing was counted. Rescan the label.' };
  }
  const match = candidate;
  const expectedTotal = match.stop.packages.length;
  if (totalBags !== expectedTotal) {
    return {
      ...label, kind: 'check',
      message: `Bag total mismatch: the screenshot list has ${expectedTotal} package(s) for stop ${match.stop.number}, but the label says ${totalBags} bags. Nothing was counted. Check that all screenshots for this stop were imported.`
    };
  }
  const previous = readings.get(match.packageId);
  if (previous) {
    if (previous.bagNumber === label.bagNumber && previous.totalBags === label.totalBags) {
      return { ...label, kind: 'duplicate' };
    }
    return { ...label, kind: 'check', message: 'This package was already read with a different bag number or total. Check the label; existing progress was kept.' };
  }
  const otherLabels = match.stop.packages.filter(id => readings.has(id)).map(id => readings.get(id));
  if (otherLabels.some(item => item.totalBags !== label.totalBags || item.bagNumber === label.bagNumber)) {
    return { ...label, kind: 'check', message: 'This bag number or total conflicts with another package at this stop. Check the packages; nothing was added.' };
  }
  return { ...match, ...label, kind: 'match' };
}
