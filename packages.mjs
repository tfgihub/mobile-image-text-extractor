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

export function readBagLabel(text) {
  const fractions = [...text.matchAll(/(?:^|[^A-Za-z0-9])(\d+)\s*(?:[o0]f|\/)\s*(\d+)\s*bags?\b/gi)];
  if (!fractions.length) return { kind: 'reading' };
  const lines = text.split(/\r?\n/).map(line => line.trim());
  const codes = [];
  let weightLine = -1;
  for (const [index, line] of lines.entries()) {
    if (/\bweight\b/i.test(line)) weightLine = index;
    const match = line.match(/^[|(\[]*\s*([A-Za-z0-9]{4})\s*[|)\].,]*$/);
    if (match && !/^(?:BAGS|HOUR|FROM|SHIP|DATE|TIME|STOP)$/i.test(match[1])) {
      codes.push({ code: match[1].toUpperCase(), index });
    }
  }
  const belowWeight = codes.filter(item => weightLine >= 0 && item.index > weightLine);
  const candidates = [...new Set((belowWeight.length ? belowWeight : codes).map(item => item.code))];
  if (!candidates.length) return { kind: 'reading' };
  const code = candidates.join(', ');
  if (candidates.length > 1 || new Set(fractions.map(item => `${Number(item[1])}/${Number(item[2])}`)).size > 1) {
    return { kind: 'check', code, message: 'More than one label or bag count was read. Check the package and show only one label at a time. Nothing was added.' };
  }
  const bagNumber = Number(fractions[0][1]);
  const totalBags = Number(fractions[0][2]);
  if (!Number.isSafeInteger(bagNumber) || !Number.isSafeInteger(totalBags) || bagNumber < 1 || totalBags < 1 || bagNumber > totalBags) {
    return { kind: 'check', code, message: 'The bag number or total is invalid. Check the package and rescan. Nothing was added.' };
  }
  return { kind: 'label', code, bagNumber, totalBags };
}

export function stopProgress(stop, readings) {
  const labels = stop.packages.filter(id => readings.has(id)).map(id => readings.get(id));
  const totals = new Set(labels.map(label => label.totalBags));
  const positions = new Set(labels.map(label => label.bagNumber));
  const conflict = totals.size > 1 || positions.size !== labels.length;
  const total = totals.size === 1 ? labels[0].totalBags : stop.packages.length;
  const count = positions.size;
  return {
    count, total, listedFound: labels.length, listedTotal: stop.packages.length, conflict,
    complete: !conflict && total > 0 && count === total && labels.length === stop.packages.length
  };
}

export function inspectPackageLabel(text, stops, readings) {
  const label = readBagLabel(text);
  if (label.kind !== 'label') return label;
  const matches = stops.flatMap(stop =>
    stop.packages.filter(id => id.length >= 4 && id.slice(-4).toUpperCase() === label.code)
      .map(packageId => ({ stop, packageId }))
  );
  if (matches.length !== 1) {
    return {
      ...label, kind: 'check',
      message: matches.length
        ? 'This four-character code matches multiple listed package IDs. Check the package; nothing was assigned to a stop.'
        : 'This package code is not in the stop list. Check the package; it was not added to any stop.'
    };
  }
  const match = matches[0];
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
  return { ...label, ...match, kind: 'match' };
}
