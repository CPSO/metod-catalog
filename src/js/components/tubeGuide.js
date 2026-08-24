// Tube Reference Guide Modal Component
import { TUBE_DEFINITIONS } from '../utils/tubeBadge.js';

export function renderTubeGuideModal(container, { onClose }) {
  const tubesList = [
    { key: 'green', name: 'Grøn prop (Lithium-Heparin)', ring: 'Sort ring (eller hvid for børneglas)', use: 'Generel rutinekemi: Elektrolytter, enzymer (ALAT, BASP, Amylase), proteiner (Albumin), lipider og levertal.' },
    { key: 'red', name: 'Rød prop (Serum med clot activator)', ring: 'Sort ring', use: 'Serumanalyser: Specifikke proteiner, immunologi, hormoner, infektionstal og lægemiddelmonitorering.' },
    { key: 'purple', name: 'Lilla prop (K2/K3-EDTA)', ring: 'Sort ring', use: 'Hæmatologi & Specialanalyser: Hæmoglobin, leukocytter, trombocytter, differentialtælling, HbA1c, DNA-analyser og Ammoniak (på isvand).' },
    { key: 'lightblue', name: 'Lyseblå prop (3,2% Natriumcitrat)', ring: 'Sort ring', use: 'Koagulationsanalyser: INR, APTT, D-dimer, Fibrinogen, Antithrombin. Kræver præcis fyldning til indikatorstreg.' },
    { key: 'grey', name: 'Grå prop (Fluorid-Oxalat)', ring: 'Sort ring', use: 'Kulhydratmetabolisme: Glukose- og laktatmålinger med hurtig hæmning af in vitro glykolyse.' }
  ];

  container.innerHTML = `
    <div class="modal-backdrop open" id="tube-guide-backdrop">
      <div class="modal-container" style="max-width: 700px;" role="dialog">
        <div class="modal-header">
          <div class="modal-header-top">
            <h3 style="font-size: 1.3rem;">Prøverør & Farvekoder (Region H)</h3>
            <button id="tube-guide-close-btn" class="btn btn-ghost">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <p style="font-size: 0.875rem; color: var(--text-secondary); margin-top: 0.25rem;">
            Oversigt over de mest anvendte Vacuette® glas på Herlev og Gentofte Hospital.
          </p>
        </div>

        <div class="modal-body" style="padding: 1.5rem;">
          ${tubesList.map(t => {
            const def = TUBE_DEFINITIONS[t.key] || TUBE_DEFINITIONS.grey;
            return `
              <div class="tube-card-item">
                <div class="tube-visual" style="background: ${def.bg}; border: 2px solid ${def.color};">
                  <span class="tube-dot ${t.key}" style="width: 14px; height: 14px;"></span>
                </div>
                <div style="flex: 1;">
                  <h4 style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.2rem;">
                    ${t.name}
                  </h4>
                  <div style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 0.35rem;">
                    Ringtype: <strong>${t.ring}</strong>
                  </div>
                  <p style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.4;">
                    ${t.use}
                  </p>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;

  const backdrop = document.getElementById('tube-guide-backdrop');
  document.getElementById('tube-guide-close-btn')?.addEventListener('click', onClose);
  backdrop?.addEventListener('click', (e) => {
    if (e.target === backdrop) onClose();
  });
}
