# PDF scraping / database sync — progress & plan

## Goal
Automate keeping `src/data/database.json` in sync with the hospital's real
metodeblad PDFs (`gentoftehospital.dk/.../klinisk-biokemisk-afdeling/metodeblade/`).
Eventual target: a scheduled GitHub Action that scrapes, parses, and opens a PR
with proposed changes — never auto-commits, since this is clinical reference data.

## What exists
- `scripts/pdf-diff.js` — dry-run parser. Takes pre-extracted `.txt` files (from
  `pdftotext -layout -enc UTF-8`), extracts NPU code / unit / dates / reference-interval
  table, and diffs against `database.json` (matched by NPU). Print-only, no writes.
  Run it with: `docker compose exec app node scripts/pdf-diff.js` (needs Node; this repo's
  sandbox doesn't have Node installed directly, use the Docker container).
- `scripts/pdf-samples/` — local scratch folder for real sample PDFs, gitignored
  (`*.pdf` and `txt/` both ignored — only `README.md` is committed). Extract new PDFs with:
  ```
  pdftotext -layout -enc UTF-8 "file.pdf" "scripts/pdf-samples/txt/file.txt"
  ```

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

## Next steps (in rough priority order)
1. Trigger the workflow again with this redesign and review the resulting
   PR — first run will still be large (`pdf-manifest.json` on `main` is
   still empty; every known PDF looks "new" the first time).
2. Manually complete the auto-created draft entries' `name`/`indication`/
   `sample`/`method`/`section` fields (same per-entry human work PLAN.md
   always expected for these fields — the scraper now hands you a
   pre-filled starting point instead of nothing).
3. Push local commits to origin when ready.

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
docker compose exec app node scripts/pdf-diff.js
docker compose exec app node scripts/mark-reviewed.js <npu-or-slug>
```

