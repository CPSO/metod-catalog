// Alphabetical Letter Navigation Bar (A-Z + Æ Ø Å)

export function renderLetterBar(container, { activeLetter, letterCounts, onSelectLetter, totalResults }) {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'Æ', 'Ø', 'Å'];

  const buttonsHtml = letters.map(letter => {
    const count = letterCounts[letter] || 0;
    const isActive = activeLetter === letter;
    const hasItems = count > 0;
    const disabledClass = !hasItems ? 'disabled' : '';
    const activeClass = isActive ? 'active' : '';
    const itemsClass = hasItems ? 'has-items' : '';

    return `
      <button 
        class="letter-btn ${activeClass} ${itemsClass} ${disabledClass}" 
        data-letter="${letter}"
        title="${letter}: ${count} ${count === 1 ? 'analyse' : 'analyser'}"
        ${!hasItems ? 'disabled' : ''}
      >
        <span>${letter}</span>
      </button>
    `;
  }).join('');

  container.innerHTML = `
    <div class="letter-bar-container">
      <div class="container letter-bar-inner">
        <div class="letter-buttons-track">
          <button 
            class="letter-btn all-btn ${activeLetter === 'ALL' ? 'active' : ''}" 
            data-letter="ALL"
            title="Vis alle analyser"
          >
            <span>Alle</span>
          </button>
          ${buttonsHtml}
        </div>
        <div class="stats-counter">
          <span>${totalResults} ${totalResults === 1 ? 'resultat' : 'resultater'}</span>
        </div>
      </div>
    </div>
  `;

  // Attach event listeners
  container.querySelectorAll('.letter-btn:not(.disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      const letter = btn.getAttribute('data-letter');
      if (letter) {
        onSelectLetter(letter);
      }
    });
  });
}
