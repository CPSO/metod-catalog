// Tube color definitions and badge rendering utilities

export const TUBE_DEFINITIONS = {
  green: {
    name: 'Grøn prop (Lithium-Heparin)',
    color: '#10b981',
    bg: 'var(--tube-green-bg)',
    desc: 'Anvendes til de fleste rutinekemiske analyser (plasma).'
  },
  red: {
    name: 'Rød prop (Serum / Clot Activator)',
    color: '#ef4444',
    bg: 'var(--tube-red-bg)',
    desc: 'Anvendes til serumanalyser, specielle proteiner og lægemiddelmonitorering.'
  },
  purple: {
    name: 'Lilla prop (K2/K3-EDTA)',
    color: '#8b5cf6',
    bg: 'var(--tube-purple-bg)',
    desc: 'Anvendes til hæmatologi, HbA1c, ammoniak og DNA/genetiske analyser.'
  },
  lightblue: {
    name: 'Lyseblå prop (3,2% Natriumcitrat)',
    color: '#0284c7',
    bg: 'var(--tube-lightblue-bg)',
    desc: 'Anvendes til koagulationsanalyser (INR, APTT, D-dimer, Antithrombin).'
  },
  grey: {
    name: 'Grå prop (Fluorid-Oxalat)',
    color: '#6b7280',
    bg: 'var(--tube-grey-bg)',
    desc: 'Anvendes til glukose- og laktatbestemmelser.'
  },
  // Not a real tube type — shown when tubeColor is genuinely unset (e.g. a
  // scraper-generated draft entry awaiting manual completion). Falling back
  // to a specific real tube (e.g. grey/Fluorid-Oxalat) here would present
  // unverified data as if it were fact.
  unknown: {
    name: 'Rørtype ikke angivet',
    color: '#9ca3af',
    bg: 'var(--tube-grey-bg)',
    desc: 'Rørtype er ikke registreret for denne analyse endnu.'
  }
};

export function renderTubeBadge(tubeColor, customLabel) {
  const colorKey = (tubeColor || 'unknown').toLowerCase();
  const def = TUBE_DEFINITIONS[colorKey] || TUBE_DEFINITIONS.unknown;
  const label = tubeColor ? (customLabel || def.name) : def.name;

  return `
    <span class="tube-indicator ${colorKey}" title="${def.desc}">
      <span class="tube-dot ${colorKey}"></span>
      <span>${label}</span>
    </span>
  `;
}
