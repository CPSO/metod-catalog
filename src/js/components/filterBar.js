// Faceted Filter Bar Component

export function renderFilterBar(container, { sections, activeSection, activeTubeColor, accreditedOnly, onFilterChange, onResetFilters }) {
  const hasActiveFilters = activeSection !== 'ALL' || activeTubeColor !== 'ALL' || accreditedOnly;

  container.innerHTML = `
    <div class="filter-bar">
      <div class="filter-group-left">
        <!-- Analysesektion -->
        <select id="section-filter" class="filter-select" aria-label="Filtrer efter sektion">
          <option value="ALL" ${activeSection === 'ALL' ? 'selected' : ''}>Alle Sektioner</option>
          ${sections.map(s => `<option value="${s}" ${activeSection === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>

        <!-- Prøverør farve -->
        <select id="tube-filter" class="filter-select" aria-label="Filtrer efter prøverør">
          <option value="ALL" ${activeTubeColor === 'ALL' ? 'selected' : ''}>Alle Prøverør</option>
          <option value="green" ${activeTubeColor === 'green' ? 'selected' : ''}>🟢 Grøn prop (Lithium-Heparin)</option>
          <option value="red" ${activeTubeColor === 'red' ? 'selected' : ''}>🔴 Rød prop (Serum)</option>
          <option value="purple" ${activeTubeColor === 'purple' ? 'selected' : ''}>🟣 Lilla prop (EDTA)</option>
          <option value="lightblue" ${activeTubeColor === 'lightblue' ? 'selected' : ''}>🔵 Lyseblå prop (Citrat)</option>
        </select>

        <!-- Akkrediteret Toggle -->
        <button id="accredited-toggle" class="filter-pill ${accreditedOnly ? 'active' : ''}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <span>Kun DANAK akkrediterede</span>
        </button>
      </div>

      <div class="filter-group-right">
        ${hasActiveFilters ? `
          <button id="reset-filters-btn" class="btn btn-ghost btn-sm" style="color: var(--color-danger);">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
            <span>Nulstil filtre</span>
          </button>
        ` : ''}
      </div>
    </div>
  `;

  // Bind Events
  document.getElementById('section-filter')?.addEventListener('change', (e) => {
    onFilterChange({ section: e.target.value });
  });

  document.getElementById('tube-filter')?.addEventListener('change', (e) => {
    onFilterChange({ tubeColor: e.target.value });
  });

  document.getElementById('accredited-toggle')?.addEventListener('click', () => {
    onFilterChange({ accreditedOnly: !accreditedOnly });
  });

  document.getElementById('reset-filters-btn')?.addEventListener('click', onResetFilters);
}
