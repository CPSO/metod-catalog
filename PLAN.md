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

### Fixed stale entries (done, committed)
- **Alanintransaminase [ALAT];P** → NPU19651 (was NPU01129), doc M-014/13. New 8-row
  age-stratified table replacing the old 3-bracket one. *(commit 6e7292c)*
- **Apolipoprotein B;P** → NPU22299 (was NPU01259), doc M-296/01. New method uses a single
  decision threshold (`> 1,00 g/L`, age "Alle aldre") instead of the old 3-tier risk table.
  *(commit 6e7292c)*
- **Antitrypsin;P** — added as a brand-new entry, NPU19692, doc M-212/04. *(commit 6e7292c)*
- **Antithrombin (enz.; Xa);P** → NPU29992 (was NPU01280 "Antithrombin;P"), doc M-116/07.
  Completely different method (Hæmatologi/koagulation section, citrate tube, chromogenic
  Xa-based assay). *(commit 5c24b26)*
- **Ammonium;P** → NPU03928 (was NPU01140 "Ammoniak;P"), doc M-232/03. *(commit 5c24b26)*

Both commits are local only — **not yet pushed to origin** (2 commits ahead as of last check).

### New PDF samples added, NOT yet processed
User added 12 more PDFs spanning letters beyond A (good template diversity test).
Already `pdftotext`-extracted to `scripts/pdf-samples/txt/`, diff already run once —
raw parser output reviewed but nothing added to `database.json` yet:

1. `Hydrogencarbonat (aktuel);P(aB), P(vB)-Hydrogencarbonat;...(ABL)` — NPU02409 — parser found 0 reference-interval rows, needs manual read (blood gas analyte, likely a different table shape again).
2. `Hæmoglobin A1c (IFCC) (Blod)` — NPU27300 (+ companion NPU27412 "Glukose, middel") — **full text already read** in this session (see transcript before interruption). Real reference is a single decision threshold: "HbA1c (IFCC): < 48 mmol/mol" / "eAG: < 7,7 mmol/L" under "Klinisk beslutningsgrænse" — parser's automatic extraction grabbed garbage ("72 timer v. 21°C blod..."), needs manual entry like ALAT/Apolipoprotein B was. Two NPU codes on one method sheet (HbA1c itself + derived eAG/mean glucose) — decide whether that's one DB entry or two.
3. `Elektrokardiografi [EKG]` — **no NPU code at all**, it's a procedure code (FAS00050), not a blood test. Doesn't fit this catalog's schema (no reference interval, no NPU). **Recommend skipping** this one rather than forcing it in — flag to user to confirm.
4. `Koagulation overfladeinduceret [APTT] (Plasma)` — NPU01682 — parsed cleanly, 2 rows (`<18 år: 20-34 s`, `≥18 år: 20-29 s`), looks trustworthy, low risk to add as-is after a quick read-through.
5. `Koagulationsfaktor II+VII+X [INR] (Plasma)` — NPU01685 — parsed 3 rows, unit "Ingen" (correctly unitless, INR is a ratio) — worth double-checking full text before adding.
6. `Koagulationsfaktor II-VII-X (Plasma)` — NPU18878 — parsed 2 rows, unit "Ratio" — double-check full text.
7. `Oxygen (O2);mætn. [Saturation] (ABL) (Blod)` — NPU03011 — parser returned 3 rows but the 3rd ("Alle | Alle aldre | 0,70-0,80") looks suspicious/likely wrong (a 70-80% O2 saturation reading as a blanket "all ages" normal range doesn't fit clinically) — **needs full manual read**, don't trust the automated rows as-is.
8. `Sjøgren syndrom [SSA]-IgG (Plasma)` — NPU12564 — 1 row, `< 7 kU/L`, plausible autoantibody cutoff.
9. `Sjøgren syndrom [SSB]-IgG (Plasma)` — NPU28541 — 1 row, `7-10 kU/L` — odd that it's a range not a cutoff, worth confirming against full text (autoantibody tests are usually a single cutoff, not a range — could be a borderline/grey-zone band).
10. `U1 snRNP(70 kDa+A+C)-IgG (Plasma)` — NPU26646 — 1 row, `< 5 kU/L`, plausible.
11. `Zink (Plasma)` — NPU03768 — 1 row, `10 – 19 µmol/L`, plausible but check for missed age stratification.
12. `Østradiol (Plasma)` — NPU01972 — parser only surfaced 3 rows and they use gender symbols (♀/♂) that the parser's group-word splitter doesn't recognize (only handles text "Kvinder"/"Mænd", not symbols) — the age field is polluted with the raw "♀: ..." prefix, and the table is almost certainly longer (adult ranges likely missing from what was captured). **Needs a full manual read and probably a parser fix** (add ♀/♂ to `GROUP_WORDS`/`splitGroupFromAge`).

## Next steps (in rough priority order)
1. Decide on EKG — skip it (recommended) or find some way to represent non-NPU procedures.
2. Manually read + add the "needs full read" ones: Hydrogencarbonat, Hæmoglobin A1c, Oxygen
   saturation, Østradiol (plus a `GROUP_WORDS` fix for ♀/♂ symbols since Østradiol needs it).
3. Read + add the more straightforward ones: APTT, both Koagulationsfaktor docs, both Sjøgren
   docs, U1 snRNP, Zink — lower risk but still confirm full text before transcribing, same
   rigor as the ALAT/Apolipoprotein B/Antitrypsin fixes (don't trust raw parser output blindly).
4. Once letter diversity is validated (this batch covers A, H, E, K, O, S, U, Z, Ø), decide
   whether to build the actual GitHub Action (apt-get poppler-utils, run pdftotext + this
   parser, open a PR) — or keep doing manual passes like this one.
5. Push the 2 local commits (6e7292c, 5c24b26) to origin whenever the user's ready — currently
   holding them locally per usual practice of not pushing without being asked.

## Reminder for next session
Node isn't installed directly in this sandbox — use
`docker compose up -d --build` then `docker compose exec app node ...` (or `npm run dev`
inside the container) to run/test anything. `pdftotext` (poppler) IS available directly
via the Bash tool on this machine, so PDF→text extraction can happen outside Docker.
