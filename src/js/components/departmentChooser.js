// Landing view — pick a department before entering its catalog. The header
// dropdown then handles quick switching once you're inside.

export function renderDepartmentChooser(container, { departments = [], activeDepartment, onSelect }) {
  container.innerHTML = `
    <div class="department-chooser">
      <div class="department-chooser-head">
        <h2>Vælg afdeling</h2>
        <p>Vælg hvilket metodebladskatalog du vil åbne. Du kan skifte afdeling når som helst i toppen.</p>
      </div>
      <div class="department-chooser-grid">
        ${departments.map(d => {
          const count = Array.isArray(d.dataset) ? d.dataset.length : 0;
          const isCurrent = d.id === activeDepartment;
          return `
            <button class="department-card ${isCurrent ? 'is-current' : ''} ${count === 0 ? 'is-empty' : ''}"
                    data-dept="${d.id}"
                    aria-label="Åbn ${d.label}">
              <span class="department-card-id">${d.id}</span>
              <span class="department-card-label">${d.label}</span>
              <span class="department-card-site">${d.site || ''}</span>
              <span class="department-card-count">
                ${count === 0 ? 'Ingen data endnu' : `${count} analyser`}
              </span>
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `;

  container.querySelectorAll('.department-card').forEach(btn => {
    btn.addEventListener('click', () => onSelect?.(btn.getAttribute('data-dept')));
  });
}
