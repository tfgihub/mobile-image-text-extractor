const streetType = '(?:STREET|ST|AVENUE|AVE|ROAD|RD|PLACE|PL|DRIVE|DR|COURT|CT|WAY|LANE|LN|BOULEVARD|BLVD|CIRCLE|CIR|TERRACE|TER|PARKWAY|PKWY|HIGHWAY|HWY|TRAIL|TRL|LOOP)';
const addressPattern = new RegExp(
  '\\b\\d+[A-Za-z]?(?:-\\d+)?\\s+(?:[A-Za-z0-9.\\x27-]+\\s+){1,8}' + streetType + '\\b\\.?[^\\n]*',
  'i'
);

export function addressKey(address) {
  return address.trim().replace(/\s+/g, ' ').replace(/[.,]/g, '').toUpperCase();
}

export function mergeStops(existing, incoming) {
  const merged = existing.map(stop => ({ address: stop.address, packages: [...stop.packages] }));
  for (const stop of incoming) {
    const match = merged.find(item => addressKey(item.address) === addressKey(stop.address));
    if (match) {
      match.packages = [...new Set([...match.packages, ...stop.packages])];
    } else {
      merged.push({ address: stop.address.trim(), packages: [...new Set(stop.packages)] });
    }
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

  function addPackage(id) {
    if (current) {
      if (!current.packages.includes(id)) current.packages.push(id);
    } else {
      unassigned++;
    }
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const addressLine = line.replace(/^\s*\d{1,3}[.)]?\s+(?=\d+[A-Za-z]?\s)/, '');
    const address = addressLine.match(addressPattern);
    if (address) {
      if (awaitingPackage) missing++;
      awaitingPackage = false;
      current = { address: address[0].trim(), packages: [] };
      stops.push(current);
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

    const prefixedIds = line.match(/\bsp[A-Za-z0-9]{4,62}\b/g);
    if (prefixedIds) {
      for (const id of prefixedIds) addPackage(id);
      awaitingPackage = false;
    } else if (awaitingPackage) {
      if (/^[A-Za-z0-9_-]{4,64}$/.test(line) && /[0-9_-]/.test(line)) {
        addPackage(line);
      } else {
        missing++;
      }
      awaitingPackage = false;
    }
  }
  if (awaitingPackage) missing++;
  if (unassigned) warnings.push(`${unassigned} package ID(s) appeared before an address. Assign them manually.`);
  if (missing) warnings.push(`${missing} package row(s) had no readable ID. Check the image and fill in missing IDs.`);
  if (!stops.length) warnings.push('No street address recognized. Add a stop manually or correct the extracted text.');
  if (stops.some(stop => !stop.packages.length)) warnings.push('Some stops have no recognized package IDs. Fill them in before adding.');
  return { stops: mergeStops([], stops), warnings };
}

export function formatStops(stops) {
  return stops.map((stop, index) =>
    `${index + 1}. ${stop.address} (${stop.packages.length} package${stop.packages.length === 1 ? '' : 's'})\n` +
    stop.packages.map(id => `   - ${id}`).join('\n')
  ).join('\n\n');
}
