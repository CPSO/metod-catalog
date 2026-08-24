#!/usr/bin/env node

/**
 * CLI Helper: Convert raw PDF text / OCR output into database JSON entries
 * 
 * Usage:
 *   node scripts/parse-pdf.js input.txt
 *   node scripts/parse-pdf.js input.txt >> src/data/database.json
 */

import fs from 'fs';
import path from 'path';

function parseText(rawText) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

  // Extract NPU
  let npu = 'NPU00000';
  const npuMatch = rawText.match(/(NPU\d{5})/i);
  if (npuMatch) npu = npuMatch[1].toUpperCase();

  // Extract Name
  let name = 'Ukendt Analyse';
  const nameMatch = rawText.match(/([A-Za-zÆØÅæøå0-9\s,\-\(\)\[\];]+);P/i);
  if (nameMatch) {
    name = `${nameMatch[1].trim()};P`;
  } else if (lines.length > 2) {
    name = lines[2];
  }

  const letter = name[0].toUpperCase();

  // LABKA code
  let labka = name.substring(0, 4).toUpperCase();
  const labkaMatch = rawText.match(/Analysenavn og kode i LABKA\s+([A-Za-z0-9\-]+)/i);
  if (labkaMatch) labka = labkaMatch[1];

  // Unit
  let unit = 'g/L';
  const unitMatch = rawText.match(/Enhed\s+([a-zA-Z0-9\/µ\^]+)/i);
  if (unitMatch) unit = unitMatch[1];

  // Tube color
  let tubeColor = 'green';
  let tubeColorName = 'Grøn prop (Lithium-Heparin)';
  if (/rød prop/i.test(rawText)) {
    tubeColor = 'red';
    tubeColorName = 'Rød prop (Serum)';
  } else if (/lilla prop|EDTA/i.test(rawText)) {
    tubeColor = 'purple';
    tubeColorName = 'Lilla prop (EDTA)';
  } else if (/lyseblå|citrat/i.test(rawText)) {
    tubeColor = 'lightblue';
    tubeColorName = 'Lyseblå prop (Citrat)';
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') + `-${npu.toLowerCase()}`;

  return {
    id: `M-${Date.now().toString().slice(-4)}`,
    documentNumber: `M-${labka}`,
    slug,
    name,
    letter,
    npu,
    labka,
    labkaFullName: `P-${name} ${labka}`,
    spCode: `${name} ${npu}`,
    webreqCode: `${name} ${npu}`,
    unit,
    section: 'KEMI',
    hospital: 'Herlev og Gentofte Hospital',
    department: 'Klinisk Biokemisk Afdeling',
    accreditation: 'DANAK EXAM Reg.nr. 1001',
    author: 'Importeret',
    inUseDate: new Date().toLocaleDateString('da-DK'),
    revisionDate: '12-2027',
    replaces: '-',
    indication: {
      summary: 'Klinisk indikation udledt af analysemetodeblad.',
      elevated: ['Forhøjede værdier'],
      decreased: ['Nedsatte værdier']
    },
    sample: {
      material: 'Plasma/serum',
      tube: `Vacuette® glas med ${tubeColorName}`,
      tubeColor,
      tubeColorName,
      ringColor: 'sort',
      minVolume: 'Et fyldt glas',
      specialConditions: 'Ingen særlige.'
    },
    referenceIntervals: [
      { group: 'Alle', age: 'Alle aldre', range: 'Se vejledning', unit }
    ],
    alarmLimits: 'Ingen.',
    logistics: {
      laboratory: 'Herlev og Gentofte Hospital, Klinisk Biokemisk Afdeling',
      frequency: 'Døgnet rundt alle ugens dage.',
      turnaroundTime: 'Svartid for 90% af analyserne er maksimalt 60 minutter.',
      handling: {
        internal: 'Ingen særlige forholdsregler.',
        external: 'Ingen særlige forholdsregler.',
        practice: 'Opbevares i klimaskab indtil afhentning.'
      },
      stability: {
        wholeBlood: '24 timer v. 21°C',
        pipetted: '7 døgn v. 2–8°C'
      },
      transport: {
        internal: 'Intern transport',
        external: 'Region H transportordning',
        practice: 'Region H transportordning ved 21 °C'
      },
      preanalyticalErrors: 'Ingen særlige.'
    },
    method: {
      ceMarked: true,
      accredited: true,
      traceability: 'International referencemetode',
      principle: 'Fotometri / Kemi',
      instrument: 'Siemens Atellica CH 930',
      calibrator: 'Atellica Calibrator',
      reagent: 'Atellica Reagens',
      externalQC: 'LABQUALITY',
      precisionControls: [],
      clinicalDifference: 'Ikke oplyst',
      measuringRange: { standard: 'Standard analyseområde' },
      interference: {
        hemoglobin: 'Se indlægsseddel',
        bilirubin: 'Se indlægsseddel',
        lipemia: 'Se indlægsseddel'
      },
      comments: ''
    },
    history: []
  };
}

const fileArg = process.argv[2];
if (fileArg) {
  const content = fs.readFileSync(fileArg, 'utf-8');
  const result = parseText(content);
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('Angiv venligst en tekstfil: node scripts/parse-pdf.js fil.txt');
}
