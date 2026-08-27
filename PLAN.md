# PDF scraping / database sync — progress & plan

## ✅ Clean database wipe/rebuild — executed 2026-08-27

Decisions taken (see `AskUserQuestion` round this session):
1. **Full wipe, accept the loss** of the 20 rich hand-authored entries'
   method/QC/indication-split/logistics content — re-earn manually over
   time like every other draft. No merge-back from git history.
2. **Extend extraction first** so the rebuilt drafts are as complete as
   the pipeline can make them (see "Extraction extension" below).
3. **Local script + commit** as the mechanism.

What was done:
- `src/data/database.json` → `[]`, `scripts/pdf-manifest.json` → `{}`.
- Rebuilt from the **24 local sample PDFs only** (`scripts/pdf-samples/`)
  via `extract_pdf_fields.py` + `pdf-diff.js --apply --changed-json`
  (a `changed.json` was synthesised from the pre-wipe manifest so drafts
  keep real `pdfUrl`/`letter`). Result: **23 draft entries** (EKG skipped
  — no NPU). Down from 189.
- The remaining ~188 analyses are **not yet in the DB** — they come back
  on the next CI run of `scrape-metodeblade.yml` (manifest is now empty, so
  every PDF reads as new and gets recreated as a draft by the extended
  pipeline). That run is the next step.

### Extraction extension (`scripts/pdf-diff.js`, this session)
The pdfplumber rewrite already isolates every method/QC label as a clean
cell (see "Extraction layer rewrite" below) — they just weren't being
consumed. Now `createDraftEntry()` fills:
- **`method.*`**: `ceMarked`/`accredited` (Ja/Nej→bool), `traceability`,
  `principle`, `instrument`, `calibrator`, `reagent`, `externalQC`,
  `precisionControls[]` (name/level/cv/ci zipped from the four
  pipe-separated QC cells; level-only rows dropped — the UI keys on
  `name`), `clinicalDifference`, `measuringRange{total,standard}` (prose
  lines rejected via a range-shape check), `interference{hemoglobin,
  bilirubin,lipemia,biasNote}` (strict bracket-form only; qualitative /
  kit-insert prose goes to `biasNote` verbatim, no guessed limits),
  `comments`. Verified near-identical to the hand-curated Albumin/ALAT
  blocks on the 24 samples.
- **`indication.elevated` / `.decreased`**: split on Danish "Forhøjet…:" /
  "Nedsat…:" header lines (`ELEVATED_HDR_RE`/`DECREASED_HDR_RE` — anchored
  on the stem, **no `\b`** near the ø/å, the trap this file keeps
  flagging), soft-wrapped bullets rejoined by `linesToBullets()`. Entries
  with no such header keep the single summary blob (unchanged behaviour).
- **`logistics`**: `frequency`, `turnaroundTime`, `preanalyticalErrors`,
  best-effort `stability{wholeBlood,pipetted}` (only when the cell is
  actually structured — pipe-separated or two explicit sub-labels;
  prose blobs like INR's are left `{}` rather than truncated).
- New helper `unwrap()` centralises soft-wrap rejoin + **strips U+E000–
  U+F8FF** (Wingdings/Symbol bullets pdfplumber emits as raw PUA bytes).
  Now also applied to unit/sampleMaterial/minVolume/alarmLimits/laboratory
  so no JSON string value carries an embedded `\n`.
- Misc fixes found in testing: `Albumin;P;P` double specimen-code (broke
  name extraction), `; P`→`;P` canonicalisation, MRKD boilerplate drifting
  into `traceability` on the antibody-panel sheets (`MRKD_SIG_RE` guard).
- `DRAFT_ENTRY_FLAG` reworded (method is populated now); new
  `METHOD_INCOMPLETE_FLAG` fires only when the method block comes out
  empty.
- **Policy unchanged**: matched (existing) entries still only get
  unit/dates auto-applied; `method`/`indication`/`referenceIntervals` are
  never auto-written to an existing entry, only used for new drafts.

### Known-still-imperfect on the rebuilt drafts (all carry
`dataQualityFlags`, so the UI shows the warning):
- Østradiol `referenceIntervals` still garble (heavily drifted
  multi-variant template — documented below, not fixed).
- Combined-panel sheets (Hydrogencarbonat, Albumin (Urin), Hæmoglobin
  A1c, Oxygen, the Sjøgren/U1 antibody panels) fall back to the PDF
  filename for `name` and have thinner method blocks — known hard cases.
- AFP `indication.elevated` is one dash-separated blob, not split per
  condition.

## Reference-interval cell: staged parser + `target` / `referenceNote` (done 2026-08-27)

The `Referenceinterval / kliniske beslutningsgrænser` cell is free text in
the PDFs; for ~1/3 of analyses it isn't an age/sex table at all (specimen
type, cycle phase, time of day, decision bands, citations, genotype
prose), and the old single branchy `extractReferenceIntervals()` forced
`{group, age, range, unit}` onto all of it and produced garbage in
`group`/`age`.

Replaced with a **staged recogniser ladder** in
`scripts/lib/reference-parser.js` (imported by `pdf-diff.js`). Each stage
is `(cell, ctx) -> { rows, note } | null`; the runner tries them in order
and takes the first with rows, else a terminal `narrative` stage that
yields no rows and puts the verbatim text in `note`. Stages:
`ageSexTable` → `targetTable` (specimen/phase/time) → `decisionBands`
(Negativ/Positiv/…, both `label: value` and `value (label)` layouts) →
`singleValue` (one value + prose) → `narrative`. Fit tests are strict and
separate from extraction, which is what makes "fall through" safe.

Schema changes (migrated across all 186 entries via a full rebuild):
- row key **`group` → `target`** — a sex, a specimen (`Veneblod`), a phase
  (`Follikulær fase`), a decision band (`Positiv`), … default `Alle`.
  `scripts/lib/database-format.js` and the UI read `target ?? group`.
- new entry field **`referenceNote`** — raw/leftover cell text the ladder
  couldn't structure. New `REFERENCE_NOTE_ONLY_FLAG` when rows are empty
  but a note exists.
- `normalizeExponentUnit()` in `pdf-diff.js` now restores `x 109/L` →
  `× 10⁹/L` (and `x 10-3` → `× 10⁻³`) on `unit`, row units, and
  `measuringRange` at build time — replaces the one-off `_expfix` pass
  from the PR #9 session and drops the exponent flag for those.

Routing over all 211 fresh cells: 90 ageSexTable, 36 decisionBands, 29
singleValue, 15 empty (no cell), 31 narrative, 10 targetTable. The 31
narrative are genuinely unstructurable (genotype prose, "Ikke relevant",
flattened age grids). `referenceIntervals` row count vs the previous
build: 143 byte-identical, ~7 empty→populated, ~10 lost a mangled row but
gained the content in `referenceNote` (INR terapeutisk interval, FSH
fertil-alder, Østradiol phases, …).

UI (`detailPanel.js`): the calculator + matrix render only when there are
structured rows; otherwise the `referenceNote` shows as a card. Matrix
column "Gruppe / Køn" → "Gælder for". `referenceTable.js` list column
"Køn" → "Gælder for".

Still imperfect: Østradiol keeps one garbled row (phase data is in the
note); ACTH's single time-bracket row goes to narrative; combined
Kappa/Lambda panel lists 3 sub-analytes as `target`.

---

## Original trigger for the wipe (kept for context)

Trigger: while filling in missing `pdfUrl` links by hand, found that
`Alkalisk phosphatase [BASP];P` (NPU01289) has been renamed+renumbered by
the hospital to `Basisk fosfatase;P` (NPU53077, doc M-018/13, was
M-016/10) — confirmed via the live PDF's own text. Fixing just the
identity fields (npu/name/pdfUrl) on the old hand-curated entry created a
**duplicate**: the already-merged scraper PR (#6) had separately
auto-created a *second* NPU53077 entry (bare draft) for the same analysis,
since it couldn't match the old stale NPU01289. Same slug on both — a real
routing bug. Investigating further showed the two entries' `referenceIntervals`
genuinely differ (the new document has much more granular pediatric age
brackets), so this isn't just an identity mismatch — the underlying
clinical data changed between document revisions too. Reverted the
in-progress fix rather than ship a half-resolved duplicate (see git log —
nothing committed from this).

User's call: now that the extraction pipeline is the pdfplumber-based one
(see "Extraction layer rewrite" below) instead of the old pdftotext regex
parser, reconciling 20 individually hand-curated legacy entries against
whatever NPU-renumbering/renaming the hospital has done since they were
written is going to keep surfacing one-off duplicate/stale-identity bugs
like this one. Rather than patch these as they're found, do a clean wipe
and rebuild the database from the current live site using the current
(much more capable) pipeline.

**These open questions were resolved 2026-08-27 — see the "✅ Clean
database wipe/rebuild" section at the top of this file for what was
decided and done.**
1. Rich content on the 20 legacy entries: **accepted the loss.**
2. Scope: **wipe everything.**
3. Extend extraction first: **yes** — done before the wipe.
4. Mechanism: cleared `database.json`→`[]` and `pdf-manifest.json`→`{}`,
   then a one-off local `pdf-diff.js --apply` run against the 24 sample
   PDFs; the rest repopulates on the next CI run.

## Goal
Automate keeping `src/data/database.json` in sync with the hospital's real
metodeblad PDFs (`gentoftehospital.dk/.../klinisk-biokemisk-afdeling/metodeblade/`).
Eventual target: a scheduled GitHub Action that scrapes, parses, and opens a PR
with proposed changes — never auto-commits, since this is clinical reference data.

## What exists
- `scripts/extract_pdf_fields.py` — Python/pdfplumber field extractor. Takes a PDF,
  outputs JSON of `{npu, docId, fields: {label: value}, dates: {...}}` using pdfplumber's
  table detection (word-position-aware, not linearized text — see "Extraction rewrite"
  below for why). Pure extraction, no business logic.
- `scripts/pdf-diff.js` — parser/differ. Takes a directory of those `.json` files,
  extracts unit/dates/referenceIntervals/name/section/indication/sample/etc., and diffs
  against `database.json` (matched by NPU). Dry-run by default (print-only); `--apply`
  patches matched entries (unit/dates only) and auto-creates draft entries for new NPUs.
  Run it with: `docker compose exec app node scripts/pdf-diff.js scripts/pdf-samples/json`
  (needs Node + Python; this repo's sandbox doesn't have either installed directly — the
  Docker dev image now has both, see Dockerfile).
- `scripts/pdf-samples/` — local scratch folder for real sample PDFs, gitignored
  (`*.pdf`, `txt/`, and `json/` all ignored — only `README.md` is committed). Extract a
  new PDF with: `python3 scripts/extract_pdf_fields.py "file.pdf" > scripts/pdf-samples/json/file.json`

## Known parser quirks (already handled)
- Danish å/æ/ø break JS `\b` word-boundary regex — don't rely on `\b` around them.
- Units containing digits (e.g. "x 103 IU/L") need an unrestricted trailing capture group.
- Age-stratified tables have 2+ template variants: standalone group header lines
  ("Kvinder:") vs. inline group-in-age-text ("Kvinde ≥ 18 år: ..."). Both handled.
- Some analyses have no age stratification at all — just one bare value in the
  Referenceinterval section, or a value next to a "beslutningsgrænse:" label. Fallback
  in `extractFallbackWholeLifeRange()` catches these → emits a single "Alle / Alle aldre" row.
- Deep `method`/QC fields (CE mærket, Akkrediteret, traceability, apparatur, etc.) are NOT
  reliably parseable — the PDF's two-column layout drifts unpredictably there. Any manual
  entry should still get a human skim of PDF pages 2–3 for that section.
- `laboratory` extraction is best-effort/low-confidence — same column-drift issue.

## Progress so far

### Stale and initial entries fixed & verified (done)
- **Alanintransaminase [ALAT];P** → NPU19651 (was NPU01129), doc M-014/13. New 8-row age-stratified table. *(commit 4af237c)*
- **Apolipoprotein B;P** → NPU22299 (was NPU01259), doc M-296/01. Single decision threshold (`> 1,00 g/L`). *(commit 4af237c)*
- **Antitrypsin;P** — brand-new entry, NPU19692, doc M-212/04. *(commit 4af237c)*
- **Antithrombin (enz.; Xa);P** → NPU29992 (was NPU01280), doc M-116/07. Chromogenic Xa assay. *(commit 230084b)*
- **Ammonium;P** → NPU03928 (was NPU01140 "Ammoniak;P"), doc M-232/03. *(commit 230084b)*
- **Albumin;P** → NPU19673, doc M-015/13.
- **Amylase, pancreastype;P** → NPU19653, doc M-295/01.
- **Alkalisk phosphatase [BASP];P** → NPU01289, doc M-016/10.
- **Apolipoprotein A1;P** → NPU01258, doc M-022/07.

### Second PDF batch — 11 new analyses implemented (done, commit 450c27b)
11 new analyses added spanning letters H, K, O, S, U, Z, Ø (bringing database total to 20 analyses):
1. **Hydrogencarbonat (aktuel);P(aB)** — NPU02409, doc M-252/03 (ABL gasanalyse, arterie/kapillær vs. vene).
2. **Hæmoglobin A1c (IFCC);Hb(B)** — NPU27300, doc M-178/10 (EDTA fuldblod, beslutningsgrænse `< 48 mmol/mol` & companion eAG NPU27412).
3. **Koagulation overfladeinduceret [APTT];P** — NPU01682, doc M-114/09 (Citratplasma, `<18 år: 20-34 s`, `≥18 år: 20-29 s`).
4. **Koagulationsfaktor II+VII+X [INR];P** — NPU01685, doc M-113/09 (Citratplasma, terapeutisk interval `2,0-3,0`, ringegrænse `> 5,0`).
5. **Koagulationsfaktor II-VII-X;P** — NPU18878, doc M-209/03 (Citratplasma ratio).
6. **Oxygen (O2);mætn. [Saturation] (ABL);Hb(aB)** — NPU03011, doc M-041/12 (ABL iltsaturation).
7. **Sjøgren syndrom [SSA]-IgG;P** — NPU12564, doc M-126/12 (Phadia 250 FEIA).
8. **Sjøgren syndrom [SSB]-IgG;P** — NPU12567, doc M-125/11 (Phadia 250 FEIA).
9. **U1 snRNP(70 kDa+A+C)-IgG;P** — NPU26646, doc M-129/11 (Phadia 250 FEIA).
10. **Zink;P** — NPU03768, doc M-256/03 (Serum fotometri, `10 – 19 µmol/L`).
11. **Østradiol;P** — NPU01972, doc M-206/09 (Atellica IM kemiluminescens, fuld stratificering).

*Note*: Elektrokardiografi [EKG] excluded — diagnostic procedure code (FAS00050 / DNK05219), not a blood test.

### Parser upgrades in `scripts/pdf-diff.js` (done, commit 450c27b)
- Added gender symbol matching (`♀`, `♂`) in `GROUP_WORDS`, `STANDALONE_GROUP_RE`, `BARE_GROUP_RE`, and `splitGroupFromAge()`.
- Added recognition for `menopause`, `fase`, `uger`, etc. in `AGE_UNIT_RE`.

### UI: Alphabet filter bar restored (done, commit 450c27b)
- **`src/js/components/filterBar.js`** — added `0-9 / A–Å` alphabet navigation row above the existing faceted filter controls (`Kun voksne`, `Alle Sektioner`, `Alle Prøverør`, `Kun DANAK`).
- **`src/js/search.js`** — added `letter` filter parameter to `search()` and new `getAvailableLetters()` method. Letters without analyses are dimmed/disabled.
- **`src/js/app.js`** — wired `state.letter` through search, filter bar, and all reset actions.
- **`src/styles/components.css`** — new `.alphabet-bar`, `.alphabet-btn`, `.alphabet-divider` styles with hover/active states and dark-mode support.

## Commit history (local, on `main`)
| Commit | Description |
|--------|-------------|
| `450c27b` | feat: add 11 new clinical methods to database and restore alphabet filter bar |
| `c4dc46d` | Add PDF samples and texts; update .gitignore |
| `230084b` | Correct two more stale database entries from source PDFs |
| `4af237c` | Add PDF scraping dry-run parser and correct stale database entries |

### GitHub Action for periodic scraping (done)
- **Discovery mechanism**: the metodeblade landing page has no index of
  individual analyses, but per-letter pages do:
  `.../metodeblade/Sider/{LETTER}.aspx` (`0-9`, `A`–`Z`, `Æ`, `Ø`, `Å`), each
  listing that letter's PDF links directly in the HTML. Confirmed live
  against the site.
- **Bot defense**: the site sits behind an F5 JS challenge
  (`security-check.regionh.dk`) that blocks plain HTTP clients (curl,
  fetch). A headless Playwright/Chromium browser passes it fine — first
  navigate to the landing page to get past the challenge and pick up
  session cookies, then everything else (letter pages, PDF downloads) reuses
  that browser context.
- **`scripts/scrape-metodeblade.js`** — walks all letter pages, downloads
  each PDF via the authenticated browser context, hashes it, and only saves
  new/changed PDFs (tracked in `scripts/pdf-manifest.json`, url → sha256 +
  last-seen/last-changed). Unchanged PDFs are skipped on subsequent runs.
  Needs Playwright's Chromium + system deps installed
  (`npx playwright install --with-deps chromium`) — does **not** work in the
  project's regular `node:24-slim` dev container (missing browser system
  libs); run it in CI or via the `mcr.microsoft.com/playwright` Docker image.
- **`scripts/pdf-diff.js`** — extended with `--apply` (patches matched
  entries' `unit`/`inUseDate`/`revisionDate`/`referenceIntervals` in
  `database.json`; `laboratory` and deep method/QC fields are never
  auto-applied — always manual review) and `--report <path>` (writes a
  Markdown summary for use as a PR body). A custom serializer preserves the
  file's existing one-object-per-line `referenceIntervals` formatting so
  applied changes produce small, reviewable diffs instead of reformatting
  the whole file.
  - **Known limitation, confirmed via testing, partially fixed**: rows
    labeled with a decision-threshold word instead of an age bracket (e.g.
    "Negativ: < 7 kU/L", "Inkonklusiv: 7-10 kU/L", "Positiv: > 10 kU/L")
    used to be silently dropped by `extractReferenceIntervals()` — for
    tables with no age stratification at all, that meant every row but one
    vanished (the survivor came from `extractFallbackWholeLifeRange()`
    grabbing the first bare number in the section, losing its label too).
    Fixed by adding `DECISION_LABEL_RE`, a narrow curated vocabulary
    (negativ/positiv/inkonklusiv/gråzone/grænseværdi/beslutningsgrænse/
    terapeutisk interval) matched anywhere in the descriptor (not anchored
    to the start, since column-drift sometimes glues an unrelated
    left-column label onto the same line before the real one) — confirmed
    against real samples: Sjøgren SSA/SSB and U1 snRNP now correctly
    capture all 3 rows instead of 1. A first attempt widened this to *any*
    non-age descriptor instead of a curated list, which fixed the same
    cases but also reintroduced garbage from dates/stability/interference
    text throughout the document (exactly what `AGE_UNIT_RE`'s original
    narrowness was protecting against) — reverted in favor of the
    curated-vocabulary version.
    **Still open** (not attempted — see below for why): (1) column-drift
    can still relocate genuine reference-interval content outside any
    reliable section boundary (e.g. INR's "Terapeutisk interval" row and
    Hæmoglobin A1c's real values get interleaved with unrelated
    stability/heading text in ways that differ per template — a
    boundary-based fix was prototyped and reverted after it verified
    unreliable across templates); (2) `ROW_RE`'s 25-char trailing-unit cap
    drops rows with explanatory prose after the value (e.g. INR's
    "Terapeutisk interval: 2,0-3,0 (enkelte patientgrupper ...)"); (3)
    heavily drifted multi-variant templates like Østradiol still garble.
    `--apply` still writes referenceIntervals into `database.json` per the
    current design (the PR is meant to catch remaining issues on review),
    so **PRs from this workflow still need a real read of the
    referenceIntervals diffs**, not just a skim — the fix above shrinks the
    blast radius of that risk, it doesn't eliminate it.
  - **`revisionDate` extraction bug — fixed.** Column-drift can split
    "Revision:" from its own value across two lines with "Erstatter:"'s date
    sitting in between, e.g.:
    ```
    Udarbejdet af:   Taget i brug: 23.03.2026        Revision:
    Valbona Camili   Erstatter: 15.12.2025            23.03.2029
    ```
    `findDateAfterLabel()`'s first-date-in-window scan grabbed
    `Erstatter:`'s date instead of `Revision:`'s own, silently, with
    `confidence: high` and no warning. First found via the local (stale)
    sample text for U1 snRNP; confirmed against **live** re-downloaded PDFs
    the real GitHub Action run touched, since the local sample turned out
    to have a different (older) layout than what's on the site now. Fixed
    by extracting `replaces`/`inUseDate` first and excluding their already-
    known values when scanning for `revisionDate`. Verified against live
    Sjøgren SSA and U1 snRNP PDFs (both previously wrong, now correct) and
    the full local 24-sample set (zero `revisionDate` diffs anywhere, no
    regressions).
- **`.github/workflows/scrape-metodeblade.yml`** — weekly cron +
  `workflow_dispatch`. Installs Playwright Chromium + `poppler-utils`, runs
  the scraper, extracts text with `pdftotext -layout -enc UTF-8`, runs
  `pdf-diff.js --apply --report`, and opens a PR (via
  `peter-evans/create-pull-request`) touching only `database.json` and
  `pdf-manifest.json` if anything changed. Never pushes to `main` directly.
- Added `playwright` as a devDependency; `scripts/pdf-cache/` (scraper's
  working directory — downloaded PDFs, extracted text, generated report) is
  gitignored, only `pdf-manifest.json` is committed.
- **Not yet done**: a full live run of the Action itself (`workflow_dispatch`
  on GitHub) hasn't been triggered — validation so far is a local spike
  (Playwright in the `mcr.microsoft.com/playwright` Docker image) that
  confirmed bot-check bypass, letter-page scraping, PDF download, manifest
  diffing (including a correct no-op second run), and the full
  scrape → extract → apply → report pipeline against one real PDF (Zink).
- Note: `scripts/pdf-samples/*.pdf` and `txt/` are actually committed to
  git today (tracked), despite this file previously describing them as
  gitignored — `.gitignore` had the relevant lines commented out. Fixed
  going forward (uncommented), but the already-tracked sample files
  haven't been removed from git history.

## Auto-apply redesign after PR #1–#3 review (done)
The first three real PRs from the live Action (closed without merging — see
commit/PR history) surfaced that auto-applying `referenceIntervals` to
*existing, hand-curated* entries was net-harmful: on complex tables it
silently replaced correct data with worse extractions (dropped rows, merged
distinct patient groups like "arterial vs. venous" into one, garbled prose
into a range). The `DECISION_LABEL_RE` widening from the earlier session
(the "decision-threshold row" fix) was reverted back to the original,
narrower `extractReferenceIntervals()` — `scripts/pdf-diff.js`'s function is
now byte-identical to the pre-session version at commit `450c27b`.

Redesigned scope, reflecting that the actual goal was always to grow the
catalog (191+ analyses aren't in it yet), not just diff the 20 that are:
- **Matched entries** (NPU already in `database.json`): only `unit`,
  `inUseDate`, `revisionDate` auto-apply — proven reliable across two real
  runs. `referenceIntervals` differences are report-only now, explicitly
  labeled "NOT auto-applied — compare manually" in both console and PR body.
- **New entries** (NPU not yet in `database.json`): auto-created as draft
  entries — no LLM (ruled out on cost), just the fields this parser can
  actually get reliably: `npu`, `unit`, `inUseDate`/`revisionDate`/`replaces`,
  best-effort `referenceIntervals`, plus `pdfUrl`/`letter` from the
  scraper's `changed.json` (passed via new `--changed-json` flag — matched
  to each `.txt` by filename). Fields that tested as unreliable across real
  samples — `name` (title-line format/order varies by template, e.g.
  `NPU02043 P-Alfa-1-Føtoprotein` vs `Zink;P NPU03768`; a "Analysenavn og
  kode i SP" label that looked promising in one sample turned out to be the
  same column-drift problem in 2 of 3 other samples checked), `section`,
  `indication`, `sample`, `method` — are left **honestly empty**, not
  guessed, and the whole entry is stamped with a `dataQualityFlags` note
  explaining what needs manual completion. `name` falls back to the PDF's
  own filename (e.g. "Zink (Plasma)") — real and unambiguous, just not the
  canonical `;P` format the rest of the DB uses.
  - New functions: `slugify()`, `extractDocId()` (pulls "M-256/03" from
    "Metodeblad nr. M-256/03"), `createDraftEntry()`.
  - Deliberately does **not** reuse `importerModal.js`'s existing pattern of
    filling unknowns with plausible-sounding generic defaults (e.g. a
    hardcoded `"Siemens Atellica CH 930"` instrument, `"Se indlægsseddel"`
    text) — that presents fabricated data as if verified.
  - Found and fixed a real instance of that same anti-pattern while testing
    this: `utils/tubeBadge.js`'s `renderTubeBadge()` silently defaulted an
    empty/unknown `tubeColor` to a *specific real tube type* ("Grå prop
    (Fluorid-Oxalat)") instead of an honest "not set" state — harmless
    before (every entry had real curated tube data) but actively misleading
    once draft entries with empty `tubeColor` exist. Added a real `unknown`
    tube definition ("Rørtype ikke angivet") instead.
- Verified end-to-end against all 24 real local samples plus a full
  headless-browser UI check (list view, detail panel, search) with a
  synthetic `changed.json` — zero console/page errors, drafts render
  correctly, no regression on existing entries' tube badges.
- PR body wording rewritten to be unambiguous about what happened:
  `"N matched entries with differences (unit/dates auto-applied,
  referenceIntervals report-only), M new draft entries created"` — the
  earlier "Changes ... have been applied" phrasing was genuinely
  misread as "everything in this diff is trustworthy."

## `unit` field: stripped-exponent bug found in PR #4 review (fixed)
User caught a real one reviewing PR #4's diff: Antithrombin's `unit` would
have auto-applied `"x 10^3 IU/L"` → `"x 103 IU/L"` — losing the exponent.
Root cause is **not** a regex bug: `pdftotext` itself already flattens
superscript formatting before this script ever sees the text (confirmed —
`grep`ing the raw `.txt` file directly shows `"x 103 IU/L"`, no caret). A
PDF's `×10⁹` and a genuine plain `109` produce byte-identical extracted
text, so no amount of pattern-matching can tell them apart after the fact —
the information is gone at the text-extraction layer, not lost by us.

Checked scope on the actual PR #4 branch (211 real PDFs, not just local
samples): **16 entries** affected — Antithrombin (the one caught by
inspection) plus **15 new draft entries**, nearly the entire CBC/
differential panel (erythrocytes, leukocyte subtypes, thrombocytes,
reticulocytes — all use `×10ⁿ/L`-style units in Danish hematology
convention). PR #4 closed without merging.

Fix in `extractUnit()`: any unit value matching `/10\d/` (a bare digit run
immediately after "10", the signature of a flattened exponent) now gets
`confidence: 'low'` instead of `'high'`. Effects:
- **Existing entries**: `applyToEntry()` already skips low-confidence
  fields, so this can never again silently overwrite a correct existing
  unit — confirmed Antithrombin's unit is now untouched in a re-run.
- **New draft entries**: a specific `EXPONENT_UNIT_FLAG` gets added to
  `dataQualityFlags` (separate from the generic draft-entry flag) so it's
  visibly called out as needing a PDF cross-check, not folded into the
  generic "needs completion" note.

## Extraction layer rewrite: pdftotext -> pdfplumber (done)
User asked whether per-PDF or per-template parsers were feasible, since the
regex approach kept needing new special-casing for each new bug found. Real
answer: neither per-file nor per-template parsers would have fixed the
actual root cause, because the column-drift corruption isn't really
template-dependent — it's `pdftotext -layout`'s column-reconstruction
heuristic breaking down differently based on how much text is in each
field, even across two PDFs from the *same* template (confirmed: Zink and
ACE use the same template, Zink extracts cleanly, ACE doesn't). Regex
patching was fighting symptoms of a real information-loss problem at the
text-extraction layer.

Tested the real fix instead: `pdftotext -layout` linearizes a PDF's
two-column layout into one text stream using a positional *guess*, which is
what breaks. `pdfplumber` (Python) uses each word's actual bounding box to
reconstruct real table structure instead of guessing. Validated against all
24 local samples plus the 3 worst-known cases (Østradiol, INR,
Hydrogencarbonat) before committing to the rewrite:
- Every labeled field in a document comes back as a clean, correctly-
  isolated table cell — not just `referenceIntervals`, but `Analysenavn og
  kode i SP` (the canonical name), `Indikation og resultatvurdering`,
  `Prøvemateriale og rørtype`, `Ansvarlig KBA analysesektion` (section),
  `Ringegrænser` (alarm limits), all of it. Fields written off all session
  as "not reliably regex-parseable" turned out to be trivially parseable
  once the table structure survives extraction — the data was never the
  problem, `pdftotext`'s linearization destroying it was.
- INR's dropped "Terapeutisk interval" row, Hydrogencarbonat's dropped
  Veneblod row, and Østradiol's cross-section content mixing are all fixed
  at the mechanism level (isolated table cells), not patched per-case.
- The date-label mixup (`Revision:`/`Erstatter:`, see the earlier fix
  above) is *also* solved structurally — confirmed the two labels land in
  genuinely separate table cells, not just separated by a smarter regex.
- **Not fixed by this, still applies**: the superscript/exponent-stripping
  issue (`×10⁹` -> `109`) — that's font-rendering-level information loss,
  below the layout-reconstruction level pdfplumber operates at. The
  existing `STRIPPED_EXPONENT_RE` confidence-downgrade logic is unchanged
  and still necessary.

New pieces:
- **`scripts/extract_pdf_fields.py`** — pure extraction, PDF -> JSON
  (`{npu, docId, fields: {label: value}, dates: {...}}`). No business logic
  or field-selection rules; those all stay in `pdf-diff.js`. The
  `Taget i brug`/`Revision`/`Erstatter` date cluster is read from its own
  table cells specifically (not a full-text regex fallback — that
  reintroduced the exact drift bug this rewrite was partly meant to fix,
  caught and corrected before shipping).
- **`scripts/pdf-diff.js`** rewritten to consume that JSON instead of
  scanning linearized text. New extractors: `extractName()` (from
  `Analysenavn og kode i SP`/`WebReq`, stripping the NPU suffix; requires
  the result match the DB's real `Name;SpecimenCode` shape — a positive
  check, not a blacklist of "doesn't look like a name" phrases, since a
  blacklist kept missing new bad phrasings like "Rekvirering via WebReq er
  ikke muligt" showing up as a fake name), `extractSection()` (keyword-
  mapped to the DB's existing `KEMI`/`KOAGULATION`/`IMMUNKEMI`/`POCT`
  codes), `extractIndicationSummary()`, `extractSampleMaterial()`,
  `extractMinVolume()`, `extractAlarmLimits()`. `extractReferenceIntervals()`
  now runs on a single isolated cell instead of the whole document, so the
  earlier decision-label-as-group widening (reverted for being unsafe
  against raw pdftotext text — see above) is back and safe here: nothing
  else in the string to sweep in by mistake. Two more row-parsing fixes
  found via this session's re-testing: `stripLeadingGroupPrefix()` (rows
  like `♀: 16 dage – 10 år: 0,02-0,11 nmol/L` have two colons — the old
  code let the first one make `♀` look like a bare group symbol and
  swallow the real age/range into a mangled "unit" string) and
  `mergeSplitLabelValueLines()` (some cells put a row's label and value on
  separate lines, e.g. Hydrogencarbonat's `Arterie- og kapillærblod:` /
  `22,0-27,0 mmol/L.` on two lines — silently dropped the whole row before).
- **New draft entries are now dramatically more complete**: name (when
  extractable), section, indication summary, sample material, min volume,
  alarm limits, laboratory, unit, dates, referenceIntervals — not just the
  bare npu/unit/dates/referenceIntervals skeleton from before. Deep
  method/QC fields still left empty (not attempted this pass).
  `dataQualityFlags` gained `NAME_IS_FILENAME_FLAG` (separate from the
  generic draft-entry note) for when name extraction falls back to the
  PDF's filename.
- **Dockerfile**: dev container now installs Python 3 + `pdfplumber` (see
  `scripts/requirements.txt`, pinned) alongside Node, so
  `docker compose exec app` can run the whole pipeline — no more needing a
  separate scratch container for the Python half during local testing.
- **`.github/workflows/scrape-metodeblade.yml`**: `pdftotext`/poppler-utils
  step replaced with `actions/setup-python` + `pip install -r
  scripts/requirements.txt` + `extract_pdf_fields.py` per PDF.
- Policy unchanged from the previous redesign: matched (existing) entries
  still only get unit/dates auto-applied, referenceIntervals stays
  report-only — the extraction being far more reliable now doesn't change
  that policy, since the risk being guarded against is "this parser is
  wrong again someday," not "this parser is currently wrong."

## Next steps (in rough priority order)
1. **Trigger `scrape-metodeblade.yml` and review the PR.** The DB is now
   23 entries and the manifest is empty, so this run recreates all ~211
   analyses as drafts through the extended pipeline (method/QC +
   indication split now included). Expect a large PR; the 23 already
   present will re-match by NPU (unit/dates only auto-apply), the rest
   come in new.
2. Manually complete / verify the draft entries — the method block is now
   machine-filled, so this is a *review* pass, not from-scratch: confirm
   method/QC against pages 2–3 of each PDF, fix the filename-fallback
   `name`s (combined-panel sheets), check units flagged with the
   exponent-risk note, and re-do Østradiol's `referenceIntervals` by hand.
   Clear flags per entry with `scripts/mark-reviewed.js`.
3. Improve extraction coverage further where the 23-entry rebuild exposed
   gaps: AFP-style dash-list indication splitting, combined-panel `name`
   extraction, `logistics.transport`/`handling` (currently always empty —
   the source cells only carry column headers, no values).
4. Push local commits to origin when ready.

### ~~Split `indication.summary` into `elevated`/`decreased`~~ — done 2026-08-27
Implemented in `extractIndication()` (see the wipe/rebuild section at the
top). Header-driven; entries without a "Forhøjet…:"/"Nedsat…:" header keep
the single summary blob.

## Data-quality flags in the UI (done)
Since `pdf-diff.js --apply`'s `referenceIntervals` extraction is known-unreliable
(see limitations above), entries it auto-applies referenceIntervals changes to now
carry that risk visibly in the app itself, not just in the PR:
- `pdf-diff.js`'s `applyToEntry()` stamps `dataQualityFlags: string[]` onto any
  entry whose `referenceIntervals` it changes (dedup'd, so re-scraping an
  already-flagged entry doesn't pile up duplicate messages).
- **UI**: `referenceTable.js` shows a small ⚠ next to the analysis name in the
  list view (hover for the reason, via the existing fast-tooltip system);
  `detailPanel.js` shows a full warning banner at the top of the detail panel.
  Both confirmed visually via a headless-browser screenshot test with a
  temporary test flag (not committed).
- **Clearing**: `scripts/mark-reviewed.js <npu-or-slug>` removes the flags from
  an entry once a human has verified it against the source PDF — e.g.
  `node scripts/mark-reviewed.js NPU12564`.
- Shared `scripts/lib/database-format.js` now holds the formatting-preserving
  `serializeDatabase()` (previously duplicated inline in `pdf-diff.js`) so both
  `pdf-diff.js --apply` and `mark-reviewed.js` write in the same compact
  `referenceIntervals` style without reformatting the rest of the file.

## Running / Testing with Docker
```bash
docker compose up -d --build
docker compose exec app python3 scripts/extract_pdf_fields.py "scripts/pdf-samples/file.pdf" > scripts/pdf-samples/json/file.json
docker compose exec app node scripts/pdf-diff.js scripts/pdf-samples/json
docker compose exec app node scripts/mark-reviewed.js <npu-or-slug>
```

