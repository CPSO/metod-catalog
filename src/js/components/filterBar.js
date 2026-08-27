// Faceted Filter Bar Component with Alphabet Navigation
const DANISH_ALPHABET = [
  '0-9', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'Æ', 'Ø', 'Å'
];

export function renderFilterBar(container, {
  filters = { letter: true, section: true, tubeColor: true, accredited: true, adult: true },
  sections,
  availableLetters = new Set(),
  activeLetter = 'ALL',
  activeSection,
  activeTubeColor,
  accreditedOnly,
  adultOnly,
  onFilterChange,
  onResetFilters
}) {
  const hasActiveFilters =
    (filters.letter && activeLetter !== 'ALL') ||
    (filters.section && activeSection !== 'ALL') ||
    (filters.tubeColor && activeTubeColor !== 'ALL') ||
    (filters.accredited && accreditedOnly) ||
    (filters.adult && !adultOnly);

  container.innerHTML = `
    <div class="filter-wrapper">
      ${filters.letter ? `
      <!-- 1-9 / A-Å Alphabet Letter Filter -->
      <div class="alphabet-bar-container" aria-label="Filtrer analyser efter forbogstav">
        <div class="alphabet-bar">
          <button class="alphabet-btn ${activeLetter === 'ALL' ? 'active' : ''}" data-letter="ALL" title="Vis alle forbogstaver">
            Alle
          </button>
          <div class="alphabet-divider"></div>
          ${DANISH_ALPHABET.map(char => {
            const isAvailable = availableLetters.has(char);
            const isActive = activeLetter === char;
            return `
              <button class="alphabet-btn ${isActive ? 'active' : ''} ${!isAvailable ? 'disabled' : ''}"
                      data-letter="${char}"
                      ${!isAvailable ? 'disabled title="Ingen analyser med ' + char + '"' : 'title="Filtrer analyser startende med ' + char + '"'}>
                ${char}
              </button>
            `;
          }).join('')}
        </div>
      </div>
      ` : ''}

      <!-- Faceted Controls Bar -->
      <div class="filter-bar">
        <div class="filter-group-left">
          ${filters.adult ? `
          <!-- Kun voksne (18+) Toggle -->
          <button id="adult-toggle" class="filter-pill ${adultOnly ? 'active' : ''}" title="Skjul referenceintervaller for børn (alder under 18 år)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="8" r="4"/>
              <path d="M4 21v-1a8 8 0 0 1 16 0v1"/>
            </svg>
            <span>Kun voksne (18+)</span>
          </button>
          ` : ''}

          ${filters.section ? `
          <!-- Analysesektion -->
          <select id="section-filter" class="filter-select" aria-label="Filtrer efter sektion">
            <option value="ALL" ${activeSection === 'ALL' ? 'selected' : ''}>Alle Sektioner</option>
            ${sections.map(s => `<option value="${s}" ${activeSection === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
          ` : ''}

          ${filters.tubeColor ? `
          <!-- Prøverør farve -->
          <select id="tube-filter" class="filter-select" aria-label="Filtrer efter prøverør">
            <option value="ALL" ${activeTubeColor === 'ALL' ? 'selected' : ''}>Alle Prøverør</option>
            <option value="green" ${activeTubeColor === 'green' ? 'selected' : ''}>🟢 Grøn prop (Lithium-Heparin)</option>
            <option value="red" ${activeTubeColor === 'red' ? 'selected' : ''}>🔴 Rød prop (Serum)</option>
            <option value="purple" ${activeTubeColor === 'purple' ? 'selected' : ''}>🟣 Lilla prop (EDTA)</option>
            <option value="lightblue" ${activeTubeColor === 'lightblue' ? 'selected' : ''}>🔵 Lyseblå prop (Citrat)</option>
          </select>
          ` : ''}

          ${filters.accredited ? `
          <!-- Akkrediteret Toggle -->
          <button id="accredited-toggle" class="filter-pill ${accreditedOnly ? 'active' : ''}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            <span>Kun DANAK akkrediterede</span>
          </button>
          ` : ''}
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
    </div>
  `;

  // Bind Alphabet Buttons
  container.querySelectorAll('.alphabet-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const selectedLetter = btn.getAttribute('data-letter');
      if (!selectedLetter) return;
      onFilterChange({
        letter: selectedLetter === activeLetter ? 'ALL' : selectedLetter
      });
    });
  });

  // Bind Faceted Filter Events
  document.getElementById('section-filter')?.addEventListener('change', (e) => {
    onFilterChange({ section: e.target.value });
  });

  document.getElementById('tube-filter')?.addEventListener('change', (e) => {
    onFilterChange({ tubeColor: e.target.value });
  });

  document.getElementById('accredited-toggle')?.addEventListener('click', () => {
    onFilterChange({ accreditedOnly: !accreditedOnly });
  });

  document.getElementById('adult-toggle')?.addEventListener('click', () => {
    onFilterChange({ adultOnly: !adultOnly });
  });

  document.getElementById('reset-filters-btn')?.addEventListener('click', onResetFilters);
}
