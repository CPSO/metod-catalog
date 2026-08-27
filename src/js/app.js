// Main Application Logic
import { DEPARTMENTS, DEFAULT_DEPARTMENT, getDepartment } from '../data/departments.js';
import { CatalogSearchEngine } from './search.js';
import { renderNavbar } from './components/navbar.js';
import { renderFilterBar } from './components/filterBar.js';
import { renderReferenceTable } from './components/referenceTable.js';
import { renderDetailPanel } from './components/detailPanel.js';
import { renderTubeGuideModal } from './components/tubeGuide.js';
import { renderImporterModal } from './components/importerModal.js';
import { showToast } from './utils/export.js';

const DEFAULT_FILTERS = {
  query: '',
  section: 'ALL',
  tubeColor: 'ALL',
  letter: 'ALL',
  accreditedOnly: false,
  adultOnly: true
};

class App {
  constructor() {
    this.themeStorageKey = 'metod_catalog_theme';
    this.departmentStorageKey = 'metod_catalog_department';

    this.state = {
      department: this.resolveInitialDepartment(),
      ...DEFAULT_FILTERS,
      sortKey: 'name',
      sortDir: 'asc',
      selectedItem: null,
      isTubeGuideOpen: false,
      isImporterOpen: false,
      theme: localStorage.getItem(this.themeStorageKey) || 'light'
    };

    this.loadDepartmentData();

    this.initTheme();
    this.initDomContainers();
    this.bindGlobalEvents();
    this.handleRouting();
    this.render();
  }

  // ── Department ──────────────────────────────────────────────────────────
  resolveInitialDepartment() {
    const fromUrl = new URLSearchParams(window.location.search).get('dept');
    const stored = localStorage.getItem('metod_catalog_department');
    const candidate = (fromUrl || stored || DEFAULT_DEPARTMENT).toUpperCase();
    return DEPARTMENTS.some(d => d.id === candidate) ? candidate : DEFAULT_DEPARTMENT;
  }

  customStorageKey() {
    return `metod_catalog_custom_db_${this.state.department}`;
  }

  loadDepartmentData() {
    this.dept = getDepartment(this.state.department);
    const stored = localStorage.getItem(this.customStorageKey());
    const customEntries = stored ? JSON.parse(stored) : [];
    this.database = [...this.dept.dataset, ...customEntries];
    if (this.searchEngine) {
      this.searchEngine.setDataset(this.database);
    } else {
      this.searchEngine = new CatalogSearchEngine(this.database);
    }
  }

  switchDepartment(id) {
    if (id === this.state.department || !DEPARTMENTS.some(d => d.id === id)) return;
    this.state.department = id;
    localStorage.setItem(this.departmentStorageKey, id);

    // Reset per-department view state
    Object.assign(this.state, DEFAULT_FILTERS);
    this.state.selectedItem = null;
    if (this.searchInput) this.searchInput.value = '';
    this.toggleClearButton();

    // Reflect in the URL without adding history noise
    const url = new URL(window.location);
    url.searchParams.set('dept', id);
    url.hash = '';
    history.replaceState('', document.title, url);

    this.loadDepartmentData();
    this.render();
  }

  // ── Theme ──────────────────────────────────────────────────────────────
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
    this.filterBarContainer = document.getElementById('filter-bar-mount');
    this.tableContainer = document.getElementById('reference-table-mount');
    this.modalContainer = document.getElementById('modal-mount');
    this.panelContainer = document.getElementById('panel-mount');
    this.searchInput = document.getElementById('main-search-input');
    this.clearSearchBtn = document.getElementById('clear-search-btn');
  }

  bindGlobalEvents() {
    this.searchInput?.addEventListener('input', (e) => {
      this.state.query = e.target.value;
      this.toggleClearButton();
      this.renderMainContent();
    });

    this.clearSearchBtn?.addEventListener('click', () => {
      this.state.query = '';
      if (this.searchInput) this.searchInput.value = '';
      this.toggleClearButton();
      this.renderMainContent();
    });

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
      const h = hash.toLowerCase();
      const match = this.database.find(item =>
        item.slug === hash ||
        item.id === hash ||
        (item.npu || '').toLowerCase() === h ||
        (item.code || '').toLowerCase() === h
      );
      this.state.selectedItem = match || null;
    } else {
      this.state.selectedItem = null;
    }
    this.renderPanel();
  }

  openDetailModal(item) {
    this.state.selectedItem = item;
    window.location.hash = item.slug;
    this.renderPanel();
  }

  closeDetailModal() {
    this.state.selectedItem = null;
    if (window.location.hash) {
      history.pushState('', document.title, window.location.pathname + window.location.search);
    }
    this.renderPanel();
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
    this.database.push(newEntry);

    const stored = localStorage.getItem(this.customStorageKey());
    const customEntries = stored ? JSON.parse(stored) : [];
    customEntries.push(newEntry);
    localStorage.setItem(this.customStorageKey(), JSON.stringify(customEntries));

    this.searchEngine.setDataset(this.database);
    this.render();
  }

  renderNavbarSection() {
    renderNavbar(this.navContainer, {
      department: this.dept,
      departments: DEPARTMENTS,
      onDepartmentChange: (id) => this.switchDepartment(id),
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
      section: this.state.section,
      tubeColor: this.state.tubeColor,
      letter: this.state.letter,
      accreditedOnly: this.state.accreditedOnly
    });

    renderFilterBar(this.filterBarContainer, {
      filters: this.dept.filters,
      sections: this.searchEngine.getSections(),
      availableLetters: this.searchEngine.getAvailableLetters(),
      activeLetter: this.state.letter,
      activeSection: this.state.section,
      activeTubeColor: this.state.tubeColor,
      accreditedOnly: this.state.accreditedOnly,
      adultOnly: this.state.adultOnly,
      onFilterChange: (filters) => {
        Object.assign(this.state, filters);
        this.renderMainContent();
      },
      onResetFilters: () => {
        Object.assign(this.state, DEFAULT_FILTERS, { query: this.state.query });
        this.renderMainContent();
      }
    });

    renderReferenceTable(this.tableContainer, results, {
      sortKey: this.state.sortKey,
      sortDir: this.state.sortDir,
      adultOnly: this.dept.filters.adult && this.state.adultOnly,
      emptyMessage: this.database.length === 0 ? this.dept.emptyMessage : null,
      onSort: (key) => {
        if (this.state.sortKey === key) {
          this.state.sortDir = this.state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.state.sortKey = key;
          this.state.sortDir = 'asc';
        }
        this.renderMainContent();
      },
      onSelectItem: (item) => this.openDetailModal(item),
      onResetSearch: () => {
        Object.assign(this.state, DEFAULT_FILTERS, { adultOnly: false });
        if (this.searchInput) this.searchInput.value = '';
        this.toggleClearButton();
        this.renderMainContent();
      }
    });
  }

  renderPanel() {
    if (this.state.selectedItem) {
      renderDetailPanel(this.panelContainer, this.state.selectedItem, {
        department: this.dept,
        onClose: () => this.closeDetailModal()
      });
    } else {
      this.panelContainer.innerHTML = '';
    }
  }

  renderModals() {
    if (this.state.isTubeGuideOpen && this.dept.features.tubeGuide) {
      renderTubeGuideModal(this.modalContainer, {
        onClose: () => this.closeTubeGuide()
      });
    } else if (this.state.isImporterOpen && this.dept.features.importer) {
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
    this.renderPanel();
    this.renderModals();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new App();
});
