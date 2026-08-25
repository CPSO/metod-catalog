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

## Next steps (in rough priority order)
1. Add further PDF samples from remaining letters (B, C, D, E, F, G, I, J, L, M, N, P, R, T, V) to expand catalog coverage beyond the current 20 entries.
2. Design and build the GitHub Action workflow for periodic scraping (`apt-get install poppler-utils`, `pdftotext`, run `pdf-diff.js`, create automated PR for reviewed updates).
3. Push local commits to origin when ready.

## Running / Testing with Docker
```bash
docker compose up -d --build
docker compose exec app node scripts/pdf-diff.js
```

