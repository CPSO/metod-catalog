#!/usr/bin/env node
/**
 * Parses pre-extracted metodeblad text files (produced by
 *   pdftotext -layout -enc UTF-8 file.pdf file.txt
 * ) and diffs the fields we can extract with confidence against
 * src/data/database.json, matched by NPU code.
 *
 * By default this does NOT write anything — it only prints a report.
 * Pass --apply to also patch database.json:
 *   - Matched entries (NPU already in the database): only unit, inUseDate,
 *     revisionDate, replaces get auto-applied — these have held up correctly
 *     across real runs. referenceIntervals is NOT auto-applied to existing
 *     entries anymore: its extraction is unreliable enough on complex
 *     tables (tried and reverted — see PLAN.md) that overwriting known-good
 *     curated data with it caused real data loss. Differences are still
 *     reported as text for manual review.
 *   - New entries (NPU not yet in the database): auto-created as draft
 *     entries using only genuinely-reliable fields (npu, unit, dates,
 *     pdfUrl, letter, best-effort referenceIntervals). Fields that were
 *     never reliably regex-parseable from these PDFs — name (title-line
 *     format is inconsistent across templates), indication, sample,
 *     method, section — are left honestly empty rather than guessed, and
 *     the whole entry is stamped with dataQualityFlags so it's visibly a
 *     draft in the app until a human completes it.
 *   pdfUrl/letter come from --changed-json (the scraper's changed.json),
 *   matched to each .txt file by filename.
 *
 * Pass --report <path> to write a Markdown summary suitable as a PR body.
 *
 * Usage:
 *   node scripts/pdf-diff.js [dir-of-txt-files] [--apply] [--report path.md] [--changed-json path.json]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { serializeDatabase } from './lib/database-format.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliArgs = process.argv.slice(2);
const apply = cliArgs.includes('--apply');
const reportIdx = cliArgs.indexOf('--report');
const reportPath = reportIdx !== -1 ? cliArgs[reportIdx + 1] : null;
const changedJsonIdx = cliArgs.indexOf('--changed-json');
const changedJsonPath = changedJsonIdx !== -1 ? cliArgs[changedJsonIdx + 1] : null;
const flagValueIndices = new Set([reportIdx + 1, changedJsonIdx + 1].filter(i => i > 0));
const positional = cliArgs.filter((a, i) => !a.startsWith('--') && !flagValueIndices.has(i));
const txtDir = positional[0] || path.join(__dirname, 'pdf-samples', 'txt');
const dbPath = path.join(__dirname, '..', 'src', 'data', 'database.json');

// filename (without extension) -> { url, letter } — lets draft entries get a
// real pdfUrl/letter without trying to parse either out of the PDF text.
const changedMeta = new Map();
if (changedJsonPath && fs.existsSync(changedJsonPath)) {
  const changedEntries = JSON.parse(fs.readFileSync(changedJsonPath, 'utf-8'));
  for (const entry of changedEntries) {
    changedMeta.set(path.basename(entry.file, path.extname(entry.file)), { url: entry.url, letter: entry.letter });
  }
}

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

// excludeDates: date values (already normalized, e.g. from another label) to
// skip over. Needed because "Taget i brug:", "Revision:" and "Erstatter:"
// sit in a small cluster near the top of the document, and column-drift
// sometimes splits a label from its own value across two lines with
// *another* label's date landing in between — e.g.
//   Udarbejdet af:   Taget i brug: 23.03.2026        Revision:
//   Valbona Camili   Erstatter: 15.12.2025            23.03.2029
// Searching for the first date after "Revision:" would otherwise grab
// Erstatter's "15.12.2025" instead of Revision's own "23.03.2029", which
// happens to be identical to (or looks like) the replaces date — silently
// wrong with reported confidence "high" and no signal anything was off.
function findDateAfterLabel(text, label, excludeDates = []) {
  const idx = text.indexOf(label);
  if (idx === -1) return { value: null, confidence: 'missing' };
  const window = text.slice(idx + label.length, idx + label.length + 200);
  const dateRe = /(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})/g;
  let m;
  while ((m = dateRe.exec(window)) !== null) {
    const normalized = normalizeDate(m[0]);
    if (!excludeDates.includes(normalized)) {
      return { value: normalized, confidence: 'high' };
    }
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

  // Order matters: replaces/inUseDate are extracted first so their values
  // can be excluded when searching for revisionDate — see findDateAfterLabel's
  // comment for why (column-drift can put another label's date in the way).
  const replaces = findDateAfterLabel(text, 'Erstatter:');
  const inUseDate = findDateAfterLabel(text, 'Taget i brug:', [replaces.value].filter(Boolean));
  const revisionDate = findDateAfterLabel(text, 'Revision:', [replaces.value, inUseDate.value].filter(Boolean));

  return {
    npu: extractNpu(text),
    unit,
    inUseDate,
    revisionDate,
    replaces,
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

// Shown in the app's list/detail views (see referenceTable.js, detailPanel.js)
// as a warning icon so anyone browsing the catalog knows to double-check this
// entry against its source PDF rather than trust it outright. Cleared by
// scripts/mark-reviewed.js once a human has verified it.
const REFERENCE_INTERVAL_FLAG = 'Referenceinterval udtrukket automatisk fra PDF-scraping — kan være ufuldstændigt (fx sammenlagte grupper eller manglende rækker). Bør verificeres mod kildedokumentet.';
const DRAFT_ENTRY_FLAG = 'Automatisk oprettet kladde fra PDF-scraping. Navn er sat til PDF-filnavnet (ikke det kanoniske format) og indikation/prøvetagning/metode/sektion er ikke udfyldt — kræver manuel færdiggørelse.';

// Fields we trust enough to auto-apply to an EXISTING entry. `laboratory`
// and everything under `method`/QC are excluded — see PLAN.md's "Known
// parser quirks": PDF two-column layout drift makes those unreliable, so
// they always stay manual-review-only regardless of --apply.
//
// referenceIntervals is deliberately NOT auto-applied here anymore. It was
// for a while (see PLAN.md), but on complex/drifted tables it silently
// replaced correct, hand-curated data with worse extractions — dropped
// rows, merged distinct patient groups into one, garbled prose into a
// range. That's a real regression when it happens to data someone already
// verified, so referenceIntervals differences on matched entries are
// report-only now; a human decides whether to apply them by hand.
function applyToEntry(dbEntry, parsed) {
  const applied = [];
  const setIfChanged = (label, parsedField, dbValue, setter) => {
    if (parsedField.value === null || parsedField.confidence === 'low') return;
    if (parsedField.value !== dbValue) {
      setter(parsedField.value);
      applied.push(label);
    }
  };

  setIfChanged('unit', parsed.unit, dbEntry.unit, v => { dbEntry.unit = v; });
  setIfChanged('inUseDate', parsed.inUseDate, dbEntry.inUseDate, v => { dbEntry.inUseDate = v; });
  setIfChanged('revisionDate', parsed.revisionDate, dbEntry.revisionDate, v => { dbEntry.revisionDate = v; });

  return applied;
}

function slugify(name, npu) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') + `-${npu.toLowerCase()}`;
}

// "Metodeblad nr. M-256/03" -> "M-256/03". Same landmark already used to
// strip noise out of referenceIntervals descriptors (see stripNoisePrefixes).
function extractDocId(text) {
  const m = text.match(/Metodeblad nr\.\s*([A-Z]-\d+\/\d+)/i);
  return m ? m[1] : null;
}

// Builds a new database.json entry from only the fields this parser can
// reliably get (see the file-level comment for why the rest are left
// empty rather than guessed). meta is { url, letter } from the scraper's
// changed.json, keyed by filename — see changedMeta below.
function createDraftEntry(fileBaseName, parsed, meta, docId) {
  const name = fileBaseName; // PDF's own filename, e.g. "Zink (Plasma)" — not the ";P" canonical format, but real and unambiguous
  return {
    id: docId || '',
    documentNumber: '',
    slug: slugify(name, parsed.npu),
    name,
    letter: meta?.letter || name[0].toUpperCase(),
    npu: parsed.npu,
    labka: '',
    labkaFullName: '',
    spCode: '',
    webreqCode: '',
    pdfUrl: meta?.url || '',
    unit: parsed.unit.value || '',
    section: '',
    hospital: 'Herlev og Gentofte Hospital',
    department: 'Klinisk Biokemisk Afdeling',
    inUseDate: parsed.inUseDate.value || '',
    revisionDate: parsed.revisionDate.value || '',
    replaces: parsed.replaces.value || '',
    indication: { summary: '', elevated: [], decreased: [] },
    sample: { material: '', tube: '', tubeColor: '', minVolume: '', specialConditions: '' },
    referenceIntervals: parsed.referenceIntervals,
    alarmLimits: '',
    logistics: { laboratory: '', frequency: '', handling: {}, stability: {}, transport: {}, preanalyticalErrors: '' },
    method: {},
    history: [],
    dataQualityFlags: [DRAFT_ENTRY_FLAG, ...(parsed.referenceIntervals.length > 0 ? [REFERENCE_INTERVAL_FLAG] : [])]
  };
}

function report(file, text, parsed, dbEntry, database) {
  const lines = [];
  const md = [];
  lines.push(`\n=== ${file} (${parsed.npu || 'NO NPU FOUND'}) ===`);
  md.push(`### ${file} (${parsed.npu || 'NO NPU FOUND'})`);

  if (!dbEntry) {
    if (!parsed.npu) {
      // Can't create an entry without an NPU to key it on (e.g. Elektrokardiografi —
      // a diagnostic procedure code, not a blood test; see PLAN.md).
      lines.push('  ⚠ No NPU found — skipped (nothing to create an entry for).');
      console.log(lines.join('\n'));
      md.push('**⚠ No NPU found in this PDF — skipped, not a matchable analysis.**');
      return { kind: 'skipped', md: md.join('\n') };
    }

    const fileBaseName = file.replace(/\.txt$/i, '');
    const meta = changedMeta.get(fileBaseName);
    const docId = extractDocId(text);

    if (apply) {
      const draft = createDraftEntry(fileBaseName, parsed, meta, docId);
      database.push(draft);
      lines.push(`  + Created draft entry "${draft.name}" (${draft.slug}) — needs manual completion (name/indication/sample/method/section).`);
      lines.push(`    unit: ${fmt(parsed.unit)}`);
      lines.push(`    inUseDate: ${fmt(parsed.inUseDate)}`);
      lines.push(`    revisionDate: ${fmt(parsed.revisionDate)}`);
      lines.push(`    referenceIntervals (${parsed.referenceIntervals.length}):`);
      parsed.referenceIntervals.forEach(r => lines.push(`      - ${r.group} | ${r.age} | ${r.range} ${r.unit || ''}`));
      console.log(lines.join('\n'));

      md.push(`**+ Created draft entry:** \`${draft.slug}\` — **needs manual completion**: name (currently the PDF filename, not the canonical \`;P\` format), indication, sample/tube, method, section.`);
      md.push('');
      md.push(`- unit: ${fmt(parsed.unit)}`);
      md.push(`- inUseDate: ${fmt(parsed.inUseDate)}`);
      md.push(`- revisionDate: ${fmt(parsed.revisionDate)}`);
      md.push(`- referenceIntervals (unverified):`);
      parsed.referenceIntervals.forEach(r => md.push(`  - ${r.group} | ${r.age} | ${r.range} ${r.unit || ''}`));
      return { kind: 'new', md: md.join('\n'), created: true };
    }

    lines.push('  ⚠ No matching entry in database.json — candidate NEW entry (dry run, not created).');
    lines.push(`    unit: ${fmt(parsed.unit)}`);
    lines.push(`    inUseDate: ${fmt(parsed.inUseDate)}`);
    lines.push(`    revisionDate: ${fmt(parsed.revisionDate)}`);
    lines.push(`    laboratory: ${fmt(parsed.laboratory)}`);
    lines.push(`    referenceIntervals (${parsed.referenceIntervals.length}):`);
    parsed.referenceIntervals.forEach(r => lines.push(`      - ${r.group} | ${r.age} | ${r.range} ${r.unit || ''}`));
    console.log(lines.join('\n'));

    md.push('**⚠ No matching NPU in database.json — candidate NEW entry (dry run, not created).**');
    md.push('');
    md.push(`- unit: ${fmt(parsed.unit)}`);
    md.push(`- inUseDate: ${fmt(parsed.inUseDate)}`);
    md.push(`- revisionDate: ${fmt(parsed.revisionDate)}`);
    md.push(`- laboratory: ${fmt(parsed.laboratory)}`);
    md.push(`- referenceIntervals:`);
    parsed.referenceIntervals.forEach(r => md.push(`  - ${r.group} | ${r.age} | ${r.range} ${r.unit || ''}`));
    return { kind: 'new', md: md.join('\n') };
  }

  lines.push(`  Matched: "${dbEntry.name}" (${dbEntry.slug})`);
  md.push(`Matched: **${dbEntry.name}** (\`${dbEntry.slug}\`)`);
  let anyDiff = false;
  const needsReview = [];

  const fieldDiff = (label, parsedField, dbValue) => {
    if (parsedField.value === null) {
      lines.push(`  ? ${label}: could not extract (confidence: ${parsedField.confidence})`);
      return;
    }
    if (parsedField.value !== dbValue) {
      anyDiff = true;
      const flag = parsedField.confidence === 'low' ? ' [low confidence — verify]' : '';
      lines.push(`  ≠ ${label}: DB="${dbValue}" → PDF="${parsedField.value}"${flag}`);
      md.push(`- ≠ **${label}**: \`${dbValue}\` → \`${parsedField.value}\`${flag}`);
      if (parsedField.confidence === 'low') needsReview.push(label);
    }
  };

  fieldDiff('unit', parsed.unit, dbEntry.unit);
  fieldDiff('inUseDate', parsed.inUseDate, dbEntry.inUseDate);
  fieldDiff('revisionDate', parsed.revisionDate, dbEntry.revisionDate);
  fieldDiff('laboratory', parsed.laboratory, dbEntry.logistics?.laboratory);
  if (parsed.laboratory.value !== null) needsReview.push('laboratory (never auto-applied)');

  if (!intervalsEqual(parsed.referenceIntervals, dbEntry.referenceIntervals)) {
    anyDiff = true;
    lines.push('  ≠ referenceIntervals [NOT auto-applied — compare manually]:');
    lines.push('    DB:');
    (dbEntry.referenceIntervals || []).forEach(r => lines.push(`      - ${r.group} | ${r.age} | ${r.range} ${r.unit || ''}`));
    lines.push('    PDF:');
    parsed.referenceIntervals.forEach(r => lines.push(`      - ${r.group} | ${r.age} | ${r.range} ${r.unit || ''}`));

    md.push('- ≠ **referenceIntervals** _(not auto-applied — this parser is unreliable on complex tables; compare manually against the PDF before editing)_:');
    md.push('  - DB: ' + (dbEntry.referenceIntervals || []).map(r => `${r.group}/${r.age}/${r.range}${r.unit || ''}`).join('; '));
    md.push('  - PDF: ' + parsed.referenceIntervals.map(r => `${r.group}/${r.age}/${r.range}${r.unit || ''}`).join('; '));
    needsReview.push('referenceIntervals (not auto-applied)');
  }

  if (!anyDiff) {
    lines.push('  ✓ No differences found.');
    md.push('✓ No differences found.');
  }
  console.log(lines.join('\n'));

  let appliedFields = [];
  if (apply && anyDiff) {
    appliedFields = applyToEntry(dbEntry, parsed);
    if (appliedFields.length) {
      md.push('');
      md.push(`**Applied to database.json:** ${appliedFields.join(', ')}`);
    }
  }
  if (needsReview.length) {
    md.push('');
    md.push(`**Needs manual review:** ${needsReview.join(', ')}`);
  }

  return { kind: 'matched', md: md.join('\n'), anyDiff, appliedFields, needsReview };
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

const results = [];
let anyApplied = false;

for (const file of files) {
  const text = fs.readFileSync(path.join(txtDir, file), 'utf-8');
  const parsed = parsePdfText(text);
  const dbEntry = database.find(item => item.npu === parsed.npu);
  const result = report(file, text, parsed, dbEntry, database);
  if (result) {
    results.push(result);
    if (result.appliedFields?.length || result.created) anyApplied = true;
  }
}

if (apply && anyApplied) {
  fs.writeFileSync(dbPath, serializeDatabase(database) + '\n');
  console.log(`\n✎ Applied changes written to ${dbPath}`);
}

if (reportPath) {
  const createdCount = results.filter(r => r.created).length;
  const skippedCount = results.filter(r => r.kind === 'skipped').length;
  const newNotCreatedCount = results.filter(r => r.kind === 'new' && !r.created).length;
  const changedCount = results.filter(r => r.kind === 'matched' && r.anyDiff).length;
  const header = [
    '## PDF scrape / database sync report',
    '',
    `${files.length} PDF(s) checked — ${changedCount} matched entr${changedCount === 1 ? 'y' : 'ies'} with differences (unit/dates auto-applied, referenceIntervals report-only), ` +
      (apply
        ? `${createdCount} new draft entr${createdCount === 1 ? 'y' : 'ies'} created`
        : `${newNotCreatedCount} candidate new entr${newNotCreatedCount === 1 ? 'y' : 'ies'} (dry run, not created)`) +
      (skippedCount ? `, ${skippedCount} skipped (no NPU found)` : '') + '.',
    apply
      ? '_unit/inUseDate/revisionDate applied to matched entries; new entries created as flagged drafts needing manual completion; referenceIntervals changes on matched entries were NOT applied — see below._'
      : '_Dry run — no changes applied._',
    ''
  ];
  fs.writeFileSync(reportPath, header.join('\n') + '\n' + results.map(r => r.md).join('\n\n') + '\n');
  console.log(`\n✎ Report written to ${reportPath}`);
}
