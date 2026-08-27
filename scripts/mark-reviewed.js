#!/usr/bin/env node
/**
 * Clears dataQualityFlags from a database.json entry once a human has
 * verified it against the source PDF (see pdf-diff.js's applyToEntry,
 * which is what sets these flags in the first place).
 *
 * Usage:
 *   node scripts/mark-reviewed.js <npu-or-slug>
 *   node scripts/mark-reviewed.js NPU12564
 *   node scripts/mark-reviewed.js sjoegren-syndrom-ssa-igg-p-npu12564
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { serializeDatabase } from './lib/database-format.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'src', 'data', 'kba.json');

const identifier = process.argv[2];
if (!identifier) {
  console.error('Usage: node scripts/mark-reviewed.js <npu-or-slug>');
  process.exit(1);
}

const database = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
const entry = database.find(
  item => item.slug === identifier || item.npu.toLowerCase() === identifier.toLowerCase()
);

if (!entry) {
  console.error(`No entry found matching "${identifier}" (checked slug and npu).`);
  process.exit(1);
}

if (!entry.dataQualityFlags || entry.dataQualityFlags.length === 0) {
  console.log(`"${entry.name}" (${entry.npu}) has no dataQualityFlags to clear.`);
  process.exit(0);
}

console.log(`Clearing ${entry.dataQualityFlags.length} flag(s) from "${entry.name}" (${entry.npu}):`);
entry.dataQualityFlags.forEach(f => console.log(`  - ${f}`));
delete entry.dataQualityFlags;

fs.writeFileSync(dbPath, serializeDatabase(database) + '\n');
console.log(`\n✎ Written to ${dbPath}`);
