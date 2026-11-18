export const runStorageKey = 'package-sort-run';

export function serializeRun(list, readings, shownStops, acceptedList = list) {
  return JSON.stringify({ version: 1, list, acceptedList, readings: [...readings], shownStops: [...shownStops] });
}

export function parseSavedRun(raw) {
  const saved = JSON.parse(raw);
  if (!saved || typeof saved !== 'object' || saved.version !== 1 ||
      typeof saved.list !== 'string' || !saved.list.trim() ||
      typeof saved.acceptedList !== 'string' ||
      !Array.isArray(saved.readings) || saved.readings.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{4,}$/.test(id)) ||
      !Array.isArray(saved.shownStops) || saved.shownStops.some(number => !Number.isSafeInteger(number) || number < 1)) {
    throw new Error('Saved package records have an unsupported or invalid format.');
  }
  return {
    list: saved.list,
    acceptedList: saved.acceptedList,
    readings: new Set(saved.readings),
    shownStops: new Set(saved.shownStops)
  };
}
