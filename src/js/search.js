// High-Performance Search & Faceted Filter Engine

export class CatalogSearchEngine {
  constructor(dataset = []) {
    this.dataset = dataset;
    this.buildIndex();
  }

  setDataset(newDataset) {
    this.dataset = newDataset;
    this.buildIndex();
  }

  buildIndex() {
    this.searchIndex = this.dataset.map(item => {
      const searchTerms = [
        item.name,
        item.npu,
        item.code,
        item.labka,
        item.labkaFullName,
        item.spCode,
        item.webreqCode,
        item.documentNumber,
        item.id,
        item.section,
        item.unit,
        item.sample?.tube,
        item.sample?.tubeColorName,
        item.sample?.material,
        item.method?.instrument,
        item.indication?.summary,
        ...(item.indication?.elevated || []),
        ...(item.indication?.decreased || [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return {
        id: item.id,
        slug: item.slug,
        item,
        searchTerms
      };
    });
  }

  search({ query = '', section = 'ALL', tubeColor = 'ALL', letter = 'ALL', accreditedOnly = false }) {
    const cleanQuery = query.trim().toLowerCase();
    const queryTokens = cleanQuery ? cleanQuery.split(/\s+/).filter(t => t.length > 0) : [];

    return this.searchIndex
      .filter(({ item, searchTerms }) => {
        // 1. Section Filter
        if (section !== 'ALL' && (item.section || '').toUpperCase() !== section.toUpperCase()) {
          return false;
        }

        // 2. Letter Filter
        if (letter !== 'ALL') {
          const itemLetter = (item.letter || item.name[0] || '').toUpperCase();
          if (letter === '0-9' || letter === '1-9' || letter === '#') {
            if (!/^\d/.test(itemLetter)) return false;
          } else if (itemLetter !== letter.toUpperCase()) {
            return false;
          }
        }

        // 3. Tube Color Filter
        if (tubeColor !== 'ALL' && item.sample?.tubeColor?.toLowerCase() !== tubeColor.toLowerCase()) {
          return false;
        }

        // 4. Accreditation Filter
        if (accreditedOnly && !item.method?.accredited) {
          return false;
        }

        // 5. Query Filter
        if (queryTokens.length > 0) {
          // Every token must match somewhere in the search terms
          return queryTokens.every(token => searchTerms.includes(token));
        }

        return true;
      })
      .map(({ item, searchTerms }) => {
        // Calculate relevance score
        let score = 0;
        if (cleanQuery) {
          const idHit = [item.npu, item.code, item.labka].some(v => (v || '').toLowerCase() === cleanQuery);
          if (idHit) {
            score += 100;
          } else if (item.name.toLowerCase().startsWith(cleanQuery)) {
            score += 50;
          } else if (item.name.toLowerCase().includes(cleanQuery)) {
            score += 25;
          } else if (item.indication?.summary?.toLowerCase().includes(cleanQuery)) {
            score += 10;
          }
        }
        return { item, score };
      })
      .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, 'da'))
      .map(entry => entry.item);
  }

  getSections() {
    const sections = new Set();
    this.dataset.forEach(item => {
      if (item.section) sections.add(item.section);
    });
    return Array.from(sections).sort();
  }

  getAvailableLetters() {
    const letters = new Set();
    this.dataset.forEach(item => {
      const l = (item.letter || item.name[0] || '').toUpperCase();
      if (/^\d/.test(l)) {
        letters.add('0-9');
      } else if (l) {
        letters.add(l);
      }
    });
    return letters;
  }
}
