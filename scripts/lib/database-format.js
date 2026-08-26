// database.json formats every `referenceIntervals` row as one compact
// single-line object (unlike the rest of the file, which is plain
// `JSON.stringify(db, null, 2)` output). Plain re-stringifying would
// reformat that array in every entry, not just the ones actually touched,
// turning a small field change into a file-wide diff — so referenceIntervals
// is pulled out via a marker, stringified normally, then spliced back in
// using the original compact format.
function formatIntervalRow(r) {
  return `{ "group": ${JSON.stringify(r.group)}, "age": ${JSON.stringify(r.age)}, "range": ${JSON.stringify(r.range)}, "unit": ${JSON.stringify(r.unit)} }`;
}

function formatIntervals(rows, indent) {
  if (!rows || rows.length === 0) return '[]';
  const itemIndent = indent + '  ';
  const items = rows.map(r => itemIndent + formatIntervalRow(r)).join(',\n');
  return `[\n${items}\n${indent}]`;
}

export function serializeDatabase(db) {
  const markers = [];
  const patched = db.map((entry, i) => {
    if (!entry.referenceIntervals) return entry;
    const marker = `@@REFINTERVALS_${i}@@`;
    markers.push({ marker, rows: entry.referenceIntervals });
    return { ...entry, referenceIntervals: marker };
  });
  let text = JSON.stringify(patched, null, 2);
  for (const { marker, rows } of markers) {
    text = text.replace(`"${marker}"`, formatIntervals(rows, '    '));
  }
  return text;
}
