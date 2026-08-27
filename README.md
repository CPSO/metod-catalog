# Metodeblade Datakatalog (Herlev & Gentofte Hospital)

En lynhurtig, moderne og søgbar **Statisk Søgedatabase (Static Search Database)** over laboratoriemetodeblade for Klinisk Biokemisk Afdeling (KBA) på Herlev og Gentofte Hospital.

Projektet kører 100% klient-baseret uden backend-servere og er klar til gratis hosting på **GitHub Pages**.

---

## ✨ Nøglefunktioner

1. **Lynhurtig Instant Search**:
   - Søg på tværs af **analysenavne** (dansk/latin), **NPU-koder** (fx `NPU19673`, `NPU19653`), **LABKA-koder** (`ALB`, `AMYLP`), **kliniske indikationer** (`dehydrering`, `pankreatit`, `leversygdom`, `nyresvigt`), **prøverørsfarver** (`grøn prop`, `rød prop`) og **analyseapparatur**.
   - Keyboard shortcut: Tryk `/` for straks at hoppe til søgefeltet.

2. **A–Z Bogstavfilter**:
   - Hurtig filtrering på startbogstaver (A, B, C... Å) med tæller for antal tilgængelige analyser.

3. **Komplet Klinisk Metodeblad Visning**:
   - **Indikation & Vurdering**: Tydelig opdeling af forhøjede og nedsatte tilstande.
   - **Prøvetagning & Rørtype**: Farvekodede glas (Grøn Lithium-Heparin, Rød Serum, Lilla EDTA, Lyseblå Citrat) med mindste prøvemængde og håndtering.
   - **Interaktiv Referenceinterval Beregner**: Vælg patientens alder og køn for at se det gældende normalområde.
   - **Metode & Udstyr**: Apparatur (Siemens Atellica), metrologisk sporbarhed, måleområde og HIL-interferensgrænser (hæmolyse, icterus, lipæmi).
   - **Kvalitetskontrol & Logistik**: Intermediær CV%, måleusikkerhed (CI 95%), RCV%, svartider og holdbarhed.
   - **Print-venlig**: Optimeret CSS til direkte udskrift i standard laboratorieformat.

4. **Indbygget Data Importer**:
   - Knappen **"Tilføj / Import"** i toppen af siden lader dig indsætte rå OCR-tekst fra nye PDF-metodeblade (fx bogstaverne B, C, D...) eller JSON-data for at udvide databasen direkte i browseren.

---

## 🚀 Kom godt i gang

### Kør lokalt:
```bash
# 1. Installer afhængigheder
npm install

# 2. Start lokal udviklingsserver
npm run dev
```
Åbn `http://localhost:3000` i din browser.

### Byg til produktion:
```bash
npm run build
```
Dette genererer en færdig `dist/`-mappe, som kan uploades til enhver statisk webserver (GitHub Pages, Cloudflare Pages, Netlify eller Vercel).

---

## 🌐 Gratis Hosting på GitHub Pages

Projektet indeholder allerede en GitHub Actions workflow i `.github/workflows/deploy.yml`:

1. Opret et nyt GitHub repository (fx `metod-catalog`).
2. Push koden til GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Metodeblade Static Search Database"
   git branch -M main
   git remote add origin https://github.com/<dit-brugernavn>/metod-catalog.git
   git push -u origin main
   ```
3. Gå til dit repository på GitHub -> **Settings** -> **Pages**:
   - Under **Build and deployment** vælg **Source: GitHub Actions**.
4. GitHub bygger og udgiver automatisk din database på:  
   `https://<dit-brugernavn>.github.io/metod-catalog/`

---

## 📂 Datastruktur & Tilføjelse af Nye Bogstaver

Kataloget er opdelt pr. afdeling: `src/data/kba.json` (Klinisk Biokemisk Afdeling) og `src/data/kma.json` (Klinisk Mikrobiologisk Afdeling), registreret i `src/data/departments.js`. KBA-formatet er fuldt struktureret:

```json
{
  "id": "M-015/13",
  "documentNumber": "M-015 ALB",
  "slug": "albumin-p-npu19673",
  "name": "Albumin;P",
  "letter": "A",
  "npu": "NPU19673",
  "labka": "ALB",
  "labkaFullName": "P-Albumin ALB",
  "unit": "g/L",
  "section": "KEMI",
  "indication": {
    "summary": "...",
    "elevated": ["..."],
    "decreased": ["..."]
  },
  "sample": {
    "material": "Plasma/serum",
    "tubeColor": "green",
    "tube": "Vacuette® glas med grøn prop og sort ring, indeholdende Lithium-Heparin",
    "minVolume": "Et fyldt glas"
  },
  "referenceIntervals": [
    { "target": "Alle", "age": "18 år – 39 år", "range": "36 – 48", "unit": "g/L" }
  ],
  "referenceNote": ""
}
```
Du kan enten tilføje nye poster direkte i afdelingens JSON-fil eller bruge den indbyggede import-knap på websiden (kun KBA).
