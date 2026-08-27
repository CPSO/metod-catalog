// ── Reference-interval cell: staged parser ("ladder") ────────────────────
// The "Referenceinterval / kliniske beslutningsgrænser" cell is a free-text
// field in the source PDFs. For ~2/3 of analyses it's a clean age/sex
// table; for the rest it's a decision-band list, a specimen/phase/time-of-
// day table, one value plus an explanatory paragraph, or prose that isn't
// a reference interval at all (genotype counts, "harmoniseret i Region H").
//
// Instead of one function branching on every shape (which kept accreting
// one-off bugs), each shape has its own recogniser: (cell, ctx) ->
// { rows, note } | null. It returns null when its FIT TEST says the cell
// isn't its shape, and the runner tries the next one. The fit test is
// strict and kept separate from the extraction — that separation is what
// makes "fall through to the next stage" safe. The terminal `narrative`
// stage always matches and returns no rows, just the verbatim text in
// `note`, so a cell that fits nothing yields honest raw text rather than
// invented rows.
//
// Row shape: { target, age, range, unit }. `target` = what the row applies
// to (a sex "Kvinder", a specimen "Veneblod", a phase "Follikulær fase", a
// decision band "Positiv", …), default "Alle". `age` is age-only, default
// "Alle aldre". `note` carries prose the winning stage couldn't structure.

export const REF_LABEL_ALIASES = [
  'Referenceinterval',
  'Referenceinterval/kliniske be- slutningsgrænser',
  'Klinisk beslutningsgrænse',
  'Kliniske beslutningsgrænse',
  'Kliniske beslutningsgrænser'
];

export function findReferenceCell(data) {
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
  'barn': 'Børn',
  'pige': 'Piger',
  'piger': 'Piger',
  'dreng': 'Drenge',
  'drenge': 'Drenge',
  'piger og drenge': 'Alle',
  'drenge og piger': 'Alle',
  '♀+♂': 'Alle',
  '♂+♀': 'Alle',
  'voksne': 'Alle',
  'voksen': 'Alle'
};

// Normalise a `target` label: gender symbols -> words, drop a trailing
// specimen code (";P", ";Csv"), unwrap a "Pt(U) — X" / "For Pt(U)-X:"
// analyte wrapper down to "Alle".
function normalizeTarget(t) {
  let s = (t || '').trim();
  if (/^♀\s*\+\s*♂$|^♂\s*\+\s*♀$/.test(s)) return 'Alle';
  if (s === '♀') return 'Kvinder';
  if (s === '♂') return 'Mænd';
  s = s.replace(/^(For\s+)?P?t?\(?U\)?\s*[—–-]?\s*[A-Za-zÆØÅæøå./]+\s*:?\s*/i, '').trim() || 'Alle';
  s = s.replace(/\s*;\s*(P|Csv|B|aB|vB|Hb|U|Ery|Rtc|f?Pt)\b.*$/i, '').trim();
  return s || 'Alle';
}

// A range/threshold worth keeping: has a comparator, a dash-range, or a
// decimal. Rejects bare integers ("0", "02", "15") that are really debris
// (allele counts, split age brackets).
function looksLikeRange(range) {
  return /[<>≥≤]|\d\s*[–-]\s*[<>≥≤]?\s*\d|\d[.,]\d/.test(range || '');
}

// A reference-interval row is a line that splits into "descriptor : numeric-range/threshold [unit]".
// Unit tail is unrestricted (not "no digits") because units like "x 103 IU/L" or "10³ IU/L" contain them.
const ROW_RE = /^(.{1,60}?):\s*([<≥≤>]?\s*[\d.,]+(?:\s*[-–]\s*[\d.,]+)?)\s*(.{0,60})$/;
const STANDALONE_GROUP_RE = /^(alle|kvinder?|mænd|mand|børn|barn|pige[r]?|dreng[e]?|piger og drenge|drenge og piger|voksne|voksen|[♀♂]|♀\s*\+\s*♂|♂\s*\+\s*♀)\s*:?\s*$/i;
const BARE_GROUP_RE = /^(alle|kvinder?|mænd|mand|børn|barn|pige[r]?|dreng[e]?|voksne|[♀♂])$/i;
// Recognises an age bracket. Covers the abbreviations the PDFs actually use
// (d, dg, dgn, md, mdr, mdr., uge/uger, år, døgn, dage) plus "Alle aldre" /
// "Voksne". No \b next to "år" — a JS word boundary doesn't fire there
// (PLAN.md).
// "år" stays loose (a JS \b doesn't fire next to "å"); "døgn"/"måned" get
// \b so definite-article forms like "døgnet" / "måneden" don't read as an
// age bracket ("Resten af døgnet" is a time-of-day label, not an age).
const AGE_UNIT_RE = /år|\bdøgn\b|\bdgn\b|\bdage?\b|\bdg\b|(?:^|[\s\d])d(?=[\s.]|$)|\bmdr?\b|\bmd\b|\buger?\b|\bmåned(?:er)?\b|\btimer?\b|alle\s*aldre|voksne|voksen|gestation|uge\s*\d/i;
const DATE_LIKE_RE = /^\d{1,2}\.\d{1,2}\.\d{4}$/;

// Bibliographic reference / source-note debris that shares the cell with
// the actual interval, at the bottom, under "Kilde:" / "Referencer:" or
// just parenthesised. Never a data row.
const CITATION_RE = /\bDOI\b|\bet al\.?|Verlagsgesellschaft|Clin\s*Chem|Clinical\s+Laboratory|Diagnostics|SJCLI|Scand\s*J|J\s*Clin|\bIn:\s|\bed\.(?=[\s,])|Kilde[nr]?:|Referencer?:|Oplyst\s+ved\s+producent|DSKB|VUK-anbefaling|harmoniseret|Harmoniserings|Region\s*H\)?\.?$|\d{4}[:;]\s*\d+\s*[-–]\s*\d+|Bilag\s*\d/i;

// Curated decision-threshold vocabulary — a narrow list on purpose (an
// earlier "any non-age label is its own group" attempt swept in garbage,
// see PLAN.md). Matched at the START of the descriptor only.
const DECISION_LABEL_RE = /^\s*(negativ|positiv|inkonklusiv|gr[åa]zone|gr[æ]nsev[æ]rdi|klinisk\s+beslutningsgr[æ]nse|beslutningsgr[æ]nse|beslutning|terapeutisk(\s+interval)?|signalv[æ]rdi|[øo]vre\s+gr[æ]nse|nedre\s+gr[æ]nse|[øo]nskev[æ]rdi|anbefalet|toksisk|ringegr[æ]nse)/i;

// A gender word can sit anywhere in the age descriptor instead of being
// its own header row or a "Kvinder:"-style leading prefix — real examples
// from the catalog: "≥18 år kvinde", "Kvinde ≥ 18 år", "Kvinder > 18 år",
// "Mænd 10-125 år", "• Kvinde, 18 - 49 år". Pull it out so the row is
// grouped correctly and the age text is left clean. No \b directly against
// æ/ø/å (PLAN.md) — the word stems here start/end on ASCII letters so
// \b is safe.
const AGE_GENDER_RE = /\b(kvinder?|mænd|mand|drenge?|piger?)\b/i;
const GENDER_TO_GROUP = {
  kvinde: 'Kvinder', kvinder: 'Kvinder',
  mand: 'Mænd', 'mænd': 'Mænd',
  dreng: 'Drenge', drenge: 'Drenge',
  pige: 'Piger', piger: 'Piger'
};
export function splitGroupFromAge(age) {
  const m = age.match(AGE_GENDER_RE);
  if (!m) return { group: null, age };
  const group = GENDER_TO_GROUP[m[1].toLowerCase()] || null;
  const cleaned = age
    .replace(AGE_GENDER_RE, ' ')
    .replace(/\s+,/g, ',')
    .replace(/^[\s•,:–-]+|[\s•,:–-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { group, age: cleaned || 'Alle aldre' };
}

// Strips a leading "♀: " / "Kvinder: " style group prefix off a line, if
// present. Rows like "♀: 16 dage – 10 år: 0,02-0,11 nmol/L" have TWO colons
// — running ROW_RE on the raw line lets its non-greedy descriptor settle
// for the first ("♀") and swallow the real age/range into a mangled unit.
// Stripping the prefix first means ROW_RE only sees the second, real colon.
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

// Some templates put a row's label on one line and its value on the very
// next, e.g. "Arterie- og kapillærblod:" / "22,0-27,0 mmol/L." — confirmed
// on Hydrogencarbonat, where this cost the whole Veneblod row. Only merges
// when the next line has no colon of its own (a bare value, not the start
// of a different label: value row).
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

const NUM = '[-+]?\\d+(?:[.,]\\d+)?';
const RANGE_CORE = `[<≥≤>]?\\s*${NUM}(?:\\s*[-–]\\s*[<≥≤>]?\\s*${NUM})?`;
const BARE_VALUE_RE = new RegExp(`^(${RANGE_CORE})\\s*(.{0,40}?)\\.?$`);

// Line prefixes that wrap the real row without being a stratifier — a
// LABKA-form analyte name ("For Pt(U)-Kreatinin:") or a bare
// "Referenceinterval:" / "Normalområde:" label. Strip so the rest parses.
const WRAPPER_PREFIX_RE = /^(For\s+P?t?\(U\)[- ]?[A-Za-zÆØÅæøå0-9./]+|Referenceinterval(?:let)?|Reference(?:område|interval)|Normalområde|Normalværdi(?:er)?)\s*:\s*/i;

function splitLines(cell) {
  return mergeSplitLabelValueLines(
    cell.split('\n').map(l => l.trim().replace(WRAPPER_PREFIX_RE, '')).filter(Boolean)
  );
}

// Age row with no colon: "<age bracket> <range> [unit]" — "0-1 måned 0,7 –
// 8,5 x 10-3 IU/L", "18-125 år 0,4 – 4,8 kU/L". Used only after the normal
// "descriptor: range" parse fails.
const SPACE_AGE_ROW_RE = /^([0-9<>≥≤][0-9.,<>≥≤\s–-]*?(?:år|dage?|døgn|dgn|dg|md|mdr|uger?|m[åa]ned(?:er)?|m[åa]n|timer?)\b\.?)\s+([<>≥≤]?\s*[0-9][0-9.,]*\s*[-–]\s*[<>≥≤]?\s*[0-9][0-9.,]*)\s*(.*)$/i;

function isCitationLine(line) {
  return CITATION_RE.test(line) || /^10\.\d{3,}/.test(line) || /^\(.{0,120}\b(19|20)\d{2}\b.{0,120}\)\.?$/.test(line);
}

// "descriptor: <range> <tail>" -> { descriptor, range, tail } | null
function splitRowLine(line) {
  const m = line.match(ROW_RE);
  if (!m) return null;
  const descriptor = m[1].trim();
  const range = m[2].replace(/\s+/g, ' ').trim();
  if (!descriptor || DATE_LIKE_RE.test(range) || /^10\.\d{3,}$/.test(range)) return null;
  return { descriptor, range, tail: m[3].trim() };
}

// Trailing text after the numeric range: a real unit ("mmol/L", "Ratio")
// vs. advisory prose ("ny prøve anbefales efter 2-3 mdr."). Keep the unit,
// return the prose for the caller's `note`.
const UNIT_STOPWORD_RE = /\b(og|eller|samt|ved|for|se|jf|dette|dvs|kan|efter|ny|nyt|hvor|der|som|er|betragtes|normalt|anbefales?|angives?|påvist|producentens?|reference\w*|harmoniseret|percentil|gældende|jf\.)\b/i;
function splitUnitFromTail(tail) {
  if (!tail) return { unit: null, prose: '' };
  let cut = tail.split(/,|\.\s|\s\(|\s–\s|\s-\s/)[0].trim().replace(/\.$/, '');
  // Cut again at the first prose stopword ("mmol/L er normalt" -> "mmol/L").
  const sw = cut.match(UNIT_STOPWORD_RE);
  if (sw && sw.index > 0) cut = cut.slice(0, sw.index).trim();
  const rest = cut ? tail.slice(tail.indexOf(cut) + cut.length).replace(/^[\s,.;–-]+/, '').trim() : tail;
  if (!cut || cut.split(/\s+/).length > 3 || cut.length > 18 || UNIT_STOPWORD_RE.test(cut) ||
      /^(ingen|intet|n\/?a|-|–)$/i.test(cut)) {
    return { unit: null, prose: tail };
  }
  return { unit: cut, prose: rest };
}

function cleanTarget(descriptor) {
  return descriptor
    .replace(/^[•\s]+/, '')
    .replace(/[:\s]+$/, '')
    .replace(/^For\s+P?t?\(?U\)?[- ]?[A-Za-zÆØÅæøå]+:\s*/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function titleCaseFirst(s) {
  const t = s.trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Stage 1 — clean age/sex table (Albumin, ALAT, Basisk fosfatase …).
function stageAgeSexTable(cell) {
  const rows = [];
  const skipped = []; // non-age content this shape can't hold — kept as a note
  let ageRows = 0, otherRows = 0, currentTarget = 'Alle';
  for (const rawLine of splitLines(cell)) {
    if (isCitationLine(rawLine)) continue;
    if (STANDALONE_GROUP_RE.test(rawLine)) {
      currentTarget = GROUP_WORDS[rawLine.replace(/[:.]/g, '').trim().toLowerCase()] || currentTarget;
      continue;
    }
    const pref = stripLeadingGroupPrefix(rawLine);
    let parsed = splitRowLine(pref ? pref.rest : rawLine);
    // "Kvinder: 3,94-5,16 g/L" / "Alle: 10 – 65 U/L" — once the group prefix
    // is stripped the remainder is a bare value with no colon of its own.
    if (!parsed && pref) {
      const bm = pref.rest.match(BARE_VALUE_RE);
      if (bm && looksLikeRange(bm[1])) parsed = { descriptor: '', range: bm[1].replace(/\s+/g, ' ').trim(), tail: (bm[2] || '').trim() };
    }
    // Colon-free "<age> <range> [unit]" line.
    if (!parsed) {
      const sm = (pref ? pref.rest : rawLine).match(SPACE_AGE_ROW_RE);
      if (sm) parsed = { descriptor: sm[1].trim(), range: sm[2].replace(/\s+/g, ' ').trim(), tail: sm[3].trim() };
    }
    if (!parsed) { if (/[a-zæøå]{6,}/i.test(rawLine)) skipped.push(rawLine); continue; }
    const { unit } = splitUnitFromTail(parsed.tail);
    if (parsed.descriptor === '' && pref) {
      rows.push({ target: pref.group, age: 'Alle aldre', range: parsed.range, unit: unit || null });
      ageRows++;
      continue;
    }
    if (DECISION_LABEL_RE.test(parsed.descriptor)) { otherRows++; skipped.push(rawLine); continue; }
    if (AGE_UNIT_RE.test(parsed.descriptor)) {
      const fromAge = splitGroupFromAge(parsed.descriptor);
      rows.push({ target: (pref && pref.group) || fromAge.group || currentTarget, age: fromAge.age || 'Alle aldre', range: parsed.range, unit: unit || null });
      ageRows++;
    } else if (BARE_GROUP_RE.test(parsed.descriptor)) {
      rows.push({ target: (pref && pref.group) || GROUP_WORDS[parsed.descriptor.toLowerCase()] || currentTarget, age: 'Alle aldre', range: parsed.range, unit: unit || null });
      ageRows++;
    } else {
      otherRows++;
      skipped.push(rawLine);
    }
  }
  // A single clean age/group row with nothing conflicting is still this
  // shape — "Alle: 10 – 65 U/L", "Under 2 dage: 0,05-0,5 g/L".
  const note = skipped.join(' ').replace(/\s{2,}/g, ' ').trim();
  if (ageRows >= 2 && ageRows >= otherRows) return { rows, note };
  if (ageRows === 1 && otherRows === 0) return { rows, note };
  return null;
}

// Stage 2 — non-age stratifier table: specimen (arterial/venous), cycle
// phase, time of day, gestational week.
function stageTargetTable(cell) {
  const rows = [];
  let ok = 0, bad = 0;
  for (const rawLine of splitLines(cell)) {
    if (isCitationLine(rawLine) || STANDALONE_GROUP_RE.test(rawLine)) continue;
    const parsed = splitRowLine(rawLine);
    if (!parsed) { if (/[a-zæøå]{6,}/i.test(rawLine)) bad++; continue; }
    if (AGE_UNIT_RE.test(parsed.descriptor) || DECISION_LABEL_RE.test(parsed.descriptor)) return null;
    // Prose masquerading as a row: "0 (patienten har ingen HLA-C*06:02 …".
    if (/^\s*\d+\s*\(/.test(parsed.descriptor) || !looksLikeRange(parsed.range)) { bad++; continue; }
    const g = splitGroupFromAge(parsed.descriptor);
    const target = normalizeTarget(g.group || cleanTarget(parsed.descriptor));
    if (!target || target.length > 44 || target.split(/\s+/).length > 6 || /\.\s+[A-ZÆØÅ]/.test(target)) { bad++; continue; }
    const { unit } = splitUnitFromTail(parsed.tail);
    rows.push({ target, age: 'Alle aldre', range: parsed.range, unit: unit || null });
    ok++;
  }
  return ok >= 2 && ok > bad ? { rows, note: '' } : null;
}

// Stage 3 — decision bands. Two layouts:
//   "Negativ: < 0,7 Ratio"            label first  (ANA-Ab, CCP, …)
//   "FIB-4 <1,30 (negativ)"           label last, parenthesised (FIB-4, …)
const BAND_WORD = 'negativ|positiv|inkonklusiv|gr[åa]zone|gr[æ]nsev[æ]rdi';
const TRAILING_BAND_RE = new RegExp(`^(.*?)([<>≥≤=]\\s*[\\d.,]+(?:\\s*[-–]\\s*[\\d.,]+)?)\\s*\\(?\\s*(${BAND_WORD})\\s*\\)?\\.?$`, 'i');
function stageDecisionBands(cell, ctx = {}) {
  const rows = [];
  const prose = [];
  let ok = 0, other = 0;
  for (const rawLine of splitLines(cell)) {
    if (isCitationLine(rawLine)) { prose.push(rawLine); continue; }

    // "Beslutning < 300 x 106/L" — decision word, space (no colon), value.
    const lead = rawLine.match(/^(beslutning(?:sgr[æ]nse)?|negativ|positiv|inkonklusiv)\s+([<>≥≤]\s*[\d.,]+(?:\s*[-–]\s*[\d.,]+)?)\s*(.*)$/i);
    if (lead && !rawLine.includes(':')) {
      const { unit } = splitUnitFromTail(lead[3]);
      rows.push({ target: titleCaseFirst(lead[1]), age: 'Alle aldre', range: lead[2].replace(/\s+/g, ' ').trim(), unit: unit || ctx.unit || null });
      ok++;
      continue;
    }

    const trail = rawLine.match(TRAILING_BAND_RE);
    if (trail) {
      rows.push({
        target: titleCaseFirst(trail[3]),
        age: 'Alle aldre',
        range: trail[2].replace(/=\s*/, '').replace(/\s+/g, ' ').trim(),
        unit: ctx.unit && !/^(ingen|intet)$/i.test(ctx.unit) ? ctx.unit : null
      });
      ok++;
      continue;
    }

    const parsed = splitRowLine(rawLine);
    if (!parsed) { if (/[a-zæøå]{8,}/i.test(rawLine)) prose.push(rawLine); continue; }
    const dm = parsed.descriptor.match(DECISION_LABEL_RE);
    if (!dm) { other++; continue; }
    const { unit, prose: p } = splitUnitFromTail(parsed.tail);
    if (p) prose.push(p);
    rows.push({ target: normalizeTarget(titleCaseFirst(dm[1])), age: 'Alle aldre', range: parsed.range, unit: unit || null });
    ok++;
  }
  return ok >= 1 && ok >= other ? { rows, note: prose.join(' ').replace(/\s{2,}/g, ' ').trim() } : null;
}

// Stage 4 — one bare value/range for the whole cell, the rest explanatory
// prose or a citation (Fibrinogen, Apolipoprotein B, FIB-4, LDL).
function stageSingleValue(cell, ctx) {
  // "-3mmol/L til +3mmol/L" — value, unit, "til", value, unit.
  const til = cell.trim().match(/^([-+]?\d[\d.,]*)\s*([^\s\d]{1,10}?)\s+til\s+([-+]?\d[\d.,]*)\s*\2?\.?$/i);
  if (til) return { rows: [{ target: 'Alle', age: 'Alle aldre', range: `${til[1]} – ${til[3]}`, unit: til[2] }], note: '' };

  const values = [];
  const prose = [];
  for (const raw of splitLines(cell)) {
    // A line that starts with a bare value is data even if it also carries
    // a "(Bilag 1)" / year that looks citation-ish — check value first.
    const bm = raw.match(BARE_VALUE_RE);
    if (bm && looksLikeRange(bm[1]) && !DATE_LIKE_RE.test(bm[1].trim()) && !raw.includes(':')) {
      values.push({ range: bm[1].replace(/\s+/g, ' ').trim(), tail: (bm[2] || '').trim() });
      continue;
    }
    if (isCitationLine(raw)) continue;
    if (/[a-zæøå]{4,}/i.test(raw)) prose.push(raw);
  }
  if (values.length !== 1) return null;
  let { unit } = splitUnitFromTail(values[0].tail);
  if (!unit) unit = ctx.unit || null;
  if (unit && /^(ingen|intet|n\/?a)$/i.test(unit)) unit = null;
  return { rows: [{ target: 'Alle', age: 'Alle aldre', range: values[0].range, unit }], note: prose.join(' ').replace(/\s{2,}/g, ' ').trim() };
}

const REFERENCE_STAGES = [
  ['ageSexTable', stageAgeSexTable],
  ['targetTable', stageTargetTable],
  ['decisionBands', stageDecisionBands],
  ['singleValue', stageSingleValue]
];

function isPlausibleRow(r) {
  return r && /\d/.test(r.range || '') && (r.range || '').length <= 30 && !/^10\.\d{3,}$/.test(r.range || '');
}
function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter(r => {
    const k = `${r.target}|${r.age}|${r.range}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

// Returns { rows, note, stage } — `stage` is the recogniser that matched
// ("ageSexTable" | "targetTable" | "decisionBands" | "singleValue" |
// "narrative" | "empty"), useful for routing analysis; callers may ignore it.
export function parseReferenceCell(cellText, ctx = {}) {
  if (!cellText || !cellText.trim()) return { rows: [], note: '', stage: 'empty' };
  for (const [name, stage] of REFERENCE_STAGES) {
    let out = null;
    try { out = stage(cellText, ctx); } catch { /* stage bailed — try next */ }
    if (out && out.rows.length) {
      const rows = dedupeRows(out.rows.filter(isPlausibleRow));
      if (rows.length) return { rows, note: out.note || '', stage: name };
    }
  }
  const raw = splitLines(cellText).join(' ').replace(/\s{2,}/g, ' ').trim();
  return { rows: [], note: raw, stage: 'narrative' };
}
