// Catalog Grid & Card Rendering Component
import { renderTubeBadge } from '../utils/tubeBadge.js';
import { copyToClipboard } from '../utils/export.js';

export function renderCatalogGrid(container, items, { onSelectCard, onResetSearch }) {
  if (!items || items.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </div>
        <h3>Ingen analyser fundet</h3>
        <p>Vi fandt ingen metodeblade der matcher dine søgekriterier eller filtre. Prøv at søge efter NPU-kode, forkortelse eller klinisk indikation.</p>
        <button id="empty-reset-btn" class="btn btn-primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
          <span>Vis alle analyser</span>
        </button>
      </div>
    `;
    document.getElementById('empty-reset-btn')?.addEventListener('click', onResetSearch);
    return;
  }

  const cardsHtml = items.map(item => {
    const tubeHtml = renderTubeBadge(item.sample?.tubeColor, item.sample?.tubeColorName || item.sample?.tube);

    return `
      <article class="catalog-card" data-slug="${item.slug}" tabindex="0" role="button" aria-label="Se metodeblad for ${item.name}">
        <div>
          <div class="card-top">
            <div class="codes-group">
              <span class="badge-npu mono" title="NPU Kode: ${item.npu}">${item.npu}</span>
              <span class="badge-labka mono" title="LABKA Kode: ${item.labka}">${item.labka}</span>
              <span class="badge-doc">${item.documentNumber || item.id}</span>
            </div>
            <div>
              ${tubeHtml}
            </div>
          </div>

          <h3 class="card-title">${item.name}</h3>
          <div class="card-unit mono">Enhed: ${item.unit}</div>

          <p class="card-indication">
            ${item.indication?.summary || 'Ingen indikationstekst tilgængelig.'}
          </p>

          <div class="card-quick-meta">
            <div class="meta-row">
              <span class="meta-label">Prøvemateriale:</span>
              <span class="meta-value">${item.sample?.material || 'Plasma/serum'}</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">Svartid:</span>
              <span class="meta-value" style="font-size: 0.75rem;">${item.logistics?.turnaroundTime?.split('.')[0] || 'Inden for 60 min.'}</span>
            </div>
          </div>
        </div>

        <div class="card-footer">
          <span class="section-tag">${item.section || 'KEMI'}</span>
          <span class="card-action-btn">
            <span>Åbn metodeblad</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </span>
        </div>
      </article>
    `;
  }).join('');

  container.innerHTML = `
    <div class="catalog-grid">
      ${cardsHtml}
    </div>
  `;

  // Attach card click handlers
  container.querySelectorAll('.catalog-card').forEach(card => {
    const slug = card.getAttribute('data-slug');
    const item = items.find(i => i.slug === slug);
    if (item) {
      card.addEventListener('click', () => onSelectCard(item));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectCard(item);
        }
      });
    }
  });
}
