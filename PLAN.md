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
  - **Separate bug noticed in passing, not yet fixed**: `revisionDate`
    extraction can pick up the wrong date when "Revision:" and "Erstatter:"
    labels appear on adjacent lines with their values column-wrapped (seen
    in U1 snRNP's source PDF: `findDateAfterLabel()`'s 200-char window after
    "Revision:" spans into the next line and matches "Erstatter:"'s date
    first). Returns a wrong value with `confidence: high`, no warning flag —
    worth fixing before trusting `revisionDate` auto-apply blindly.
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

## Next steps (in rough priority order)
1. Trigger the new workflow manually (`workflow_dispatch`) once pushed to
   origin, and review the first PR carefully — it will be a large one since
   `pdf-manifest.json` starts empty (every known PDF looks "new").
2. Add further PDF samples from remaining letters (B, C, E, F, G, I, J, L,
   M, N, O, P, Q, R, S, T, U, V, W, X, Y) to expand catalog coverage beyond
   the current 20 entries — the new scraper can supply these automatically
   now via its PR, but each still needs the same manual-entry treatment for
   brand-new NPUs (indication, sample, method fields).
3. Consider improving `extractReferenceIntervals()` for age/group
   stratification before trusting `--apply`'s referenceIntervals output
   without a careful per-PR read — see limitation noted above.
4. Push local commits to origin when ready.

## Running / Testing with Docker
```bash
docker compose up -d --build
docker compose exec app node scripts/pdf-diff.js
```

