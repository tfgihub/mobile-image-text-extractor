export const packageLabelPattern = /\b[pd]ack[a-z]{2,3}\s*[iIl1][dD]\b(.*)$/i;
export const screenWordPattern = /^(?:SCAN|BAGS|CART|STOP|NAME|TIME|FROM|SHIP|NEXT|DONE|EDIT|VIEW|BACK|HELP|INFO|NOTE|SAVE|EXIT)$/i;

export function stopListStart(lines) {
  let start = 0;
  for (const [index, text] of lines.entries()) {
    if ((!/#\s*\d+/.test(text) && /\bready\b.*\bcart[_ -]?\d+\b/i.test(text)) ||
        /\bscan\s+\d+\s+bags?\s+to\s+verify\b/i.test(text) ||
        (start > 0 && index === start && /^\s*\d+\s+of\s+\d+\s*$/i.test(text))) start = index + 1;
  }
  return start;
}

export function screenshotText(data) {
  if (typeof data.text !== 'string') throw new Error('Screenshot OCR did not return text.');
  if (data.lines == null) return data.text;
  if (!Array.isArray(data.lines)) throw new Error('Screenshot OCR returned invalid text positions.');
  if (!data.lines.length) return data.text;

  const rows = [];
  for (const line of [...data.lines].sort((a, b) => a.bbox?.y0 - b.bbox?.y0)) {
    if (typeof line.text !== 'string') throw new Error('Screenshot OCR returned an invalid text line.');
    if (!line.text.trim()) continue;
    const box = line.bbox;
    if (!box || ![box.x0, box.y0, box.x1, box.y1].every(Number.isFinite) ||
        box.x1 <= box.x0 || box.y1 <= box.y0) {
      throw new Error('Screenshot OCR returned invalid text positions.');
    }
    const center = (box.y0 + box.y1) / 2;
    const row = rows.find(item => Math.abs(center - (item.box.y0 + item.box.y1) / 2) <=
      Math.min(box.y1 - box.y0, item.box.y1 - item.box.y0) / 2);
    if (row) {
      row.parts.push(line);
      row.box = {
        x0: Math.min(row.box.x0, box.x0), y0: Math.min(row.box.y0, box.y0),
        x1: Math.max(row.box.x1, box.x1), y1: Math.max(row.box.y1, box.y1)
      };
    } else rows.push({ parts: [line], box: { ...box } });
  }
  rows.sort((a, b) => (a.box.y0 + a.box.y1) - (b.box.y0 + b.box.y1));
  for (const row of rows) {
    row.text = row.parts.sort((a, b) => a.bbox.x0 - b.bbox.x0).map(part => part.text.trim()).join(' ');
  }
  rows.splice(0, stopListStart(rows.map(row => row.text)));

  const labels = rows.filter(row => packageLabelPattern.test(row.text));
  for (let index = 1; index < rows.length; index++) {
    const code = rows[index];
    if (!/^[A-Za-z0-9]{4}$/.test(code.text) || screenWordPattern.test(code.text)) continue;
    const previous = rows[index - 1];
    const fragment = previous.text.replace(/[^A-Za-z]/g, '').toLowerCase();
    if (!/^(?:p{1,2}|pa|pac|pack|packa|packag|package)$/.test(fragment)) continue;
    // A fragment needs a nearby full label as both a column and size reference.
    const anchor = labels.find(label => {
      const height = label.box.y1 - label.box.y0;
      const gap = code.box.y0 - previous.box.y1;
      return Math.abs(label.box.x0 - code.box.x0) <= height / 2 &&
        Math.abs(label.box.x0 - previous.box.x0) <= height / 2 &&
        Math.abs(label.box.y0 - previous.box.y0) <= height * 8 &&
        gap >= 0 && gap <= height * 1.5;
    });
    if (anchor) previous.text = 'Package ID';
  }
  return rows.map(row => row.text).join('\n');
}
