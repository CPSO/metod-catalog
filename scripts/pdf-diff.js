#!/usr/bin/env node
/**
 * Parses pre-extracted metodeblad field JSON (produced by
 *   python3 scripts/extract_pdf_fields.py file.pdf > file.json
 * ) and diffs the fields we can extract with confidence against
 * src/data/database.json, matched by NPU code.
 *
 * Extraction moved from linearized pdftotext -layout text to pdfplumber's
 * table detection (see extract_pdf_fields.py) after confirming, on real
 * samples, that pdftotext's column-reconstruction heuristic regularly
 * misorders two-column content — merging distinct patient groups, dropping
 * rows, gluing unrelated labels/values together. pdfplumber uses each
 * word's actual position instead of guessing, so it recovers the PDF's
 * real label -> value structure directly. This script only reads that
 * already-clean structure; it has no text-layout logic of its own anymore
 * (see PLAN.md for the before/after evidence on Østradiol, INR,
 * Hydrogencarbonat, and the revisionDate/Erstatter mixup).
 *
 * By default this does NOT write anything — it only prints a report.
 * Pass --apply to also patch database.json:
 *   - Matched entries (NPU already in the database): only unit, inUseDate,
 *     revisionDate, replaces get auto-applied — these have held up
 *     correctly across real runs. referenceIntervals is NOT auto-applied
 *     to existing entries — even with the better extraction, overwriting
 *     hand-curated data automatically is a real risk if this parser is
 *     ever wrong again, so it stays report-only for matched entries by
 *     policy, not just by current necessity.
 *   - New entries (NPU not yet in the database): auto-created as draft
 *     entries. Filled from the clean per-field extraction: name (from the
 *     "Analysenavn og kode i SP/WebReq" label, with the NPU suffix
 *     stripped and a plausibility check — falls back to the PDF's own
 *     filename when that label is missing, multi-line, or reads like an
 *     instruction rather than a name, e.g. combined/panel documents),
 *     section, indication summary, sample material/volume, alarm limits,
 *     laboratory, unit, dates, referenceIntervals. Deep method/QC fields
 *     are still left empty — not attempted this pass. The whole entry is
 *     stamped with dataQualityFlags so it's visibly a draft until a human
 *     completes/verifies it.
 *   pdfUrl/letter come from --changed-json (the scraper's changed.json),
 *   matched to each .json field-extract file by filename.
 *
 * Pass --report <path> to write a Markdown summary suitable as a PR body.
 *
 * Usage:
 *   node scripts/pdf-diff.js [dir-of-json-files] [--apply] [--report path.md] [--changed-json path.json]
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
const jsonDir = positional[0] || path.join(__dirname, 'pdf-samples', 'json');
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

function normalizeDate(raw) {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${d.padStart(2, '0')}-${mo.padStart(2, '0')}-${y}`;
}

function dateField(data, key) {
  const raw = data.dates?.[key];
  const value = normalizeDate(raw);
  return { value, confidence: value ? 'high' : 'missing' };
}

// pdfplumber (like pdftotext before it) loses superscript/subscript
// formatting at the font-rendering level, not the layout level — a PDF's
// "×10⁹" and a genuine literal "109" produce identical extracted text
// either way, so this is unrelated to the table-extraction rewrite and
// still needed. Confirmed against real data: 15+ hematology entries
// (erythrocytes, leukocyte subtypes, thrombocytes) all use "×10ⁿ/L"-style
// units and would extract this way.
const STRIPPED_EXPONENT_RE = /10\d/;

function extractUnit(data) {
  const value = data.fields['Enhed'];
  if (!value) return { value: null, confidence: 'missing' };
  return { value, confidence: STRIPPED_EXPONENT_RE.test(value) ? 'low' : 'high' };
}

function extractLaboratory(data) {
  const value = data.fields['Udførende laboratorie'];
  return value ? { value, confidence: 'high' } : { value: null, confidence: 'missing' };
}

const SECTION_MAP = [
  [/koagulation/i, 'KOAGULATION'],
  [/immun/i, 'IMMUNKEMI'],
  [/poct|præanalyse|ekg/i, 'POCT'],
  [/kemi/i, 'KEMI']
];

function extractSection(data) {
  const raw = data.fields['Ansvarlig KBA analysesektion'];
  if (!raw) return null;
  for (const [re, code] of SECTION_MAP) {
    if (re.test(raw)) return code;
  }
  return null;
}

// The "Analysenavn og kode i SP" / "...WebReq" cells usually hold the exact
// canonical "Name;P" string plus the NPU, but not always — combined
// documents (e.g. Hydrogencarbonat's arterial+venous variant), shared
// antibody-panel sheets (Sjøgren SSA/SSB/U1 snRNP all point to the same
// "Nucleært-Ab(IgG) [ANA]" screening panel text instead of their own
// name), and unavailable-via-this-channel notes (e.g. "Rekvirering via
// WebReq er ikke muligt") put something else there instead.
//
// A blacklist of "doesn't look like a name" phrases was tried and found
// insufficient — real documents kept producing new non-name phrasings a
// fixed list can't anticipate. Require a *positive* signal instead: every
// genuine name in this database follows the "Name;SpecimenCode" NPU
// convention (e.g. "Antitrypsin;P", "Hæmoglobin A1c (IFCC);Hb(B)"), so
// only accept candidates containing that semicolon-separated shape.
const NAME_SHAPE_RE = /^[^;\n]{2,70};\s*[A-Za-zÆØÅæøå0-9()]{1,15}$/;

function cleanNameCandidate(raw, npu) {
  if (!raw || raw.includes('\n')) return null;
  const text = raw
    .replace(new RegExp(`\\(?\\s*og\\s+${npu}\\s*\\)?`, 'i'), '')
    .replace(new RegExp(`\\(?\\s*${npu}\\s*\\)?`, 'i'), '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[,()]+|[,()]+$/g, '')
    .trim();
  return NAME_SHAPE_RE.test(text) ? text : null;
}

function extractName(data) {
  if (!data.npu) return null;
  return (
    cleanNameCandidate(data.fields['Analysenavn og kode i SP'], data.npu) ||
    cleanNameCandidate(data.fields['Analysenavn og kode i WebReq'], data.npu) ||
    null
  );
}

function extractIndicationSummary(data) {
  const raw = data.fields['Indikation og resultatvurdering'];
  return raw ? raw.replace(/\s*\n\s*/g, ' ').trim() : null;
}

function extractSampleMaterial(data) {
  const raw = data.fields['Prøvemateriale og rørtype'];
  return raw ? raw.replace(/\s*\n\s*/g, ' ').trim() : null;
}

function extractMinVolume(data) {
  const raw = data.fields['Mindste prøvemængde'];
  return raw ? raw.replace(/\s*\n\s*/g, ' ').trim() : null;
}

function extractAlarmLimits(data) {
  const raw = data.fields['Ringegrænser'];
  return raw ? raw.replace(/\s*\n\s*/g, ' ').trim() : null;
}

const REF_LABEL_ALIASES = [
  'Referenceinterval',
  'Referenceinterval/kliniske be- slutningsgrænser',
  'Klinisk beslutningsgrænse',
  'Kliniske beslutningsgrænse',
  'Kliniske beslutningsgrænser'
];

function findReferenceCell(data) {
  for (const label of REF_LABEL_ALIASES) {
    if (data.fields[label]) return data.fields[label];
  }
  return null;
}

const GROUP_WORDS = {
  'alle': 'Alle',
  'kvinde': 'Kvinder',
  'kvinder': 'Kvinder',
  '♀': 'Kvinder',
  'mand': 'Mænd',
  'mænd': 'Mænd',
  '♂': 'Mænd',
  'børn': 'Børn',
  'barn': 'Børn'
};

// A reference-interval row is a line that splits into "descriptor : numeric-range/threshold [unit]".
// Unit tail is unrestricted (not "no digits") because units like "x 103 IU/L" or "10³ IU/L" contain them.
const ROW_RE = /^(.{1,60}?):\s*([<≥≤>]?\s*[\d.,]+(?:\s*[-–]\s*[\d.,]+)?)\s*(.{0,60})$/;
const STANDALONE_GROUP_RE = /^(alle|kvinder?|mænd|mand|børn|barn|[♀♂])\s*:?\s*$/i;
const BARE_GROUP_RE = /^(alle|kvinder?|mænd|mand|børn|barn|[♀♂])$/i;
const AGE_UNIT_RE = /(år|døgn|dage?|(?:^|\s)d(?:\s|$)|mdr\.?|uger|måned|timer|voksne|risiko|menopause|fase)/i;
const DATE_LIKE_RE = /^\d{1,2}\.\d{1,2}\.\d{4}$/;

// Strips a leading "♀: " / "Kvinder: " style group prefix off a line, if
// present, and returns what's left along with the resolved group. Needed
// because rows like "♀: 16 dage – 10 år: 0,02-0,11 nmol/L" have TWO
// colons — running ROW_RE on the raw line lets its non-greedy descriptor
// match settle for the first ("♀"), which then looks like a bare group
// symbol (matches BARE_GROUP_RE) and swallows the real age/range into a
// mangled "unit" string instead. Stripping the prefix first means ROW_RE
// only ever sees the second, real colon.
function stripLeadingGroupPrefix(line) {
  for (const word of Object.keys(GROUP_WORDS)) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^${escaped}[:.]\\s*`, 'i');
    if (re.test(line)) {
      return { group: GROUP_WORDS[word], rest: line.replace(re, '').trim() };
    }
  }
  return null;
}

// Parses a reference-interval cell's text into rows. This now runs on text
// pdfplumber already isolated to this one labeled field, not the whole
// document — the false-positive risk that made an earlier, similar "treat
// any non-age label as its own group" attempt unsafe against raw
// pdftotext text (it swept in unrelated dates/stability/interference text
// from elsewhere in the document) doesn't apply here: there's nothing else
// in this string to sweep in. Confirmed against real samples: correctly
// captures decision-threshold tables (Negativ/Inkonklusiv/Positiv) that
// the previous version dropped 2 of 3 rows from.
// Some templates put a row's label on one line and its value on the very
// next, e.g. "Arterie- og kapillærblod:" / "22,0-27,0 mmol/L." — confirmed
// on Hydrogencarbonat, where this cost the whole Veneblod row before this
// merge existed. Only merges when the next line has no colon of its own
// (i.e. clearly a bare value, not the start of a different label: value
// row) so it doesn't swallow a following group header or row by mistake.
function mergeSplitLabelValueLines(lines) {
  const merged = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];
    if (/:$/.test(line) && next && !next.includes(':')) {
      merged.push(`${line} ${next}`);
      i++;
    } else {
      merged.push(line);
    }
  }
  return merged;
}

function extractReferenceIntervals(cellText) {
  if (!cellText) return [];
  const rawLines = cellText.split('\n').map(l => l.trim()).filter(Boolean);
  const lines = mergeSplitLabelValueLines(rawLines);
  const rows = [];
  let currentGroup = 'Alle';

  for (const rawLine of lines) {
    if (STANDALONE_GROUP_RE.test(rawLine)) {
      const word = rawLine.replace(':', '').trim().toLowerCase();
      currentGroup = GROUP_WORDS[word] || currentGroup;
      continue;
    }

    const prefixStripped = stripLeadingGroupPrefix(rawLine);
    const line = prefixStripped ? prefixStripped.rest : rawLine;
    const inlineGroup = prefixStripped ? prefixStripped.group : null;

    const m = line.match(ROW_RE);
    if (!m) continue;
    const [, descriptorRaw, range, unitRaw] = m;
    const descriptor = descriptorRaw.trim();
    const trimmedRange = range.replace(/\s+/g, ' ').trim();
    const unit = unitRaw.trim();
    if (!descriptor || DATE_LIKE_RE.test(trimmedRange)) continue;

    if (BARE_GROUP_RE.test(descriptor)) {
      rows.push({ group: inlineGroup || GROUP_WORDS[descriptor.toLowerCase()] || descriptor, age: 'Alle aldre', range: trimmedRange, unit: unit || null });
      continue;
    }

    if (AGE_UNIT_RE.test(descriptor)) {
      rows.push({
        group: inlineGroup || currentGroup,
        age: descriptor,
        range: trimmedRange,
        unit: unit || null
      });
      continue;
    }

    // Not an age bracket — a decision-threshold label (Negativ/Positiv/...)
    // or similar. Safe to keep as its own group now the input is already
    // isolated to this one field (see function comment).
    rows.push({ group: inlineGroup || descriptor, age: 'Alle aldre', range: trimmedRange, unit: unit || null });
  }
  return rows;
}

// Some templates (e.g. Antitrypsin, Apolipoprotein B) state a single
// unlabeled threshold/range for the whole cell instead of a "label: value"
// row — e.g. just "0,97-1,68 g/L" on its own line. Catch that as a
// whole-life "Alle" row anchored on the document's own declared unit.
function extractFallbackWholeLifeRange(cellText, unitValue) {
  if (!cellText || !unitValue) return null;
  const escapedUnit = unitValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`([<≥>]?\\s*[\\d.,]+(?:\\s*[-–]\\s*[\\d.,]+)?)\\s*${escapedUnit}`);
  const lines = cellText.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const m = line.match(re);
    if (m) return { range: m[1].replace(/\s+/g, ' ').trim(), unit: unitValue };
  }
  return null;
}

function parsePdfJson(data) {
  const unit = extractUnit(data);
  const refCell = findReferenceCell(data);
  let referenceIntervals = extractReferenceIntervals(refCell);

  if (referenceIntervals.length === 0) {
    const fallback = extractFallbackWholeLifeRange(refCell, unit.value);
    if (fallback) {
      referenceIntervals = [{ group: 'Alle', age: 'Alle aldre', range: fallback.range, unit: fallback.unit }];
    }
  }

  return {
    npu: data.npu || null,
    docId: data.docId || null,
    unit,
    inUseDate: dateField(data, 'inUseDate'),
    revisionDate: dateField(data, 'revisionDate'),
    replaces: dateField(data, 'replaces'),
    laboratory: extractLaboratory(data),
    referenceIntervals,
    name: extractName(data),
    section: extractSection(data),
    indicationSummary: extractIndicationSummary(data),
    sampleMaterial: extractSampleMaterial(data),
    minVolume: extractMinVolume(data),
    alarmLimits: extractAlarmLimits(data)
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
const REFERENCE_INTERVAL_FLAG = 'Referenceinterval udtrukket automatisk fra PDF-scraping — bør verificeres mod kildedokumentet.';
const DRAFT_ENTRY_FLAG = 'Automatisk oprettet kladde fra PDF-scraping. Metode/apparatur-felter og evt. indikationens forhøjet/nedsat-lister er ikke udfyldt — kræver manuel færdiggørelse.';
const NAME_IS_FILENAME_FLAG = 'Navn kunne ikke udtrækkes pålideligt fra PDF\'en og er sat til filnavnet i stedet — ikke det kanoniske ";P"-format. Bør rettes manuelt.';
const EXPONENT_UNIT_FLAG = 'Enheden kan indeholde en tabt eksponent — PDF-tekstudtræk viser fx "×10⁹" som "109", der er umuligt at skelne fra et ægte "109". Tjek enheden mod selve PDF\'en.';

// Fields we trust enough to auto-apply to an EXISTING entry. Everything
// under `method`/QC stays manual-review-only regardless of --apply — not
// attempted by this parser at all yet. referenceIntervals is deliberately
// NOT auto-applied here even though the new extraction is far more
// reliable (see PLAN.md): overwriting hand-curated data automatically is a
// real risk if this parser is ever wrong again, so it's report-only for
// matched entries by policy, not just by current necessity.
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

// Builds a new database.json entry. meta is { url, letter } from the
// scraper's changed.json, keyed by filename — see changedMeta above.
function createDraftEntry(fileBaseName, parsed, meta) {
  const nameIsFilename = !parsed.name;
  const name = parsed.name || fileBaseName; // fallback: PDF's own filename — real and unambiguous, just not the canonical ";P" format
  return {
    id: parsed.docId || '',
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
    section: parsed.section || '',
    hospital: 'Herlev og Gentofte Hospital',
    department: 'Klinisk Biokemisk Afdeling',
    inUseDate: parsed.inUseDate.value || '',
    revisionDate: parsed.revisionDate.value || '',
    replaces: parsed.replaces.value || '',
    indication: { summary: parsed.indicationSummary || '', elevated: [], decreased: [] },
    sample: { material: parsed.sampleMaterial || '', tube: '', tubeColor: '', minVolume: parsed.minVolume || '', specialConditions: '' },
    referenceIntervals: parsed.referenceIntervals,
    alarmLimits: parsed.alarmLimits || '',
    logistics: { laboratory: parsed.laboratory.value || '', frequency: '', handling: {}, stability: {}, transport: {}, preanalyticalErrors: '' },
    method: {},
    history: [],
    dataQualityFlags: [
      DRAFT_ENTRY_FLAG,
      ...(nameIsFilename ? [NAME_IS_FILENAME_FLAG] : []),
      ...(parsed.referenceIntervals.length > 0 ? [REFERENCE_INTERVAL_FLAG] : []),
      ...(parsed.unit.confidence === 'low' ? [EXPONENT_UNIT_FLAG] : [])
    ]
  };
}

function report(file, parsed, dbEntry, database) {
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

    const fileBaseName = file.replace(/\.json$/i, '');
    const meta = changedMeta.get(fileBaseName);

    if (apply) {
      const draft = createDraftEntry(fileBaseName, parsed, meta);
      database.push(draft);
      lines.push(`  + Created draft entry "${draft.name}" (${draft.slug})${draft.dataQualityFlags.length > 1 ? ' — needs manual review, see flags' : ''}.`);
      lines.push(`    unit: ${fmt(parsed.unit)}`);
      lines.push(`    inUseDate: ${fmt(parsed.inUseDate)}`);
      lines.push(`    revisionDate: ${fmt(parsed.revisionDate)}`);
      lines.push(`    section: ${parsed.section || '(none)'}`);
      lines.push(`    referenceIntervals (${parsed.referenceIntervals.length}):`);
      parsed.referenceIntervals.forEach(r => lines.push(`      - ${r.group} | ${r.age} | ${r.range} ${r.unit || ''}`));
      console.log(lines.join('\n'));

      md.push(`**+ Created draft entry:** \`${draft.slug}\``);
      md.push('');
      md.push(`- name: ${draft.name}${parsed.name ? '' : ' _(fallback: PDF filename, not canonical format)_'}`);
      md.push(`- section: ${parsed.section || '(none)'}`);
      md.push(`- unit: ${fmt(parsed.unit)}`);
      md.push(`- inUseDate: ${fmt(parsed.inUseDate)}`);
      md.push(`- revisionDate: ${fmt(parsed.revisionDate)}`);
      md.push(`- referenceIntervals (unverified):`);
      parsed.referenceIntervals.forEach(r => md.push(`  - ${r.group} | ${r.age} | ${r.range} ${r.unit || ''}`));
      md.push(`- dataQualityFlags: ${draft.dataQualityFlags.length}`);
      return { kind: 'new', md: md.join('\n'), created: true };
    }

    lines.push('  ⚠ No matching entry in database.json — candidate NEW entry (dry run, not created).');
    lines.push(`    name: ${parsed.name || '(fallback to filename)'}`);
    lines.push(`    unit: ${fmt(parsed.unit)}`);
    lines.push(`    inUseDate: ${fmt(parsed.inUseDate)}`);
    lines.push(`    revisionDate: ${fmt(parsed.revisionDate)}`);
    lines.push(`    referenceIntervals (${parsed.referenceIntervals.length}):`);
    parsed.referenceIntervals.forEach(r => lines.push(`      - ${r.group} | ${r.age} | ${r.range} ${r.unit || ''}`));
    console.log(lines.join('\n'));

    md.push('**⚠ No matching NPU in database.json — candidate NEW entry (dry run, not created).**');
    md.push('');
    md.push(`- name: ${parsed.name || '(fallback to filename)'}`);
    md.push(`- unit: ${fmt(parsed.unit)}`);
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

    md.push('- ≠ **referenceIntervals** _(not auto-applied by policy — compare manually against the PDF before editing)_:');
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
const files = fs.readdirSync(jsonDir).filter(f => f.endsWith('.json'));

if (files.length === 0) {
  console.log(`No .json field-extract files found in ${jsonDir}`);
  process.exit(1);
}

const results = [];
let anyApplied = false;

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(jsonDir, file), 'utf-8'));
  const parsed = parsePdfJson(data);
  const dbEntry = database.find(item => item.npu === parsed.npu);
  const result = report(file, parsed, dbEntry, database);
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
      ? '_unit/inUseDate/revisionDate applied to matched entries; new entries created as flagged drafts (name/section/indication/sample/referenceIntervals filled where reliably extractable, method/QC left for manual completion); referenceIntervals changes on matched entries were NOT applied — see below._'
      : '_Dry run — no changes applied._',
    ''
  ];
  fs.writeFileSync(reportPath, header.join('\n') + '\n' + results.map(r => r.md).join('\n\n') + '\n');
  console.log(`\n✎ Report written to ${reportPath}`);
}
