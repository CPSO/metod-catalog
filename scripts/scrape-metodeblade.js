#!/usr/bin/env node
/**
 * Scrapes the hospital's metodeblade PDF index and downloads new/changed PDFs.
 *
 * The site sits behind a bot-defense JS challenge (F5, redirects through
 * security-check.regionh.dk) that plain HTTP clients can't pass, so this
 * uses a real (headless) browser via Playwright. There is no single index
 * page listing every analysis — PDFs are listed per starting letter at
 *   https://www.gentoftehospital.dk/.../metodeblade/Sider/{LETTER}.aspx
 * (e.g. 0-9.aspx, A.aspx, ... Å.aspx), confirmed by manually checking
 * several of these pages against the known pdfUrl values in database.json.
 *
 * Requires Playwright's Chromium browser + system deps to be installed
 * (`npx playwright install --with-deps chromium`) — this does NOT work in
 * the project's regular node:24-slim dev container, which lacks the
 * browser's system libraries. Run it in CI, or locally via the
 * mcr.microsoft.com/playwright Docker image.
 *
 * Usage:
 *   node scripts/scrape-metodeblade.js [output-dir]
 *
 * Writes downloaded/changed PDFs into output-dir (default:
 * scripts/pdf-cache), updates scripts/pdf-manifest.json, and writes
 * output-dir/changed.json listing what changed.
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE = 'https://www.gentoftehospital.dk/afdelinger-og-klinikker/klinisk-biokemisk-afdeling/metodeblade';
const LANDING_URL = `${BASE}/`;
const LETTERS = ['0-9', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ'.split('')];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const manifestPath = path.join(__dirname, 'pdf-manifest.json');
const outDir = process.argv[2] || path.join(__dirname, 'pdf-cache');

function loadManifest() {
  if (!fs.existsSync(manifestPath)) return {};
  return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
}

function saveManifest(manifest) {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = loadManifest();
  const seenUrls = new Set();
  const changed = [];

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ userAgent: UA });

  // Navigating the landing page first passes the bot-defense JS challenge
  // and establishes the session cookies the letter pages / PDF downloads need.
  await page.goto(LANDING_URL, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);

  for (const letter of LETTERS) {
    const url = `${BASE}/Sider/${letter}.aspx`;
    const resp = await page.goto(url, { waitUntil: 'load', timeout: 30000 }).catch(() => null);
    if (!resp || resp.status() >= 400) {
      console.log(`skip ${letter}: ${resp ? `status ${resp.status()}` : 'navigation failed'}`);
      continue;
    }
    await page.waitForTimeout(800);

    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href'))
    );
    const pdfLinks = [...new Set(links.filter(h => h && h.toLowerCase().endsWith('.pdf')))]
      .map(h => new URL(h, url).toString());

    for (const pdfUrl of pdfLinks) {
      seenUrls.add(pdfUrl);
      const res = await page.context().request.get(pdfUrl).catch(() => null);
      if (!res || !res.ok()) {
        console.log(`  ! failed to download ${pdfUrl}`);
        continue;
      }
      const buf = await res.body();
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      const prev = manifest[pdfUrl];
      const isChanged = !prev || prev.sha256 !== hash;

      if (isChanged) {
        const fileName = decodeURIComponent(path.basename(new URL(pdfUrl).pathname));
        fs.writeFileSync(path.join(outDir, fileName), buf);
        changed.push({ url: pdfUrl, file: fileName, letter, status: prev ? 'changed' : 'new' });
      }

      manifest[pdfUrl] = {
        sha256: hash,
        letter,
        lastChecked: new Date().toISOString(),
        lastChanged: isChanged ? new Date().toISOString() : prev.lastChanged
      };
    }
    console.log(`${letter}: ${pdfLinks.length} PDFs`);
  }

  await browser.close();
  saveManifest(manifest);

  fs.writeFileSync(path.join(outDir, 'changed.json'), JSON.stringify(changed, null, 2) + '\n');

  console.log(`\nTotal known PDFs: ${seenUrls.size}`);
  console.log(`New/changed: ${changed.length}`);
  changed.forEach(c => console.log(`  [${c.status}] ${c.letter}/${c.file}`));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
