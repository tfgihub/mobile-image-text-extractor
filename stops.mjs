import { samePackage } from './identity.mjs?v=saved8';

const streetType = '(?:STREET|ST|AVENUE|AVE|ROAD|RD|PLACE|PL|DRIVE|DR|COURT|CT|WAY|LANE|LN|BOULEVARD|BLVD|CIRCLE|CIR|TERRACE|TER|PARKWAY|PKWY|HIGHWAY|HWY|TRAIL|TRL|LOOP)';
const addressPattern = new RegExp(
  '\\b\\d+[A-Za-z]?(?:-\\d+)?\\s+(?:[A-Za-z0-9.\\x27-]+\\s+){1,8}' + streetType + '\\b\\.?[^\\n]*',
  'i'
);

export function addressKey(address) {
  const reference = address.match(/#\s*(\d+)\b/);
  if (reference && !addressPattern.test(address)) return `recipient:${reference[1]}`;
  return address.trim().replace(/\s+/g, ' ').replace(/[.,]/g, '').toUpperCase();
}

export function mergeStops(existing, incoming, warnings = []) {
  const merged = [];
  for (const stop of [...existing, ...incoming]) {
    let target = merged.find(item => addressKey(item.address) === addressKey(stop.address));
    const isNew = !target;
    if (!target) target = { ...stop, address: stop.address.trim(), packages: [] };
    for (const rawId of stop.packages) {
      const id = /^[A-Za-z0-9]{4}$/.test(rawId) ? rawId.toUpperCase() : rawId;
      const owner = merged.find(item => item.packages.some(saved => samePackage(saved, id)));
      if (owner && owner !== target) {
        warnings.push(`Package ${id} already belongs to ${owner.address}; it was not added to ${stop.address}. Check the screenshot.`);
        continue;
      }
      const duplicate = target.packages.findIndex(saved => samePackage(saved, id));
      if (duplicate < 0) target.packages.push(id);
      else if (target.packages[duplicate].length === 4 && id.length > 4) target.packages[duplicate] = id;
    }
    if (isNew && (target.packages.length || !stop.packages.length)) merged.push(target);
  }
  return merged;
}

export function parseStops(text) {
  const stops = [];
  const warnings = [];
  let current;
  let awaitingPackage = false;
  let unassigned = 0;
  let missing = 0;
  let pendingName = '';
  let packageRows = false;

  function addPackage(id) {
    if (current) {
      if (!current.packages.includes(id)) current.packages.push(id);
    } else {
      unassigned++;
    }
  }

  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const [index, line] of lines.entries()) {
    if (!line) continue;
    const addressLine = line.replace(/^\s*\d{1,3}[.)]?\s+(?=\d+[A-Za-z]?\s)/, '');
    const address = addressLine.match(addressPattern);
    const recipient = line.match(/^(.*?)#\s*(\d{3,})\s*$/);
    if (address || recipient) {
      if (awaitingPackage) missing++;
      awaitingPackage = false;
      const heading = address ? address[0].trim() : `${recipient[1].trim() || pendingName || 'Recipient'} #${recipient[2]}`;
      current = { address: heading, packages: [] };
      stops.push(current);
      packageRows = true;
      pendingName = '';
      continue;
    }

    if (/^#\s*\d{3,}\s*$/.test(lines[index + 1] || '') &&
        /^[A-Za-z][A-Za-z .'-]+$/.test(line) &&
        !/\b(?:ready|cart|package|scan|verify)\b/i.test(line)) {
      pendingName = line;
      continue;
    }

    const packageRow = line.match(/\bpackage\s*[iIl1][dD]\b(.*)$/i);
    if (packageRow) {
      if (awaitingPackage) missing++;
      packageRows = true;
      const id = packageRow[1].trim().match(/^[:|=-]*\s*([A-Za-z0-9]{4})\s*$/);
      if (id) {
        addPackage(id[1].toUpperCase());
        awaitingPackage = false;
      } else {
        awaitingPackage = 'short';
      }
      continue;
    }

    const unknown = line.match(/\bunknow[n]?\b(.*)$/i);
    if (unknown) {
      if (awaitingPackage) missing++;
      const id = unknown[1].trim().replace(/^[\s:|=-]+/, '').replace(/[\s|,;]+$/, '');
      if (/^[A-Za-z0-9_-]{4,64}$/.test(id)) {
        addPackage(id);
        awaitingPackage = false;
      } else {
        awaitingPackage = true;
      }
      continue;
    }

    const shortId = line.match(/^[^A-Za-z0-9]*([A-Z0-9]{4})[^A-Za-z0-9]*$/);
    if (packageRows && shortId) {
      if (awaitingPackage || /\d/.test(shortId[1])) addPackage(shortId[1]);
      else if (!/^(?:SCAN|BAGS|CART|STOP|NAME|TIME|FROM|SHIP|NEXT|DONE|EDIT|VIEW|BACK|HELP|INFO|NOTE|SAVE|EXIT)$/.test(shortId[1])) {
        warnings.push(`Unlabelled text "${shortId[1]}" was not added as a package ID. Check the screenshot and enter it manually if it is a package.`);
      }
      awaitingPackage = false;
      continue;
    }
    const prefixedIds = line.match(/\bsp[A-Za-z0-9]{4,62}\b/g);
    if (prefixedIds) {
      for (const id of prefixedIds) addPackage(id);
      awaitingPackage = false;
    } else if (awaitingPackage) {
      if (awaitingPackage === 'short' && /^[A-Za-z0-9]{4}$/.test(line)) {
        addPackage(line.toUpperCase());
      } else if (awaitingPackage !== 'short' && /^[A-Za-z0-9_-]{4,64}$/.test(line) && /[0-9_-]/.test(line)) {
        addPackage(line);
      } else {
        missing++;
      }
      awaitingPackage = false;
    }
  }
  if (awaitingPackage) missing++;
  if (unassigned) warnings.push(`${unassigned} package ID(s) appeared before a stop heading. Check the screenshot and assign them manually.`);
  if (missing) warnings.push(`${missing} package row(s) had no readable ID. Check the image and fill in missing IDs.`);
  if (!stops.length) warnings.push('No stop heading recognized. Nothing was added. Check the screenshot or enter the stop manually.');
  if (stops.some(stop => !stop.packages.length)) warnings.push('Some stops have no recognized package IDs. Fill them in directly in the box.');
  return { stops: mergeStops([], stops, warnings), warnings };
}

export function formatStops(stops) {
  let next = Math.max(0, ...stops.map(stop => stop.number || 0)) + 1;
  return stops.map(stop => {
    const number = stop.number ?? next++;
    if (!Number.isSafeInteger(number) || number < 1) throw new Error('Stop numbers must be positive safe whole numbers.');
    return `${number}. ${stop.address}\n` + stop.packages.map(id => `   - ${id}`).join('\n');
  }).join('\n\n');
}

export function readStopList(text, preserveNumbers = false) {
  const stops = [];
  for (const block of text.trim().split(/\n\s*\n/)) {
    if (!block.trim()) continue;
    const [heading, ...lines] = block.split(/\r?\n/).map(line => line.trim());
    const address = heading.replace(/^\d+[.)]\s+/, '').replace(/\s+\(\d+ packages?\)$/, '');
    const packages = lines.filter(line => !/^[-*]\s*$/.test(line)).map(line => line.replace(/^[-*]\s+/, ''));
    if (!address || /^[-*]\s/.test(address) || packages.some(id => !/^[A-Za-z0-9_-]{4,}$/.test(id))) {
      return { stops: [], error: 'Your existing text was kept as-is. New stops were appended without merging. Use an address followed by one package ID per line, with a blank line between stops.' };
    }
    const stop = { address, packages };
    if (preserveNumbers) {
      const explicit = heading.match(/^(\d+)[.)]\s+/);
      stop.number = explicit ? Number(explicit[1]) : stops.length + 1;
    }
    stops.push(stop);
  }
  if (preserveNumbers && (stops.some(stop => !Number.isSafeInteger(stop.number) || stop.number < 1) ||
      new Set(stops.map(stop => stop.number)).size !== stops.length)) {
    return { stops: [], error: 'Stop numbers must be unique positive whole numbers.' };
  }
  return { stops, error: null };
}

export function updateStopList(text, scannedText) {
  if (!scannedText.trim()) return { text, warnings: [] };
  const scanned = parseStops(scannedText);
  if (!scanned.stops.length) {
    return { text, warnings: scanned.warnings };
  }
  const existing = readStopList(text, true);
  if (existing.error) {
    return {
      text,
      warnings: ['Fix the existing list format before importing more screenshots. Nothing was added.', ...scanned.warnings]
    };
  }
  const warnings = [...scanned.warnings];
  return { text: formatStops(mergeStops(existing.stops, scanned.stops, warnings)), warnings };
}
