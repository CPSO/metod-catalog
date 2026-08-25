// Reference Interval List — Excel-style data table
const COLUMNS = [
  { key: 'name', label: 'Analyse' },
  { key: 'npu', label: 'NPU-kode' },
  { key: 'labkaFullName', label: 'Labka navn' },
  { key: 'range', label: 'Referenceinterval' },
  { key: 'unit', label: 'Enhed' },
  { key: 'revisionDate', label: 'Næste revision' },
  { key: 'laboratory', label: 'Udførende laboratorium' },
  { key: 'age', label: 'Alder' },
  { key: 'group', label: 'Køn' }
];

function parseDanishDate(str) {
  if (!str) return 0;
  const [d, m, y] = str.split('-').map(Number);
  if (!d || !m || !y) return 0;
  return new Date(y, m - 1, d).getTime();
}

function buildRows(items) {
  const rows = [];
  items.forEach(item => {
    const intervals = item.referenceIntervals?.length ? item.referenceIntervals : [{ group: '-', age: '-', range: '-', unit: item.unit }];
    intervals.forEach(interval => {
      rows.push({
        item,
        name: item.name,
        npu: item.npu,
        labkaFullName: item.labkaFullName || item.labka,
        range: interval.range,
        unit: interval.unit || item.unit,
        revisionDate: item.revisionDate || '-',
        laboratory: item.logistics?.laboratory || '-',
        age: interval.age || '-',
        group: interval.group || '-'
      });
    });
  });
  return rows;
}

function sortRows(rows, key, dir) {
  const factor = dir === 'desc' ? -1 : 1;
  const sorted = [...rows].sort((a, b) => {
    if (key === 'revisionDate') {
      return (parseDanishDate(a.revisionDate) - parseDanishDate(b.revisionDate)) * factor;
    }
    const av = String(a[key] ?? '').toLowerCase();
    const bv = String(b[key] ?? '').toLowerCase();
    return av.localeCompare(bv, 'da') * factor;
  });
  return sorted;
}

export function renderReferenceTable(container, items, { sortKey, sortDir, onSort, onSelectItem, onResetSearch }) {
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
        <p>Vi fandt ingen metodeblade der matcher dine søgekriterier eller filtre.</p>
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

  const rows = sortRows(buildRows(items), sortKey, sortDir);

  const headHtml = COLUMNS.map(col => {
    const isActive = col.key === sortKey;
    const arrow = isActive ? (sortDir === 'asc' ? '▲' : '▼') : '';
    return `<th data-sort-key="${col.key}" class="${isActive ? 'sorted' : ''}"><span>${col.label}</span><span class="sort-arrow">${arrow}</span></th>`;
  }).join('');

  const bodyHtml = rows.map((row, i) => `
    <tr data-row-index="${i}" tabindex="0" role="button" aria-label="Se metodeblad for ${row.name}">
      <td class="cell-name">${row.name}</td>
      <td class="mono cell-npu">${row.npu}</td>
      <td class="mono">${row.labkaFullName}</td>
      <td class="mono cell-range">${row.range}</td>
      <td>${row.unit}</td>
      <td class="mono">${row.revisionDate}</td>
      <td>${row.laboratory}</td>
      <td>${row.age}</td>
      <td>${row.group}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div class="table-toolbar">
      <span class="table-result-count">${items.length} ${items.length === 1 ? 'analyse' : 'analyser'} · ${rows.length} referenceintervaller</span>
    </div>
    <div class="ref-table-wrapper">
      <table class="ref-table">
        <thead><tr>${headHtml}</tr></thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    </div>
  `;

  container.querySelectorAll('th[data-sort-key]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort-key');
      if (key) onSort(key);
    });
  });

  container.querySelectorAll('tr[data-row-index]').forEach(tr => {
    const idx = Number(tr.getAttribute('data-row-index'));
    const row = rows[idx];
    if (!row) return;
    tr.addEventListener('click', () => onSelectItem(row.item));
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelectItem(row.item);
      }
    });
  });
}
