// In-App Data & PDF Text Importer Component
import { showToast, downloadJson } from '../utils/export.js';

export function renderImporterModal(container, { onImportData, currentDatabase, onClose }) {
  container.innerHTML = `
    <div class="modal-backdrop open" id="importer-backdrop">
      <div class="modal-container" style="max-width: 860px;" role="dialog">
        
        <div class="modal-header">
          <div class="modal-header-top">
            <div>
              <h3 style="font-size: 1.35rem; font-weight: 800;">Data Importer & PDF Parser</h3>
              <p style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.2rem;">
                Indsæt PDF-tekst/OCR fra andre sider (fx bogstav B, C, D...) for at udtrække data automatisk, eller indsæt JSON direkte.
              </p>
            </div>
            <button id="importer-close-btn" class="btn btn-ghost">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="modal-body" style="padding: 1.5rem;">
          
          <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
            <button id="mode-text-btn" class="btn btn-primary btn-sm">Fra PDF / OCR Tekst</button>
            <button id="mode-json-btn" class="btn btn-secondary btn-sm">Fra Rå JSON</button>
            <div style="margin-left: auto;">
              <button id="export-current-db-btn" class="btn btn-secondary btn-sm">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                <span>Download Database (${currentDatabase.length})</span>
              </button>
            </div>
          </div>

          <div id="text-mode-section">
            <label style="display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.4rem;">
              Indsæt kopieret tekst fra et nyt metodeblad (PDF):
            </label>
            <textarea id="pdf-raw-input" class="importer-textarea" placeholder="Indsæt teksten fra PDF her... (fx Herlev og Gentofte Hospital Klinisk Biokemisk Afdeling ...)"></textarea>
            
            <div style="display: flex; justify-content: flex-end; margin-top: 0.75rem;">
              <button id="parse-text-btn" class="btn btn-primary">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m5 12 7-7 7 7"/>
                  <path d="M12 19V5"/>
                </svg>
                <span>Analyser & Generer Metodeblad</span>
              </button>
            </div>
          </div>

          <!-- Preview & Result Section -->
          <div id="preview-section" style="display: none; margin-top: 1.5rem; border-top: 1px solid var(--border-color); padding-top: 1.25rem;">
            <h4 style="font-size: 1rem; margin-bottom: 0.5rem;">Resultat forhåndsvisning:</h4>
            <pre id="json-preview" style="background: var(--bg-surface-subtle); padding: 1rem; border-radius: var(--radius-md); max-height: 200px; overflow-y: auto; font-size: 0.8rem; border: 1px solid var(--border-color);" class="mono"></pre>
            
            <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem;">
              <button id="add-to-db-btn" class="btn btn-primary">
                <span>➕ Føj analyse til databasen</span>
              </button>
            </div>
          </div>

        </div>

      </div>
    </div>
  `;

  const backdrop = document.getElementById('importer-backdrop');
  document.getElementById('importer-close-btn')?.addEventListener('click', onClose);
  backdrop?.addEventListener('click', (e) => {
    if (e.target === backdrop) onClose();
  });

  document.getElementById('export-current-db-btn')?.addEventListener('click', () => {
    downloadJson(currentDatabase, 'metodeblade-database.json');
  });

  let parsedEntry = null;

  // Simple In-Browser Text Parser
  document.getElementById('parse-text-btn')?.addEventListener('click', () => {
    const rawText = document.getElementById('pdf-raw-input')?.value || '';
    if (!rawText.trim()) {
      showToast('Indsæt venligst noget tekst først!');
      return;
    }

    try {
      parsedEntry = parseMetodebladText(rawText);
      const previewEl = document.getElementById('json-preview');
      const previewSec = document.getElementById('preview-section');
      if (previewEl && previewSec) {
        previewEl.textContent = JSON.stringify(parsedEntry, null, 2);
        previewSec.style.display = 'block';
        showToast('Metodeblad blev analyseret!');
      }
    } catch (e) {
      console.error(e);
      showToast('Kunne ikke fortolke teksten automatisk. Prøv JSON-tilstand.', 'error');
    }
  });

  document.getElementById('add-to-db-btn')?.addEventListener('click', () => {
    if (parsedEntry) {
      onImportData(parsedEntry);
      showToast(`'${parsedEntry.name}' er tilføjet til databasen!`);
      onClose();
    }
  });
}

// Basic parser logic for standard Danish KBA format
function parseMetodebladText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Extract NPU & Name
  let name = 'Ukendt Analyse';
  let npu = 'NPU00000';
  let letter = 'A';

  const npuMatch = text.match(/(NPU\d{5})/i);
  if (npuMatch) {
    npu = npuMatch[1].toUpperCase();
  }

  const nameMatch = text.match(/([A-Za-zÆØÅæøå0-9\s,\-\(\)\[\];]+);P/i);
  if (nameMatch) {
    name = `${nameMatch[1].trim()};P`;
    letter = name[0].toUpperCase();
  } else if (lines.length > 3) {
    name = lines[2] || lines[3];
    letter = name[0].toUpperCase();
  }

  // Extract Section
  let section = 'KEMI';
  if (/HÆMATOLOGI/i.test(text)) section = 'HÆMATOLOGI';
  if (/KOAGULATION/i.test(text)) section = 'KOAGULATION';
  if (/IMMUNOLOGI/i.test(text)) section = 'IMMUNOLOGI';

  // Extract Unit
  let unit = 'g/L';
  const unitMatch = text.match(/Enhed\s+([a-zA-Z0-9\/µ\^]+)/i);
  if (unitMatch) unit = unitMatch[1];

  // Extract LABKA
  let labka = name.substring(0, 4).toUpperCase();
  const labkaMatch = text.match(/Analysenavn og kode i LABKA\s+([A-Za-z0-9\-]+)/i);
  if (labkaMatch) labka = labkaMatch[1];

  // Tube color
  let tubeColor = 'green';
  let tubeColorName = 'Grøn prop (Lithium-Heparin)';
  if (/rød prop/i.test(text)) {
    tubeColor = 'red';
    tubeColorName = 'Rød prop (Serum)';
  } else if (/lilla prop|EDTA/i.test(text)) {
    tubeColor = 'purple';
    tubeColorName = 'Lilla prop (EDTA)';
  } else if (/lyseblå|citrat/i.test(text)) {
    tubeColor = 'lightblue';
    tubeColorName = 'Lyseblå prop (Citrat)';
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') + `-${npu.toLowerCase()}`;

  return {
    id: `M-AUTO-${Date.now().toString().slice(-4)}`,
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
    section,
    hospital: 'Herlev og Gentofte Hospital',
    department: 'Klinisk Biokemisk Afdeling',
    accreditation: 'DANAK EXAM Reg.nr. 1001',
    author: 'Importeret via tekst',
    inUseDate: new Date().toLocaleDateString('da-DK'),
    revisionDate: '12-2027',
    replaces: '-',
    indication: {
      summary: 'Klinisk indikation udledt af importeret metodeblad.',
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
      specialConditions: 'Følg afdelingens prøvetagningsvejledning.'
    },
    referenceIntervals: [
      { target: 'Alle', age: 'Alle aldre', range: 'Se referenceblad', unit }
    ],
    referenceNote: '',
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
      principle: 'Fotometrisk eller immunologisk måling',
      instrument: 'Siemens Atellica CH 930',
      calibrator: 'Atellica Calibrator',
      reagent: 'Atellica Reagens',
      externalQC: 'LABQUALITY',
      precisionControls: [],
      clinicalDifference: 'Ikke oplyst',
      measuringRange: { standard: 'Standard analysemåleområde' },
      interference: {
        hemoglobin: 'Se indlægsseddel',
        bilirubin: 'Se indlægsseddel',
        lipemia: 'Se indlægsseddel'
      },
      comments: ''
    },
    history: [
      {
        date: new Date().toLocaleDateString('da-DK'),
        action: 'Importeret til kataloget',
        initials: 'IMPORT'
      }
    ]
  };
}
