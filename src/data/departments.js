// Department registry — the catalog is multi-department. Each entry points
// at its own dataset file and declares which UI affordances apply, so the
// rest of the app never hard-codes "KBA".
//
// Adding a department: drop a `<id>.json` dataset in this folder, import it
// here, and add a config object. Everything else (navbar, filters, detail
// panel dispatch, search, routing) is driven off this list.

import kbaData from './kba.json';
import kmaData from './kma.json';

export const DEPARTMENTS = [
  {
    id: 'KBA',
    label: 'Klinisk Biokemisk Afdeling',
    site: 'Herlev & Gentofte',
    docTerm: 'Metodeblade',
    // primary identifier field on an entry (used for search scoring / routing)
    idField: 'npu',
    dataset: kbaData,
    // which faceted filters the filter bar shows for this department
    filters: { letter: true, section: true, tubeColor: true, accredited: true, adult: true },
    // navbar action buttons available for this department
    features: { tubeGuide: true, importer: true },
    // key in detailPanel's renderer map
    detailPanel: 'kba',
    // shown when the dataset is empty
    emptyMessage: null
  },
  {
    id: 'KMA',
    label: 'Klinisk Mikrobiologisk Afdeling',
    site: 'Herlev & Gentofte',
    docTerm: 'Metodeblade',
    idField: 'code',
    dataset: kmaData,
    filters: { letter: true, section: false, tubeColor: false, accredited: false, adult: false },
    features: { tubeGuide: false, importer: false },
    detailPanel: 'kma',
    emptyMessage: 'KMA-kataloget er endnu ikke indlæst. Data importeres fra tekstkilder — kommer snart.'
  }
];

export const DEFAULT_DEPARTMENT = 'KBA';

export function getDepartment(id) {
  return DEPARTMENTS.find(d => d.id === id) || DEPARTMENTS.find(d => d.id === DEFAULT_DEPARTMENT);
}
