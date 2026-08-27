// Reference Interval List — Excel-style data table
const COLUMNS = [
  { key: 'name', label: 'Analyse' },
  { key: 'npu', label: 'NPU-kode' },
  { key: 'group', label: 'Gælder for' },
  { key: 'age', label: 'Alder' },
  { key: 'range', label: 'Referenceinterval' },
  { key: 'unit', label: 'Enhed' },
  { key: 'laboratory', label: 'Udførende laboratorium' },
  { key: 'inUseDate', label: 'Taget i brug' },
  { key: 'revisionDate', label: 'Næste revision' },
  { key: 'pdfUrl', label: 'Metodeblad PDF', sortable: false }
];

// Converts one age token ("60 dage", "6 mdr.", "2 uger", "31 d", "17 år",
// "18") to years. A bare number, or an unrecognised unit, is read as years.
const AGE_UNIT_YEARS = [
  [/\b(?:døgn|dage?|dag|d)\b/, 1 / 365],
  [/\b(?:uger?|uge)\b/, 1 / 52],
  [/\b(?:mdr|måneder?|måned)\b/, 1 / 12],
  [/år/, 1] // no \b — a JS word boundary doesn't fire next to "å" (PLAN.md)
];
function ageTokenToYears(token) {
  const num = token.match(/\d+(?:[.,]\d+)?/);
  if (!num) return null;
  const n = Number(num[0].replace(',', '.'));
  if (!isFinite(n)) return null;
  const unit = AGE_UNIT_YEARS.find(([re]) => re.test(token.toLowerCase()));
  return n * (unit ? unit[1] : 1);
}

// "Kun voksne (18+)" hides reference intervals that apply to children —
// i.e. any bracket whose LOWER bound is under 18 years. Non-numeric
// brackets ("Alle aldre", "Voksne") can't be judged and stay visible.
// The bug this replaces: the first number was compared to 18 as if it
// were always years, so "30-60 dage" (30–60 *days*) survived the filter
// because 30 ≥ 18, and "60 dage-17 år" did too.
function isAdultInterval(ageText) {
  if (!ageText) return true;
  const t = ageText.trim().toLowerCase();
  if (!/\d/.test(t)) return true;

  // "< 18 år" / "≤ 17 år": an upper bound only, so the bracket starts at 0
  // — a children's bracket unless the bound itself is past 18.
  if (/^[<≤]/.test(t)) {
    const y = ageTokenToYears(t);
    return y == null ? true : y > 18;
  }

  // Lower bound = the first dash-separated token. If it carries no unit of
  // its own, a unit at the very end of the string applies to it too
  // ("30-60 dage" → lower bound is 30 *days*).
  const lowerRaw = t.split(/[–-]/)[0].trim();
  const trailingUnit = (t.match(/(døgn|dage?|dag|uger?|uge|mdr\.?|måneder?|måned|år)\s*$/) || [])[1];
  const lowerTok = /[a-zæøå]/.test(lowerRaw) || !trailingUnit ? lowerRaw : `${lowerRaw} ${trailingUnit}`;
  const years = ageTokenToYears(lowerTok);
  return years == null ? true : years >= 18;
}

function parseDanishDate(str) {
  if (!str) return 0;
  const [d, m, y] = str.split('-').map(Number);
  if (!d || !m || !y) return 0;
  return new Date(y, m - 1, d).getTime();
}

const REVISION_SOON_DAYS = 60;

// Status dot for the "Næste revision" date: red once overdue, orange once within the
// soon-window, and nothing (no dot, no tooltip) when the revision is comfortably in the future.
function getRevisionStatus(dateStr) {
  const dueTime = parseDanishDate(dateStr);
  if (!dueTime) return null;

  const daysLeft = Math.round((dueTime - Date.now()) / 86400000);

  if (daysLeft < 0) {
    return {
      level: 'overdue',
      tooltip: `Metodebladet skulle være revideret ${dateStr} — ${Math.abs(daysLeft)} dage forsinket.`
    };
  }
  if (daysLeft <= REVISION_SOON_DAYS) {
    return {
      level: 'soon',
      tooltip: `Revision nærmer sig: forfalder ${dateStr} (om ${daysLeft} ${daysLeft === 1 ? 'dag' : 'dage'}).`
    };
  }
  return null;
}

function buildRows(items) {
  const rows = [];
  items.forEach(item => {
    const intervals = item.referenceIntervals?.length ? item.referenceIntervals : [{ target: '-', age: '-', range: '-', unit: item.unit }];
    intervals.forEach(interval => {
      rows.push({
        item,
        name: item.name,
        npu: item.npu,
        range: interval.range,
        unit: interval.unit || item.unit,
        inUseDate: item.inUseDate || '-',
        revisionDate: item.revisionDate || '-',
        laboratory: item.logistics?.laboratory || '-',
        age: interval.age || '-',
        group: interval.target ?? interval.group ?? '-',
        pdfUrl: item.pdfUrl || '',
        dataQualityFlags: item.dataQualityFlags || []
      });
    });
  });
  return rows;
}

function sortRows(rows, key, dir) {
  const factor = dir === 'desc' ? -1 : 1;
  const sorted = [...rows].sort((a, b) => {
    if (key === 'revisionDate' || key === 'inUseDate') {
      return (parseDanishDate(a[key]) - parseDanishDate(b[key])) * factor;
    }
    const av = String(a[key] ?? '').toLowerCase();
    const bv = String(b[key] ?? '').toLowerCase();
    return av.localeCompare(bv, 'da') * factor;
  });
  return sorted;
}

const TOOLTIP_SHOW_DELAY_MS = 40;

function getTooltipEl() {
  let el = document.getElementById('ref-table-tooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ref-table-tooltip';
    el.className = 'ref-tooltip';
    document.body.appendChild(el);
  }
  return el;
}

// Native `title` tooltips have a long, browser-controlled delay. Since the revision
// dot's popup should appear almost instantly, drive a fixed-position tooltip ourselves.
function wireFastTooltips(container) {
  const tooltipEl = getTooltipEl();
  tooltipEl.classList.remove('visible');
  let showTimer = null;

  container.querySelectorAll('[data-tooltip]').forEach(target => {
    target.addEventListener('mouseenter', () => {
      clearTimeout(showTimer);
      const text = target.getAttribute('data-tooltip');
      showTimer = setTimeout(() => {
        const rect = target.getBoundingClientRect();
        tooltipEl.textContent = text;
        tooltipEl.style.left = `${rect.left + rect.width / 2}px`;
        tooltipEl.style.top = `${rect.top - 6}px`;
        tooltipEl.classList.add('visible');
      }, TOOLTIP_SHOW_DELAY_MS);
    });
    target.addEventListener('mouseleave', () => {
      clearTimeout(showTimer);
      tooltipEl.classList.remove('visible');
    });
  });
}

export function renderReferenceTable(container, items, { sortKey, sortDir, onSort, onSelectItem, onResetSearch, adultOnly = false }) {
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

  let rows = buildRows(items);
  if (adultOnly) {
    rows = rows.filter(row => isAdultInterval(row.age));
  }
  rows = sortRows(rows, sortKey, sortDir);

  if (rows.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </div>
        <h3>Ingen referenceintervaller fundet</h3>
        <p>Ingen intervaller matcher dine filtre (fx er "Kun voksne" muligvis for restriktivt).</p>
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

  const headHtml = COLUMNS.map(col => {
    const isActive = col.key === sortKey;
    const arrow = isActive ? (sortDir === 'asc' ? '▲' : '▼') : '';
    const sortable = col.sortable !== false;
    return `<th ${sortable ? `data-sort-key="${col.key}"` : 'class="not-sortable"'} class="${isActive ? 'sorted' : ''}"><span>${col.label}</span>${sortable ? `<span class="sort-arrow">${arrow}</span>` : ''}</th>`;
  }).join('');

  const bodyHtml = rows.map((row, i) => `
    <tr data-row-index="${i}" tabindex="0" role="button" aria-label="Se metodeblad for ${row.name}">
      <td class="cell-name">${row.name}${row.dataQualityFlags.length ? ` <span class="data-quality-flag" data-tooltip="${row.dataQualityFlags.join(' ').replace(/"/g, '&quot;')}">⚠</span>` : ''}</td>
      <td class="mono cell-npu">${row.npu}</td>
      <td>${row.group}</td>
      <td>${row.age}</td>
      <td class="mono cell-range">${row.range}</td>
      <td>${row.unit}</td>
      <td>${row.laboratory}</td>
      <td class="mono">${row.inUseDate}</td>
      <td class="mono cell-revision">${row.revisionDate}${(() => {
        const status = getRevisionStatus(row.revisionDate);
        return status ? ` <span class="revision-dot ${status.level}" data-tooltip="${status.tooltip}"></span>` : '';
      })()}</td>
      <td>${row.pdfUrl
        ? `<a href="${row.pdfUrl}" class="pdf-link" target="_blank" rel="noopener" data-pdf-link title="Åbn metodeblad PDF">PDF <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>`
        : '<span class="pdf-link-empty">—</span>'}</td>
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

  container.querySelectorAll('[data-pdf-link]').forEach(link => {
    link.addEventListener('click', (e) => e.stopPropagation());
  });

  wireFastTooltips(container);
}
