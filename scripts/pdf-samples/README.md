# PDF samples

Drop a handful of real Gentofte/Herlev metodeblad PDFs here (e.g. `Albumin (Plasma).pdf`,
`Amylase, pancreastype (Plasma).pdf`). They're gitignored — this folder is just a local
scratch area for tuning the PDF text extractor against real documents before it's wired
into a GitHub Action.

Once a few are here, extract their fields and compare against the matching entries in
`src/data/database.json` to see how reliably the existing fields (reference intervals,
unit, revision date, tube type, etc.) can be parsed back out automatically:

```
python3 scripts/extract_pdf_fields.py "file.pdf" > scripts/pdf-samples/json/file.json
node scripts/pdf-diff.js scripts/pdf-samples/json
```
