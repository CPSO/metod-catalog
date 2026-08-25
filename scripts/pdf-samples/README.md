# PDF samples

Drop a handful of real Gentofte/Herlev metodeblad PDFs here (e.g. `Albumin (Plasma).pdf`,
`Amylase, pancreastype (Plasma).pdf`). They're gitignored — this folder is just a local
scratch area for tuning the PDF text extractor against real documents before it's wired
into a GitHub Action.

Once a few are here, we'll extract their text and compare it against the matching entries
in `src/data/database.json` to see how reliably the existing fields (reference intervals,
unit, revision date, tube type, etc.) can be parsed back out automatically.
