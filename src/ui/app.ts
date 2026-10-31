import { SimulationEngine } from '../simulation/engine';
import { createDefaultParser, COMPONENT_CATALOG, ComponentDefinition } from '../simulation/registry';
import { InteractionManager } from './canvas/interactionManager';
import { LogiclyParser } from '../io/parser';
import { ICircuit, IVariableInputCircuit, IInputCircuit, IOutputCircuit } from '../simulation/types';
import { ClockCircuit } from '../simulation/circuits/clock';
import { LabelCircuit } from '../simulation/circuits/annotation';
import { SwitchCircuit } from '../simulation/circuits/controls';
import { LightBulbCircuit } from '../simulation/circuits/outputs';
import { ComplexCircuit } from '../simulation/circuits/complex';
import { XORGateCircuit, XNORGateCircuit } from '../simulation/circuits/gates';
import { SymbolRenderer } from './canvas/symbolRenderer';
import { SAMPLE_CIRCUITS, SAMPLE_FULL_ADDER_IC_XML } from './samples';
import { BUILTIN_IC_TEMPLATES } from '../simulation/templates';
import { UndoRedoManager, UndoState } from '../simulation/undoRedo';
import { SettingsModel, AppSettings } from '../simulation/settings';
import { PngExporter } from './export/pngExporter';
import { SvgExporter } from './export/svgExporter';

export class ProLogicApp {
  private _engine: SimulationEngine;
  private _parser: LogiclyParser;
  private _interaction: InteractionManager;
  private _undoRedo: UndoRedoManager;
  private _settingsModel: SettingsModel;

  private _isPlaying: boolean = true;
  private _isAnsi: boolean = true;
  private _lastTime: number = performance.now();
  private _simSpeed: number = 1.0;
  private _clipboardXml: string | null = null;
  private _lastUsedCustomTypeId: string | null = null;

  // Document Persistence & Lifecycle State
  private _currentFilePath: string | null = null;
  private _currentDocumentTitle: string = 'Half Adder';
  private _isDirty: boolean = false;

  public get currentFilePath(): string | null {
    return this._currentFilePath;
  }

  public get isDirty(): boolean {
    return this._isDirty;
  }

  public get currentDocumentTitle(): string {
    return this._currentDocumentTitle;
  }

  // Responsive & Layout State
  private _paletteWidth: number = 260;
  private _propertiesWidth: number = 250;
  private _isPaletteCollapsed: boolean = false;
  private _isPropertiesCollapsed: boolean = false;

  constructor() {
    this._engine = new SimulationEngine();
    this._parser = createDefaultParser();
    this._undoRedo = new UndoRedoManager(100);
    this._settingsModel = new SettingsModel();

    const svg = document.getElementById('circuit-canvas') as unknown as SVGSVGElement;
    this._interaction = new InteractionManager(svg, this._engine);

    // Apply persisted settings
    this.applySettings(this._settingsModel.settings);
    this._settingsModel.onSettingsChanged = (s) => this.applySettings(s);

    // Dynamic OS system theme listener (Follows Windows appearance in real-time)
    if (typeof window !== 'undefined' && window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (this._settingsModel.settings.themeMode === 'system') {
          this.applySettings(this._settingsModel.settings);
        }
      });
    }

    // Hook undo/redo stack changes
    this._undoRedo.onStackChanged = () => this.updateUndoRedoUI();

    // Hook circuit modifications for automatic undo snapshots
    this._interaction.onCircuitModified = (desc) => {
      this.recordUndoSnapshot(desc || 'Modify Circuit');
    };

    this._interaction.onDirty = () => {
      this.setDirty(true);
    };

    // Hook view pan/zoom changes to keep HUD zoom indicator in sync
    this._interaction.onViewChanged = () => {
      this.updateZoomDisplay();
    };

    // Hook placement mode changes to update palette stamp active styling
    this._interaction.onPlacementModeChange = (type) => {
      this.updatePalettePlacementVisuals(type);
    };

    this.setupTitlebar();
    this.setupSplittersAndSidebars();
    this.setupCanvasHud();
    this.setupPalette();
    this.setupToolbar();
    this.setupModals();
    this.setupSettingsModal();
    this.setupPropertiesPanel();
    this.setupSimulationLoop();
    this.setupGlobalKeyboardShortcuts();

    // Initialize pristine blank workspace on fresh startup
    this.newCircuit();

    // Setup OS shell integration: command-line launch, Explorer double-click, and secondary instances
    this.setupShellFileIntegration();
  }

  private setupShellFileIntegration(): void {
    if (window.api && typeof window.api.getInitialFile === 'function') {
      window.api
        .getInitialFile()
        .then((file) => {
          if (file && file.content) {
            const docName = file.name || (file.filePath ? this.getFileName(file.filePath) : 'Circuit');
            this.loadCircuitXml(file.content, docName, file.filePath || null);
          }
        })
        .catch((err) => {
          console.error('Failed to get initial launch file from shell:', err);
        });
    }

    if (window.api && typeof window.api.onOpenFile === 'function') {
      window.api.onOpenFile((file) => {
        if (file && file.content) {
          const docName = file.name || (file.filePath ? this.getFileName(file.filePath) : 'Circuit');
          this.loadCircuitXml(file.content, docName, file.filePath || null);
        }
      });
    }
  }

  private applySettings(settings: AppSettings): void {
    // Theme resolution: System / Dark / Light
    let effectiveTheme: 'dark' | 'light' = 'dark';
    if (settings.themeMode === 'system') {
      const isDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      effectiveTheme = isDark ? 'dark' : 'light';
    } else {
      effectiveTheme = settings.themeMode;
    }
    document.documentElement.setAttribute('data-theme', effectiveTheme);
    document.documentElement.setAttribute('data-theme-mode', settings.themeMode || 'system');

    // Dynamic brand logo variant (Dark badge vs Light glyph)
    const titlebarLogo = document.querySelector('.titlebar-logo-icon') as HTMLImageElement;
    if (titlebarLogo) {
      titlebarLogo.src = effectiveTheme === 'light' ? 'assets/logo-light.png' : 'assets/logo-dark.png';
    }

    // Update status bar theme pill text and icon
    const themeText = document.getElementById('theme-status-text');
    if (themeText) {
      if (settings.themeMode === 'system') {
        themeText.textContent = `Theme: Auto (${effectiveTheme === 'dark' ? 'Dark' : 'Light'})`;
      } else if (settings.themeMode === 'dark') {
        themeText.textContent = 'Theme: Dark';
      } else {
        themeText.textContent = 'Theme: Bright';
      }
    }

    const themeIcon = document.getElementById('theme-icon');
    if (themeIcon) {
      if (settings.themeMode === 'system') {
        themeIcon.setAttribute('viewBox', '0 0 576 512');
        themeIcon.innerHTML = `<path d="M64 0C28.7 0 0 28.7 0 64V352c0 35.3 28.7 64 64 64H240l-10.7 32H160c-17.7 0-32 14.3-32 32s14.3 32 32 32H416c17.7 0 32-14.3 32-32s-14.3-32-32-32H346.7L336 416H512c35.3 0 64-28.7 64-64V64c0-35.3-28.7-64-64-64H64zM512 64V288H64V64H512z"/>`;
      } else if (effectiveTheme === 'dark') {
        themeIcon.setAttribute('viewBox', '0 0 384 512');
        themeIcon.innerHTML = `<path d="M223.5 32C100 32 0 132.3 0 256S100 480 223.5 480c60.6 0 115.5-24.2 155.8-63.4c5-4.9 6.3-12.5 3.1-18.7s-10.1-9.7-17-8.5c-9.8 1.7-19.8 2.6-30.1 2.6c-96.9 0-175.5-78.8-175.5-176c0-65.8 36-123.1 89.3-153.3c6.1-3.5 9.2-10.5 7.7-17.3s-7.3-11.9-14.3-12.5c-6.3-.5-12.6-.8-19-.8z"/>`;
      } else {
        themeIcon.setAttribute('viewBox', '0 0 512 512');
        themeIcon.innerHTML = `<path d="M361.5 1.2c5 2.1 8.6 6.6 9.6 11.9L391 121l107.9 19.8c5.3 1 9.8 4.6 11.9 9.6s1.5 10.7-1.6 15.2L446.9 256l62.3 90.3c3.1 4.5 3.7 10.2 1.6 15.2s-6.6 8.6-11.9 9.6L391 391 371.1 498.9c-1 5.3-4.6 9.8-9.6 11.9s-10.7 1.5-15.2-1.6L256 446.9l-90.3 62.3c-4.5 3.1-10.2 3.7-15.2 1.6s-8.6-6.6-9.6-11.9L121 391 13.1 371.1c-5.3-1-9.8-4.6-11.9-9.6s-1.5-10.7 1.6-15.2L65.1 256 2.8 165.7c-3.1-4.5-3.7-10.2-1.6-15.2s6.6-8.6 11.9-9.6L121 121 140.9 13.1c1-5.3 4.6-9.8 9.6-11.9s10.7-1.5 15.2 1.6L256 65.1 346.3 2.8c4.5-3.1 10.2-3.7 15.2-1.6zM160 256a96 96 0 1 1 192 0 96 96 0 1 1 -192 0zm224 0a128 128 0 1 0 -256 0 128 128 0 1 0 256 0z"/>`;
      }
    }

    // Update overflow menu theme button text and icon
    const menuThemeText = document.getElementById('menu-theme-text');
    if (menuThemeText) {
      if (settings.themeMode === 'system') {
        menuThemeText.textContent = 'Theme: Follow Windows';
      } else if (settings.themeMode === 'dark') {
        menuThemeText.textContent = 'Theme: Dark Mode';
      } else {
        menuThemeText.textContent = 'Theme: Bright (Light) Mode';
      }
    }

    const menuThemeIcon = document.getElementById('menu-theme-icon');
    if (menuThemeIcon) {
      if (settings.themeMode === 'system') {
        menuThemeIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 576 512" fill="currentColor"><path d="M64 0C28.7 0 0 28.7 0 64V352c0 35.3 28.7 64 64 64H240l-10.7 32H160c-17.7 0-32 14.3-32 32s14.3 32 32 32H416c17.7 0 32-14.3 32-32s-14.3-32-32-32H346.7L336 416H512c35.3 0 64-28.7 64-64V64c0-35.3-28.7-64-64-64H64zM512 64V288H64V64H512z"/></svg>`;
      } else if (effectiveTheme === 'dark') {
        menuThemeIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 384 512" fill="currentColor"><path d="M223.5 32C100 32 0 132.3 0 256S100 480 223.5 480c60.6 0 115.5-24.2 155.8-63.4c5-4.9 6.3-12.5 3.1-18.7s-10.1-9.7-17-8.5c-9.8 1.7-19.8 2.6-30.1 2.6c-96.9 0-175.5-78.8-175.5-176c0-65.8 36-123.1 89.3-153.3c6.1-3.5 9.2-10.5 7.7-17.3s-7.3-11.9-14.3-12.5c-6.3-.5-12.6-.8-19-.8z"/></svg>`;
      } else {
        menuThemeIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 512 512" fill="currentColor"><path d="M361.5 1.2c5 2.1 8.6 6.6 9.6 11.9L391 121l107.9 19.8c5.3 1 9.8 4.6 11.9 9.6s1.5 10.7-1.6 15.2L446.9 256l62.3 90.3c3.1 4.5 3.7 10.2 1.6 15.2s-6.6 8.6-11.9 9.6L391 391 371.1 498.9c-1 5.3-4.6 9.8-9.6 11.9s-10.7 1.5-15.2-1.6L256 446.9l-90.3 62.3c-4.5 3.1-10.2 3.7-15.2 1.6s-8.6-6.6-9.6-11.9L121 391 13.1 371.1c-5.3-1-9.8-4.6-11.9-9.6s-1.5-10.7 1.6-15.2L65.1 256 2.8 165.7c-3.1-4.5-3.7-10.2-1.6-15.2s6.6-8.6 11.9-9.6L121 121 140.9 13.1c1-5.3 4.6-9.8 9.6-11.9s10.7-1.5 15.2 1.6L256 65.1 346.3 2.8c4.5-3.1 10.2-3.7 15.2-1.6zM160 256a96 96 0 1 1 192 0 96 96 0 1 1 -192 0zm224 0a128 128 0 1 0 -256 0 128 128 0 1 0 256 0z"/></svg>`;
      }
    }

    this._isAnsi = settings.skinName === 'ansi';
    this._interaction.setGateStandard(this._isAnsi);
    this._interaction.setGridSnap(settings.snapToGrid);
    this._interaction.setGridSize(settings.gridSize);
    this._interaction.setShowGrid(settings.showGrid);
    this._interaction.setWireColorsEnabled(settings.enableWireColors);
    this._interaction.setSnapOrthogonalWires(settings.snapOrthogonalWires);

    // Simulation floating input signal
    this._engine.setDefaultFloatSignal(settings.defaultFloatSignal);

    // Palette visibility
    const sidebar = document.querySelector('.palette-sidebar') as HTMLElement;
    if (sidebar) {
      sidebar.style.display = settings.showPalette ? 'flex' : 'none';
      const splitter = document.getElementById('splitter-palette');
      if (splitter) {
        splitter.style.display = settings.showPalette && !this._isPaletteCollapsed ? 'flex' : 'none';
      }
    }

    // Dynamic CSS signal variables
    document.documentElement.style.setProperty('--signal-high', settings.highSignalColor);
    document.documentElement.style.setProperty('--signal-low', settings.lowSignalColor);
    document.documentElement.style.setProperty('--signal-hiz', settings.hiZSignalColor);
    document.documentElement.style.setProperty('--signal-contention', settings.unknownSignalColor);

    // Grid snap button state
    const snapBtn = document.getElementById('btn-snap');
    if (snapBtn) {
      snapBtn.classList.toggle('btn-active', settings.snapToGrid);
    }
    const snapStatusText = document.getElementById('snap-status-text');
    if (snapStatusText) {
      snapStatusText.textContent = settings.snapToGrid ? 'Snap: ON' : 'Snap: OFF';
    }

    // ANSI button label
    const standardBtn = document.getElementById('btn-standard');
    if (standardBtn) {
      const label = standardBtn.querySelector('.btn-label-text');
      if (label) {
        label.textContent = this._isAnsi ? 'ANSI' : 'IEC';
      } else {
        standardBtn.textContent = this._isAnsi ? 'ANSI' : 'IEC';
      }
    }

    // Refresh canvas rendering for current skin and theme
    this._interaction.render();
  }

  private recordUndoSnapshot(description: string): void {
    const circuitsMap = new Map<string, ICircuit>();
    const metaMap = new Map<string, { x: number; y: number; rotation: number }>();

    for (const [uid, node] of this._interaction.nodes) {
      circuitsMap.set(uid, node.circuit);
      metaMap.set(uid, { x: node.x, y: node.y, rotation: node.rotation });
    }

    const xml = this._parser.serialize(
      {
        engine: this._engine,
        circuits: circuitsMap,
        metadata: metaMap,
        locations: { left: [], right: [], top: [], bottom: [] }
      },
      { includeCustomTemplates: true }
    );

    this._undoRedo.pushState({
      xml,
      description,
      selectedUids: Array.from(this._interaction.selectedUids)
    });

    this.setDirty(true);
  }

  private handleUndo(): void {
    if (!this._undoRedo.canUndo) return;

    const currentSnapshot = this.getCurrentSnapshot('Current State');
    const targetState = this._undoRedo.undo(currentSnapshot);
    if (!targetState) return;

    const doc = this._parser.parse(targetState.xml);
    this._interaction.loadDocument(doc, targetState.selectedUids);
    this.showToast(`Undo: ${targetState.description}`);
  }

  private handleRedo(): void {
    if (!this._undoRedo.canRedo) return;

    const currentSnapshot = this.getCurrentSnapshot('Current State');
    const targetState = this._undoRedo.redo(currentSnapshot);
    if (!targetState) return;

    const doc = this._parser.parse(targetState.xml);
    this._interaction.loadDocument(doc, targetState.selectedUids);
    this.showToast(`Redo: ${targetState.description}`);
  }

  private getCurrentSnapshot(description: string): UndoState {
    const circuitsMap = new Map<string, ICircuit>();
    const metaMap = new Map<string, { x: number; y: number; rotation: number }>();

    for (const [uid, node] of this._interaction.nodes) {
      circuitsMap.set(uid, node.circuit);
      metaMap.set(uid, { x: node.x, y: node.y, rotation: node.rotation });
    }

    const xml = this._parser.serialize(
      {
        engine: this._engine,
        circuits: circuitsMap,
        metadata: metaMap,
        locations: { left: [], right: [], top: [], bottom: [] }
      },
      { includeCustomTemplates: true }
    );

    return {
      xml,
      description,
      selectedUids: Array.from(this._interaction.selectedUids)
    };
  }

  private updateUndoRedoUI(): void {
    const undoBtn = document.getElementById('btn-undo') as HTMLButtonElement;
    const redoBtn = document.getElementById('btn-redo') as HTMLButtonElement;

    if (undoBtn) {
      undoBtn.disabled = !this._undoRedo.canUndo;
      undoBtn.title = this._undoRedo.canUndo
        ? `Undo: ${this._undoRedo.lastUndoActionName} (Ctrl+Z)`
        : 'Undo (Ctrl+Z)';
    }

    if (redoBtn) {
      redoBtn.disabled = !this._undoRedo.canRedo;
      redoBtn.title = this._undoRedo.canRedo
        ? `Redo: ${this._undoRedo.nextRedoActionName} (Ctrl+Y)`
        : 'Redo (Ctrl+Y)';
    }
  }

  private handleCopy(): void {
    if (this._interaction.selectedUids.size === 0) return;

    const selectedCircuits = new Map<string, ICircuit>();
    const selectedMeta = new Map<string, { x: number; y: number; rotation: number }>();

    for (const uid of this._interaction.selectedUids) {
      const node = this._interaction.nodes.get(uid);
      if (node) {
        selectedCircuits.set(uid, node.circuit);
        selectedMeta.set(uid, { x: node.x, y: node.y, rotation: node.rotation });
      }
    }

    // Only serialize connections whose both endpoints are in the selection
    const subEngine = new SimulationEngine();
    for (const c of selectedCircuits.values()) {
      subEngine.registerCircuit(c);
    }
    for (const conn of this._engine.connections) {
      if (
        selectedCircuits.has(conn.outputCircuit.uid) &&
        selectedCircuits.has(conn.inputCircuit.uid)
      ) {
        subEngine.connect(
          conn.outputCircuit,
          conn.outputIndex,
          conn.inputCircuit,
          conn.inputIndex,
          conn.points ? [...conn.points] : []
        );
      }
    }

    this._clipboardXml = this._parser.serialize(
      {
        engine: subEngine,
        circuits: selectedCircuits,
        metadata: selectedMeta,
        locations: { left: [], right: [], top: [], bottom: [] }
      },
      { includeCustomTemplates: true }
    );

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(this._clipboardXml).catch(() => {});
    }

    this.showToast(`Copied ${this._interaction.selectedUids.size} component(s) to clipboard`);
  }

  private handleCut(): void {
    if (this._interaction.selectedUids.size === 0) return;
    this.handleCopy();
    this._interaction.deleteSelected();
    this.showToast('Cut selection');
  }

  private handlePaste(): void {
    if (!this._clipboardXml) return;

    try {
      // Parse clipboard with fresh UIDs
      const remap = new Map<string, string>();
      const doc = this._parser.parse(this._clipboardXml, remap);

      if (doc.circuits.size === 0) return;

      // Calculate bounding box center of pasted objects to place near center or offset +30
      let minX = Infinity;
      let minY = Infinity;
      for (const meta of doc.metadata.values()) {
        if (meta.x < minX) minX = meta.x;
        if (meta.y < minY) minY = meta.y;
      }

      const offsetX = 30;
      const offsetY = 30;

      this._interaction.selectedUids.clear();
      const newUids: string[] = [];

      for (const [newUid, circuit] of doc.circuits) {
        const meta = doc.metadata.get(newUid) || { x: 0, y: 0, rotation: 0 };
        this._interaction.addComponent(
          circuit,
          meta.x + offsetX,
          meta.y + offsetY,
          meta.rotation,
          true,
          false
        );
        newUids.push(newUid);
      }

      for (const conn of doc.engine.connections) {
        const offsetPoints = (conn.points || []).map((pt) => ({
          x: pt.x + offsetX,
          y: pt.y + offsetY
        }));
        this._engine.connect(
          conn.outputCircuit,
          conn.outputIndex,
          conn.inputCircuit,
          conn.inputIndex,
          offsetPoints
        );
      }

      for (const uid of newUids) {
        this._interaction.selectedUids.add(uid);
      }

      this._engine.propagateAll();
      this._interaction.render();
      this.recordUndoSnapshot('Paste Components');
      this.showToast(`Pasted ${newUids.length} component(s)`);
    } catch (err: any) {
      this.showToast(`Failed to paste: ${err?.message || err}`);
    }
  }

  private setupGlobalKeyboardShortcuts(): void {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      if (
        activeTag === 'input' ||
        activeTag === 'textarea' ||
        (document.activeElement as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      // Save As: Ctrl+Shift+S or Cmd+Shift+S
      if (isCtrlOrCmd && e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        this.handleSaveFileAs();
        return;
      }

      // Save: Ctrl+S or Cmd+S
      if (isCtrlOrCmd && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        this.handleSaveFile();
        return;
      }

      // Open: Ctrl+O or Cmd+O
      if (isCtrlOrCmd && !e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        this.handleOpenFile();
        return;
      }

      // New Circuit: Ctrl+N or Cmd+N
      if (isCtrlOrCmd && !e.shiftKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        if (!this._isDirty || confirm('Discard unsaved changes and create new circuit?')) {
          this.newCircuit();
        }
        return;
      }

      // Undo: Ctrl+Z
      if (isCtrlOrCmd && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        this.handleUndo();
        return;
      }

      // Redo: Ctrl+Y or Ctrl+Shift+Z
      if (
        (isCtrlOrCmd && (e.key === 'y' || e.key === 'Y')) ||
        (isCtrlOrCmd && e.shiftKey && (e.key === 'z' || e.key === 'Z'))
      ) {
        e.preventDefault();
        this.handleRedo();
        return;
      }

      // Cut: Ctrl+X
      if (isCtrlOrCmd && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
        this.handleCut();
        return;
      }

      // Copy: Ctrl+C
      if (isCtrlOrCmd && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        this.handleCopy();
        return;
      }

      // Paste: Ctrl+V
      if (isCtrlOrCmd && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        this.handlePaste();
        return;
      }

      // Select All: Ctrl+A
      if (isCtrlOrCmd && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        this._interaction.selectAll();
        return;
      }

      // Theme Toggle: Ctrl+T
      if (isCtrlOrCmd && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        const current = this._settingsModel.settings.themeMode || 'system';
        const next = current === 'system' ? 'dark' : current === 'dark' ? 'light' : 'system';
        this._settingsModel.update({ themeMode: next });
        const name = next === 'system' ? 'System (Auto)' : next === 'dark' ? 'Dark Mode' : 'Bright (Light)';
        this.showToast(`Theme switched to: ${name}`);
        return;
      }

      // Zoom Reset: Ctrl+0
      if (isCtrlOrCmd && e.key === '0') {
        e.preventDefault();
        this._interaction.zoom = 1.0;
        this._interaction.panX = 50;
        this._interaction.panY = 50;
        this._interaction.render();
        this.updateZoomDisplay();
        return;
      }

      // Zoom In: Ctrl+= or Ctrl++
      if (isCtrlOrCmd && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        this._interaction.zoom = Math.min(3.0, this._interaction.zoom * 1.2);
        this._interaction.render();
        this.updateZoomDisplay();
        return;
      }

      // Zoom Out: Ctrl+- or Ctrl+_
      if (isCtrlOrCmd && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        this._interaction.zoom = Math.max(0.3, this._interaction.zoom * 0.8);
        this._interaction.render();
        this.updateZoomDisplay();
        return;
      }

      // Fit View: Ctrl+F, Shift+F, or Ctrl+9
      if ((isCtrlOrCmd && (e.key === 'f' || e.key === 'F')) || (e.shiftKey && (e.key === 'F' || e.key === 'f')) || (isCtrlOrCmd && e.key === '9')) {
        e.preventDefault();
        this.fitView();
        return;
      }

      // Toggle Palette Sidebar: Ctrl+B
      if (isCtrlOrCmd && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        this.togglePalette();
        return;
      }

      // Toggle Properties Inspector: Ctrl+I
      if (isCtrlOrCmd && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        this.toggleProperties();
        return;
      }

      // Selection Mode [V] and Pan Mode [H] shortcuts
      if (!isCtrlOrCmd && !e.shiftKey && !e.altKey) {
        if (e.key === 'v' || e.key === 'V') {
          this._interaction.setTool('select');
          return;
        }
        if (e.key === 'h' || e.key === 'H') {
          this._interaction.setTool('pan');
          return;
        }
      }

      // Play / Pause simulation: Spacebar (when not panning)
      if (e.code === 'Space' && !e.repeat && !e.shiftKey && !e.ctrlKey) {
        // Spacebar is also used for pan drag if mouse is held down
      }
    });
  }

  private setupPalette(): void {
    const container = document.getElementById('palette-items');
    if (!container) return;

    const categories: Record<string, typeof COMPONENT_CATALOG> = {};
    for (const comp of COMPONENT_CATALOG) {
      if (!categories[comp.category]) categories[comp.category] = [];
      categories[comp.category].push(comp);
    }

    container.innerHTML = '';
    for (const [catName, comps] of Object.entries(categories)) {
      const groupDiv = document.createElement('div');
      groupDiv.className = 'category-group';

      const title = document.createElement('div');
      title.className = 'category-title';
      title.textContent = catName;
      groupDiv.appendChild(title);

      for (const comp of comps) {
        const item = this.createPaletteItemElement(comp);
        groupDiv.appendChild(item);
      }

      container.appendChild(groupDiv);
    }

    // Canvas drop target
    const canvasContainer = document.getElementById('canvas-container');
    if (canvasContainer) {
      canvasContainer.addEventListener('dragover', (e) => e.preventDefault());
      canvasContainer.addEventListener('drop', async (e) => {
        e.preventDefault();

        // 1. Check if user dropped a file from desktop / file explorer
        if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
          const file = e.dataTransfer.files[0];
          const filePath = (file as any).path || null;
          if (filePath && window.api && typeof window.api.readFile === 'function') {
            try {
              const content = await window.api.readFile(filePath);
              const fileName = this.getFileName(filePath);
              this.loadCircuitXml(content, fileName, filePath);
              return;
            } catch (err: any) {
              this.showToast(`Failed to open dropped file: ${err?.message || err}`);
              return;
            }
          }
          try {
            const buffer = await file.arrayBuffer();
            const uint8 = new Uint8Array(buffer);
            let text = '';
            let start = 0;
            if (uint8.length >= 3 && uint8[0] === 0xef && uint8[1] === 0xbb && uint8[2] === 0xbf) start = 3;
            while (
              start < uint8.length &&
              (uint8[start] === 0x20 || uint8[start] === 0x09 || uint8[start] === 0x0a || uint8[start] === 0x0d)
            ) {
              start++;
            }
            if (start < uint8.length && uint8[start] === 0x3c) {
              text = new TextDecoder('utf-8').decode(uint8);
            } else if (typeof DecompressionStream !== 'undefined') {
              try {
                const ds = new DecompressionStream('deflate-raw');
                const writer = ds.writable.getWriter();
                writer.write(uint8);
                writer.close();
                text = await new Response(ds.readable).text();
              } catch {
                text = new TextDecoder('utf-8').decode(uint8);
              }
            } else {
              text = new TextDecoder('utf-8').decode(uint8);
            }
            if (text) {
              this.loadCircuitXml(text, file.name, null);
              return;
            }
          } catch (err: any) {
            this.showToast(`Failed to read dropped file: ${err?.message || err}`);
            return;
          }
        }

        // 2. Palette component drop
        const type = e.dataTransfer?.getData('text/plain');
        if (type) {
          if (type === '%custom@logic.ly') {
            const customTemplates = this.getCustomICTemplates();
            if (customTemplates.length > 0) {
              const targetType = (this._lastUsedCustomTypeId && customTemplates.some(t => t.type === this._lastUsedCustomTypeId))
                ? this._lastUsedCustomTypeId
                : customTemplates[0].type;
              const c = this._parser.createCircuitInstance(targetType, '');
              if (c) {
                const pos = this._interaction.screenToWorld(e.clientX, e.clientY);
                this._interaction.addComponent(c, pos.x - 30, pos.y - 20);
                this._lastUsedCustomTypeId = targetType;
                const meta = this._parser.getCustomMetadata(targetType);
                this.showToast(`Placed Custom IC "${meta?.name || 'Custom IC'}" on canvas.`);
                this.recordUndoSnapshot('Add Custom IC');
              }
            } else {
              this.showCustomICGuideModal();
            }
            return;
          }
          const c = this._parser.createCircuitInstance(type, '');
          if (c) {
            const pos = this._interaction.screenToWorld(e.clientX, e.clientY);
            this._interaction.addComponent(c, pos.x - 30, pos.y - 20);
            if (this.isCustomType(type)) {
              this._lastUsedCustomTypeId = type;
            }
          }
        }
      });
    }

    // Search filter
    const searchInput = document.getElementById('palette-search') as HTMLInputElement;
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase();
        const items = container.querySelectorAll('.palette-item') as NodeListOf<HTMLElement>;
        items.forEach((item) => {
          const text = item.textContent?.toLowerCase() || '';
          item.style.display = text.includes(query) ? 'flex' : 'none';
        });
      });
    }

    this.updatePalettePlacementVisuals(this._interaction.placementType);
  }

  private setupToolbar(): void {
    // Undo / Redo
    const undoBtn = document.getElementById('btn-undo');
    if (undoBtn) undoBtn.addEventListener('click', () => this.handleUndo());

    const redoBtn = document.getElementById('btn-redo');
    if (redoBtn) redoBtn.addEventListener('click', () => this.handleRedo());

    // Cut, Copy, Paste, Delete
    const cutBtn = document.getElementById('btn-cut');
    if (cutBtn) cutBtn.addEventListener('click', () => this.handleCut());

    const copyBtn = document.getElementById('btn-copy');
    if (copyBtn) copyBtn.addEventListener('click', () => this.handleCopy());

    const pasteBtn = document.getElementById('btn-paste');
    if (pasteBtn) pasteBtn.addEventListener('click', () => this.handlePaste());

    const deleteBtn = document.getElementById('btn-delete');
    if (deleteBtn) deleteBtn.addEventListener('click', () => this._interaction.deleteSelected());

    // Play / Pause
    const playBtn = document.getElementById('btn-play');
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        this._isPlaying = !this._isPlaying;
        this.updatePlayButtonState();
      });
    }

    // Step
    const stepBtn = document.getElementById('btn-step');
    if (stepBtn) {
      stepBtn.addEventListener('click', () => {
        this._engine.advance(100);
        this._interaction.updateDynamicVisuals();
        this._interaction.renderWires();
      });
    }

    // Reset
    const resetBtn = document.getElementById('btn-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this._engine.reset();
        this._interaction.render();
        this._interaction.updateDynamicVisuals();
        this._interaction.renderWires();
      });
    }

    // Clear
    const clearBtn = document.getElementById('btn-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('Clear entire circuit canvas?')) {
          this.newCircuit();
        }
      });
    }

    // Speed Selector
    const speedSelect = document.getElementById('select-speed') as HTMLSelectElement;
    if (speedSelect) {
      speedSelect.addEventListener('change', () => {
        this._simSpeed = parseFloat(speedSelect.value) || 1.0;
      });
    }

    // Samples Custom Dropdown Button & Flyout Menu
    const samplesDropdownBtn = document.getElementById('btn-samples-dropdown');
    const samplesDropdownMenu = document.getElementById('samples-dropdown-menu');

    const closeSamplesDropdown = () => {
      if (samplesDropdownMenu && !samplesDropdownMenu.classList.contains('hidden')) {
        samplesDropdownMenu.classList.add('hidden');
        samplesDropdownBtn?.setAttribute('aria-expanded', 'false');
      }
    };

    if (samplesDropdownBtn && samplesDropdownMenu) {
      samplesDropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeOverflow();
        const isHidden = samplesDropdownMenu.classList.contains('hidden');
        if (isHidden) {
          samplesDropdownMenu.classList.remove('hidden');
          samplesDropdownBtn.setAttribute('aria-expanded', 'true');
        } else {
          closeSamplesDropdown();
        }
      });

      const sampleItems = samplesDropdownMenu.querySelectorAll('.sample-menu-item');
      sampleItems.forEach((item) => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const sampleKey = item.getAttribute('data-sample');
          if (sampleKey && SAMPLE_CIRCUITS[sampleKey]) {
            this.setSampleDropdownState(sampleKey);
            this.loadCircuitXml(SAMPLE_CIRCUITS[sampleKey], sampleKey, null);
          }
          closeSamplesDropdown();
        });
      });

      // Dismiss on click outside
      document.addEventListener('click', (e) => {
        if (!samplesDropdownMenu.contains(e.target as Node) && e.target !== samplesDropdownBtn) {
          closeSamplesDropdown();
        }
      });

      // Dismiss on Escape
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          closeSamplesDropdown();
        }
      });
    }

    // Fallback select element
    const sampleSelect = document.getElementById('select-samples') as HTMLSelectElement;
    if (sampleSelect) {
      sampleSelect.addEventListener('change', () => {
        const sampleName = sampleSelect.value;
        if (sampleName && SAMPLE_CIRCUITS[sampleName]) {
          this.setSampleDropdownState(sampleName);
          this.loadCircuitXml(SAMPLE_CIRCUITS[sampleName], sampleName, null);
        } else if (!sampleName) {
          this.resetSampleDropdownState();
        }
      });
    }

    // ANSI / IEC toggle
    const standardBtn = document.getElementById('btn-standard');
    if (standardBtn) {
      standardBtn.addEventListener('click', () => {
        const newStandard = this._isAnsi ? 'iec' : 'ansi';
        this._settingsModel.update({ skinName: newStandard });
      });
    }

    // Grid snap toggle
    const snapBtn = document.getElementById('btn-snap');
    if (snapBtn) {
      snapBtn.addEventListener('click', () => {
        const newSnap = !this._settingsModel.settings.snapToGrid;
        this._settingsModel.update({ snapToGrid: newSnap });
      });
    }

    // Zoom controls
    const zoomInBtn = document.getElementById('btn-zoom-in');
    const zoomOutBtn = document.getElementById('btn-zoom-out');
    const zoomResetBtn = document.getElementById('btn-zoom-reset');

    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', () => {
        this._interaction.zoom = Math.min(3.0, this._interaction.zoom * 1.2);
        this._interaction.render();
        this.updateZoomDisplay();
      });
    }
    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', () => {
        this._interaction.zoom = Math.max(0.3, this._interaction.zoom * 0.8);
        this._interaction.render();
        this.updateZoomDisplay();
      });
    }
    if (zoomResetBtn) {
      zoomResetBtn.addEventListener('click', () => {
        this._interaction.zoom = 1.0;
        this._interaction.panX = 50;
        this._interaction.panY = 50;
        this._interaction.render();
        this.updateZoomDisplay();
      });
    }

    const zoomFitBtn = document.getElementById('btn-zoom-fit');
    if (zoomFitBtn) {
      zoomFitBtn.addEventListener('click', () => {
        this.fitView();
      });
    }

    // Settings
    const settingsBtn = document.getElementById('btn-settings');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        this.openSettingsModal();
      });
    }

    // About
    const aboutBtn = document.getElementById('btn-about');
    if (aboutBtn) {
      aboutBtn.addEventListener('click', () => {
        this.showAboutModal();
      });
    }

    const brandHeader = document.getElementById('brand-header');
    if (brandHeader) {
      brandHeader.addEventListener('click', () => {
        this.showAboutModal();
      });
    }

    // Open file
    const openBtn = document.getElementById('btn-open');
    if (openBtn) {
      openBtn.addEventListener('click', async () => {
        await this.handleOpenFile();
      });
    }

    // Save file
    const saveBtn = document.getElementById('btn-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        await this.handleSaveFile();
      });
    }

    // New workspace button (in place of Save As on command bar)
    const newBtn = document.getElementById('btn-new');
    if (newBtn) {
      newBtn.addEventListener('click', () => {
        if (!this._isDirty || confirm('Discard unsaved changes and open a new workspace?')) {
          this.newCircuit();
        }
      });
    }

    // Save As file (support both old btn-save-as if present and menu-save-as)
    const saveAsBtn = document.getElementById('btn-save-as');
    if (saveAsBtn) {
      saveAsBtn.addEventListener('click', async () => {
        await this.handleSaveFileAs();
      });
    }

    // Package IC
    const packageBtn = document.getElementById('btn-package-ic');
    if (packageBtn) {
      packageBtn.addEventListener('click', () => {
        this.handlePackageIC();
      });
    }

    // Export Schematic (PNG)
    const exportBtn = document.getElementById('btn-export');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        this.exportPngImage();
      });
    }

    // Command Bar Overflow Menu ("•••" More Options)
    const overflowBtn = document.getElementById('btn-commandbar-overflow');
    const overflowMenu = document.getElementById('commandbar-overflow-menu');

    const closeOverflow = () => {
      if (overflowMenu && !overflowMenu.classList.contains('hidden')) {
        overflowMenu.classList.add('hidden');
        overflowBtn?.setAttribute('aria-expanded', 'false');
      }
    };

    if (overflowBtn && overflowMenu) {
      overflowBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeSamplesDropdown();
        const isHidden = overflowMenu.classList.contains('hidden');
        if (isHidden) {
          overflowMenu.classList.remove('hidden');
          overflowBtn.setAttribute('aria-expanded', 'true');
        } else {
          overflowMenu.classList.add('hidden');
          overflowBtn.setAttribute('aria-expanded', 'false');
        }
      });

      // Dismiss on click outside
      document.addEventListener('click', (e) => {
        if (!overflowMenu.contains(e.target as Node) && e.target !== overflowBtn) {
          closeOverflow();
        }
      });

      // Dismiss on Escape key
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          closeOverflow();
        }
      });
    }

    // Overflow Menu Item: Package Custom IC
    const menuPackageBtn = document.getElementById('menu-package-ic');
    if (menuPackageBtn) {
      menuPackageBtn.addEventListener('click', () => {
        closeOverflow();
        this.handlePackageIC();
      });
    }

    // Overflow Menu Item: Save As
    const menuSaveAsBtn = document.getElementById('menu-save-as');
    if (menuSaveAsBtn) {
      menuSaveAsBtn.addEventListener('click', async () => {
        closeOverflow();
        await this.handleSaveFileAs();
      });
    }

    // Overflow Menu Item: Export Schematic (PNG)
    const menuExportBtn = document.getElementById('menu-export-png') || document.getElementById('menu-export-svg');
    if (menuExportBtn) {
      menuExportBtn.addEventListener('click', () => {
        closeOverflow();
        this.exportPngImage();
      });
    }

    // Overflow Menu Item: Clear Canvas
    const menuClearBtn = document.getElementById('menu-clear-canvas');
    if (menuClearBtn) {
      menuClearBtn.addEventListener('click', () => {
        closeOverflow();
        if (confirm('Clear entire circuit canvas?')) {
          this.newCircuit();
        }
      });
    }

    // Overflow Menu Item: Preferences & Settings
    const menuSettingsBtn = document.getElementById('menu-settings');
    if (menuSettingsBtn) {
      menuSettingsBtn.addEventListener('click', () => {
        closeOverflow();
        this.openSettingsModal();
      });
    }

    // Overflow Menu Item: About ProLogic
    const menuAboutBtn = document.getElementById('menu-about');
    if (menuAboutBtn) {
      menuAboutBtn.addEventListener('click', () => {
        closeOverflow();
        this.showAboutModal();
      });
    }

    // Theme Toggle in Status Bar (Above Taskbar)
    const themeBtn = document.getElementById('btn-theme-toggle');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const current = this._settingsModel.settings.themeMode || 'system';
        const next = current === 'system' ? 'dark' : current === 'dark' ? 'light' : 'system';
        this._settingsModel.update({ themeMode: next });
        const name = next === 'system' ? 'System (Auto)' : next === 'dark' ? 'Dark Mode' : 'Bright (Light)';
        this.showToast(`Theme switched to: ${name}`);
      });
    }

    // Overflow Menu Unified Theme Toggle
    const menuThemeBtn = document.getElementById('menu-theme-toggle');
    if (menuThemeBtn) {
      menuThemeBtn.addEventListener('click', () => {
        closeOverflow();
        const current = this._settingsModel.settings.themeMode || 'system';
        const next = current === 'system' ? 'dark' : current === 'dark' ? 'light' : 'system';
        this._settingsModel.update({ themeMode: next });
        const name = next === 'system' ? 'Follow Windows (System)' : next === 'dark' ? 'Dark Mode' : 'Bright (Light)';
        this.showToast(`Theme switched to: ${name}`);
      });
    }
  }

  /* ==========================================================================
     Workbench Layout, Custom Title Bar & Splitter Mechanisms
     ========================================================================== */

  private setupTitlebar(): void {
    const minBtn = document.getElementById('btn-win-minimize');
    const maxBtn = document.getElementById('btn-win-maximize');
    const closeBtn = document.getElementById('btn-win-close');

    minBtn?.addEventListener('click', () => {
      window.api?.minimizeWindow();
    });

    maxBtn?.addEventListener('click', () => {
      window.api?.maximizeWindow();
    });

    closeBtn?.addEventListener('click', () => {
      this.handleRequestClose();
    });

    if (window.api && typeof window.api.onRequestClose === 'function') {
      window.api.onRequestClose(() => {
        this.handleRequestClose();
      });
    }

    window.addEventListener('beforeunload', (e) => {
      if (this._isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // Maximized state sync
    if (window.api?.onMaximizedChange) {
      window.api.onMaximizedChange((isMaximized: boolean) => {
        this.updateMaximizeIcon(isMaximized);
      });
    }

    // Initial check if window is maximized
    if (window.api?.isMaximized) {
      window.api.isMaximized().then((isMax: boolean) => {
        this.updateMaximizeIcon(isMax);
      }).catch(() => {});
    }
  }

  private updateMaximizeIcon(isMaximized: boolean): void {
    const maxIcon = document.getElementById('icon-win-maximize');
    const restoreIcon = document.getElementById('icon-win-restore');
    if (maxIcon && restoreIcon) {
      maxIcon.style.display = isMaximized ? 'none' : 'block';
      restoreIcon.style.display = isMaximized ? 'block' : 'none';
    }
  }

  public setDocumentTitle(title: string, dirty: boolean = false): void {
    this._currentDocumentTitle = title;
    const titleElem = document.getElementById('titlebar-circuit-title');
    if (titleElem) {
      titleElem.textContent = title;
    }
    this.setDirty(dirty);
  }

  public setDirty(dirty: boolean): void {
    this._isDirty = dirty;
    const dirtyElem = document.getElementById('titlebar-dirty-indicator');
    if (dirtyElem) {
      dirtyElem.style.display = dirty ? 'inline' : 'none';
    }
    const dirtySuffix = dirty ? ' •' : '';
    document.title = `${this._currentDocumentTitle}${dirtySuffix}`;
  }

  private updatePlayButtonState(): void {
    const playBtn = document.getElementById('btn-play');
    if (!playBtn) return;
    playBtn.classList.toggle('btn-active', this._isPlaying);
    const label = playBtn.querySelector('.btn-label-text');
    if (label) {
      label.textContent = this._isPlaying ? 'Pause' : 'Play';
    } else {
      playBtn.textContent = this._isPlaying ? 'Pause' : 'Play';
    }
    const icon = playBtn.querySelector('svg');
    if (icon) {
      if (this._isPlaying) {
        icon.setAttribute('viewBox', '0 0 320 512');
        icon.className.baseVal = 'icon-pause';
        icon.innerHTML = `<path d="M48 64C21.5 64 0 85.5 0 112V400c0 26.5 21.5 48 48 48H80c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H48zm192 0c-26.5 0-48 21.5-48 48V400c0 26.5 21.5 48 48 48h32c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H240z"/>`;
      } else {
        icon.setAttribute('viewBox', '0 0 384 512');
        icon.className.baseVal = 'icon-play';
        icon.innerHTML = `<path d="M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80V432c0 17.4 9.4 33.4 24.5 41.9s33.7 8.1 48.5-.9L361 297c14.3-8.7 23-24.2 23-41s-8.7-32.2-23-41L73 39z"/>`;
      }
    }
  }

  // Symmetrical Animated Sidebar Toggles
  public togglePalette(forceOpen?: boolean): void {
    const paletteSidebar = document.getElementById('palette-sidebar');
    const splitterPalette = document.getElementById('splitter-palette');
    const btnExpandPalette = document.getElementById('btn-expand-palette');
    if (!paletteSidebar) return;

    const shouldCollapse = forceOpen !== undefined ? !forceOpen : !this._isPaletteCollapsed;
    this._isPaletteCollapsed = shouldCollapse;
    paletteSidebar.classList.toggle('collapsed', shouldCollapse);

    const w = paletteSidebar.offsetWidth || this._paletteWidth || 260;
    if (shouldCollapse) {
      paletteSidebar.style.marginLeft = `-${w}px`;
    } else {
      paletteSidebar.style.marginLeft = '0px';
    }

    if (btnExpandPalette) {
      btnExpandPalette.style.display = shouldCollapse ? 'flex' : 'none';
    }

    if (splitterPalette) {
      if (shouldCollapse) {
        splitterPalette.style.opacity = '0';
        splitterPalette.style.pointerEvents = 'none';
        setTimeout(() => {
          if (this._isPaletteCollapsed) splitterPalette.style.display = 'none';
        }, 280);
      } else {
        splitterPalette.style.display = 'flex';
        splitterPalette.style.pointerEvents = '';
        requestAnimationFrame(() => {
          splitterPalette.style.opacity = '1';
        });
      }
    }
  }

  public toggleProperties(forceOpen?: boolean): void {
    const propertiesSidebar = document.getElementById('properties-sidebar');
    const splitterProperties = document.getElementById('splitter-properties');
    const btnExpandProperties = document.getElementById('btn-expand-properties');
    if (!propertiesSidebar) return;

    const shouldCollapse = forceOpen !== undefined ? !forceOpen : !this._isPropertiesCollapsed;
    this._isPropertiesCollapsed = shouldCollapse;
    propertiesSidebar.classList.toggle('collapsed', shouldCollapse);

    const w = propertiesSidebar.offsetWidth || this._propertiesWidth || 250;
    if (shouldCollapse) {
      propertiesSidebar.style.marginRight = `-${w}px`;
    } else {
      propertiesSidebar.style.marginRight = '0px';
    }

    if (btnExpandProperties) {
      btnExpandProperties.style.display = shouldCollapse ? 'flex' : 'none';
    }

    if (splitterProperties) {
      if (shouldCollapse) {
        splitterProperties.style.opacity = '0';
        splitterProperties.style.pointerEvents = 'none';
        setTimeout(() => {
          if (this._isPropertiesCollapsed) splitterProperties.style.display = 'none';
        }, 280);
      } else {
        splitterProperties.style.display = 'flex';
        splitterProperties.style.pointerEvents = '';
        requestAnimationFrame(() => {
          splitterProperties.style.opacity = '1';
        });
      }
    }
  }

  public openPropertiesInspector(circuit?: ICircuit): void {
    if (circuit) {
      this._interaction.selectedCircuit = circuit;
    }
    this.toggleProperties(true);
    setTimeout(() => {
      const panel = document.getElementById('properties-content');
      if (panel) {
        const targetInput = panel.querySelector<HTMLElement>(
          '#prop-gate-behavior, #prop-switch-reset, #prop-inputs-count, #prop-export-name, #prop-clock-freq, #prop-label-text, select, input:not([readonly])'
        );
        targetInput?.focus();
      }
    }, 50);
  }

  private setupSplittersAndSidebars(): void {
    const paletteSidebar = document.getElementById('palette-sidebar');
    const propertiesSidebar = document.getElementById('properties-sidebar');
    const splitterPalette = document.getElementById('splitter-palette');
    const splitterProperties = document.getElementById('splitter-properties');

    const btnCollapsePalette = document.getElementById('btn-collapse-palette');
    const btnExpandPalette = document.getElementById('btn-expand-palette');

    const btnCollapseProperties = document.getElementById('btn-collapse-properties');
    const btnExpandProperties = document.getElementById('btn-expand-properties');

    btnCollapsePalette?.addEventListener('click', () => this.togglePalette(false));
    btnExpandPalette?.addEventListener('click', () => this.togglePalette(true));

    btnCollapseProperties?.addEventListener('click', () => this.toggleProperties(false));
    btnExpandProperties?.addEventListener('click', () => this.toggleProperties(true));

    // Left Splitter (Palette) Draggable Resizing
    if (splitterPalette && paletteSidebar) {
      let isDragging = false;
      let startX = 0;
      let startWidth = 0;

      const onMouseDown = (e: MouseEvent) => {
        isDragging = true;
        startX = e.clientX;
        startWidth = paletteSidebar.offsetWidth;
        document.body.classList.add('resizing-ew');
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        e.preventDefault();
      };

      const onMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;
        const delta = e.clientX - startX;
        const newWidth = Math.max(180, Math.min(450, startWidth + delta));
        this._paletteWidth = newWidth;
        paletteSidebar.style.width = `${newWidth}px`;
      };

      const onMouseUp = () => {
        if (!isDragging) return;
        isDragging = false;
        document.body.classList.remove('resizing-ew');
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      splitterPalette.addEventListener('mousedown', onMouseDown);
    }

    // Right Splitter (Properties) Draggable Resizing
    if (splitterProperties && propertiesSidebar) {
      let isDragging = false;
      let startX = 0;
      let startWidth = 0;

      const onMouseDown = (e: MouseEvent) => {
        isDragging = true;
        startX = e.clientX;
        startWidth = propertiesSidebar.offsetWidth;
        document.body.classList.add('resizing-ew');
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        e.preventDefault();
      };

      const onMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;
        const delta = startX - e.clientX;
        const newWidth = Math.max(200, Math.min(450, startWidth + delta));
        this._propertiesWidth = newWidth;
        propertiesSidebar.style.width = `${newWidth}px`;
      };

      const onMouseUp = () => {
        if (!isDragging) return;
        isDragging = false;
        document.body.classList.remove('resizing-ew');
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      splitterProperties.addEventListener('mousedown', onMouseDown);
    }
  }

  private setupCanvasHud(): void {
    const btnSelect = document.getElementById('btn-tool-select');
    const btnPan = document.getElementById('btn-tool-pan');

    const updateToolButtons = (tool: 'select' | 'pan') => {
      btnSelect?.classList.toggle('active', tool === 'select');
      btnPan?.classList.toggle('active', tool === 'pan');
    };

    btnSelect?.addEventListener('click', () => {
      this._interaction.setTool('select');
      updateToolButtons('select');
    });

    btnPan?.addEventListener('click', () => {
      this._interaction.setTool('pan');
      updateToolButtons('pan');
    });

    this._interaction.onToolChange = (tool) => {
      updateToolButtons(tool);
    };

    const hudZoomIn = document.getElementById('btn-hud-zoom-in');
    const hudZoomOut = document.getElementById('btn-hud-zoom-out');
    const hudZoomReset = document.getElementById('btn-hud-zoom-reset');
    const hudZoomFit = document.getElementById('btn-hud-zoom-fit');

    hudZoomIn?.addEventListener('click', () => {
      this._interaction.zoom = Math.min(3.0, this._interaction.zoom * 1.2);
      this._interaction.render();
      this.updateZoomDisplay();
    });

    hudZoomOut?.addEventListener('click', () => {
      this._interaction.zoom = Math.max(0.3, this._interaction.zoom * 0.8);
      this._interaction.render();
      this.updateZoomDisplay();
    });

    hudZoomReset?.addEventListener('click', () => {
      this._interaction.zoom = 1.0;
      this._interaction.panX = 50;
      this._interaction.panY = 50;
      this._interaction.render();
      this.updateZoomDisplay();
    });

    hudZoomFit?.addEventListener('click', () => {
      this.fitView();
    });

    this.updateZoomDisplay();
  }

  public updateZoomDisplay(): void {
    const zoomPercent = Math.round(this._interaction.zoom * 100);
    const hudLabel = document.getElementById('hud-zoom-label');
    if (hudLabel) {
      hudLabel.textContent = `${zoomPercent}%`;
    }
    const zoomResetBtn = document.getElementById('btn-zoom-reset');
    if (zoomResetBtn) {
      zoomResetBtn.textContent = `${zoomPercent}%`;
    }
  }

  public fitView(): void {
    this._interaction.zoomToFit();
    this.updateZoomDisplay();
    this.showToast('Fit view to circuit components');
  }

  private setupSettingsModal(): void {
    const modal = document.getElementById('modal-settings');
    const closeBtn = document.getElementById('btn-settings-close');
    const saveBtn = document.getElementById('btn-settings-save');
    const restoreBtn = document.getElementById('btn-settings-restore');

    const closeModal = () => {
      if (modal) modal.style.display = 'none';
    };

    closeBtn?.addEventListener('click', closeModal);
    saveBtn?.addEventListener('click', closeModal);

    restoreBtn?.addEventListener('click', () => {
      if (confirm('Reset all preferences to default values?')) {
        this._settingsModel.resetToDefaults();
        this.syncSettingsInputs();
        this.showToast('Restored default preferences');
      }
    });

    // Tab buttons
    const tabs = ['surface', 'colors', 'simulation'];
    tabs.forEach((tab) => {
      const btn = document.getElementById(`tab-btn-${tab}`);
      const content = document.getElementById(`tab-content-${tab}`);
      btn?.addEventListener('click', () => {
        tabs.forEach((t) => {
          document.getElementById(`tab-btn-${t}`)?.classList.toggle('active', t === tab);
          document.getElementById(`tab-content-${t}`)?.classList.toggle('active', t === tab);
        });
      });
    });

    // Inputs real-time syncing
    const themeMode = document.getElementById('setting-theme-mode') as HTMLSelectElement;
    themeMode?.addEventListener('change', () => {
      this._settingsModel.update({ themeMode: themeMode.value as any });
    });

    const snapGrid = document.getElementById('setting-snap-grid') as HTMLInputElement;
    snapGrid?.addEventListener('change', () => {
      this._settingsModel.update({ snapToGrid: snapGrid.checked });
    });

    const snapOrthogonal = document.getElementById('setting-snap-orthogonal-wires') as HTMLInputElement;
    snapOrthogonal?.addEventListener('change', () => {
      this._settingsModel.update({ snapOrthogonalWires: snapOrthogonal.checked });
    });

    const gridSize = document.getElementById('setting-grid-size') as HTMLSelectElement;
    gridSize?.addEventListener('change', () => {
      this._settingsModel.update({ gridSize: parseInt(gridSize.value, 10) || 15 });
    });

    const showGrid = document.getElementById('setting-show-grid') as HTMLInputElement;
    showGrid?.addEventListener('change', () => {
      this._settingsModel.update({ showGrid: showGrid.checked });
    });

    const showPalette = document.getElementById('setting-show-palette') as HTMLInputElement;
    showPalette?.addEventListener('change', () => {
      this._settingsModel.update({ showPalette: showPalette.checked });
    });

    const gateStandard = document.getElementById('setting-gate-standard') as HTMLSelectElement;
    gateStandard?.addEventListener('change', () => {
      this._settingsModel.update({ skinName: gateStandard.value as 'ansi' | 'iec' });
    });

    const enableWireColors = document.getElementById('setting-enable-wire-colors') as HTMLInputElement;
    enableWireColors?.addEventListener('change', () => {
      this._settingsModel.update({ enableWireColors: enableWireColors.checked });
    });

    const colorHigh = document.getElementById('setting-color-high') as HTMLInputElement;
    colorHigh?.addEventListener('input', () => {
      this._settingsModel.update({ highSignalColor: colorHigh.value });
    });

    const colorLow = document.getElementById('setting-color-low') as HTMLInputElement;
    colorLow?.addEventListener('input', () => {
      this._settingsModel.update({ lowSignalColor: colorLow.value });
    });

    const colorHiz = document.getElementById('setting-color-hiz') as HTMLInputElement;
    colorHiz?.addEventListener('input', () => {
      this._settingsModel.update({ hiZSignalColor: colorHiz.value });
    });

    const colorConflict = document.getElementById('setting-color-conflict') as HTMLInputElement;
    colorConflict?.addEventListener('input', () => {
      this._settingsModel.update({ unknownSignalColor: colorConflict.value });
    });

    const limitFramerate = document.getElementById('setting-limit-framerate') as HTMLInputElement;
    limitFramerate?.addEventListener('change', () => {
      this._settingsModel.update({ limitPropagationToFrameRate: limitFramerate.checked });
    });

    const pauseOnLoad = document.getElementById('setting-pause-on-load') as HTMLInputElement;
    pauseOnLoad?.addEventListener('change', () => {
      this._settingsModel.update({ pauseSimulationOnChangeDocument: pauseOnLoad.checked });
    });

    const defaultFloat = document.getElementById('setting-default-float') as HTMLSelectElement;
    defaultFloat?.addEventListener('change', () => {
      const val = defaultFloat.value as 'undefined' | 'false' | 'true';
      this._settingsModel.update({ defaultFloatSignal: val });
      this._engine.setDefaultFloatSignal(val);
      this._interaction.render();
    });
  }

  private openSettingsModal(): void {
    this.syncSettingsInputs();
    const modal = document.getElementById('modal-settings');
    if (modal) modal.style.display = 'flex';
  }

  private syncSettingsInputs(): void {
    const s = this._settingsModel.settings;

    const themeMode = document.getElementById('setting-theme-mode') as HTMLSelectElement;
    if (themeMode) themeMode.value = s.themeMode || 'system';

    const snapGrid = document.getElementById('setting-snap-grid') as HTMLInputElement;
    if (snapGrid) snapGrid.checked = s.snapToGrid;

    const snapOrthogonal = document.getElementById('setting-snap-orthogonal-wires') as HTMLInputElement;
    if (snapOrthogonal) snapOrthogonal.checked = s.snapOrthogonalWires;

    const gridSize = document.getElementById('setting-grid-size') as HTMLSelectElement;
    if (gridSize) gridSize.value = s.gridSize.toString();

    const showGrid = document.getElementById('setting-show-grid') as HTMLInputElement;
    if (showGrid) showGrid.checked = s.showGrid;

    const showPalette = document.getElementById('setting-show-palette') as HTMLInputElement;
    if (showPalette) showPalette.checked = s.showPalette;

    const gateStandard = document.getElementById('setting-gate-standard') as HTMLSelectElement;
    if (gateStandard) gateStandard.value = s.skinName;

    const enableWireColors = document.getElementById('setting-enable-wire-colors') as HTMLInputElement;
    if (enableWireColors) enableWireColors.checked = s.enableWireColors;

    const colorHigh = document.getElementById('setting-color-high') as HTMLInputElement;
    if (colorHigh) colorHigh.value = s.highSignalColor;

    const colorLow = document.getElementById('setting-color-low') as HTMLInputElement;
    if (colorLow) colorLow.value = s.lowSignalColor;

    const colorHiz = document.getElementById('setting-color-hiz') as HTMLInputElement;
    if (colorHiz) colorHiz.value = s.hiZSignalColor;

    const colorConflict = document.getElementById('setting-color-conflict') as HTMLInputElement;
    if (colorConflict) colorConflict.value = s.unknownSignalColor;

    const limitFramerate = document.getElementById('setting-limit-framerate') as HTMLInputElement;
    if (limitFramerate) limitFramerate.checked = s.limitPropagationToFrameRate;

    const pauseOnLoad = document.getElementById('setting-pause-on-load') as HTMLInputElement;
    if (pauseOnLoad) pauseOnLoad.checked = s.pauseSimulationOnChangeDocument;

    const defaultFloat = document.getElementById('setting-default-float') as HTMLSelectElement;
    if (defaultFloat) defaultFloat.value = s.defaultFloatSignal;
  }

  private setupPropertiesPanel(): void {
    const panel = document.getElementById('properties-content');
    if (!panel) return;

    this._interaction.onComponentDoubleClick = (circuit: ICircuit) => {
      this.openPropertiesInspector(circuit);
    };

    this._interaction.onSelectionChange = (circuit, allSelected) => {
      if (allSelected.length === 0) {
        panel.innerHTML = `<div style="color: var(--text-muted); font-size: 12px; margin-top: 10px;">Select a component on the canvas to inspect its pins and properties.</div>`;
        return;
      }

      if (allSelected.length > 1) {
        panel.innerHTML = `
          <div class="inspector-card-header">
            <div class="inspector-card-title">Multiple Selection</div>
            <div class="inspector-action-bar">
              <button id="btn-prop-rotate-multi" class="btn" title="Rotate all selected components 90° (R)">
                <svg width="11" height="11" viewBox="0 0 512 512" fill="currentColor"><path d="M463.5 224H472c13.3 0 24-10.7 24-24V72c0-9.7-5.8-18.5-14.8-22.2s-19.3-1.7-26.2 5.2L413.4 96.6c-87.6-86.5-228.7-86.2-315.8 1c-87.5 87.5-87.5 229.3 0 316.8s229.3 87.5 316.8 0c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0c-62.5 62.5-163.8 62.5-226.3 0s-62.5-163.8 0-226.3c62.2-62.2 162.7-62.5 225.3-1L327 183c-6.9 6.9-8.9 17.2-5.2 26.2s12.5 14.8 22.2 14.8H463.5z"/></svg>
                <span>Rotate All</span>
              </button>
              <button id="btn-prop-del-multi" class="btn" style="color: #ef4444;" title="Delete all selected components (Del)">
                <svg width="11" height="11" viewBox="0 0 448 512" fill="currentColor"><path d="M135.2 17.7C140.6 6.8 151.7 0 163.8 0H284.2c12.1 0 23.2 6.8 28.6 17.7L320 32h96c17.7 0 32 14.3 32 32s-14.3 32-32 32H32C14.3 96 0 81.7 0 64S14.3 32 32 32h96l7.2-14.3zM32 128H416V448c0 35.3-28.7 64-64 64H96c-35.3 0-64-28.7-64-64V128zm96 64c-8.8 0-16 7.2-16 16V432c0 8.8 7.2 16 16 16s16-7.2 16-16V208c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16V432c0 8.8 7.2 16 16 16s16-7.2 16-16V208c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16V432c0 8.8 7.2 16 16 16s16-7.2 16-16V208c0-8.8-7.2-16-16-16z"/></svg>
                <span>Delete All</span>
              </button>
            </div>
          </div>
          <div class="property-row">
            <label class="property-label">Selected Items</label>
            <div style="font-size: 12px; color: var(--text-primary); font-weight: 600;">${allSelected.length} components</div>
          </div>
          <div style="color: var(--text-muted); font-size: 11px; margin-top: 12px; line-height: 1.5;">
            Drag any selected component to move all items together. Press [R] to rotate or [Del] to delete all selected items.
          </div>
        `;

        document.getElementById('btn-prop-rotate-multi')?.addEventListener('click', () => {
          this._interaction.rotateSelected();
        });
        document.getElementById('btn-prop-del-multi')?.addEventListener('click', () => {
          this._interaction.deleteSelected();
        });
        return;
      }

      // Single component inspection
      if (!circuit) return;
      let compTitle = (circuit.label || circuit.type.replace('@logic.ly', '')).toUpperCase();
      if (circuit.type === 'rs_flip_flop@logic.ly' || circuit.type === 'sr_flip_flop@logic.ly') {
        compTitle = 'SR FLIP FLOP';
      }
      let html = `
        <div class="inspector-card-header">
          <div class="inspector-card-title">${compTitle}</div>
          <div class="inspector-action-bar">
            <button id="btn-prop-rotate" class="btn" title="Rotate 90° (R)">
              <svg width="11" height="11" viewBox="0 0 512 512" fill="currentColor"><path d="M463.5 224H472c13.3 0 24-10.7 24-24V72c0-9.7-5.8-18.5-14.8-22.2s-19.3-1.7-26.2 5.2L413.4 96.6c-87.6-86.5-228.7-86.2-315.8 1c-87.5 87.5-87.5 229.3 0 316.8s229.3 87.5 316.8 0c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0c-62.5 62.5-163.8 62.5-226.3 0s-62.5-163.8 0-226.3c62.2-62.2 162.7-62.5 225.3-1L327 183c-6.9 6.9-8.9 17.2-5.2 26.2s12.5 14.8 22.2 14.8H463.5z"/></svg>
              <span>Rotate</span>
            </button>
            <button id="btn-prop-delete" class="btn" style="color: #ef4444;" title="Delete Component (Del)">
              <svg width="11" height="11" viewBox="0 0 448 512" fill="currentColor"><path d="M135.2 17.7C140.6 6.8 151.7 0 163.8 0H284.2c12.1 0 23.2 6.8 28.6 17.7L320 32h96c17.7 0 32 14.3 32 32s-14.3 32-32 32H32C14.3 96 0 81.7 0 64S14.3 32 32 32h96l7.2-14.3zM32 128H416V448c0 35.3-28.7 64-64 64H96c-35.3 0-64-28.7-64-64V128zm96 64c-8.8 0-16 7.2-16 16V432c0 8.8 7.2 16 16 16s16-7.2 16-16V208c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16V432c0 8.8 7.2 16 16 16s16-7.2 16-16V208c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16V432c0 8.8 7.2 16 16 16s16-7.2 16-16V208c0-8.8-7.2-16-16-16z"/></svg>
              <span>Delete</span>
            </button>
          </div>
        </div>
      `;

      // UID
      html += `
        <div class="property-row">
          <label class="property-label">UID</label>
          <input class="property-input" readonly value="${circuit.uid}" style="font-size: 10px; color: var(--text-muted);" />
        </div>
      `;

      // Complex Circuit Pin Summary
      if (circuit instanceof ComplexCircuit) {
        html += `
          <div class="property-row">
            <label class="property-label">Inputs</label>
            <div style="font-size: 11px; color: var(--text-secondary);">
              ${circuit.inputsCount} pin(s)${circuit.inputsCount > 0 ? ': ' + Array.from({length: circuit.inputsCount}, (_, i) => circuit.getInputExportNameAt(i) || `#${i}`).join(', ') : ''}
            </div>
          </div>
          <div class="property-row">
            <label class="property-label">Outputs</label>
            <div style="font-size: 11px; color: var(--text-secondary);">
              ${circuit.outputsCount} pin(s)${circuit.outputsCount > 0 ? ': ' + Array.from({length: circuit.outputsCount}, (_, i) => circuit.getOutputExportNameAt(i) || `#${i}`).join(', ') : ''}
            </div>
          </div>
        `;
      }

      // Export pin name
      html += `
        <div class="property-row">
          <label class="property-label">Export Pin Name</label>
          <input id="prop-export-name" class="property-input" value="${circuit.exportName || ''}" placeholder="e.g. InA, Clock, Q" />
        </div>
      `;

      // Inputs count for variable gates
      if ('inputsCount' in circuit && 'setInputsCount' in circuit) {
        const varCircuit = circuit as unknown as IVariableInputCircuit;
        html += `
          <div class="property-row">
            <label class="property-label">Input Pins (1 - 16)</label>
            <input id="prop-inputs-count" type="number" min="1" max="16" class="property-input" value="${varCircuit.inputsCount}" />
          </div>
        `;
      }

      // Behavior for XOR and XNOR gates
      if (circuit instanceof XORGateCircuit) {
        html += `
          <div class="property-row">
            <label class="property-label">Behavior</label>
            <select id="prop-gate-behavior" class="property-input">
              <option value="0" ${circuit.functionIndex === 0 ? 'selected' : ''}>Odd number of inputs are high</option>
              <option value="1" ${circuit.functionIndex === 1 ? 'selected' : ''}>Exactly one input is high</option>
            </select>
          </div>
        `;
      } else if (circuit instanceof XNORGateCircuit) {
        html += `
          <div class="property-row">
            <label class="property-label">Behavior</label>
            <select id="prop-gate-behavior" class="property-input">
              <option value="0" ${circuit.functionIndex === 0 ? 'selected' : ''}>Odd number of inputs are low</option>
              <option value="1" ${circuit.functionIndex === 1 ? 'selected' : ''}>Exactly one input is low</option>
            </select>
          </div>
        `;
      }

      // Signal After Reset for Toggle Switch
      if (circuit instanceof SwitchCircuit) {
        html += `
          <div class="property-row">
            <label class="property-label">Signal After Reset</label>
            <select id="prop-switch-reset" class="property-input">
              <option value="false" ${!circuit.defaultState ? 'selected' : ''}>Low</option>
              <option value="true" ${circuit.defaultState ? 'selected' : ''}>High</option>
            </select>
          </div>
        `;
      }

      // Frequency for clock
      if (circuit instanceof ClockCircuit) {
        html += `
          <div class="property-row">
            <label class="property-label">Clock Period (ms)</label>
            <input id="prop-clock-freq" type="number" min="50" step="50" class="property-input" value="${circuit.frequency}" />
          </div>
        `;
      }

      // Text & Rich Formatting for label
      if (circuit instanceof LabelCircuit) {
        const fontSizes = [10, 12, 13, 14, 16, 18, 24, 32, 48];
        const currentFontSize = circuit.fontSize || 13;
        const currentAlignment = circuit.alignment || 'left';
        const currentColor = (circuit.color || '').toLowerCase();

        html += `
          <div class="property-row">
            <label class="property-label">Label Text</label>
            <textarea id="prop-label-text" class="property-input" rows="3" style="resize: vertical; font-family: inherit;">${circuit.text}</textarea>
          </div>

          <div class="property-row">
            <label class="property-label">Typography</label>
            <div style="display: flex; gap: 6px; align-items: center; width: 100%;">
              <select id="prop-font-size" class="property-input" style="flex: 1; min-width: 0; padding: 4px 6px;">
                ${fontSizes.map((sz) => `<option value="${sz}" ${sz === currentFontSize ? 'selected' : ''}>${sz}px${sz === 13 ? ' (Default)' : ''}</option>`).join('')}
              </select>
              <button id="btn-prop-bold" class="btn ${circuit.bold ? 'active' : ''}" style="width: 32px; height: 28px; padding: 0; font-family: serif; display: inline-flex; align-items: center; justify-content: center; ${circuit.bold ? 'background: var(--signal-high, #00f5d4); color: #000; font-weight: 900;' : 'font-weight: 700;'}" title="Bold">
                B
              </button>
              <button id="btn-prop-italic" class="btn ${circuit.italic ? 'active' : ''}" style="width: 32px; height: 28px; padding: 0; font-style: italic; font-family: serif; display: inline-flex; align-items: center; justify-content: center; ${circuit.italic ? 'background: var(--signal-high, #00f5d4); color: #000;' : ''}" title="Italic">
                I
              </button>
            </div>
          </div>

          <div class="property-row">
            <label class="property-label">Alignment</label>
            <div style="display: flex; gap: 4px; width: 100%;">
              <button id="btn-prop-align-left" class="btn ${currentAlignment === 'left' ? 'active' : ''}" style="flex: 1; height: 28px; padding: 0; display: inline-flex; align-items: center; justify-content: center; ${currentAlignment === 'left' ? 'background: var(--signal-high, #00f5d4); color: #000;' : ''}" title="Align Left">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path fill-rule="evenodd" d="M2 3.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm0 3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm0 3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm0 3a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5z"/>
                </svg>
              </button>
              <button id="btn-prop-align-center" class="btn ${currentAlignment === 'center' ? 'active' : ''}" style="flex: 1; height: 28px; padding: 0; display: inline-flex; align-items: center; justify-content: center; ${currentAlignment === 'center' ? 'background: var(--signal-high, #00f5d4); color: #000;' : ''}" title="Align Center">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path fill-rule="evenodd" d="M2 3.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm2 3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-2 3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm3 3a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5z"/>
                </svg>
              </button>
              <button id="btn-prop-align-right" class="btn ${currentAlignment === 'right' ? 'active' : ''}" style="flex: 1; height: 28px; padding: 0; display: inline-flex; align-items: center; justify-content: center; ${currentAlignment === 'right' ? 'background: var(--signal-high, #00f5d4); color: #000;' : ''}" title="Align Right">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path fill-rule="evenodd" d="M2 3.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm4 3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-4 3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm6 3a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5z"/>
                </svg>
              </button>
            </div>
          </div>

          <div class="property-row">
            <label class="property-label">Font Color</label>
            <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
              <button class="color-swatch-btn" data-color="" title="Default (Theme)" style="width: 22px; height: 22px; border-radius: 50%; border: 2px solid ${!currentColor ? 'var(--signal-high, #00f5d4)' : 'rgba(255,255,255,0.3)'}; background: linear-gradient(135deg, #334155 50%, #94a3b8 50%); cursor: pointer;"></button>
              <button class="color-swatch-btn" data-color="#ffffff" title="White" style="width: 22px; height: 22px; border-radius: 50%; border: 2px solid ${currentColor === '#ffffff' ? 'var(--signal-high, #00f5d4)' : 'rgba(255,255,255,0.3)'}; background: #ffffff; cursor: pointer;"></button>
              <button class="color-swatch-btn" data-color="#000000" title="Black" style="width: 22px; height: 22px; border-radius: 50%; border: 2px solid ${currentColor === '#000000' ? 'var(--signal-high, #00f5d4)' : 'rgba(255,255,255,0.3)'}; background: #000000; cursor: pointer;"></button>
              <button class="color-swatch-btn" data-color="#00f5d4" title="Cyan" style="width: 22px; height: 22px; border-radius: 50%; border: 2px solid ${currentColor === '#00f5d4' ? '#ffffff' : 'rgba(255,255,255,0.3)'}; background: #00f5d4; cursor: pointer;"></button>
              <button class="color-swatch-btn" data-color="#10b981" title="Green" style="width: 22px; height: 22px; border-radius: 50%; border: 2px solid ${currentColor === '#10b981' ? 'var(--signal-high, #00f5d4)' : 'rgba(255,255,255,0.3)'}; background: #10b981; cursor: pointer;"></button>
              <button class="color-swatch-btn" data-color="#f59e0b" title="Amber" style="width: 22px; height: 22px; border-radius: 50%; border: 2px solid ${currentColor === '#f59e0b' ? 'var(--signal-high, #00f5d4)' : 'rgba(255,255,255,0.3)'}; background: #f59e0b; cursor: pointer;"></button>
              <button class="color-swatch-btn" data-color="#ef4444" title="Red" style="width: 22px; height: 22px; border-radius: 50%; border: 2px solid ${currentColor === '#ef4444' ? 'var(--signal-high, #00f5d4)' : 'rgba(255,255,255,0.3)'}; background: #ef4444; cursor: pointer;"></button>
              <input type="color" id="prop-color-custom" value="${currentColor || '#00f5d4'}" title="Custom Color Picker" style="width: 24px; height: 24px; padding: 0; border: none; border-radius: 4px; cursor: pointer; background: transparent;" />
            </div>
          </div>
        `;
      }

      panel.innerHTML = html;

      // Attach actions
      const rotateBtn = document.getElementById('btn-prop-rotate');
      if (rotateBtn) {
        rotateBtn.addEventListener('click', () => {
          this._interaction.rotateSelected();
        });
      }

      const deleteBtn = document.getElementById('btn-prop-delete');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
          this._interaction.removeComponent(circuit);
        });
      }

      const exportInput = document.getElementById('prop-export-name') as HTMLInputElement;
      if (exportInput) {
        exportInput.addEventListener('change', () => {
          circuit.exportName = exportInput.value.trim() || undefined;
          this.recordUndoSnapshot('Change Export Pin Name');
        });
      }

      const inputsCountInput = document.getElementById('prop-inputs-count') as HTMLInputElement;
      if (inputsCountInput) {
        inputsCountInput.addEventListener('change', () => {
          const val = parseInt(inputsCountInput.value, 10);
          if (val >= 1 && val <= 16 && 'setInputsCount' in circuit) {
            (circuit as unknown as IVariableInputCircuit).setInputsCount(val);
            const node = this._interaction.nodes.get(circuit.uid);
            if (node) {
              node.renderResult = SymbolRenderer.renderComponent(circuit, this._isAnsi);
              this._interaction.render();
            }
            this.recordUndoSnapshot(`Change Input Pins to ${val}`);
          }
        });
      }

      const behaviorSelect = document.getElementById('prop-gate-behavior') as HTMLSelectElement;
      if (behaviorSelect && (circuit instanceof XORGateCircuit || circuit instanceof XNORGateCircuit)) {
        behaviorSelect.addEventListener('change', () => {
          const idx = parseInt(behaviorSelect.value, 10);
          circuit.functionIndex = idx;
          this._engine.propagateAll();
          this._interaction.updateWireSignals();
          this.recordUndoSnapshot('Change Gate Behavior');
        });
      }

      const switchResetSelect = document.getElementById('prop-switch-reset') as HTMLSelectElement;
      if (switchResetSelect && circuit instanceof SwitchCircuit) {
        switchResetSelect.addEventListener('change', () => {
          const isHigh = switchResetSelect.value === 'true';
          circuit.defaultState = isHigh;
          circuit.state = isHigh;
          this._engine.propagateAll();
          this._interaction.updateDynamicVisuals();
          this._interaction.updateWireSignals();
          this.recordUndoSnapshot(`Change Switch Reset Signal to ${isHigh ? 'High' : 'Low'}`);
        });
      }

      const clockFreqInput = document.getElementById('prop-clock-freq') as HTMLInputElement;
      if (clockFreqInput && circuit instanceof ClockCircuit) {
        clockFreqInput.addEventListener('change', () => {
          const val = parseFloat(clockFreqInput.value);
          if (val >= 10) {
            circuit.frequency = val;
            this.recordUndoSnapshot(`Change Clock Frequency to ${val}ms`);
          }
        });
      }

      if (circuit instanceof LabelCircuit) {
        const updateNodeAndRender = () => {
          const node = this._interaction.nodes.get(circuit.uid);
          if (node) {
            node.renderResult = SymbolRenderer.renderComponent(circuit, this._isAnsi);
            this._interaction.render();
          }
          this.setDirty(true);
        };

        const labelTextInput = document.getElementById('prop-label-text') as HTMLTextAreaElement;
        if (labelTextInput) {
          // Real-time input synchronization on keystroke
          labelTextInput.addEventListener('input', () => {
            circuit.text = labelTextInput.value;
            updateNodeAndRender();
          });
          labelTextInput.addEventListener('change', () => {
            this.recordUndoSnapshot('Edit Label');
          });
        }

        const fontSizeSelect = document.getElementById('prop-font-size') as HTMLSelectElement;
        if (fontSizeSelect) {
          fontSizeSelect.addEventListener('change', () => {
            circuit.fontSize = parseInt(fontSizeSelect.value, 10);
            updateNodeAndRender();
            this.recordUndoSnapshot('Change Label Font Size');
          });
        }

        const boldBtn = document.getElementById('btn-prop-bold');
        if (boldBtn) {
          boldBtn.addEventListener('click', () => {
            circuit.bold = !circuit.bold;
            updateNodeAndRender();
            this.recordUndoSnapshot(circuit.bold ? 'Bold Label' : 'Unbold Label');
            this._interaction.onSelectionChange?.(circuit, [circuit]);
          });
        }

        const italicBtn = document.getElementById('btn-prop-italic');
        if (italicBtn) {
          italicBtn.addEventListener('click', () => {
            circuit.italic = !circuit.italic;
            updateNodeAndRender();
            this.recordUndoSnapshot(circuit.italic ? 'Italicize Label' : 'Unitalicize Label');
            this._interaction.onSelectionChange?.(circuit, [circuit]);
          });
        }

        const setAlignment = (align: 'left' | 'center' | 'right') => {
          circuit.alignment = align;
          updateNodeAndRender();
          this.recordUndoSnapshot(`Align Label ${align}`);
          this._interaction.onSelectionChange?.(circuit, [circuit]);
        };

        document.getElementById('btn-prop-align-left')?.addEventListener('click', () => setAlignment('left'));
        document.getElementById('btn-prop-align-center')?.addEventListener('click', () => setAlignment('center'));
        document.getElementById('btn-prop-align-right')?.addEventListener('click', () => setAlignment('right'));

        const swatches = panel.querySelectorAll('.color-swatch-btn');
        swatches.forEach((swatch) => {
          swatch.addEventListener('click', () => {
            const col = (swatch as HTMLElement).dataset.color;
            circuit.color = col ? col : undefined;
            updateNodeAndRender();
            this.recordUndoSnapshot('Change Label Color');
            this._interaction.onSelectionChange?.(circuit, [circuit]);
          });
        });

        const customColorInput = document.getElementById('prop-color-custom') as HTMLInputElement;
        if (customColorInput) {
          customColorInput.addEventListener('input', () => {
            circuit.color = customColorInput.value;
            updateNodeAndRender();
          });
          customColorInput.addEventListener('change', () => {
            circuit.color = customColorInput.value;
            updateNodeAndRender();
            this.recordUndoSnapshot('Change Label Color');
            this._interaction.onSelectionChange?.(circuit, [circuit]);
          });
        }
      }
    };

    this._interaction.onConnectionSelectionChange = (conn) => {
      if (!conn) return;

      const outCircuit = conn.outputCircuit;
      const inCircuit = conn.inputCircuit;
      const outName = outCircuit.exportName || outCircuit.type.replace('@logic.ly', '').toUpperCase();
      const inName = inCircuit.exportName || inCircuit.type.replace('@logic.ly', '').toUpperCase();
      const val = outCircuit.getOutputAt(conn.outputIndex);
      const valText = val === true ? 'HIGH (1)' : val === false ? 'LOW (0)' : 'HIGH-Z / UNDEFINED';
      const valColor = val === true ? '#00f5d4' : val === false ? '#64748b' : '#f59e0b';

      const pointsCount = conn.points ? conn.points.length : 0;

      panel.innerHTML = `
        <div class="inspector-card-header">
          <div class="inspector-card-title">Connection Wire</div>
          <div class="inspector-action-bar">
            <button id="btn-prop-straighten-wire" class="btn" title="Straighten wire and clear bend points">
              <svg width="11" height="11" viewBox="0 0 640 512" fill="currentColor"><path d="M32 64c17.7 0 32 14.3 32 32l0 320c0 17.7-14.3 32-32 32s-32-14.3-32-32L0 96c0-17.7 14.3-32 32-32zm576 0c17.7 0 32 14.3 32 32l0 320c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-320c0-17.7 14.3-32 32-32zM441 239c9.4 9.4 9.4 24.6 0 33.9l-88 88c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l47-47L273.9 280l47 47c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-88-88c-9.4-9.4-9.4-24.6 0-33.9l88-88c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-47 47 98.1 0-47-47c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l88 88z"/></svg>
              <span>Straighten</span>
            </button>
            <button id="btn-prop-del-conn" class="btn" style="color: #ef4444;" title="Delete Wire (Del)">
              <svg width="11" height="11" viewBox="0 0 448 512" fill="currentColor"><path d="M135.2 17.7C140.6 6.8 151.7 0 163.8 0H284.2c12.1 0 23.2 6.8 28.6 17.7L320 32h96c17.7 0 32 14.3 32 32s-14.3 32-32 32H32C14.3 96 0 81.7 0 64S14.3 32 32 32h96l7.2-14.3zM32 128H416V448c0 35.3-28.7 64-64 64H96c-35.3 0-64-28.7-64-64V128zm96 64c-8.8 0-16 7.2-16 16V432c0 8.8 7.2 16 16 16s16-7.2 16-16V208c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16V432c0 8.8 7.2 16 16 16s16-7.2 16-16V208c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16V432c0 8.8 7.2 16 16 16s16-7.2 16-16V208c0-8.8-7.2-16-16-16z"/></svg>
              <span>Delete</span>
            </button>
          </div>
        </div>

        <div class="property-row">
          <label class="property-label">Source Pin (Output)</label>
          <input class="property-input" readonly value="${outName} [pin ${conn.outputIndex}]" style="font-size: 11px; color: var(--text-secondary);" />
        </div>

        <div class="property-row">
          <label class="property-label">Destination Pin (Input)</label>
          <input class="property-input" readonly value="${inName} [pin ${conn.inputIndex}]" style="font-size: 11px; color: var(--text-secondary);" />
        </div>

        <div class="property-row">
          <label class="property-label">Current Signal</label>
          <input class="property-input" readonly value="${valText}" style="font-size: 11px; color: ${valColor}; font-weight: 700;" />
        </div>

        <div class="property-row">
          <label class="property-label">Shape & Route</label>
          <input class="property-input" readonly value="${pointsCount === 0 ? 'Direct natural curve (0 bend points)' : `${pointsCount} bend point(s)`}" style="font-size: 11px; color: var(--text-secondary);" />
        </div>

        <div style="color: var(--text-muted); font-size: 11px; margin-top: 14px; line-height: 1.45;">
          Tip: Drag anywhere on the wire or waypoint handles to adjust its shape and route around components. Double-click wire to add points, or double-click a handle to remove it.
        </div>
      `;

      const straightenBtn = document.getElementById('btn-prop-straighten-wire');
      if (straightenBtn) {
        straightenBtn.addEventListener('click', () => {
          this._interaction.resetSelectedConnectionShape();
        });
      }

      const delConnBtn = document.getElementById('btn-prop-del-conn');
      if (delConnBtn) {
        delConnBtn.addEventListener('click', () => {
          this._interaction.deleteSelectedConnection();
          panel.innerHTML = `<div style="color: var(--text-muted); font-size: 12px; margin-top: 10px;">Select a component on the canvas to inspect its pins and properties.</div>`;
        });
      }
    };
  }

  private setupSimulationLoop(): void {
    const loop = (currentTime: number) => {
      const delta = currentTime - this._lastTime;
      this._lastTime = currentTime;

      if (this._isPlaying && delta > 0) {
        this._engine.advance(delta * this._simSpeed);
        this._interaction.updateDynamicVisuals();
        this._interaction.updateWireSignals();
      }

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }

  public newCircuit(): void {
    this._interaction.clear();
    this._engine.reset();
    this._engine.setDefaultFloatSignal(this._settingsModel.settings.defaultFloatSignal);
    this._currentFilePath = null;
    this.setDocumentTitle('Untitled Circuit', false);
    this.recordUndoSnapshot('New Circuit');
    this.setDirty(false);
    this.resetSampleDropdownState();
  }

  public resetSampleDropdownState(): void {
    const sampleLabel = document.getElementById('sample-dropdown-label');
    if (sampleLabel) {
      sampleLabel.textContent = 'Sample Circuits...';
    }
    const sampleSelect = document.getElementById('select-samples') as HTMLSelectElement;
    if (sampleSelect) {
      sampleSelect.value = '';
    }
    const sampleItems = document.querySelectorAll('.sample-menu-item');
    sampleItems.forEach((item) => item.classList.remove('active'));
  }

  public setSampleDropdownState(sampleName: string): void {
    const sampleLabel = document.getElementById('sample-dropdown-label');
    if (sampleLabel) {
      sampleLabel.textContent = sampleName;
    }
    const sampleSelect = document.getElementById('select-samples') as HTMLSelectElement;
    if (sampleSelect) {
      sampleSelect.value = sampleName;
    }
    const sampleItems = document.querySelectorAll('.sample-menu-item');
    sampleItems.forEach((item) => {
      if (item.getAttribute('data-sample') === sampleName) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  private getFileName(filePath: string): string {
    return filePath.split(/[/\\]/).pop() || filePath;
  }

  public getSerializedCircuitXml(): string {
    const circuitsMap = new Map<string, ICircuit>();
    const metaMap = new Map<string, { x: number; y: number; rotation: number }>();

    for (const [uid, node] of this._interaction.nodes) {
      circuitsMap.set(uid, node.circuit);
      metaMap.set(uid, { x: node.x, y: node.y, rotation: node.rotation });
    }

    return this._parser.serialize(
      {
        engine: this._engine,
        circuits: circuitsMap,
        metadata: metaMap,
        locations: { left: [], right: [], top: [], bottom: [] }
      },
      { includeCustomTemplates: true }
    );
  }

  private downloadFile(filename: string, content: string): void {
    const blob = new Blob([content], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  public loadCircuitXml(xmlContent: string, circuitTitle?: string, filePath?: string | null): void {
    try {
      if (!xmlContent || typeof xmlContent !== 'string' || xmlContent.trim().length === 0) {
        throw new Error('Circuit file content is empty.');
      }

      if (this._parser.isLibrary(xmlContent)) {
        const packages = this._parser.parseLibrary(xmlContent);
        this.syncCustomTemplatesToPalette();
        this.showToast(`Loaded IC Library: ${packages.length} custom component(s) imported.`);
        return;
      }

      if (this._settingsModel.settings.pauseSimulationOnChangeDocument && this._isPlaying) {
        this._isPlaying = false;
        this.updatePlayButtonState();
      }

      const doc = this._parser.parse(xmlContent, undefined, filePath || circuitTitle);
      
      if (doc.circuits.size === 0 && (xmlContent.includes('<object') || xmlContent.includes('<visualElement'))) {
        throw new Error('No compatible components could be recognized from the circuit file.');
      }

      this._interaction.loadDocument(doc);
      this._engine.setDefaultFloatSignal(this._settingsModel.settings.defaultFloatSignal);
      this.syncCustomTemplatesToPalette();
      this._currentFilePath = filePath ?? null;
      this.setDocumentTitle(circuitTitle || 'Untitled Circuit', false);
      this.updateZoomDisplay();
      this.recordUndoSnapshot('Open Circuit');
      this.setDirty(false);
      if (circuitTitle && SAMPLE_CIRCUITS[circuitTitle]) {
        this.setSampleDropdownState(circuitTitle);
      } else {
        this.resetSampleDropdownState();
      }

      if (doc.unknownTypes && doc.unknownTypes.length > 0) {
        const unique = Array.from(new Set(doc.unknownTypes)).join(', ');
        this.showAlertModal(
          `Circuit loaded with ${doc.circuits.size} component(s) and ${doc.engine.connections.length} wire(s).\n\nWarning: ${doc.unknownTypes.length} component(s) could not be loaded due to unrecognized type(s): ${unique}.`,
          'Circuit Loaded With Warnings'
        );
      } else {
        this.showToast(`Circuit loaded: ${doc.circuits.size} component(s), ${doc.engine.connections.length} wire(s).`);
      }
    } catch (err: any) {
      console.error('Failed to load circuit XML:', err);
      const errorMsg = err?.message || String(err);
      this.showAlertModal(
        `Unable to load circuit file:\n\n${errorMsg}\n\nPlease check the file format or verify that the schematic is valid.`,
        'Error Opening Circuit'
      );
      this.showToast(`Failed to open circuit: ${errorMsg}`);
    }
  }

  public async handleOpenFile(): Promise<void> {
    try {
      let xmlContent = '';
      let docTitle = 'Untitled Circuit';
      let openedPath: string | null = null;

      if (window.api && typeof window.api.openFileDialog === 'function') {
        const res = await window.api.openFileDialog();
        if (res.canceled || !res.content) return;
        xmlContent = res.content;
        openedPath = res.filePath || null;
        if (res.name) {
          docTitle = res.name;
        } else if (res.filePath) {
          docTitle = this.getFileName(res.filePath);
        }
      } else {
        const browserRes = await this.promptBrowserFileInput();
        if (!browserRes.content) return;
        xmlContent = browserRes.content;
        docTitle = browserRes.name || 'Untitled Circuit';
        openedPath = null;
      }

      if (!xmlContent) return;
      this.loadCircuitXml(xmlContent, docTitle, openedPath);
    } catch (err: any) {
      console.error('Error during handleOpenFile:', err);
      this.showAlertModal(`Failed to open circuit file: ${err?.message || err}`, 'Open File Error');
    }
  }

  private isLibraryExtension(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return (
      lower.endsWith('.plgclib') ||
      lower.endsWith('.plgclibx') ||
      lower.endsWith('.logiclylib') ||
      lower.endsWith('.logiclylibx')
    );
  }

  public async handleSaveFile(): Promise<boolean> {
    try {
      if (this._currentFilePath) {
        const isLibrary = this.isLibraryExtension(this._currentFilePath);
        const content = isLibrary ? this._parser.serializeLibrary() : this.getSerializedCircuitXml();
        const fileName = this.getFileName(this._currentFilePath);

        if (window.api && typeof window.api.writeFile === 'function') {
          const success = await window.api.writeFile(this._currentFilePath, content);
          if (!success) {
            this.showToast(`Failed to save file: ${fileName}`);
            return false;
          }
        } else {
          this.downloadFile(fileName, content);
        }

        this.setDirty(false);
        this.showToast(`Saved: ${fileName}`);
        return true;
      }

      // No saved file path yet: strictly save as ProLogic Circuit (*.plgc)
      let defaultFileName = 'circuit.plgc';
      if (this._currentDocumentTitle && this._currentDocumentTitle !== 'Untitled Circuit') {
        const cleanTitle = this._currentDocumentTitle.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_\- ]/g, '').trim();
        defaultFileName = cleanTitle ? `${cleanTitle}.plgc` : 'circuit.plgc';
      }

      const xml = this.getSerializedCircuitXml();

      if (window.api && typeof window.api.saveFileDialog === 'function') {
        let res: { canceled: boolean; filePath?: string };
        if (typeof window.api.saveFileStrictPlgcDialog === 'function') {
          res = await window.api.saveFileStrictPlgcDialog(defaultFileName, xml);
        } else {
          res = await window.api.saveFileDialog(defaultFileName, xml, true, true);
        }

        if (res.canceled || !res.filePath) {
          return false;
        }

        this._currentFilePath = res.filePath;
        const fileName = this.getFileName(res.filePath);
        this.setDocumentTitle(fileName, false);
        this.setDirty(false);
        this.showToast(`Saved: ${fileName}`);
        return true;
      } else {
        this.downloadFile(defaultFileName, xml);
        this.setDocumentTitle(defaultFileName, false);
        this.setDirty(false);
        this.showToast(`Saved: ${defaultFileName}`);
        return true;
      }
    } catch (err: any) {
      console.error('Failed to save circuit:', err);
      this.showToast(`Error saving file: ${err?.message || err}`);
      return false;
    }
  }

  public async handleSaveFileAs(): Promise<boolean> {
    try {
      const xml = this.getSerializedCircuitXml();
      let defaultPath = this._currentFilePath;
      if (!defaultPath) {
        if (this._currentDocumentTitle && this._currentDocumentTitle !== 'Untitled Circuit') {
          const cleanTitle = this._currentDocumentTitle.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_\- ]/g, '').trim();
          defaultPath = cleanTitle ? `${cleanTitle}.plgc` : 'circuit.plgc';
        } else {
          defaultPath = 'circuit.plgc';
        }
      }

      if (window.api && typeof window.api.saveFileDialog === 'function') {
        const res = await window.api.saveFileDialog(defaultPath, xml, undefined, false);
        if (res.canceled || !res.filePath) {
          // User cancelled, return early without modifying dirty state
          return false;
        }

        const filePath = res.filePath;
        const lower = filePath.toLowerCase();
        const fileName = this.getFileName(filePath);

        // 1. Move PNG directly into Save As:
        // If user selected PNG Image (*.png), rasterize circuit & save via writeBinaryFile
        if (lower.endsWith('.png')) {
          const activeTheme = (document.documentElement.getAttribute('data-theme') as 'dark' | 'light') || 'dark';
          const pngDataUrl = await PngExporter.generatePng(
            this._engine,
            this._interaction.nodes,
            {
              scale: 2,
              theme: activeTheme,
              highSignalColor: this._settingsModel.settings.highSignalColor,
              lowSignalColor: this._settingsModel.settings.lowSignalColor,
              snapOrthogonalWires: this._settingsModel.settings.snapOrthogonalWires
            }
          );

          if (typeof window.api.writeBinaryFile === 'function') {
            await window.api.writeBinaryFile(filePath, pngDataUrl);
          } else if (typeof window.api.writeFile === 'function') {
            await window.api.writeFile(filePath, pngDataUrl);
          }
          // Do NOT change _currentFilePath (circuit document path remains intact)
          this.showToast(`Saved PNG schematic: ${fileName}`);
          return true;
        }

        // 2. Library formats: serialize registered custom packages
        const isLibrary = this.isLibraryExtension(filePath);
        const contentToSave = isLibrary ? this._parser.serializeLibrary() : xml;

        if (typeof window.api.writeFile === 'function') {
          await window.api.writeFile(filePath, contentToSave);
        }

        this._currentFilePath = filePath;
        const docName = this.getFileName(filePath);
        this.setDocumentTitle(docName, false);
        this.setDirty(false);
        this.showToast(`Saved as: ${docName}`);
        return true;
      } else {
        const fileName = this.getFileName(defaultPath);
        this.downloadFile(fileName, xml);
        this.setDocumentTitle(fileName, false);
        this.setDirty(false);
        this.showToast(`Saved as: ${fileName}`);
        return true;
      }
    } catch (err: any) {
      console.error('Failed to save circuit as:', err);
      this.showToast(`Error saving file: ${err?.message || err}`);
      return false;
    }
  }

  public async handleRequestClose(): Promise<void> {
    if (!this._isDirty) {
      // Dynamic check: document is clean / recently saved with no new changes -> close immediately
      if (window.api && typeof window.api.forceCloseWindow === 'function') {
        window.api.forceCloseWindow();
      } else if (window.api && typeof window.api.closeWindow === 'function') {
        window.api.closeWindow();
      } else {
        window.close();
      }
      return;
    }

    // Has unsaved modifications -> intercept and show prompt
    this.showConfirmCloseModal();
  }

  public showConfirmCloseModal(): void {
    const modal = document.getElementById('modal-confirm-close');
    const msg = document.getElementById('modal-confirm-close-message');
    if (!modal) {
      const docName = this._currentDocumentTitle || 'Untitled Circuit';
      if (confirm(`Do you want to save the changes you made to "${docName}" before closing?`)) {
        this.handleSaveFile().then((saved) => {
          if (saved) {
            window.api?.forceCloseWindow?.() || window.close();
          }
        });
      } else {
        window.api?.forceCloseWindow?.() || window.close();
      }
      return;
    }

    if (msg) {
      const docName = this._currentDocumentTitle || 'Untitled Circuit';
      msg.textContent = `Do you want to save the changes you made to "${docName}"?`;
    }

    modal.style.display = 'flex';
  }

  public hideConfirmCloseModal(): void {
    const modal = document.getElementById('modal-confirm-close');
    if (modal) modal.style.display = 'none';
  }

  public async saveCircuit(targetPath?: string): Promise<boolean> {
    if (targetPath) {
      const isLibrary = this.isLibraryExtension(targetPath);
      const content = isLibrary ? this._parser.serializeLibrary() : this.getSerializedCircuitXml();
      const fileName = this.getFileName(targetPath);
      if (window.api && typeof window.api.writeFile === 'function') {
        const success = await window.api.writeFile(targetPath, content);
        if (success) {
          this._currentFilePath = targetPath;
          this.setDocumentTitle(fileName, false);
          this.setDirty(false);
          this.showToast(`Saved: ${fileName}`);
          return true;
        }
        return false;
      } else {
        this.downloadFile(fileName, content);
        this._currentFilePath = targetPath;
        this.setDocumentTitle(fileName, false);
        this.setDirty(false);
        this.showToast(`Saved: ${fileName}`);
        return true;
      }
    }
    await this.handleSaveFile();
    return !this._isDirty;
  }

  private async exportPngImage(): Promise<void> {
    try {
      const activeTheme = (document.documentElement.getAttribute('data-theme') as 'dark' | 'light') || 'dark';
      const docTitle = this._currentFilePath
        ? this.getFileName(this._currentFilePath).replace(/\.[^/.]+$/, '')
        : (this._currentDocumentTitle && this._currentDocumentTitle !== 'Untitled Circuit'
            ? this._currentDocumentTitle.replace(/\.[^/.]+$/, '')
            : 'prologic_circuit');

      const result = await PngExporter.exportCircuit(
        this._engine,
        this._interaction.nodes,
        `${docTitle}.png`,
        {
          scale: 2,
          theme: activeTheme,
          highSignalColor: this._settingsModel.settings.highSignalColor,
          lowSignalColor: this._settingsModel.settings.lowSignalColor,
          snapOrthogonalWires: this._settingsModel.settings.snapOrthogonalWires
        }
      );
      if (!result.canceled) {
        this.showToast('PNG schematic exported successfully');
      }
    } catch (err: any) {
      console.error('Failed to export PNG schematic:', err);
      this.showToast('Failed to export PNG image');
    }
  }

  private promptBrowserFileInput(): Promise<{ content: string; name: string }> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.plgc,.plgclib,.plgcx,.plgclibx,.logicly,.logiclylib,.logiclyx,.logiclylibx,.circ,.dig,.cdd,.cv,.simcir,.xml,.json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve({ content: '', name: '' });
          return;
        }
        try {
          const buffer = await file.arrayBuffer();
          const uint8 = new Uint8Array(buffer);

          let start = 0;
          if (uint8.length >= 3 && uint8[0] === 0xef && uint8[1] === 0xbb && uint8[2] === 0xbf) start = 3;
          while (
            start < uint8.length &&
            (uint8[start] === 0x20 || uint8[start] === 0x09 || uint8[start] === 0x0a || uint8[start] === 0x0d)
          ) {
            start++;
          }
          if (start < uint8.length && uint8[start] === 0x3c) {
            resolve({ content: new TextDecoder('utf-8').decode(uint8), name: file.name });
            return;
          }

          if (typeof DecompressionStream !== 'undefined') {
            try {
              const ds = new DecompressionStream('deflate-raw');
              const writer = ds.writable.getWriter();
              writer.write(uint8);
              writer.close();
              const decompressedResponse = new Response(ds.readable);
              const text = await decompressedResponse.text();
              resolve({ content: text, name: file.name });
              return;
            } catch {
              try {
                const ds = new DecompressionStream('deflate');
                const writer = ds.writable.getWriter();
                writer.write(uint8);
                writer.close();
                const decompressedResponse = new Response(ds.readable);
                const text = await decompressedResponse.text();
                resolve({ content: text, name: file.name });
                return;
              } catch {
                resolve({ content: new TextDecoder('utf-8').decode(uint8), name: file.name });
                return;
              }
            }
          }
          resolve({ content: new TextDecoder('utf-8').decode(uint8), name: file.name });
        } catch {
          resolve({ content: '', name: '' });
        }
      };
      input.click();
    });
  }

  private createPaletteItemElement(comp: ComponentDefinition): HTMLElement {
    const item = document.createElement('div');
    item.className = 'palette-item';
    item.draggable = true;
    item.dataset.type = comp.type;

    let iconSvg = '';
    if (comp.type === '%custom@logic.ly') {
      iconSvg = `<svg width="24" height="24" viewBox="0 0 40 40">
        <rect x="9" y="8" width="22" height="24" rx="3" fill="#1e293b" stroke="#00f5d4" stroke-width="2"/>
        <line x1="3" y1="14" x2="9" y2="14" stroke="#00f5d4" stroke-width="2"/>
        <line x1="3" y1="20" x2="9" y2="20" stroke="#00f5d4" stroke-width="2"/>
        <line x1="3" y1="26" x2="9" y2="26" stroke="#00f5d4" stroke-width="2"/>
        <line x1="31" y1="14" x2="37" y2="14" stroke="#00f5d4" stroke-width="2"/>
        <line x1="31" y1="20" x2="37" y2="20" stroke="#00f5d4" stroke-width="2"/>
        <line x1="31" y1="26" x2="37" y2="26" stroke="#00f5d4" stroke-width="2"/>
        <text x="20" y="23" font-size="9" font-family="sans-serif" font-weight="bold" fill="#00f5d4" text-anchor="middle">IC</text>
      </svg>`;
    } else {
      const previewCircuit = this._parser.createCircuitInstance(comp.type, 'preview');
      if (previewCircuit) {
        const render = SymbolRenderer.renderComponent(previewCircuit, true);
        iconSvg = `<svg width="24" height="24" viewBox="0 0 ${render.width} ${render.height}">${render.svgContent}</svg>`;
      }
    }

    item.innerHTML = `
      <div class="palette-icon-box">${iconSvg}</div>
      <div class="palette-item-text" style="flex: 1; min-width: 0;">
        <div class="palette-item-name">${comp.name}</div>
        <div class="palette-item-desc">${comp.description}</div>
      </div>
    `;

    if (comp.type === '%custom@logic.ly') {
      item.addEventListener('click', () => {
        const customTemplates = this.getCustomICTemplates();
        if (customTemplates.length > 0) {
          const targetType = (this._lastUsedCustomTypeId && customTemplates.some(t => t.type === this._lastUsedCustomTypeId))
            ? this._lastUsedCustomTypeId
            : customTemplates[0].type;
          if (this._interaction.placementType === targetType) {
            this._interaction.cancelPlacementMode();
          } else {
            this.enterPlacementMode(targetType);
          }
        } else {
          this.showCustomICGuideModal();
        }
      });
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/plain', comp.type);
      });
      return item;
    }

    if (comp.category === 'Integrated Circuits' && comp.type !== '%custom@logic.ly') {
      const delBtn = document.createElement('button');
      delBtn.className = 'palette-item-delete-btn';
      delBtn.title = `Delete '${comp.name}' from catalog`;
      delBtn.setAttribute('aria-label', `Delete '${comp.name}' from catalog`);
      delBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 448 512" fill="currentColor"><path d="M135.2 17.7C140.6 6.8 151.7 0 163.8 0H284.2c12.1 0 23.2 6.8 28.6 17.7L320 32h96c17.7 0 32 14.3 32 32s-14.3 32-32 32H32C14.3 96 0 81.7 0 64S14.3 32 32 32h96l7.2-14.3zM32 128H416V448c0 35.3-28.7 64-64 64H96c-35.3 0-64-28.7-64-64V128zm96 64c-8.8 0-16 7.2-16 16V432c0 8.8 7.2 16 16 16s16-7.2 16-16V208c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16V432c0 8.8 7.2 16 16 16s16-7.2 16-16V208c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16V432c0 8.8 7.2 16 16 16s16-7.2 16-16V208c0-8.8-7.2-16-16-16z"/></svg>`;
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.confirmDeleteCustomIC(comp.type, comp.name);
      });
      item.appendChild(delBtn);

      item.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        this.showPaletteItemContextMenu(e.clientX, e.clientY, comp);
      });
    }

    item.addEventListener('click', () => {
      if (this._interaction.placementType === comp.type) {
        this._interaction.cancelPlacementMode();
        return;
      }
      this.enterPlacementMode(comp.type);
    });

    item.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', comp.type);
    });

    return item;
  }

  public updatePalettePlacementVisuals(activeType: string | null): void {
    const items = document.querySelectorAll('.palette-item');
    items.forEach((item) => {
      const el = item as HTMLElement;
      if (activeType && el.dataset.type === activeType) {
        el.classList.add('active', 'stamp-active');
      } else {
        el.classList.remove('active', 'stamp-active');
      }
    });
  }

  public enterPlacementMode(type: string): void {
    this._interaction.setPlacementMode(type, () => {
      const c = this._parser.createCircuitInstance(type, '');
      if (c && this.isCustomType(type)) {
        this._lastUsedCustomTypeId = type;
      }
      return c;
    });
  }

  public getCustomICTemplates(): { type: string; name: string; label: string; inputCount: number; outputCount: number }[] {
    const list: { type: string; name: string; label: string; inputCount: number; outputCount: number }[] = [];
    for (const [type] of this._parser.customTemplates) {
      if (BUILTIN_IC_TEMPLATES[type] || type === 'sr_flip_flop@logic.ly' || type === 'rs_flip_flop@logic.ly' || type === '%custom@logic.ly') {
        continue;
      }
      const meta = this._parser.getCustomMetadata(type);
      const preview = this._parser.createCircuitInstance(type, 'preview');
      let inCount = 0;
      let outCount = 0;
      if (preview && 'inputsCount' in preview) {
        inCount = (preview as unknown as IInputCircuit).inputsCount;
      }
      if (preview && 'outputsCount' in preview) {
        outCount = (preview as unknown as IOutputCircuit).outputsCount;
      }
      list.push({
        type,
        name: meta?.name || type,
        label: meta?.label || 'IC',
        inputCount: inCount,
        outputCount: outCount
      });
    }
    return list;
  }

  public isCustomType(type: string): boolean {
    return !BUILTIN_IC_TEMPLATES[type] && type !== 'sr_flip_flop@logic.ly' && type !== 'rs_flip_flop@logic.ly' && type !== '%custom@logic.ly' && this._parser.customTemplates.has(type);
  }

  private _paletteContextMenu: HTMLElement | null = null;
  private _onConfirmDeleteIC: (() => void) | null = null;

  public closePaletteContextMenu(): void {
    if (this._paletteContextMenu) {
      this._paletteContextMenu.remove();
      this._paletteContextMenu = null;
    }
  }

  public showPaletteItemContextMenu(x: number, y: number, comp: ComponentDefinition): void {
    this.closePaletteContextMenu();

    const menu = document.createElement('div');
    menu.className = 'palette-context-menu';
    menu.innerHTML = `
      <div class="palette-context-menu-item menu-item-danger" role="button">
        <svg width="12" height="12" viewBox="0 0 448 512" fill="currentColor"><path d="M135.2 17.7C140.6 6.8 151.7 0 163.8 0H284.2c12.1 0 23.2 6.8 28.6 17.7L320 32h96c17.7 0 32 14.3 32 32s-14.3 32-32 32H32C14.3 96 0 81.7 0 64S14.3 32 32 32h96l7.2-14.3zM32 128H416V448c0 35.3-28.7 64-64 64H96c-35.3 0-64-28.7-64-64V128zm96 64c-8.8 0-16 7.2-16 16V432c0 8.8 7.2 16 16 16s16-7.2 16-16V208c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16V432c0 8.8 7.2 16 16 16s16-7.2 16-16V208c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16V432c0 8.8 7.2 16 16 16s16-7.2 16-16V208c0-8.8-7.2-16-16-16z"/></svg>
        <span>Delete '${comp.name}' from Catalog</span>
      </div>
    `;

    menu.style.position = 'fixed';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.zIndex = '3000';

    const item = menu.querySelector('.palette-context-menu-item');
    item?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closePaletteContextMenu();
      this.confirmDeleteCustomIC(comp.type, comp.name);
    });

    document.body.appendChild(menu);
    this._paletteContextMenu = menu;

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${Math.max(10, window.innerWidth - rect.width - 10)}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${Math.max(10, window.innerHeight - rect.height - 10)}px`;
    }

    const onDismiss = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof MouseEvent && menu.contains(e.target as Node)) return;
      this.closePaletteContextMenu();
      document.removeEventListener('click', onDismiss);
      document.removeEventListener('contextmenu', onDismiss);
      document.removeEventListener('keydown', onKeyDown);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDismiss(e);
      }
    };

    setTimeout(() => {
      document.addEventListener('click', onDismiss);
      document.addEventListener('contextmenu', onDismiss);
      document.addEventListener('keydown', onKeyDown);
    }, 10);
  }

  public confirmDeleteCustomIC(typeId: string, name?: string): void {
    const meta = this._parser.getCustomMetadata(typeId);
    const icName = name || meta?.name || typeId;
    const message = `Are you sure you want to delete '${icName}' from your component catalog? (Instances already placed on the canvas will remain preserved).`;

    const modal = document.getElementById('modal-confirm-delete-ic');
    const msgElem = document.getElementById('modal-confirm-delete-message');

    if (!modal || !msgElem) {
      if (confirm(`Delete Custom IC: ${message}`)) {
        this.deleteCustomIC(typeId);
      }
      return;
    }

    msgElem.textContent = message;
    this._onConfirmDeleteIC = () => {
      this.deleteCustomIC(typeId);
    };
    modal.style.display = 'flex';
  }

  public deleteCustomIC(typeId: string): void {
    const meta = this._parser.getCustomMetadata(typeId);
    const name = meta?.name || typeId;

    this._parser.unregisterCustomTemplate(typeId);

    const container = document.getElementById('palette-items');
    if (container) {
      const itemElem = container.querySelector(`[data-type="${typeId}"]`);
      if (itemElem) {
        const parentGroup = itemElem.closest('.category-group');
        itemElem.remove();
        if (parentGroup) {
          const remainingItems = parentGroup.querySelectorAll('.palette-item');
          if (remainingItems.length === 0) {
            parentGroup.remove();
          }
        }
      }
    }

    if (this._lastUsedCustomTypeId === typeId) {
      this._lastUsedCustomTypeId = null;
    }

    const modalSelectIC = document.getElementById('modal-select-custom-ic');
    if (modalSelectIC && modalSelectIC.style.display !== 'none') {
      const remainingTemplates = this.getCustomICTemplates();
      if (remainingTemplates.length === 0) {
        modalSelectIC.style.display = 'none';
      } else {
        this.showSelectCustomICModal();
      }
    }

    this.showToast(`Custom IC '${name}' deleted from catalog`);
  }

  public showCustomICGuideModal(): void {
    const modal = document.getElementById('modal-custom-ic-guide');
    if (modal) modal.style.display = 'flex';
  }

  public showSelectCustomICModal(): void {
    const modal = document.getElementById('modal-select-custom-ic');
    const listContainer = document.getElementById('custom-ic-list');
    if (!modal || !listContainer) return;

    const templates = this.getCustomICTemplates();
    if (templates.length === 0) {
      modal.style.display = 'none';
      this.showCustomICGuideModal();
      return;
    }

    listContainer.innerHTML = '';
    for (const tmpl of templates) {
      const card = document.createElement('div');
      card.className = 'custom-ic-card';

      card.innerHTML = `
        <div class="custom-ic-info">
          <div class="custom-ic-badge">${tmpl.label}</div>
          <div>
            <div class="custom-ic-name">${tmpl.name}</div>
            <div class="custom-ic-details">${tmpl.inputCount} In • ${tmpl.outputCount} Out</div>
          </div>
        </div>
        <div class="custom-ic-card-actions" style="display: flex; align-items: center; gap: 8px;">
          <button class="fluent-btn fluent-btn-accent btn-sm btn-insert-ic">Insert onto Canvas</button>
          <button class="fluent-btn btn-sm btn-delete-custom-ic" title="Delete '${tmpl.name}' from catalog" aria-label="Delete '${tmpl.name}' from catalog">
            <svg width="12" height="12" viewBox="0 0 448 512" fill="currentColor"><path d="M135.2 17.7C140.6 6.8 151.7 0 163.8 0H284.2c12.1 0 23.2 6.8 28.6 17.7L320 32h96c17.7 0 32 14.3 32 32s-14.3 32-32 32H32C14.3 96 0 81.7 0 64S14.3 32 32 32h96l7.2-14.3zM32 128H416V448c0 35.3-28.7 64-64 64H96c-35.3 0-64-28.7-64-64V128zm96 64c-8.8 0-16 7.2-16 16V432c0 8.8 7.2 16 16 16s16-7.2 16-16V208c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16V432c0 8.8 7.2 16 16 16s16-7.2 16-16V208c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16V432c0 8.8 7.2 16 16 16s16-7.2 16-16V208c0-8.8-7.2-16-16-16z"/></svg>
          </button>
        </div>
      `;

      const insertBtn = card.querySelector('.btn-insert-ic');
      if (insertBtn) {
        insertBtn.addEventListener('click', () => {
          modal.style.display = 'none';
          const c = this._parser.createCircuitInstance(tmpl.type, '');
          if (c) {
            const worldCenter = this._interaction.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
            this._interaction.addComponent(c, worldCenter.x - 30, worldCenter.y - 20);
            this._lastUsedCustomTypeId = tmpl.type;
            this.recordUndoSnapshot(`Add Custom IC ${tmpl.name}`);
            this.showToast(`Custom IC "${tmpl.name}" placed onto canvas.`);
          }
        });
      }

      const delBtn = card.querySelector('.btn-delete-custom-ic');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.confirmDeleteCustomIC(tmpl.type, tmpl.name);
        });
      }

      listContainer.appendChild(card);
    }

    modal.style.display = 'flex';
  }

  public showAboutModal(): void {
    const modal = document.getElementById('modal-about');
    if (modal) modal.style.display = 'flex';
  }

  public loadSampleFullAdderIC(): void {
    const fullAdderType = 'full_adder_custom@logic.ly';
    this._parser.registerCustomTemplate(fullAdderType, SAMPLE_FULL_ADDER_IC_XML, {
      name: '1-Bit Full Adder',
      label: 'ADDER'
    });

    const comp: ComponentDefinition = {
      type: fullAdderType,
      name: '1-Bit Full Adder',
      category: 'Integrated Circuits',
      description: 'ADDER (3 In, 2 Out)',
      defaultInputs: 3,
      defaultOutputs: 2
    };
    this.addCustomICToPalette(comp);
    this._lastUsedCustomTypeId = fullAdderType;

    const modal = document.getElementById('modal-custom-ic-guide');
    if (modal) modal.style.display = 'none';

    // Place onto canvas
    const c = this._parser.createCircuitInstance(fullAdderType, '');
    if (c) {
      const worldCenter = this._interaction.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
      this._interaction.addComponent(c, worldCenter.x - 30, worldCenter.y - 20);
      this.recordUndoSnapshot('Load Sample Full Adder IC');
      this.showToast('Pre-built "1-Bit Full Adder" IC loaded into palette and placed onto canvas!');
    }
  }

  public syncCustomTemplatesToPalette(): void {
    const templates = this.getCustomICTemplates();
    for (const tmpl of templates) {
      const comp: ComponentDefinition = {
        type: tmpl.type,
        name: tmpl.name,
        category: 'Integrated Circuits',
        description: `${tmpl.label} (${tmpl.inputCount} In, ${tmpl.outputCount} Out)`,
        defaultInputs: tmpl.inputCount,
        defaultOutputs: tmpl.outputCount
      };
      this.addCustomICToPalette(comp);
    }
  }

  public addCustomICToPalette(comp: ComponentDefinition): void {
    const container = document.getElementById('palette-items');
    if (!container) return;

    let groupDiv: HTMLElement | null = null;
    const existingGroups = container.querySelectorAll('.category-group');
    existingGroups.forEach((group) => {
      const title = group.querySelector('.category-title');
      if (title && title.textContent === 'Integrated Circuits') {
        groupDiv = group as HTMLElement;
      }
    });

    if (!groupDiv) {
      groupDiv = document.createElement('div');
      groupDiv.className = 'category-group';
      const title = document.createElement('div');
      title.className = 'category-title';
      title.textContent = 'Integrated Circuits';
      groupDiv.appendChild(title);
      container.appendChild(groupDiv);
    }

    // Prevent duplicate entries in palette
    const existingItem = groupDiv.querySelector(`[data-type="${comp.type}"]`);
    if (existingItem) return;

    const item = this.createPaletteItemElement(comp);
    groupDiv.appendChild(item);
  }

  private setupModals(): void {
    const modalPkg = document.getElementById('modal-package-ic');
    const closePkgBtn = document.getElementById('btn-modal-close');
    const cancelPkgBtn = document.getElementById('btn-modal-cancel');
    const confirmPkgBtn = document.getElementById('btn-modal-confirm');

    const closeModal = () => {
      if (modalPkg) modalPkg.style.display = 'none';
    };

    if (closePkgBtn) closePkgBtn.addEventListener('click', closeModal);
    if (cancelPkgBtn) cancelPkgBtn.addEventListener('click', closeModal);

    if (confirmPkgBtn) {
      confirmPkgBtn.addEventListener('click', () => {
        this.confirmPackageIC();
      });
    }

    const modalAlert = document.getElementById('modal-alert');
    const closeAlertBtn = document.getElementById('btn-alert-close');
    const okAlertBtn = document.getElementById('btn-alert-ok');

    const closeAlert = () => {
      if (modalAlert) modalAlert.style.display = 'none';
    };

    if (closeAlertBtn) closeAlertBtn.addEventListener('click', closeAlert);
    if (okAlertBtn) okAlertBtn.addEventListener('click', closeAlert);

    // Custom IC Guide Modal
    const modalGuide = document.getElementById('modal-custom-ic-guide');
    const closeGuideBtn = document.getElementById('btn-ic-guide-close');
    const cancelGuideBtn = document.getElementById('btn-guide-close');
    const loadSampleGuideBtn = document.getElementById('btn-guide-load-sample');
    const packageNowGuideBtn = document.getElementById('btn-guide-package-now');

    const closeGuide = () => {
      if (modalGuide) modalGuide.style.display = 'none';
    };
    if (closeGuideBtn) closeGuideBtn.addEventListener('click', closeGuide);
    if (cancelGuideBtn) cancelGuideBtn.addEventListener('click', closeGuide);
    if (loadSampleGuideBtn) {
      loadSampleGuideBtn.addEventListener('click', () => {
        this.loadSampleFullAdderIC();
      });
    }
    if (packageNowGuideBtn) {
      packageNowGuideBtn.addEventListener('click', () => {
        closeGuide();
        this.handlePackageIC();
      });
    }

    // Select Custom IC Modal
    const modalSelectIC = document.getElementById('modal-select-custom-ic');
    const closeSelectICBtn = document.getElementById('btn-select-ic-close');
    const cancelSelectICBtn = document.getElementById('btn-select-ic-cancel');
    const packageNewICBtn = document.getElementById('btn-select-ic-package-new');

    const closeSelectIC = () => {
      if (modalSelectIC) modalSelectIC.style.display = 'none';
    };
    if (closeSelectICBtn) closeSelectICBtn.addEventListener('click', closeSelectIC);
    if (cancelSelectICBtn) cancelSelectICBtn.addEventListener('click', closeSelectIC);
    if (packageNewICBtn) {
      packageNewICBtn.addEventListener('click', () => {
        closeSelectIC();
        this.handlePackageIC();
      });
    }

    // Confirm Delete Custom IC Modal
    const modalConfirmDelete = document.getElementById('modal-confirm-delete-ic');
    const closeConfirmDeleteBtn = document.getElementById('btn-confirm-delete-close');
    const cancelConfirmDeleteBtn = document.getElementById('btn-confirm-delete-cancel');
    const confirmDeleteBtn = document.getElementById('btn-confirm-delete-confirm');

    const closeConfirmDelete = () => {
      if (modalConfirmDelete) modalConfirmDelete.style.display = 'none';
      this._onConfirmDeleteIC = null;
    };

    if (closeConfirmDeleteBtn) closeConfirmDeleteBtn.addEventListener('click', closeConfirmDelete);
    if (cancelConfirmDeleteBtn) cancelConfirmDeleteBtn.addEventListener('click', closeConfirmDelete);

    if (confirmDeleteBtn) {
      confirmDeleteBtn.addEventListener('click', () => {
        const action = this._onConfirmDeleteIC;
        closeConfirmDelete();
        if (action) action();
      });
    }

    // Confirm Close Unsaved Changes Modal
    const closeSaveBtn = document.getElementById('btn-confirm-close-save');
    const closeDontSaveBtn = document.getElementById('btn-confirm-close-dont-save');
    const closeCancelBtn = document.getElementById('btn-confirm-close-cancel');
    const closeXBtn = document.getElementById('btn-confirm-close-x');

    closeSaveBtn?.addEventListener('click', async () => {
      this.hideConfirmCloseModal();
      const saved = await this.handleSaveFile();
      if (saved) {
        if (window.api && typeof window.api.forceCloseWindow === 'function') {
          window.api.forceCloseWindow();
        } else if (window.api && typeof window.api.closeWindow === 'function') {
          window.api.closeWindow();
        } else {
          window.close();
        }
      }
    });

    closeDontSaveBtn?.addEventListener('click', () => {
      this.hideConfirmCloseModal();
      this.setDirty(false);
      if (window.api && typeof window.api.forceCloseWindow === 'function') {
        window.api.forceCloseWindow();
      } else if (window.api && typeof window.api.closeWindow === 'function') {
        window.api.closeWindow();
      } else {
        window.close();
      }
    });

    closeCancelBtn?.addEventListener('click', () => {
      this.hideConfirmCloseModal();
    });

    closeXBtn?.addEventListener('click', () => {
      this.hideConfirmCloseModal();
    });

    // About ProLogic Modal
    const modalAbout = document.getElementById('modal-about');
    const closeAboutBtn = document.getElementById('btn-about-modal-close');
    const okAboutBtn = document.getElementById('btn-about-close');

    const closeAbout = () => {
      if (modalAbout) modalAbout.style.display = 'none';
    };
    if (closeAboutBtn) closeAboutBtn.addEventListener('click', closeAbout);
    if (okAboutBtn) okAboutBtn.addEventListener('click', closeAbout);

    // External link handlers (GitHub, Telegram)
    document.querySelectorAll('[data-open-external]').forEach(elem => {
      elem.addEventListener('click', (e) => {
        e.preventDefault();
        const url = elem.getAttribute('data-open-external');
        if (url) {
          if (window.api && typeof window.api.openExternal === 'function') {
            window.api.openExternal(url);
          } else {
            window.open(url, '_blank');
          }
        }
      });
    });
  }

  private handlePackageIC(): void {
    const inputSwitches: { circuit: SwitchCircuit; node: any }[] = [];
    const outputBulbs: { circuit: LightBulbCircuit; node: any }[] = [];

    for (const [, node] of this._interaction.nodes) {
      if (node.circuit instanceof SwitchCircuit && node.circuit.exportName) {
        inputSwitches.push({ circuit: node.circuit, node });
      } else if (node.circuit instanceof LightBulbCircuit && node.circuit.exportName) {
        outputBulbs.push({ circuit: node.circuit, node });
      }
    }

    if (inputSwitches.length === 0 || outputBulbs.length === 0) {
      this.showAlertModal(
        'Cannot create integrated circuit. To package a circuit, you need at least one Toggle Switch and one Light Bulb with an Export Pin Name. Toggle Switches become input connectors and Light Bulbs become output connectors.'
      );
      return;
    }

    inputSwitches.sort((a, b) => a.node.y - b.node.y);
    outputBulbs.sort((a, b) => a.node.y - b.node.y);

    const summaryElem = document.getElementById('modal-pins-summary');
    if (summaryElem) {
      summaryElem.innerHTML = `
        <div style="color: #00f5d4; margin-bottom: 2px;">Inputs (${inputSwitches.length}): ${inputSwitches.map((s) => s.circuit.exportName).join(', ')}</div>
        <div style="color: #00b4d8;">Outputs (${outputBulbs.length}): ${outputBulbs.map((b) => b.circuit.exportName).join(', ')}</div>
      `;
    }

    const nameInput = document.getElementById('input-ic-name') as HTMLInputElement;
    const symbolInput = document.getElementById('input-ic-symbol') as HTMLInputElement;
    if (nameInput) nameInput.value = 'Custom IC';
    if (symbolInput) symbolInput.value = 'IC';

    const modal = document.getElementById('modal-package-ic');
    if (modal) modal.style.display = 'flex';
  }

  private confirmPackageIC(): void {
    const nameInput = document.getElementById('input-ic-name') as HTMLInputElement;
    const symbolInput = document.getElementById('input-ic-symbol') as HTMLInputElement;
    const icName = nameInput?.value.trim() || 'Custom IC';
    const symbolLabel = symbolInput?.value.trim().toUpperCase() || 'IC';

    const circuitsMap = new Map<string, ICircuit>();
    const metaMap = new Map<string, { x: number; y: number; rotation: number }>();

    for (const [uid, node] of this._interaction.nodes) {
      circuitsMap.set(uid, node.circuit);
      metaMap.set(uid, { x: node.x, y: node.y, rotation: node.rotation });
    }

    const inputSwitches = Array.from(circuitsMap.values())
      .filter((c): c is SwitchCircuit => c instanceof SwitchCircuit && !!c.exportName)
      .sort((a, b) => (metaMap.get(a.uid)?.y || 0) - (metaMap.get(b.uid)?.y || 0));

    const outputBulbs = Array.from(circuitsMap.values())
      .filter((c): c is LightBulbCircuit => c instanceof LightBulbCircuit && !!c.exportName)
      .sort((a, b) => (metaMap.get(a.uid)?.y || 0) - (metaMap.get(b.uid)?.y || 0));

    const xml = this._parser.serialize({
      engine: this._engine,
      circuits: circuitsMap,
      metadata: metaMap,
      locations: {
        left: inputSwitches.map((s) => s.uid),
        right: outputBulbs.map((b) => b.uid),
        top: [],
        bottom: []
      }
    });

    const customTypeId = `custom_${Date.now()}@logic.ly`;
    this._parser.registerCustomTemplate(customTypeId, xml, { name: icName, label: symbolLabel });

    const comp: ComponentDefinition = {
      type: customTypeId,
      name: icName,
      category: 'Integrated Circuits',
      description: `${symbolLabel} (${inputSwitches.length} In, ${outputBulbs.length} Out)`,
      defaultInputs: inputSwitches.length,
      defaultOutputs: outputBulbs.length
    };

    this.addCustomICToPalette(comp);

    const modal = document.getElementById('modal-package-ic');
    if (modal) modal.style.display = 'none';

    this.recordUndoSnapshot(`Package IC ${icName}`);
    this.showToast(`Custom IC "${icName}" (${symbolLabel}) packaged successfully! Available in palette.`);
  }

  public showToast(message: string, durationMs: number = 4000, type: 'info' | 'success' | 'warning' = 'info'): void {
    const container = document.getElementById('toast-container');
    if (!container) return;

    let iconSvg = '';
    const isSuccess = type === 'success' || /successfully|saved|copied|restored/i.test(message);
    const isWarning = type === 'warning' || /warning|error|cannot|fail/i.test(message);
    if (isSuccess) {
      iconSvg = `<svg class="toast-icon" width="15" height="15" viewBox="0 0 512 512" fill="currentColor"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM369 209L241 337c-9.4 9.4-24.6 9.4-33.9 0l-64-64c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l47 47L335 175c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9z"/></svg>`;
    } else if (isWarning) {
      iconSvg = `<svg class="toast-icon" width="15" height="15" viewBox="0 0 512 512" fill="currentColor"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM216 336h24V272H216c-13.3 0-24-10.7-24-24s10.7-24 24-24h48c13.3 0 24 10.7 24 24v88h8c13.3 0 24 10.7 24 24s-10.7 24-24 24H216c-13.3 0-24-10.7-24-24s10.7-24 24-24zm40-208a32 32 0 1 1 0 64 32 32 0 1 1 0-64z"/></svg>`;
    } else {
      iconSvg = `<svg class="toast-icon" width="15" height="15" viewBox="0 0 512 512" fill="currentColor"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM216 336h24V272H216c-13.3 0-24-10.7-24-24s10.7-24 24-24h48c13.3 0 24 10.7 24 24v88h8c13.3 0 24 10.7 24 24s-10.7 24-24 24H216c-13.3 0-24-10.7-24-24s10.7-24 24-24zm40-208a32 32 0 1 1 0 64 32 32 0 1 1 0-64z"/></svg>`;
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `${iconSvg}<span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, durationMs);
  }

  public showAlertModal(message: string, title: string = 'Cannot Create Integrated Circuit'): void {
    const modal = document.getElementById('modal-alert');
    const msgElem = document.getElementById('modal-alert-message');
    const titleElem = document.getElementById('modal-alert-title');
    if (titleElem) {
      const textSpan = titleElem.querySelector('span');
      if (textSpan) {
        textSpan.textContent = title;
      }
    }
    if (!modal || !msgElem) {
      alert(message);
      return;
    }
    msgElem.textContent = message;
    modal.style.display = 'flex';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  (window as any).prologicApp = new ProLogicApp();
});
