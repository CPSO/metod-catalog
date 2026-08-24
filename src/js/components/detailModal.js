// Comprehensive Detail Modal Component
import { renderTubeBadge } from '../utils/tubeBadge.js';
import { copyToClipboard, downloadJson, showToast } from '../utils/export.js';

export function renderDetailModal(container, item, { onClose }) {
  if (!item) {
    container.innerHTML = '';
    return;
  }

  const tubeBadgeHtml = renderTubeBadge(item.sample?.tubeColor, item.sample?.tubeColorName || item.sample?.tube);

  container.innerHTML = `
    <div class="modal-backdrop open" id="detail-modal-backdrop">
      <div class="modal-container" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        
        <!-- Header -->
        <div class="modal-header">
          <div class="modal-header-top">
            <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
              <span class="danak-accreditation">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
                <span>${item.accreditation || 'DANAK EXAM Reg.nr. 1001'}</span>
              </span>
              <span class="mono" style="font-size: 0.8rem; color: var(--text-muted); font-weight: 600;">
                Dokument: ${item.documentNumber || item.id}
              </span>
              <span style="font-size: 0.8rem; color: var(--text-muted);">
                Sektion: <strong>${item.section}</strong>
              </span>
            </div>

            <div class="modal-actions">
              <button id="modal-print-btn" class="btn btn-secondary btn-sm" title="Udskriv metodeblad">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="6 9 6 2 18 2 18 9"/>
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                  <rect x="6" y="14" width="12" height="8"/>
                </svg>
                <span>Print</span>
              </button>

              <button id="modal-share-btn" class="btn btn-secondary btn-sm" title="Kopier direkte link">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
                <span>Del link</span>
              </button>

              <button id="modal-close-btn" class="btn btn-ghost" title="Luk (Esc)">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>

          <div class="modal-title-row">
            <div>
              <h2 class="modal-title" id="modal-title">${item.name}</h2>
              <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.25rem;">
                <span class="mono" style="font-size: 0.95rem; font-weight: 700; color: var(--color-accent);">${item.npu}</span>
                <span style="color: var(--text-muted); font-size: 0.85rem;">•</span>
                <span class="mono" style="font-size: 0.9rem; font-weight: 600; color: var(--text-secondary);">${item.labkaFullName || item.labka}</span>
                <span style="color: var(--text-muted); font-size: 0.85rem;">•</span>
                <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-muted);">Enhed: ${item.unit}</span>
              </div>
            </div>
            <div>
              ${tubeBadgeHtml}
            </div>
          </div>
        </div>

        <!-- Tab Bar -->
        <div class="modal-tabs">
          <button class="modal-tab-btn active" data-tab="tab-overview">Oversigt & Indikation</button>
          <button class="modal-tab-btn" data-tab="tab-sample">Prøvetagning & Rør</button>
          <button class="modal-tab-btn" data-tab="tab-intervals">Referenceintervaller</button>
          <button class="modal-tab-btn" data-tab="tab-method">Metode & Apparatur</button>
          <button class="modal-tab-btn" data-tab="tab-qc">Kvalitetskontrol & Logistik</button>
        </div>

        <!-- Body -->
        <div class="modal-body">
          
          <!-- TAB 1: OVERVIEW & INDIKATION -->
          <div class="tab-pane active" id="tab-overview">
            <div class="detail-section">
              <h3 class="detail-section-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                Indikation og resultatvurdering
              </h3>
              <p style="font-size: 0.95rem; color: var(--text-secondary); line-height: 1.6; margin-bottom: 1.25rem;">
                ${item.indication?.summary || 'Ingen indikationstekst fundet.'}
              </p>

              <div class="detail-grid-2">
                <div class="detail-card" style="border-left: 4px solid var(--color-danger);">
                  <h4>Forhøjede værdier kan ses ved:</h4>
                  <ul class="bullet-list elevated">
                    ${(item.indication?.elevated || ['Ingen specifikke forhøjede tilstande angivet.']).map(e => `<li>${e}</li>`).join('')}
                  </ul>
                </div>

                <div class="detail-card" style="border-left: 4px solid #3b82f6;">
                  <h4>Nedsatte værdier kan ses ved:</h4>
                  <ul class="bullet-list decreased">
                    ${(item.indication?.decreased || ['Ingen specifikke nedsatte tilstande angivet.']).map(d => `<li>${d}</li>`).join('')}
                  </ul>
                </div>
              </div>
            </div>

            <!-- Koder -->
            <div class="detail-section">
              <h3 class="detail-section-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
                Analysenavne og Koder i Systemer
              </h3>
              <table class="data-table">
                <thead>
                  <tr>
                    <th>System</th>
                    <th>Analysenavn & Kode</th>
                    <th>Handling</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>Sundhedsplatformen (SP)</strong></td>
                    <td class="mono">${item.spCode || item.name}</td>
                    <td>
                      <button class="btn btn-secondary btn-sm copy-btn" data-copy="${item.spCode || item.name}">Kopier</button>
                    </td>
                  </tr>
                  <tr>
                    <td><strong>LABKA</strong></td>
                    <td class="mono">${item.labkaFullName || item.labka}</td>
                    <td>
                      <button class="btn btn-secondary btn-sm copy-btn" data-copy="${item.labka}">Kopier kode</button>
                    </td>
                  </tr>
                  <tr>
                    <td><strong>WebReq</strong></td>
                    <td class="mono">${item.webreqCode || item.npu}</td>
                    <td>
                      <button class="btn btn-secondary btn-sm copy-btn" data-copy="${item.webreqCode || item.npu}">Kopier</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Dokumentdata -->
            <div class="detail-card" style="margin-top: 1rem; font-size: 0.85rem; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
              <div>Udarbejdet af: <strong>${item.author || '-'}</strong></div>
              <div>Taget i brug: <strong>${item.inUseDate || '-'}</strong></div>
              <div>Revision: <strong>${item.revisionDate || '-'}</strong></div>
              <div>Erstatter: <strong>${item.replaces || '-'}</strong></div>
            </div>
          </div>

          <!-- TAB 2: PRØVETAGNING & RØR -->
          <div class="tab-pane" id="tab-sample">
            <div class="detail-section">
              <h3 class="detail-section-title">Prøvetagning og Rørtype</h3>
              
              <div class="detail-card" style="margin-bottom: 1.25rem;">
                <div style="display: flex; align-items: flex-start; gap: 1rem;">
                  <div style="font-size: 2rem;">🧪</div>
                  <div>
                    <h4 style="font-size: 1.05rem;">Primært Prøverør:</h4>
                    <p style="font-size: 0.95rem; font-weight: 600; color: var(--text-primary); margin-bottom: 0.25rem;">
                      ${item.sample?.tube || 'Vacuette standardglas'}
                    </p>
                    <div style="margin-top: 0.5rem;">
                      ${tubeBadgeHtml}
                    </div>
                  </div>
                </div>
              </div>

              ${item.sample?.alternativeTube ? `
                <div class="detail-card" style="margin-bottom: 1.25rem;">
                  <h4>Alternativt prøverør:</h4>
                  <p style="color: var(--text-secondary); font-size: 0.9rem;">${item.sample.alternativeTube}</p>
                </div>
              ` : ''}

              <div class="detail-grid-2">
                <div class="detail-card">
                  <h4>Mindste prøvemængde</h4>
                  <p style="color: var(--text-secondary); font-size: 0.9rem;">${item.sample?.minVolume || 'Et fyldt glas.'}</p>
                </div>
                <div class="detail-card">
                  <h4>Særlige forhold ved prøvetagning</h4>
                  <p style="color: var(--text-secondary); font-size: 0.9rem;">${item.sample?.specialConditions || 'Ingen særlige forhold.'}</p>
                </div>
              </div>
            </div>

            <div class="detail-section">
              <h3 class="detail-section-title">Holdbarhed & Præanalytik</h3>
              <table class="data-table">
                <tbody>
                  <tr>
                    <td><strong>Holdbarhed i fuldblod</strong></td>
                    <td>${item.logistics?.stability?.wholeBlood || '-'}</td>
                  </tr>
                  <tr>
                    <td><strong>Holdbarhed afpipetteret</strong></td>
                    <td>${item.logistics?.stability?.pipetted || '-'}</td>
                  </tr>
                  <tr>
                    <td><strong>Præanalytiske fejlkilder</strong></td>
                    <td>${item.logistics?.preanalyticalErrors || 'Ingen.'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- TAB 3: REFERENCEINTERVALLER -->
          <div class="tab-pane" id="tab-intervals">
            <div class="detail-section">
              <h3 class="detail-section-title">Interaktiv Referenceinterval Beregner</h3>
              
              <div class="ref-calculator-box">
                <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.5rem;">
                  Vælg patientens køn og alder for at se det gældende referenceinterval:
                </p>
                <div class="ref-calc-inputs">
                  <div class="calc-input-group">
                    <label style="font-size: 0.85rem; font-weight: 600;">Køn:</label>
                    <select id="calc-gender" class="filter-select">
                      <option value="all">Alle / Begge</option>
                      <option value="female">Kvinde</option>
                      <option value="male">Mand</option>
                    </select>
                  </div>
                  <div class="calc-input-group">
                    <label style="font-size: 0.85rem; font-weight: 600;">Alder:</label>
                    <input type="number" id="calc-age" class="filter-select" placeholder="fx 45" style="width: 90px;" min="0" max="120" value="30">
                    <span style="font-size: 0.85rem;">år</span>
                  </div>
                  <div style="margin-left: auto; display: flex; align-items: center; gap: 0.5rem;">
                    <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-muted);">Normalt Interval:</span>
                    <span id="calc-result" class="calc-result-badge">- ${item.unit}</span>
                  </div>
                </div>
              </div>

              <h3 class="detail-section-title" style="margin-top: 1.5rem;">Komplet Referenceinterval Matrix</h3>
              <table class="data-table" id="ref-matrix-table">
                <thead>
                  <tr>
                    <th>Gruppe / Køn</th>
                    <th>Alder</th>
                    <th>Referenceinterval</th>
                    <th>Enhed</th>
                  </tr>
                </thead>
                <tbody>
                  ${(item.referenceIntervals || []).map(r => `
                    <tr>
                      <td><strong>${r.group}</strong></td>
                      <td>${r.age}</td>
                      <td class="mono" style="font-weight: 700; color: var(--color-primary);">${r.range}</td>
                      <td>${r.unit || item.unit}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>

              <div class="detail-card" style="margin-top: 1rem;">
                <h4>Ringegrænser (Akutvarsling)</h4>
                <p style="color: var(--text-secondary); font-size: 0.9rem;">${item.alarmLimits || 'Ingen.'}</p>
              </div>
            </div>
          </div>

          <!-- TAB 4: METODE & APPARATUR -->
          <div class="tab-pane" id="tab-method">
            <div class="detail-section">
              <h3 class="detail-section-title">Analyseprincip & Instrumentering</h3>
              <table class="data-table">
                <tbody>
                  <tr>
                    <td><strong>CE-mærket analyse</strong></td>
                    <td>${item.method?.ceMarked ? '✅ Ja (Apparatur og reagens i kombination)' : 'Nej'}</td>
                  </tr>
                  <tr>
                    <td><strong>Akkrediteret analyse</strong></td>
                    <td>${item.method?.accredited ? '✅ Ja (DANAK)' : 'Nej (KBA HGH)'}</td>
                  </tr>
                  <tr>
                    <td><strong>Metrologisk sporbarhed</strong></td>
                    <td>${item.method?.traceability || '-'}</td>
                  </tr>
                  <tr>
                    <td><strong>Analyseprincip</strong></td>
                    <td>${item.method?.principle || '-'}</td>
                  </tr>
                  <tr>
                    <td><strong>Apparatur</strong></td>
                    <td><strong>${item.method?.instrument || '-'}</strong></td>
                  </tr>
                  <tr>
                    <td><strong>Kalibrator</strong></td>
                    <td>${item.method?.calibrator || '-'}</td>
                  </tr>
                  <tr>
                    <td><strong>Reagens</strong></td>
                    <td>${item.method?.reagent || '-'}</td>
                  </tr>
                  <tr>
                    <td><strong>Standard Måleområde</strong></td>
                    <td class="mono"><strong>${item.method?.measuringRange?.standard || item.method?.measuringRange?.total || '-'}</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Interferens -->
            <div class="detail-section">
              <h3 class="detail-section-title">Interferensgrænser (Hæmolyse, Icterus, Lipæmi)</h3>
              <div class="detail-card">
                <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.75rem;">
                  ${item.method?.interference?.biasNote || 'Der ses ingen væsentlig interferens (<10% bias) ved koncentrationer under følgende grænser:'}
                </p>
                <div class="detail-grid-2">
                  <div>
                    <span style="font-size: 0.85rem; color: var(--text-muted);">Hæmoglobin (Hæmolyse):</span>
                    <div class="mono" style="font-weight: 700;">${item.method?.interference?.hemoglobin || 'Ingen oplyst'}</div>
                  </div>
                  <div>
                    <span style="font-size: 0.85rem; color: var(--text-muted);">Bilirubin (Icterus):</span>
                    <div class="mono" style="font-weight: 700;">${item.method?.interference?.bilirubin || 'Ingen oplyst'}</div>
                  </div>
                  <div>
                    <span style="font-size: 0.85rem; color: var(--text-muted);">Lipæmi (Turbiditet):</span>
                    <div class="mono" style="font-weight: 700;">${item.method?.interference?.lipemia || 'Ingen oplyst'}</div>
                  </div>
                </div>
              </div>

              ${item.method?.comments ? `
                <div class="detail-card" style="margin-top: 1rem; border-left: 4px solid var(--color-cyan);">
                  <h4>Særlige bemærkninger</h4>
                  <p style="font-size: 0.9rem; color: var(--text-secondary);">${item.method.comments}</p>
                </div>
              ` : ''}
            </div>
          </div>

          <!-- TAB 5: KVALITETSKONTROL & LOGISTIK -->
          <div class="tab-pane" id="tab-qc">
            <div class="detail-section">
              <h3 class="detail-section-title">Kvalitetskontrol & Måleusikkerhed</h3>
              <table class="data-table">
                <tbody>
                  <tr>
                    <td><strong>Ekstern kvalitetskontrol</strong></td>
                    <td>${item.method?.externalQC || '-'}</td>
                  </tr>
                  <tr>
                    <td><strong>Mindste kliniske difference (RCV)</strong></td>
                    <td>${item.method?.clinicalDifference || '-'}</td>
                  </tr>
                </tbody>
              </table>

              ${item.method?.precisionControls && item.method.precisionControls.length > 0 ? `
                <h4 style="margin-top: 1.25rem; margin-bottom: 0.5rem; font-size: 0.95rem;">Præcisionskontrolmaterialer</h4>
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Kontrolmateriale</th>
                      <th>Niveau</th>
                      <th>Intermediær CV</th>
                      <th>Måleusikkerhed (95% CI)</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${item.method.precisionControls.map(p => `
                      <tr>
                        <td>${p.name}</td>
                        <td class="mono"><strong>${p.level}</strong></td>
                        <td class="mono">${p.cv}</td>
                        <td class="mono">${p.ci}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              ` : ''}
            </div>

            <div class="detail-section">
              <h3 class="detail-section-title">Logistik og Turnaround</h3>
              <div class="detail-card">
                <p><strong>Udførende laboratorium:</strong> ${item.logistics?.laboratory || 'Herlev og Gentofte Hospital'}</p>
                <p style="margin-top: 0.35rem;"><strong>Analyseringshyppighed:</strong> ${item.logistics?.frequency || 'Døgnet rundt'}</p>
                <p style="margin-top: 0.35rem;"><strong>Svartid:</strong> ${item.logistics?.turnaroundTime || '-'}</p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  `;

  // Attach Event Handlers
  const modal = document.getElementById('detail-modal-backdrop');
  
  // Close buttons
  document.getElementById('modal-close-btn')?.addEventListener('click', onClose);
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) onClose();
  });

  // Tab switching
  container.querySelectorAll('.modal-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.remove('active'));
      container.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      if (tabId) {
        document.getElementById(tabId)?.classList.add('active');
      }
    });
  });

  // Copy Buttons
  container.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.getAttribute('data-copy');
      if (text) copyToClipboard(text, 'Kode kopieret!');
    });
  });

  // Print button
  document.getElementById('modal-print-btn')?.addEventListener('click', () => {
    window.print();
  });

  // Share link button
  document.getElementById('modal-share-btn')?.addEventListener('click', () => {
    const shareUrl = `${window.location.origin}${window.location.pathname}#${item.slug}`;
    copyToClipboard(shareUrl, 'Direkte link til metodeblad kopieret!');
  });

  // Reference Calculator Logic
  const calcAgeInput = document.getElementById('calc-age');
  const calcGenderInput = document.getElementById('calc-gender');
  const calcResult = document.getElementById('calc-result');

  function updateCalculator() {
    const age = parseInt(calcAgeInput?.value, 10) || 0;
    const gender = calcGenderInput?.value || 'all';

    let matched = null;
    const intervals = item.referenceIntervals || [];

    if (intervals.length === 1) {
      matched = intervals[0];
    } else {
      matched = intervals.find(r => {
        const groupLower = r.group.toLowerCase();
        if (gender === 'female' && groupLower.includes('mænd')) return false;
        if (gender === 'male' && groupLower.includes('kvinder')) return false;
        return true;
      }) || intervals[0];
    }

    if (matched && calcResult) {
      calcResult.textContent = `${matched.range} ${matched.unit || item.unit}`;
    }
  }

  calcAgeInput?.addEventListener('input', updateCalculator);
  calcGenderInput?.addEventListener('change', updateCalculator);
  updateCalculator();
}
