// Main Application Logic
import rawDatabase from '../data/database.json';
import { CatalogSearchEngine } from './search.js';
import { renderNavbar } from './components/navbar.js';
import { renderLetterBar } from './components/letterBar.js';
import { renderFilterBar } from './components/filterBar.js';
import { renderCatalogGrid } from './components/catalogGrid.js';
import { renderDetailModal } from './components/detailModal.js';
import { renderTubeGuideModal } from './components/tubeGuide.js';
import { renderImporterModal } from './components/importerModal.js';
import { showToast } from './utils/export.js';

class App {
  constructor() {
    this.storageKey = 'metod_catalog_custom_db';
    this.themeStorageKey = 'metod_catalog_theme';

    // Load custom entries from localStorage merged with base JSON
    const stored = localStorage.getItem(this.storageKey);
    const customEntries = stored ? JSON.parse(stored) : [];
    this.database = [...rawDatabase, ...customEntries];

    this.searchEngine = new CatalogSearchEngine(this.database);

    // Initial state
    this.state = {
      query: '',
      letter: 'ALL',
      section: 'ALL',
      tubeColor: 'ALL',
      accreditedOnly: false,
      selectedItem: null,
      isTubeGuideOpen: false,
      isImporterOpen: false,
      theme: localStorage.getItem(this.themeStorageKey) || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    };

    this.initTheme();
    this.initDomContainers();
    this.bindGlobalEvents();
    this.handleRouting();
    this.render();
  }

  initTheme() {
    document.documentElement.setAttribute('data-theme', this.state.theme);
  }

  toggleTheme() {
    this.state.theme = this.state.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(this.themeStorageKey, this.state.theme);
    document.documentElement.setAttribute('data-theme', this.state.theme);
    this.renderNavbarSection();
  }

  initDomContainers() {
    this.navContainer = document.getElementById('navbar-mount');
    this.letterBarContainer = document.getElementById('letter-bar-mount');
    this.filterBarContainer = document.getElementById('filter-bar-mount');
    this.gridContainer = document.getElementById('catalog-grid-mount');
    this.modalContainer = document.getElementById('modal-mount');
    this.searchInput = document.getElementById('main-search-input');
    this.clearSearchBtn = document.getElementById('clear-search-btn');
  }

  bindGlobalEvents() {
    // Search input typing
    this.searchInput?.addEventListener('input', (e) => {
      this.state.query = e.target.value;
      this.toggleClearButton();
      this.renderMainContent();
    });

    // Clear search button
    this.clearSearchBtn?.addEventListener('click', () => {
      this.state.query = '';
      if (this.searchInput) this.searchInput.value = '';
      this.toggleClearButton();
      this.renderMainContent();
    });

    // Search suggestion chips
    document.querySelectorAll('.search-tag-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const term = chip.getAttribute('data-search') || chip.textContent.trim();
        this.state.query = term;
        if (this.searchInput) this.searchInput.value = term;
        this.toggleClearButton();
        this.renderMainContent();
      });
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== this.searchInput && !this.state.selectedItem) {
        e.preventDefault();
        this.searchInput?.focus();
        this.searchInput?.select();
      } else if (e.key === 'Escape') {
        if (this.state.selectedItem) {
          this.closeDetailModal();
        } else if (this.state.isTubeGuideOpen) {
          this.closeTubeGuide();
        } else if (this.state.isImporterOpen) {
          this.closeImporter();
        }
      }
    });

    // URL Hash Routing
    window.addEventListener('hashchange', () => {
      this.handleRouting();
    });
  }

  toggleClearButton() {
    if (this.state.query.trim()) {
      this.clearSearchBtn?.classList.add('visible');
    } else {
      this.clearSearchBtn?.classList.remove('visible');
    }
  }

  handleRouting() {
    const hash = window.location.hash.replace('#', '').trim();
    if (hash) {
      const match = this.database.find(item => item.slug === hash || item.id === hash || item.npu.toLowerCase() === hash.toLowerCase());
      if (match) {
        this.state.selectedItem = match;
      }
    } else {
      this.state.selectedItem = null;
    }
    this.renderModals();
  }

  openDetailModal(item) {
    this.state.selectedItem = item;
    window.location.hash = item.slug;
    this.renderModals();
  }

  closeDetailModal() {
    this.state.selectedItem = null;
    if (window.location.hash) {
      history.pushState('', document.title, window.location.pathname + window.location.search);
    }
    this.renderModals();
  }

  openTubeGuide() {
    this.state.isTubeGuideOpen = true;
    this.renderModals();
  }

  closeTubeGuide() {
    this.state.isTubeGuideOpen = false;
    this.renderModals();
  }

  openImporter() {
    this.state.isImporterOpen = true;
    this.renderModals();
  }

  closeImporter() {
    this.state.isImporterOpen = false;
    this.renderModals();
  }

  importNewEntry(newEntry) {
    // Add to current database
    this.database.push(newEntry);

    // Save custom entries to localStorage
    const stored = localStorage.getItem(this.storageKey);
    const customEntries = stored ? JSON.parse(stored) : [];
    customEntries.push(newEntry);
    localStorage.setItem(this.storageKey, JSON.stringify(customEntries));

    // Rebuild index
    this.searchEngine.setDataset(this.database);
    this.render();
  }

  renderNavbarSection() {
    renderNavbar(this.navContainer, {
      onOpenTubeGuide: () => this.openTubeGuide(),
      onOpenImporter: () => this.openImporter(),
      onToggleTheme: () => this.toggleTheme(),
      currentTheme: this.state.theme,
      totalCount: this.database.length
    });
  }

  renderMainContent() {
    const results = this.searchEngine.search({
      query: this.state.query,
      letter: this.state.letter,
      section: this.state.section,
      tubeColor: this.state.tubeColor,
      accreditedOnly: this.state.accreditedOnly
    });

    const letterCounts = this.searchEngine.getLetterCounts();

    renderLetterBar(this.letterBarContainer, {
      activeLetter: this.state.letter,
      letterCounts,
      onSelectLetter: (letter) => {
        this.state.letter = letter;
        this.renderMainContent();
      },
      totalResults: results.length
    });

    renderFilterBar(this.filterBarContainer, {
      sections: this.searchEngine.getSections(),
      activeSection: this.state.section,
      activeTubeColor: this.state.tubeColor,
      accreditedOnly: this.state.accreditedOnly,
      onFilterChange: (filters) => {
        Object.assign(this.state, filters);
        this.renderMainContent();
      },
      onResetFilters: () => {
        this.state.section = 'ALL';
        this.state.tubeColor = 'ALL';
        this.state.accreditedOnly = false;
        this.renderMainContent();
      }
    });

    renderCatalogGrid(this.gridContainer, results, {
      onSelectCard: (item) => this.openDetailModal(item),
      onResetSearch: () => {
        this.state.query = '';
        this.state.letter = 'ALL';
        this.state.section = 'ALL';
        this.state.tubeColor = 'ALL';
        this.state.accreditedOnly = false;
        if (this.searchInput) this.searchInput.value = '';
        this.toggleClearButton();
        this.renderMainContent();
      }
    });
  }

  renderModals() {
    if (this.state.selectedItem) {
      renderDetailModal(this.modalContainer, this.state.selectedItem, {
        onClose: () => this.closeDetailModal()
      });
    } else if (this.state.isTubeGuideOpen) {
      renderTubeGuideModal(this.modalContainer, {
        onClose: () => this.closeTubeGuide()
      });
    } else if (this.state.isImporterOpen) {
      renderImporterModal(this.modalContainer, {
        onImportData: (entry) => this.importNewEntry(entry),
        currentDatabase: this.database,
        onClose: () => this.closeImporter()
      });
    } else {
      this.modalContainer.innerHTML = '';
    }
  }

  render() {
    this.renderNavbarSection();
    this.renderMainContent();
    this.renderModals();
  }
}

// Bootstrap
document.addEventListener('DOMContentLoaded', () => {
  new App();
});
