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
import { parseReferenceCell, findReferenceCell } from './lib/reference-parser.js';
import { desymbolize } from './lib/text-clean.js';

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

// pdfplumber flattens "×10⁹/L" to "x 109/L" (font-level loss). But the
// exponent is recoverable from lab convention + the "×10" signature, so
// restore it: "x 103 IU/L" -> "× 10³ IU/L", "x 10-3 IU/L" -> "× 10⁻³ IU/L".
// A bare "109" with no leading "×10" is left alone — that really is
// ambiguous, and extractUnit still flags it.
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
function normalizeExponentUnit(v) {
  if (typeof v !== 'string' || !v) return v;
  return v
    .replace(/([x×])\s*10(-?\d+)/g, (_, __, exp) => '× 10' + exp.replace(/[-\d]/g, c => SUP[c]))
    .replace(/([⁰¹²³⁴⁵⁶⁷⁸⁹⁻])\s+\//g, '$1/');
}

function extractUnit(data) {
  const raw = data.fields['Enhed'];
  if (!raw) return { value: null, confidence: 'missing' };
  const value = normalizeExponentUnit(unwrap(raw));
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
    // Some sheets double the specimen code in this cell ("Albumin;P;P"),
    // which then fails NAME_SHAPE_RE for having two semicolons — collapse
    // an immediately-repeated ";Code" back to one.
    .replace(/(;\s*[A-Za-zÆØÅæøå0-9()]{1,15})\1/, '$1')
    .replace(/\s+/g, ' ')
    .replace(/;\s+/g, ';') // canonical form is ";P", not "; P"
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

// Rejoins soft-wrapped lines into whole sentences: a hyphen at end of line
// is a word split ("he-\npatom" -> "hepatom"), any other line break is a
// space. pdfplumber keeps the PDF's visual line breaks inside a cell.
// Also drops Unicode Private Use Area code points (U+E000–U+F8FF): the
// metodeblad PDFs render list bullets and arrows with a symbol font
// (Wingdings/Symbol), which pdfplumber extracts as raw PUA bytes like
//  /  — meaningless once the font mapping is gone.
function unwrap(text) {
  return text
    .replace(/[-]/g, desymbolize) // map Symbol-font µ/α/≥/… then drop stray PUA
    .replace(/(\S)-\n(\S)/g, '$1$2')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// Danish metodeblad indication cells put the free-text summary first, then
// (not always) a "Forhøjet …:" / "Nedsat …:" header followed by a list of
// conditions, one per visual line but often soft-wrapped mid-sentence. The
// header wording varies ("Forhøjet albumin:", "Forhøjede værdier ses ved:",
// "Nedsatte værdier:"), so match on the leading adjective + a trailing
// colon rather than a fixed phrase. If no such header is present the whole
// cell stays as the summary and elevated/decreased stay empty — same as
// before this split existed.
// No \b anywhere near the Danish vowels — a word boundary between "ø"/"å"
// and an ASCII letter does not exist in JS regex, so "\bforhøjet\b" never
// matches (this is the exact trap PLAN.md flags). Anchor on the stem and
// let [^:]* run to the colon instead. Kept deliberately short so a normal
// prose sentence that merely ends in a colon can't trip it.
const ELEVATED_HDR_RE = /^(forh[øo]j|[øo]get|[øo]gede|stigende)[^:]{0,40}:\s*$/i;
const DECREASED_HDR_RE = /^(nedsat|neds[æa]t|formindsk|faldende|lave? )[^:]{0,40}:\s*$/i;

function linesToBullets(lines) {
  const bullets = [];
  let cur = '';
  for (const line of lines) {
    if (!cur) cur = line;
    else if (cur.endsWith('-')) cur = cur.slice(0, -1) + line;
    else cur = `${cur} ${line}`;
    if (/[.;]$/.test(line.trim())) {
      bullets.push(cur.trim());
      cur = '';
    }
  }
  if (cur.trim()) bullets.push(cur.trim());
  return bullets.filter(Boolean);
}

function extractIndication(data) {
  const raw = data.fields['Indikation og resultatvurdering'];
  if (!raw) return { summary: null, elevated: [], decreased: [] };
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const buckets = { summary: [], elevated: [], decreased: [] };
  let mode = 'summary';
  for (const line of lines) {
    if (ELEVATED_HDR_RE.test(line)) { mode = 'elevated'; continue; }
    if (DECREASED_HDR_RE.test(line)) { mode = 'decreased'; continue; }
    buckets[mode].push(line);
  }
  return {
    summary: buckets.summary.length ? unwrap(buckets.summary.join('\n')) : null,
    elevated: linesToBullets(buckets.elevated),
    decreased: linesToBullets(buckets.decreased)
  };
}

// --- method / QC block -----------------------------------------------------
// Every field below comes back as its own isolated table cell from
// extract_pdf_fields.py — the two-column drift that made these "not
// reliably parseable" under pdftotext -layout (see PLAN.md) is gone once
// the table structure survives extraction. Multi-value QC rows
// (precisionControls and friends) are pipe-separated by the Python side,
// one segment per control level.
const YESNO_RE = /^\s*ja\b/i;

function yesNo(v) {
  if (!v) return undefined;
  if (YESNO_RE.test(v)) return true;
  if (/^\s*nej\b/i.test(v)) return false;
  return undefined;
}

function findFieldByPrefix(data, prefix) {
  const key = Object.keys(data.fields).find(k => k.toLowerCase().startsWith(prefix.toLowerCase()));
  return key ? data.fields[key] : null;
}

function splitPipe(v) {
  return v ? v.split('|').map(s => unwrap(s)).filter(Boolean) : [];
}

function extractPrecisionControls(data) {
  const names = splitPipe(data.fields['Præcisionskontrolmaterialer (navn, producent, materialetype)']);
  const levels = splitPipe(data.fields['Kontrolniveauer']);
  const cvs = splitPipe(data.fields['Intermediær præcision (CV inkl. instru. spred.) oprundet']);
  const cis = splitPipe(data.fields['Ekspanderet måleusikkerhed (k=2 sv.t. 95% CI på måleresultatet)']);
  const n = Math.max(names.length, levels.length, cvs.length, cis.length);
  const controls = [];
  for (let i = 0; i < n; i++) {
    const row = {};
    if (names[i]) row.name = names[i];
    if (levels[i]) row.level = levels[i];
    if (cvs[i]) row.cv = cvs[i];
    if (cis[i]) row.ci = cis[i];
    // The detail view keys the row off `name`; a level-only row (some
    // templates only fill "Kontrolniveauer") would render "undefined".
    if (row.name || (row.cv && row.ci)) controls.push(row);
  }
  return controls;
}

// Column drift on a few templates (the antibody-panel sheets) drops the
// "Mindste relevante kliniske difference" boilerplate into a neighbouring
// method cell. It has a fixed opening, so it's easy to recognise and keep
// out of every field except clinicalDifference.
const MRKD_SIG_RE = /^Ved to prøver på samme patient/i;

function extractMeasuringRange(data) {
  const raw = findFieldByPrefix(data, 'Måleområde');
  if (!raw) return undefined;
  const parts = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (!parts.length) return undefined;
  // Second line is only a "standard" range if it actually looks like one —
  // several templates put an explanatory sentence there instead ("Under
  // svares som <0,9 ..."), which must not become measuringRange.standard.
  const RANGE_LIKE = /[<>≤≥]?\s*[\d.,]+\s*[-–]\s*[\d.,]+|^[<>≤≥]\s*[\d.,]+/;
  // If no line is actually a numeric range, this cell is prose (combined
  // panel sheets do this) — don't invent a measuringRange.
  if (!parts.some(p => RANGE_LIKE.test(p))) return undefined;
  const total = parts.find(p => RANGE_LIKE.test(p)) || parts[0];
  const rest = parts.filter(p => p !== total);
  const standard = rest.find(p => RANGE_LIKE.test(p)) || total;
  return { total: normalizeExponentUnit(total), standard: normalizeExponentUnit(standard) };
}

// The reliable form is a bracketed limit right after the analyte name:
//   "Hæmoglobin (0,37 mmol/L)", "Bilirubin (513 µmol/L konjugeret ...)",
//   "Lipæmi (Intralipid) (4,5 mmol/L)"  ->  take the bracket that has a
//   number in it. Templates that instead give qualitative prose ("Kraftig
//   hæmolyse ...") or a kit-insert paragraph get no per-analyte limits —
//   the cell goes to biasNote verbatim rather than being guessed apart.
function extractInterference(data) {
  const raw = data.fields['Interferens (hæmolyse, icterus, lipæmi, andet)'];
  if (!raw) return undefined;
  const flat = unwrap(raw);
  const out = {};
  const limitAfter = word => {
    // <analyte> ... (<something with a digit>) — first such bracket only.
    const re = new RegExp(`${word}\\b[^\\n]*?\\(([^)]*\\d[^)]*)\\)`, 'i');
    const m = flat.match(re);
    return m ? m[1].trim() : null;
  };
  const hb = limitAfter('h[æae]moglobin');
  const bili = limitAfter('bilirubin');
  const lip = limitAfter('lip[æae]mi');
  if (hb) out.hemoglobin = hb;
  if (bili) out.bilirubin = bili;
  if (lip) out.lipemia = lip;
  const introMatch = flat.match(/[^.]*?(?:<\s*10\s*%\s*bias|ingen (?:væsentlig )?interferens|påvirkes ikke)[^.:]*[.:]/i);
  if (introMatch) out.biasNote = introMatch[0].trim();
  else if (!hb && !bili && !lip) out.biasNote = flat;
  return Object.keys(out).length ? out : undefined;
}

function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

function extractMethod(data) {
  const f = data.fields;
  const TRACE_LABEL = 'Metrologisk sporbarhed (rutinemålingens sporbarhed til referen- cemateriale og/el. –metode)';
  // A drifted cell that's really the MRKD boilerplate is not a value for
  // this field — drop it rather than surface it under the wrong label.
  const str = (label) => {
    const v = f[label] ? unwrap(f[label]) : undefined;
    return v && !MRKD_SIG_RE.test(v) ? v : undefined;
  };
  return compact({
    ceMarked: yesNo(f['CE mærket analyse (apparatur og reagens i kombination)']),
    accredited: yesNo(f['Akkrediteret analyse']),
    traceability: str(TRACE_LABEL),
    principle: str('Analyseprincip'),
    instrument: str('Apparatur'),
    calibrator: str('Kalibrator'),
    reagent: str('Reagens'),
    externalQC: str('Ekstern kvalitetskontrol'),
    precisionControls: extractPrecisionControls(data),
    clinicalDifference: f['Mindste relevante kliniske difference'] ? unwrap(f['Mindste relevante kliniske difference']) : undefined,
    measuringRange: extractMeasuringRange(data),
    interference: extractInterference(data),
    comments: f['Bemærkninger'] && !/^\s*ingen/i.test(f['Bemærkninger']) ? unwrap(f['Bemærkninger']) : undefined
  });
}

// --- logistics (best-effort) --------------------------------------------
// The "Holdbarhed" cell is one of the messier ones — column drift leftovers,
// 2–3 sub-values, no consistent structure. Split it into chunks on the
// pipe separator and the recurring Danish sub-labels, then bucket each
// chunk as whole-blood vs. pipetted/frozen by keyword. Anything it can't
// place is left out rather than mis-filed; the entry is flagged as a draft
// regardless.
function extractStability(data) {
  const raw = data.fields['Holdbarhed'];
  if (!raw) return {};
  const flat = raw
    .replace(/(\S)-\n(\S)/g, '$1$2')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Only attempt a split when the cell is actually structured: pipe-
  // separated sub-columns, or two explicit "Holdbarhed …" sub-labels.
  // Otherwise it's a prose blob (e.g. INR) and any split truncates a
  // sentence — leave it empty and let the draft flag stand.
  const hasPipe = flat.includes('|');
  const hasLabelPair = /holdbarhed\s+i?\s*fuldblod/i.test(flat)
    && /(holdbarhed\s+afpipetteret|for\s+afpipetteret|frossent\s+plasma)/i.test(flat);
  if (!hasPipe && !hasLabelPair) return {};

  const chunks = flat
    .split(/\s*\|\s*|(?=Holdbarhed\s+(?:i\s*fuldblod|afpipetteret))|(?=For afpipetteret\b)|(?=Frossent plasma\b)/i)
    .map(c => c.trim())
    .filter(Boolean);
  const out = {};
  for (const c of chunks) {
    if (/afpipetteret plasma har samme/i.test(c)) continue;
    if (/fuldblod/i.test(c)) {
      if (!out.wholeBlood) out.wholeBlood = c.replace(/^.*?fuldblod[^:]*:?\s*/i, '').trim();
    } else if (/afpipetteret|frossent|frosset/i.test(c)) {
      if (!out.pipetted) out.pipetted = c.replace(/^.*?(afpipetteret|frossent plasma|frosset plasma)[^:]*:?\s*/i, '').trim();
    }
  }
  return out;
}

function extractLogistics(data) {
  return {
    laboratory: (v => v ? unwrap(v) : '')(extractLaboratory(data).value),
    frequency: data.fields['Analyseringshyppighed'] ? unwrap(data.fields['Analyseringshyppighed']) : '',
    turnaroundTime: data.fields['Svartid (efter modtagelse af prøve)'] ? unwrap(data.fields['Svartid (efter modtagelse af prøve)']) : '',
    handling: {},
    stability: extractStability(data),
    transport: {},
    preanalyticalErrors: data.fields['Præanalytiske fejlkilder'] ? unwrap(data.fields['Præanalytiske fejlkilder']) : ''
  };
}

function extractSampleMaterial(data) {
  const raw = data.fields['Prøvemateriale og rørtype'];
  return raw ? unwrap(raw) : null;
}

function extractMinVolume(data) {
  const raw = data.fields['Mindste prøvemængde'];
  return raw ? unwrap(raw) : null;
}

function extractAlarmLimits(data) {
  const raw = data.fields['Ringegrænser'];
  return raw ? unwrap(raw) : null;
}


// Map Symbol-font PUA code points (µ, α, ≥, <, …) back to real Unicode on
// every extracted field up front, so no downstream extractor has to know
// about it. See scripts/lib/text-clean.js.
function desymbolizeData(data) {
  const fields = {};
  for (const [k, v] of Object.entries(data.fields || {})) {
    fields[desymbolize(k)] = typeof v === 'string' ? desymbolize(v) : v;
  }
  return { ...data, fields };
}

function parsePdfJson(rawData) {
  const data = desymbolizeData(rawData);
  const unit = extractUnit(data);
  const refCell = findReferenceCell(data);
  const { rows: referenceIntervals, note: referenceNote } = parseReferenceCell(refCell, { unit: unit.value });
  for (const row of referenceIntervals) row.unit = normalizeExponentUnit(row.unit);

  return {
    npu: data.npu || null,
    docId: data.docId || null,
    unit,
    inUseDate: dateField(data, 'inUseDate'),
    revisionDate: dateField(data, 'revisionDate'),
    replaces: dateField(data, 'replaces'),
    laboratory: extractLaboratory(data),
    referenceIntervals,
    referenceNote,
    name: extractName(data),
    section: extractSection(data),
    indication: extractIndication(data),
    sampleMaterial: extractSampleMaterial(data),
    minVolume: extractMinVolume(data),
    alarmLimits: extractAlarmLimits(data),
    method: extractMethod(data),
    logistics: extractLogistics(data)
  };
}

function intervalsEqual(a = [], b = []) {
  if (a.length !== b.length) return false;
  return a.every((row, i) => {
    const other = b[i];
    const g = row.target ?? row.group;
    const og = other && (other.target ?? other.group);
    return other && g === og && row.age === other.age && row.range === other.range;
  });
}

// Shown in the app's list/detail views (see referenceTable.js, detailPanel.js)
// as a warning icon so anyone browsing the catalog knows to double-check this
// entry against its source PDF rather than trust it outright. Cleared by
// scripts/mark-reviewed.js once a human has verified it.
const REFERENCE_INTERVAL_FLAG = 'Referenceinterval udtrukket automatisk fra PDF-scraping — bør verificeres mod kildedokumentet.';
const REFERENCE_NOTE_ONLY_FLAG = 'Referenceinterval-feltet kunne ikke struktureres i rækker — den rå tekst er gemt i referenceNote og bør indtastes manuelt.';
const DRAFT_ENTRY_FLAG = 'Automatisk oprettet kladde fra PDF-scraping. Alle felter er maskinudtrukne og bør efterses mod kildedokumentet før de regnes som verificerede.';
const METHOD_INCOMPLETE_FLAG = 'Metode-/apparaturafsnittet kunne ikke udtrækkes fra PDF\'en og er tomt — kræver manuel udfyldelse.';
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
    indication: {
      summary: parsed.indication.summary || '',
      elevated: parsed.indication.elevated,
      decreased: parsed.indication.decreased
    },
    sample: { material: parsed.sampleMaterial || '', tube: '', tubeColor: '', minVolume: parsed.minVolume || '', specialConditions: '' },
    referenceIntervals: parsed.referenceIntervals,
    referenceNote: parsed.referenceNote || '',
    alarmLimits: parsed.alarmLimits || '',
    logistics: parsed.logistics,
    method: parsed.method,
    history: [],
    dataQualityFlags: [
      DRAFT_ENTRY_FLAG,
      ...(nameIsFilename ? [NAME_IS_FILENAME_FLAG] : []),
      ...(Object.keys(parsed.method).length === 0 ? [METHOD_INCOMPLETE_FLAG] : []),
      ...(parsed.referenceIntervals.length > 0 ? [REFERENCE_INTERVAL_FLAG] : []),
      ...(parsed.referenceIntervals.length === 0 && parsed.referenceNote ? [REFERENCE_NOTE_ONLY_FLAG] : []),
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
      parsed.referenceIntervals.forEach(r => lines.push(`      - ${r.target ?? r.group} | ${r.age} | ${r.range} ${r.unit || ''}`));
      console.log(lines.join('\n'));

      md.push(`**+ Created draft entry:** \`${draft.slug}\``);
      md.push('');
      md.push(`- name: ${draft.name}${parsed.name ? '' : ' _(fallback: PDF filename, not canonical format)_'}`);
      md.push(`- section: ${parsed.section || '(none)'}`);
      md.push(`- unit: ${fmt(parsed.unit)}`);
      md.push(`- inUseDate: ${fmt(parsed.inUseDate)}`);
      md.push(`- revisionDate: ${fmt(parsed.revisionDate)}`);
      md.push(`- referenceIntervals (unverified):`);
      parsed.referenceIntervals.forEach(r => md.push(`  - ${r.target ?? r.group} | ${r.age} | ${r.range} ${r.unit || ''}`));
      md.push(`- dataQualityFlags: ${draft.dataQualityFlags.length}`);
      return { kind: 'new', md: md.join('\n'), created: true };
    }

    lines.push('  ⚠ No matching entry in database.json — candidate NEW entry (dry run, not created).');
    lines.push(`    name: ${parsed.name || '(fallback to filename)'}`);
    lines.push(`    unit: ${fmt(parsed.unit)}`);
    lines.push(`    inUseDate: ${fmt(parsed.inUseDate)}`);
    lines.push(`    revisionDate: ${fmt(parsed.revisionDate)}`);
    lines.push(`    referenceIntervals (${parsed.referenceIntervals.length}):`);
    parsed.referenceIntervals.forEach(r => lines.push(`      - ${r.target ?? r.group} | ${r.age} | ${r.range} ${r.unit || ''}`));
    console.log(lines.join('\n'));

    md.push('**⚠ No matching NPU in database.json — candidate NEW entry (dry run, not created).**');
    md.push('');
    md.push(`- name: ${parsed.name || '(fallback to filename)'}`);
    md.push(`- unit: ${fmt(parsed.unit)}`);
    md.push(`- referenceIntervals:`);
    parsed.referenceIntervals.forEach(r => md.push(`  - ${r.target ?? r.group} | ${r.age} | ${r.range} ${r.unit || ''}`));
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
    (dbEntry.referenceIntervals || []).forEach(r => lines.push(`      - ${r.target ?? r.group} | ${r.age} | ${r.range} ${r.unit || ''}`));
    lines.push('    PDF:');
    parsed.referenceIntervals.forEach(r => lines.push(`      - ${r.target ?? r.group} | ${r.age} | ${r.range} ${r.unit || ''}`));

    md.push('- ≠ **referenceIntervals** _(not auto-applied by policy — compare manually against the PDF before editing)_:');
    md.push('  - DB: ' + (dbEntry.referenceIntervals || []).map(r => `${r.target ?? r.group}/${r.age}/${r.range}${r.unit || ''}`).join('; '));
    md.push('  - PDF: ' + parsed.referenceIntervals.map(r => `${r.target ?? r.group}/${r.age}/${r.range}${r.unit || ''}`).join('; '));
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
