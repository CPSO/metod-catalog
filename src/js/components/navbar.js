// Navigation & Header Component

export function renderNavbar(container, { onOpenTubeGuide, onOpenImporter, onToggleTheme, currentTheme, totalCount }) {
  container.innerHTML = `
    <header class="app-header">
      <div class="container nav-container">
        <a href="#" class="brand-section">
          <div class="brand-logo">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
              <path d="M12 5v14"/>
            </svg>
          </div>
          <div class="brand-text">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <h1>Metodeblade</h1>
              <span class="brand-title-secondary">Klinisk forsknings Enhed</span>
            </div>
            <div class="brand-subtitle">
              <span>Klinisk Biokemisk Afdeling Herlev & Gentofte</span>
              <span>•</span>
              <span class="mono">${totalCount} analyser i databasen</span>
            </div>
          </div>
        </a>

        <div class="header-actions">
          <button id="tube-guide-btn" class="btn btn-secondary btn-sm" title="Se oversigt over prøverør og farvekoder">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14.5 2v17.5c0 1.4-1.1 2.5-2.5 2.5s-2.5-1.1-2.5-2.5V2"/>
              <path d="M8.5 2h7"/>
              <path d="M14.5 16h-5"/>
            </svg>
            <span>Rørguide</span>
          </button>

          <button id="importer-btn" class="btn btn-secondary btn-sm" title="Importer nye metodeblade fra PDF/tekst">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span>Tilføj / Import</span>
          </button>

          <button id="theme-toggle-btn" class="btn btn-ghost" title="Skift lys/mørk tilstand">
            ${currentTheme === 'dark' 
              ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`
              : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`
            }
          </button>
        </div>
      </div>
    </header>
  `;

  document.getElementById('tube-guide-btn')?.addEventListener('click', onOpenTubeGuide);
  document.getElementById('importer-btn')?.addEventListener('click', onOpenImporter);
  document.getElementById('theme-toggle-btn')?.addEventListener('click', onToggleTheme);
}
