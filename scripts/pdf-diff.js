#!/usr/bin/env node
/**
 * Parses pre-extracted metodeblad text files (produced by
 *   pdftotext -layout -enc UTF-8 file.pdf file.txt
 * ) and diffs the fields we can extract with confidence against
 * src/data/database.json, matched by NPU code.
 *
 * This does NOT write anything — it only prints a report. It's the dry-run
 * step before wiring PDF scraping into a GitHub Action that opens a PR.
 *
 * Usage:
 *   node scripts/pdf-diff.js [dir-of-txt-files]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const txtDir = process.argv[2] || path.join(__dirname, 'pdf-samples', 'txt');
const dbPath = path.join(__dirname, '..', 'src', 'data', 'database.json');

const GROUP_WORDS = {
  'alle': 'Alle',
  'kvinde': 'Kvinder',
  'kvinder': 'Kvinder',
  'mand': 'Mænd',
  'mænd': 'Mænd',
  'børn': 'Børn',
  'barn': 'Børn',
  '♀': 'Kvinder',
  '♂': 'Mænd'
};

function normalizeDate(raw) {
  const m = raw.match(/(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${d.padStart(2, '0')}-${mo.padStart(2, '0')}-${y}`;
}

function findDateAfterLabel(text, label) {
  const idx = text.indexOf(label);
  if (idx === -1) return { value: null, confidence: 'missing' };
  const window = text.slice(idx + label.length, idx + label.length + 200);
  const dateMatch = window.match(/(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})/);
  if (dateMatch) {
    return { value: normalizeDate(dateMatch[0]), confidence: 'high' };
  }
  // Non-date value right after the label (e.g. "Erstatter: Nyt")
  const literalMatch = window.match(/\S.{0,20}/);
  return { value: literalMatch ? literalMatch[0].trim() : null, confidence: 'low' };
}

function extractNpu(text) {
  const m = text.match(/NPU\d{5}/);
  return m ? m[0] : null;
}

function extractUnit(text) {
  const line = text.split('\n').find(l => l.trim().startsWith('Enhed'));
  if (!line) return { value: null, confidence: 'missing' };
  const value = line.replace(/^\s*Enhed/, '').trim();
  return { value: value || null, confidence: value ? 'high' : 'missing' };
}

function extractLaboratory(text) {
  const idx = text.indexOf('Udførende laboratorie');
  if (idx === -1) return { value: null, confidence: 'missing' };
  const window = text.slice(idx, idx + 400);
  const m = window.match(/Herlev og Gentofte[^\n.]{0,80}|Herlev-matriklen[^\n]{0,120}/);
  if (!m) return { value: null, confidence: 'missing' };
  // If the phrase isn't reasonably close to the label, flag it as low-confidence —
  // column drift in some templates puts an unrelated value right after the label.
  const distance = window.indexOf(m[0]);
  return { value: m[0].replace(/\s+/g, ' ').trim(), confidence: distance < 120 ? 'high' : 'low' };
}

// A reference-interval row is any line that splits into "descriptor : numeric-range/threshold [unit]".
// Unit tail is unrestricted (not "no digits") because units like "x 103 IU/L" or "10³ IU/L" contain them.
const ROW_RE = /^(.{1,60}?):\s*([<≥≤>]?\s*[\d.,]+(?:\s*[-–]\s*[\d.,]+)?)\s*(.{0,25})$/;
const STANDALONE_GROUP_RE = /^(alle|kvinder?|mænd|mand|børn|barn|[♀♂])\s*:?\s*$/i;

// An age/time descriptor must contain a recognizable unit (or be a bare group word) —
// this is what keeps unrelated "label: value" lines elsewhere in the document (dates,
// stability durations, etc.) from being mistaken for reference-interval rows.
// Note: \b doesn't work around å/æ/ø (JS treats them as non-word chars), so these
// patterns match on the substring directly instead of relying on word boundaries.
const AGE_UNIT_RE = /(år|døgn|dage?|(?:^|\s)d(?:\s|$)|mdr\.?|uger|måned|timer|voksne|risiko|menopause|fase)/i;
const DATE_LIKE_RE = /^\d{1,2}\.\d{1,2}\.\d{4}$/;

// Label text that sometimes drifts into the same line as a genuine interval row
// (PDF column misalignment) — stripped rather than used to reject the row.
const NOISE_PREFIXES = [
  'Udførende laboratorie', 'Analyseringshyppighed', 'Svartid', 'Prøvehåndtering',
  'Præanalytiske fejlkilder', 'Ringegrænser', '(efter modtagelse af prøve)', 'Forsendelse',
  'Referenceinterval/kliniske be-', 'Referenceinterval', 'slutningsgrænser'
];
const DOC_NUMBER_RE = /Metodeblad nr\.\s*[A-Z]-\d+\/\d+/i;
const BARE_GROUP_RE = /^(alle|kvinder?|mænd|mand|børn|barn|[♀♂])$/i;

function stripNoisePrefixes(descriptor) {
  let cleaned = descriptor.replace(DOC_NUMBER_RE, ' ');
  for (const noise of NOISE_PREFIXES) {
    cleaned = cleaned.replace(noise, ' ');
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

function splitGroupFromAge(descriptor) {
  for (const word of Object.keys(GROUP_WORDS)) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^${escaped}[:.]?\\s*`, 'i');
    if (re.test(descriptor)) {
      return { group: GROUP_WORDS[word], age: descriptor.replace(re, '').trim() };
    }
  }
  return null;
}

function extractReferenceIntervals(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const rows = [];
  let currentGroup = 'Alle';

  for (const line of lines) {
    if (STANDALONE_GROUP_RE.test(line)) {
      const word = line.replace(':', '').trim().toLowerCase();
      currentGroup = GROUP_WORDS[word] || currentGroup;
      continue;
    }

    const m = line.match(ROW_RE);
    if (!m) continue;
    const [, descriptorRaw, range, unitRaw] = m;
    const descriptor = stripNoisePrefixes(descriptorRaw.trim());
    const trimmedRange = range.replace(/\s+/g, ' ').trim();
    const unit = unitRaw.trim();

    if (DATE_LIKE_RE.test(trimmedRange)) continue;

    // "Alle: 10 – 65 U/L" — a whole-life interval with no age subdivision at all.
    if (BARE_GROUP_RE.test(descriptor)) {
      rows.push({
        group: GROUP_WORDS[descriptor.toLowerCase()] || descriptor,
        age: 'Alle aldre',
        range: trimmedRange,
        unit: unit || null
      });
      continue;
    }

    if (!AGE_UNIT_RE.test(descriptor)) continue;

    const inline = splitGroupFromAge(descriptor);
    rows.push({
      group: inline ? inline.group : currentGroup,
      age: inline ? inline.age : descriptor,
      range: trimmedRange,
      unit: unit || null
    });
  }
  return rows;
}

// When the normal row extraction finds nothing, some templates (e.g. Antitrypsin,
// Apolipoprotein B) just state a single unlabeled threshold/range for the whole
// reference-interval section, with no age stratification at all — e.g. "0,97-1,68 g/L"
// sitting alone. Per manual review of those PDFs: that means the value applies to all
// ages, so fall back to a single "Alle / Alle aldre" row anchored on the document's
// own declared unit (kept narrow to the Referenceinterval section so it can't pick up
// unrelated numbers from the QC/measuring-range tables elsewhere in the document).
function extractSectionSlice(text, startLabels, endLabels) {
  let startIdx = -1;
  let startLen = 0;
  for (const label of startLabels) {
    const idx = text.toLowerCase().indexOf(label.toLowerCase());
    if (idx !== -1 && (startIdx === -1 || idx < startIdx)) {
      startIdx = idx;
      startLen = label.length;
    }
  }
  if (startIdx === -1) return null;

  let endIdx = text.length;
  for (const label of endLabels) {
    const idx = text.indexOf(label, startIdx + startLen);
    if (idx !== -1 && idx < endIdx) endIdx = idx;
  }
  return text.slice(startIdx, endIdx);
}

function extractFallbackWholeLifeRange(text, unitValue) {
  if (!unitValue) return null;
  const escapedUnit = unitValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Templates like Apolipoprotein B state the value right next to a
  // "beslutningsgrænse:" (decision threshold) label — grab it directly rather than
  // via section bounds, since "beslutningsgrænse" also appears loosely in prose
  // elsewhere in the same document without being followed by a colon.
  const directMatch = text.match(
    new RegExp(`beslutningsgrænse\\s*:\\s*([<≥>]?\\s*[\\d.,]+(?:\\s*[-–]\\s*[\\d.,]+)?)\\s*${escapedUnit}`, 'i')
  );
  if (directMatch) return { range: directMatch[1].replace(/\s+/g, ' ').trim(), unit: unitValue };

  // Otherwise (e.g. Antitrypsin), the value sits unlabeled somewhere between the
  // "Referenceinterval" heading and the next section — scan that bounded slice.
  const slice = extractSectionSlice(text, ['Referenceinterval'], ['Ringegrænser', 'Udførende laboratorie']);
  if (!slice) return null;

  const re = new RegExp(`([<≥>]?\\s*[\\d.,]+(?:\\s*[-–]\\s*[\\d.,]+)?)\\s*${escapedUnit}`);
  const lines = slice.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const m = line.match(re);
    if (m) return { range: m[1].replace(/\s+/g, ' ').trim(), unit: unitValue };
  }
  return null;
}

function parsePdfText(text) {
  const unit = extractUnit(text);
  let referenceIntervals = extractReferenceIntervals(text);

  if (referenceIntervals.length === 0) {
    const fallback = extractFallbackWholeLifeRange(text, unit.value);
    if (fallback) {
      referenceIntervals = [{ group: 'Alle', age: 'Alle aldre', range: fallback.range, unit: fallback.unit }];
    }
  }

  return {
    npu: extractNpu(text),
    unit,
    inUseDate: findDateAfterLabel(text, 'Taget i brug:'),
    revisionDate: findDateAfterLabel(text, 'Revision:'),
    replaces: findDateAfterLabel(text, 'Erstatter:'),
    laboratory: extractLaboratory(text),
    referenceIntervals
  };
}

function intervalsEqual(a = [], b = []) {
  if (a.length !== b.length) return false;
  return a.every((row, i) => {
    const other = b[i];
    return other && row.group === other.group && row.age === other.age && row.range === other.range;
  });
}

function report(file, parsed, dbEntry) {
  const lines = [];
  lines.push(`\n=== ${file} (${parsed.npu || 'NO NPU FOUND'}) ===`);

  if (!dbEntry) {
    lines.push('  ⚠ No matching entry in database.json — candidate NEW entry.');
    lines.push(`    unit: ${fmt(parsed.unit)}`);
    lines.push(`    inUseDate: ${fmt(parsed.inUseDate)}`);
    lines.push(`    revisionDate: ${fmt(parsed.revisionDate)}`);
    lines.push(`    laboratory: ${fmt(parsed.laboratory)}`);
    lines.push(`    referenceIntervals (${parsed.referenceIntervals.length}):`);
    parsed.referenceIntervals.forEach(r => lines.push(`      - ${r.group} | ${r.age} | ${r.range} ${r.unit || ''}`));
    console.log(lines.join('\n'));
    return;
  }

  lines.push(`  Matched: "${dbEntry.name}" (${dbEntry.slug})`);
  let anyDiff = false;

  const fieldDiff = (label, parsedField, dbValue) => {
    if (parsedField.value === null) {
      lines.push(`  ? ${label}: could not extract (confidence: ${parsedField.confidence})`);
      return;
    }
    if (parsedField.value !== dbValue) {
      anyDiff = true;
      const flag = parsedField.confidence === 'low' ? ' [low confidence — verify]' : '';
      lines.push(`  ≠ ${label}: DB="${dbValue}" → PDF="${parsedField.value}"${flag}`);
    }
  };

  fieldDiff('unit', parsed.unit, dbEntry.unit);
  fieldDiff('inUseDate', parsed.inUseDate, dbEntry.inUseDate);
  fieldDiff('revisionDate', parsed.revisionDate, dbEntry.revisionDate);
  fieldDiff('laboratory', parsed.laboratory, dbEntry.logistics?.laboratory);

  if (!intervalsEqual(parsed.referenceIntervals, dbEntry.referenceIntervals)) {
    anyDiff = true;
    lines.push('  ≠ referenceIntervals:');
    lines.push('    DB:');
    (dbEntry.referenceIntervals || []).forEach(r => lines.push(`      - ${r.group} | ${r.age} | ${r.range} ${r.unit || ''}`));
    lines.push('    PDF:');
    parsed.referenceIntervals.forEach(r => lines.push(`      - ${r.group} | ${r.age} | ${r.range} ${r.unit || ''}`));
  }

  if (!anyDiff) lines.push('  ✓ No differences found.');
  console.log(lines.join('\n'));
}

function fmt(field) {
  return `${field.value ?? '(none)'} [${field.confidence}]`;
}

// --- main ---
const database = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
const files = fs.readdirSync(txtDir).filter(f => f.endsWith('.txt'));

if (files.length === 0) {
  console.log(`No .txt files found in ${txtDir}`);
  process.exit(1);
}

for (const file of files) {
  const text = fs.readFileSync(path.join(txtDir, file), 'utf-8');
  const parsed = parsePdfText(text);
  const dbEntry = database.find(item => item.npu === parsed.npu);
  report(file, parsed, dbEntry);
}
