import { SimulationEngine } from '../../simulation/engine';
import { ICircuit, IInputCircuit, IOutputCircuit, LogicConnection } from '../../simulation/types';
import { Point, WireRenderer } from './wireRenderer';
import { SymbolRenderer, RenderResult, JackPosition } from './symbolRenderer';
import { SwitchCircuit, PushButtonCircuit } from '../../simulation/circuits/controls';
import { LightBulbCircuit, DigitDisplayCircuit } from '../../simulation/circuits/outputs';
import { ClockCircuit } from '../../simulation/circuits/clock';
import { LabelCircuit } from '../../simulation/circuits/annotation';
import { ParsedCircuitDocument } from '../../io/parser';

export interface ComponentNode {
  circuit: ICircuit;
  x: number;
  y: number;
  rotation: number;
  renderResult: RenderResult;
}

export interface JackCandidate {
  node: ComponentNode;
  jack: JackPosition;
  worldPos: Point;
  screenPos: Point;
  distScreen: number;
}

export class InteractionManager {
  private _svg: SVGSVGElement;
  private _gridGroup: SVGGElement;
  private _wiresGroup: SVGGElement;
  private _waypointsGroup: SVGGElement;
  private _nodesGroup: SVGGElement;
  private _dragWireGroup: SVGGElement;
  private _marqueeGroup: SVGGElement;
  private _marqueeRect: SVGRectElement;

  private _engine: SimulationEngine;
  private _nodes: Map<string, ComponentNode> = new Map();
  private _isAnsi: boolean = true;
  private _gridSnap: boolean = true;
  private _gridSize: number = 15;
  private _showGrid: boolean = true;
  private _enableWireColors: boolean = true;
  private _snapOrthogonalWires: boolean = true;
  private _currentTool: 'select' | 'pan' = 'select';

  // Viewport transform
  public panX: number = 50;
  public panY: number = 50;
  public zoom: number = 1.0;

  // Multi-selection state
  public selectedUids: Set<string> = new Set();
  private _selectedConnection: LogicConnection | null = null;

  // Node Dragging state (multi-node aware)
  private _isDraggingNodes: boolean = false;
  private _dragStartMouse: Point = { x: 0, y: 0 };
  private _nodeDragOrigins: Map<string, Point> = new Map();
  private _hasMovedDuringDrag: boolean = false;

  // Marquee / Box Selection state
  private _isBoxSelecting: boolean = false;
  private _boxSelectStart: Point = { x: 0, y: 0 };

  // Viewport Panning state
  private _isPanning: boolean = false;
  private _isSpacePressed: boolean = false;
  private _lastMouse: Point = { x: 0, y: 0 };

  // Wire drawing state
  private _wireDraftStart: {
    circuit: ICircuit;
    jackIndex: number;
    isInput: boolean;
    jackPos: Point;
  } | null = null;
  private _wireDraftMouseDownPos: Point = { x: 0, y: 0 };
  private _activeSnapCandidate: JackCandidate | null = null;

  // Waypoint dragging state
  private _draggingWaypoint: { conn: LogicConnection; pointIndex: number } | null = null;
  private _wireDragCandidate: {
    conn: LogicConnection;
    clickWorldPos: Point;
    clickClientPos: Point;
    insertIndex: number;
    hasStartedDrag: boolean;
  } | null = null;

  // Dynamic Canvas Resizing state
  private _resizeObserver: ResizeObserver | null = null;
  private _lastWidth: number = 0;
  private _lastHeight: number = 0;
  private _rafResizeId: number | null = null;

  // Callbacks
  public onSelectionChange?: (primaryCircuit: ICircuit | null, allSelected: ICircuit[]) => void;
  public onConnectionSelectionChange?: (connection: LogicConnection | null) => void;
  public onComponentDoubleClick?: (circuit: ICircuit) => void;
  public onCircuitModified?: (actionDescription?: string) => void;
  public onViewChanged?: () => void;
  public onToolChange?: (tool: 'select' | 'pan') => void;
  public onDirty?: () => void;

  private _activeLabelEditor: { commit: () => void; textarea: HTMLTextAreaElement } | null = null;
  private _activeLabelEditorNode: ComponentNode | null = null;

  // Placement / Stamping Mode state
  private _placementType: string | null = null;
  private _placementFactory: (() => ICircuit | null) | null = null;
  private _placementGhostGroup: SVGGElement;
  private _placementGhostCircuit: ICircuit | null = null;
  private _placementGhostRender: RenderResult | null = null;
  public onPlacementModeChange?: (type: string | null) => void;

  constructor(svgElement: SVGSVGElement, engine: SimulationEngine) {
    this._svg = svgElement;
    this._engine = engine;

    this._gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this._wiresGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this._waypointsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this._nodesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this._dragWireGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    // Placement ghost preview group
    this._placementGhostGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this._placementGhostGroup.setAttribute('class', 'placement-ghost-group');
    this._placementGhostGroup.style.pointerEvents = 'none';
    this._placementGhostGroup.style.opacity = '0.65';
    this._placementGhostGroup.style.display = 'none';

    // Make sure draft wire group never intercepts mouse events
    this._dragWireGroup.style.pointerEvents = 'none';

    // Marquee selection group & rectangle
    this._marqueeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this._marqueeGroup.style.pointerEvents = 'none';

    this._marqueeRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    this._marqueeRect.setAttribute('class', 'selection-marquee');
    this._marqueeRect.setAttribute('vector-effect', 'non-scaling-stroke');
    this._marqueeRect.style.display = 'none';
    this._marqueeRect.style.pointerEvents = 'none';
    this._marqueeGroup.appendChild(this._marqueeRect);

    this._svg.appendChild(this._gridGroup);
    this._svg.appendChild(this._wiresGroup);
    this._svg.appendChild(this._waypointsGroup);
    this._svg.appendChild(this._nodesGroup);
    this._svg.appendChild(this._dragWireGroup);
    this._svg.appendChild(this._placementGhostGroup);
    this._svg.appendChild(this._marqueeGroup);

    this.attachEventListeners();
    this.initResizeObserver();
    this.updateTransform();
  }

  get nodes(): Map<string, ComponentNode> {
    return this._nodes;
  }

  get selectedConnection(): LogicConnection | null {
    return this._selectedConnection;
  }

  get selectedCircuit(): ICircuit | null {
    if (this.selectedUids.size === 0) return null;
    const firstUid = Array.from(this.selectedUids)[0];
    return this._nodes.get(firstUid)?.circuit || null;
  }

  set selectedCircuit(circuit: ICircuit | null) {
    this.selectedUids.clear();
    if (circuit) {
      this.selectedUids.add(circuit.uid);
    }
    this.updateSelectionVisuals();
  }

  get selectedCircuits(): ICircuit[] {
    const list: ICircuit[] = [];
    for (const uid of this.selectedUids) {
      const node = this._nodes.get(uid);
      if (node) list.push(node.circuit);
    }
    return list;
  }

  public setGateStandard(isAnsi: boolean): void {
    this._isAnsi = isAnsi;
    for (const [, node] of this._nodes) {
      node.renderResult = SymbolRenderer.renderComponent(node.circuit, this._isAnsi);
    }
    this.render();
  }

  public setGridSnap(enabled: boolean): void {
    this._gridSnap = enabled;
  }

  public setGridSize(size: number): void {
    this._gridSize = Math.max(5, size);
    const pattern = this._svg.querySelector('#grid-dots') as SVGPatternElement;
    if (pattern) {
      pattern.setAttribute('width', this._gridSize.toString());
      pattern.setAttribute('height', this._gridSize.toString());
    }
  }

  public setShowGrid(visible: boolean): void {
    this._showGrid = visible;
    const rect = this._svg.querySelector('rect[fill="url(#grid-dots)"]') as SVGRectElement;
    if (rect) {
      rect.style.display = visible ? 'block' : 'none';
    }
  }

  public setWireColorsEnabled(enabled: boolean): void {
    this._enableWireColors = enabled;
    this.updateWireSignals();
  }

  public setSnapOrthogonalWires(val: boolean): void {
    this._snapOrthogonalWires = val;
    this.renderWires();
  }

  public get snapOrthogonalWires(): boolean {
    return this._snapOrthogonalWires;
  }

  public setTool(tool: 'select' | 'pan'): void {
    if (tool === 'pan') {
      this.cancelPlacementMode();
    }
    this._currentTool = tool;
    this._svg.style.cursor = tool === 'pan' ? 'grab' : (this._placementType ? 'crosshair' : '');
    if (this.onToolChange) {
      this.onToolChange(tool);
    }
  }

  public get currentTool(): 'select' | 'pan' {
    return this._currentTool;
  }

  public get placementType(): string | null {
    return this._placementType;
  }

  public setPlacementMode(type: string | null, factory?: (() => ICircuit | null) | null): void {
    this._placementType = type;
    this._placementFactory = factory || null;

    if (this._placementType && this._placementFactory) {
      try {
        this._placementGhostCircuit = this._placementFactory();
        if (this._placementGhostCircuit) {
          this._placementGhostRender = SymbolRenderer.renderComponent(this._placementGhostCircuit, this._isAnsi);
          this._placementGhostGroup.innerHTML = this._placementGhostRender.svgContent;
        }
      } catch {
        this._placementGhostCircuit = null;
        this._placementGhostRender = null;
        this._placementGhostGroup.innerHTML = '';
      }
      this._svg.style.cursor = 'crosshair';
    } else {
      this._placementGhostCircuit = null;
      this._placementGhostRender = null;
      this._placementGhostGroup.innerHTML = '';
      this._placementGhostGroup.style.display = 'none';
      this._svg.style.cursor = this._currentTool === 'pan' ? 'grab' : '';
    }

    if (this.onPlacementModeChange) {
      this.onPlacementModeChange(this._placementType);
    }
  }

  public cancelPlacementMode(): void {
    if (this._placementType !== null) {
      this.setPlacementMode(null, null);
    }
  }

  public panBy(dx: number, dy: number): void {
    this.panX += dx;
    this.panY += dy;
    this.updateTransform();
  }

  public setPan(x: number, y: number): void {
    this.panX = x;
    this.panY = y;
    this.updateTransform();
  }

  public selectConnection(conn: LogicConnection | null): void {
    this._selectedConnection = conn;
    this.selectedUids.clear();
    this.updateSelectionVisuals();
    this.renderWaypoints();
    if (this.onConnectionSelectionChange) this.onConnectionSelectionChange(conn);
  }

  public addComponent(
    circuit: ICircuit,
    x: number,
    y: number,
    rotation: number = 0,
    snapToGrid: boolean = true,
    renderAfter: boolean = true
  ): ComponentNode {
    const renderResult = SymbolRenderer.renderComponent(circuit, this._isAnsi);
    const snap = snapToGrid && this._gridSnap;
    const finalX = snap ? Math.round(x / this._gridSize) * this._gridSize : x;
    const finalY = snap ? Math.round(y / this._gridSize) * this._gridSize : y;

    const node: ComponentNode = {
      circuit,
      x: finalX,
      y: finalY,
      rotation,
      renderResult
    };

    this._nodes.set(circuit.uid, node);
    this._engine.registerCircuit(circuit);

    // Select the newly added component
    this.selectedUids.clear();
    this.selectedUids.add(circuit.uid);
    this._selectedConnection = null;

    if (renderAfter) {
      this.render();
      if (this.onSelectionChange) this.onSelectionChange(circuit, [circuit]);
      if (this.onCircuitModified) this.onCircuitModified(`Add ${circuit.type}`);
    }
    return node;
  }

  public removeComponent(circuit: ICircuit): void {
    this._engine.unregisterCircuit(circuit);
    this._nodes.delete(circuit.uid);
    this.selectedUids.delete(circuit.uid);

    this.render();
    if (this.onSelectionChange) this.onSelectionChange(this.selectedCircuit, this.selectedCircuits);
    if (this.onCircuitModified) this.onCircuitModified(`Delete Component`);
  }

  public rotateSelected(angleDegrees: number = 90): void {
    if (this.selectedUids.size === 0) return;

    for (const uid of this.selectedUids) {
      const node = this._nodes.get(uid);
      if (node) {
        node.rotation = (node.rotation + angleDegrees) % 360;
      }
    }
    this.render();
    if (this.onCircuitModified) this.onCircuitModified(`Rotate Component(s)`);
  }

  private getConnectionId(conn: LogicConnection): string {
    return `${conn.outputCircuit.uid}_${conn.outputIndex}_${conn.inputCircuit.uid}_${conn.inputIndex}`;
  }

  public resetSelectedConnectionShape(): void {
    if (!this._selectedConnection) return;
    this._selectedConnection.points = [];
    this.renderWires();
    this.renderWaypoints();
    if (this.onConnectionSelectionChange) this.onConnectionSelectionChange(this._selectedConnection);
    if (this.onCircuitModified) this.onCircuitModified(`Reset Wire Shape`);
  }

  public deleteSelectedConnection(): void {
    if (!this._selectedConnection) return;
    this._engine.disconnect(this._selectedConnection);
    this._selectedConnection = null;
    this.renderWires();
    this.renderWaypoints();
    if (this.onConnectionSelectionChange) this.onConnectionSelectionChange(null);
    if (this.onCircuitModified) this.onCircuitModified(`Delete Wire`);
  }

  public deleteSelected(): void {
    let modified = false;

    if (this._selectedConnection) {
      this._engine.disconnect(this._selectedConnection);
      this._selectedConnection = null;
      if (this.onConnectionSelectionChange) this.onConnectionSelectionChange(null);
      modified = true;
    }

    if (this.selectedUids.size > 0) {
      for (const uid of this.selectedUids) {
        const node = this._nodes.get(uid);
        if (node) {
          this._engine.unregisterCircuit(node.circuit);
          this._nodes.delete(uid);
          modified = true;
        }
      }
      this.selectedUids.clear();
      if (this.onSelectionChange) this.onSelectionChange(null, []);
    }

    if (modified) {
      this.render();
      if (this.onCircuitModified) this.onCircuitModified(`Delete Selection`);
    }
  }

  public selectAll(): void {
    this.selectedUids.clear();
    for (const [uid] of this._nodes) {
      this.selectedUids.add(uid);
    }
    this._selectedConnection = null;
    this.updateSelectionVisuals();
    if (this.onSelectionChange) this.onSelectionChange(this.selectedCircuit, this.selectedCircuits);
  }

  public deselectAll(): void {
    this.commitActiveLabelEdit();
    this.selectedUids.clear();
    this._selectedConnection = null;
    this.cancelWireDraft();
    this.updateSelectionVisuals();
    if (this.onSelectionChange) this.onSelectionChange(null, []);
    if (this.onConnectionSelectionChange) this.onConnectionSelectionChange(null);
  }

  public get activeLabelEditor(): { commit: () => void; textarea: HTMLTextAreaElement } | null {
    return this._activeLabelEditor;
  }

  public commitActiveLabelEdit(): void {
    if (this._activeLabelEditor) {
      this._activeLabelEditor.commit();
    }
  }

  public startInPlaceLabelEditing(node: ComponentNode): void {
    if (!(node.circuit instanceof LabelCircuit)) return;
    const circuit = node.circuit as LabelCircuit;

    if (this._activeLabelEditor) {
      if (this._activeLabelEditorNode === node) {
        const textarea = this._activeLabelEditor.textarea;
        const len = textarea.value.length;
        requestAnimationFrame(() => {
          textarea.focus();
          try {
            textarea.setSelectionRange(len, len);
          } catch {}
        });
        setTimeout(() => {
          textarea.focus();
          try {
            textarea.setSelectionRange(len, len);
          } catch {}
        }, 0);
        return;
      }
      this._activeLabelEditor.commit();
    }

    // Select this node
    this.selectedUids.clear();
    this.selectedUids.add(circuit.uid);
    this._selectedConnection = null;
    this.updateSelectionVisuals();
    if (this.onSelectionChange) {
      this.onSelectionChange(circuit, [circuit]);
    }

    const container = (this._svg.parentElement as HTMLElement) || document.body;
    const containerRect = container.getBoundingClientRect();
    const screenPos = this.worldToScreen(node.x, node.y);
    const left = screenPos.x - containerRect.left;
    const top = screenPos.y - containerRect.top;

    const textarea = document.createElement('textarea');
    textarea.className = 'canvas-inplace-editor';
    textarea.value = circuit.text;
    textarea.spellcheck = false;

    const isBlank = circuit.text.trim().length === 0;
    const initialW = isBlank
      ? Math.round(80 * this.zoom)
      : Math.max(Math.round(16 * this.zoom), Math.round((node.renderResult?.width ?? 80) * this.zoom));
    const initialH = isBlank
      ? Math.round(28 * this.zoom)
      : Math.max(Math.round(20 * this.zoom), Math.round((node.renderResult?.height ?? 28) * this.zoom));

    textarea.style.position = 'absolute';
    textarea.style.left = `${left}px`;
    textarea.style.top = `${top}px`;
    textarea.style.width = `${initialW}px`;
    textarea.style.height = `${initialH}px`;
    textarea.style.fontSize = `${(circuit.fontSize || 13) * this.zoom}px`;
    textarea.style.fontWeight = circuit.bold ? '700' : '500';
    textarea.style.fontStyle = circuit.italic ? 'italic' : 'normal';
    textarea.style.textAlign = circuit.alignment || 'left';
    if (circuit.color) {
      textarea.style.color = circuit.color;
    }

    if (node.rotation && node.rotation !== 0) {
      const cx = ((node.renderResult?.width ?? 80) / 2) * this.zoom;
      const cy = ((node.renderResult?.height ?? 28) / 2) * this.zoom;
      textarea.style.transformOrigin = `${cx}px ${cy}px`;
      textarea.style.transform = `rotate(${node.rotation}deg)`;
    }

    textarea.addEventListener('mousedown', (e) => e.stopPropagation());
    textarea.addEventListener('mouseup', (e) => e.stopPropagation());
    textarea.addEventListener('click', (e) => e.stopPropagation());
    textarea.addEventListener('dblclick', (e) => e.stopPropagation());

    container.appendChild(textarea);

    const len = textarea.value.length;
    requestAnimationFrame(() => {
      textarea.focus();
      try {
        textarea.setSelectionRange(len, len);
      } catch {}
    });
    setTimeout(() => {
      textarea.focus();
      try {
        textarea.setSelectionRange(len, len);
      } catch {}
    }, 0);

    const updateSizeAndContent = () => {
      circuit.text = textarea.value;
      node.renderResult = SymbolRenderer.renderComponent(circuit, this._isAnsi);
      this.render();

      const isBlankNow = textarea.value.trim().length === 0;
      const newW = isBlankNow
        ? Math.round(80 * this.zoom)
        : Math.max(Math.round(16 * this.zoom), Math.round(node.renderResult.width * this.zoom));
      const newH = isBlankNow
        ? Math.round(28 * this.zoom)
        : Math.max(Math.round(20 * this.zoom), Math.round(node.renderResult.height * this.zoom));
      textarea.style.width = `${newW}px`;
      textarea.style.height = `${newH}px`;

      const propTextarea = document.getElementById('prop-label-text') as HTMLTextAreaElement;
      if (propTextarea && propTextarea.value !== textarea.value) {
        propTextarea.value = textarea.value;
      }

      if (this.onDirty) {
        this.onDirty();
      }
    };

    textarea.addEventListener('input', updateSizeAndContent);

    let isFinished = false;
    const initialText = circuit.text;

    const commit = () => {
      if (isFinished) return;
      isFinished = true;
      this._activeLabelEditor = null;
      this._activeLabelEditorNode = null;

      window.removeEventListener('mousedown', onPointerDownOutside, true);
      window.removeEventListener('touchstart', onPointerDownOutside, true);

      circuit.text = textarea.value;
      node.renderResult = SymbolRenderer.renderComponent(circuit, this._isAnsi);
      this.render();

      if (textarea.parentElement) {
        textarea.parentElement.removeChild(textarea);
      }

      const propTextarea = document.getElementById('prop-label-text') as HTMLTextAreaElement;
      if (propTextarea && propTextarea.value !== circuit.text) {
        propTextarea.value = circuit.text;
      }

      if (circuit.text !== initialText) {
        if (this.onCircuitModified) {
          this.onCircuitModified('Edit Label');
        }
      }
    };

    textarea.addEventListener('keydown', (e: KeyboardEvent) => {
      e.stopPropagation();

      if (e.key === 'Escape') {
        e.preventDefault();
        commit();
        return;
      }

      if (e.key === 'Enter') {
        if (e.shiftKey) {
          setTimeout(updateSizeAndContent, 0);
          return;
        } else {
          e.preventDefault();
          commit();
          return;
        }
      }
    });

    const onPointerDownOutside = (e: MouseEvent | TouchEvent) => {
      if (e.target !== textarea) {
        commit();
      }
    };

    setTimeout(() => {
      if (!isFinished) {
        window.addEventListener('mousedown', onPointerDownOutside, true);
        window.addEventListener('touchstart', onPointerDownOutside, true);
      }
    }, 0);

    this._activeLabelEditor = { commit, textarea };
    this._activeLabelEditorNode = node;
  }

  public screenToWorld(screenX: number, screenY: number): Point {
    const rect = this._svg.getBoundingClientRect();
    return {
      x: (screenX - rect.left - this.panX) / this.zoom,
      y: (screenY - rect.top - this.panY) / this.zoom
    };
  }

  public worldToScreen(worldX: number, worldY: number): Point {
    const rect = this._svg.getBoundingClientRect();
    return {
      x: worldX * this.zoom + this.panX + rect.left,
      y: worldY * this.zoom + this.panY + rect.top
    };
  }

  public getRotatedJackPosition(node: ComponentNode, jack: JackPosition): Point {
    if (node.rotation === 0) {
      return { x: node.x + jack.x, y: node.y + jack.y };
    }

    const cx = node.renderResult.width / 2;
    const cy = node.renderResult.height / 2;
    const rad = (node.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const relX = jack.x - cx;
    const relY = jack.y - cy;

    const rotX = relX * cos - relY * sin + cx;
    const rotY = relX * sin + relY * cos + cy;

    return { x: node.x + rotX, y: node.y + rotY };
  }

  public findNearestCompatibleJack(
    clientX: number,
    clientY: number,
    filterOpposite: { isInput: boolean; circuitUid: string; jackIndex: number } | null = null,
    maxSnapRadiusScreen: number = 28
  ): JackCandidate | null {
    const rect = this._svg.getBoundingClientRect();
    let nearest: JackCandidate | null = null;
    let minDistance = maxSnapRadiusScreen;

    for (const [uid, node] of this._nodes) {
      for (const jack of node.renderResult.jacks) {
        if (filterOpposite) {
          // Must connect an Output to an Input or vice versa
          if (jack.isInput === filterOpposite.isInput) {
            continue;
          }
          // Cannot connect a jack to itself
          if (
            uid === filterOpposite.circuitUid &&
            jack.isInput === filterOpposite.isInput &&
            jack.index === filterOpposite.jackIndex
          ) {
            continue;
          }
        }

        const worldPos = this.getRotatedJackPosition(node, jack);
        const screenX = worldPos.x * this.zoom + this.panX + rect.left;
        const screenY = worldPos.y * this.zoom + this.panY + rect.top;
        const dist = Math.hypot(clientX - screenX, clientY - screenY);

        if (dist <= minDistance) {
          minDistance = dist;
          nearest = {
            node,
            jack,
            worldPos,
            screenPos: { x: screenX, y: screenY },
            distScreen: dist
          };
        }
      }
    }

    return nearest;
  }

  private completeConnection(
    start: { circuit: ICircuit; jackIndex: number; isInput: boolean },
    target: { node: ComponentNode; jack: JackPosition }
  ): void {
    let outputCircuit: IOutputCircuit;
    let outputIndex: number;
    let inputCircuit: IInputCircuit;
    let inputIndex: number;

    if (start.isInput) {
      outputCircuit = target.node.circuit as IOutputCircuit;
      outputIndex = target.jack.index;
      inputCircuit = start.circuit as IInputCircuit;
      inputIndex = start.jackIndex;
    } else {
      outputCircuit = start.circuit as IOutputCircuit;
      outputIndex = start.jackIndex;
      inputCircuit = target.node.circuit as IInputCircuit;
      inputIndex = target.jack.index;
    }

    this._engine.connect(outputCircuit, outputIndex, inputCircuit, inputIndex);
    this._engine.propagateAll();
    this.render();
    if (this.onCircuitModified) this.onCircuitModified(`Connect Wire`);
  }

  public cancelWireDraft(): void {
    this._wireDraftStart = null;
    this._activeSnapCandidate = null;
    this._dragWireGroup.innerHTML = '';
  }

  public updateTransform(): void {
    const transformStr = `translate(${this.panX}, ${this.panY}) scale(${this.zoom})`;
    this._gridGroup.setAttribute('transform', transformStr);
    this._wiresGroup.setAttribute('transform', transformStr);
    this._waypointsGroup.setAttribute('transform', transformStr);
    this._nodesGroup.setAttribute('transform', transformStr);
    this._dragWireGroup.setAttribute('transform', transformStr);
    this._marqueeGroup.setAttribute('transform', transformStr);

    const pattern = this._svg.querySelector('#grid-dots') as SVGPatternElement;
    if (pattern) {
      pattern.setAttribute('patternTransform', `translate(${this.panX}, ${this.panY}) scale(${this.zoom})`);
    }

    this.onViewChanged?.();
  }

  private initResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') return;

    // Observe either container or SVG element
    const target = this._svg.parentElement || this._svg;
    if (!target) return;

    try {
      this._resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const width = entry.contentRect.width;
          const height = entry.contentRect.height;
          this.handleResize(width, height);
        }
      });
      this._resizeObserver.observe(target);
    } catch {
      // Graceful fallback if observer cannot attach
    }
  }

  public handleResize(newWidth: number, newHeight: number): void {
    if (newWidth <= 0 || newHeight <= 0) return;

    if (this._lastWidth > 0 && this._lastHeight > 0) {
      const dw = newWidth - this._lastWidth;
      const dh = newHeight - this._lastHeight;

      // Keep circuit centered in view by adjusting pan offset
      this.panX += dw / 2;
      this.panY += dh / 2;
    }

    this._lastWidth = newWidth;
    this._lastHeight = newHeight;

    // Throttle transform updates with requestAnimationFrame for smooth 60 FPS
    if (typeof requestAnimationFrame !== 'undefined') {
      if (this._rafResizeId !== null) {
        cancelAnimationFrame(this._rafResizeId);
      }
      this._rafResizeId = requestAnimationFrame(() => {
        this._rafResizeId = null;
        this.updateTransform();
      });
    } else {
      this.updateTransform();
    }
  }

  /**
   * Automatically scales and centers all components and waypoints on the canvas within the current window bounds
   */
  public zoomToFit(padding: number = 60): void {
    if (this._nodes.size === 0) {
      this.panX = 50;
      this.panY = 50;
      this.zoom = 1.0;
      this.updateTransform();
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const [, node] of this._nodes) {
      const w = node.renderResult.width || 60;
      const h = node.renderResult.height || 40;
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + w);
      maxY = Math.max(maxY, node.y + h);
    }

    // Include wire waypoints in bounding box
    for (const conn of this._engine.connections) {
      if (conn.points) {
        for (const pt of conn.points) {
          minX = Math.min(minX, pt.x);
          minY = Math.min(minY, pt.y);
          maxX = Math.max(maxX, pt.x);
          maxY = Math.max(maxY, pt.y);
        }
      }
    }

    const circuitWidth = Math.max(20, maxX - minX);
    const circuitHeight = Math.max(20, maxY - minY);

    let containerW = this._lastWidth;
    let containerH = this._lastHeight;

    if (typeof this._svg.getBoundingClientRect === 'function') {
      const svgRect = this._svg.getBoundingClientRect();
      if (svgRect.width > 0) containerW = svgRect.width;
      if (svgRect.height > 0) containerH = svgRect.height;
    }

    if (!containerW || containerW <= 0) containerW = 800;
    if (!containerH || containerH <= 0) containerH = 600;

    const availableW = Math.max(100, containerW - padding * 2);
    const availableH = Math.max(100, containerH - padding * 2);

    const scaleX = availableW / circuitWidth;
    const scaleY = availableH / circuitHeight;

    // Clamp zoom to sensible bounds [0.2, 2.5]
    const fitZoom = Math.min(scaleX, scaleY);
    this.zoom = Math.min(2.5, Math.max(0.2, fitZoom));

    const circuitCenterX = minX + circuitWidth / 2;
    const circuitCenterY = minY + circuitHeight / 2;

    this.panX = containerW / 2 - circuitCenterX * this.zoom;
    this.panY = containerH / 2 - circuitCenterY * this.zoom;

    this.updateTransform();
  }

  public destroy(): void {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._rafResizeId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this._rafResizeId);
      this._rafResizeId = null;
    }
  }

  public render(): void {
    this.updateTransform();
    this.renderNodes();
    this.renderWires();
    this.renderWaypoints();
  }

  /**
   * Fast, in-place visual update of selection borders without destroying DOM nodes
   */
  public updateSelectionVisuals(): void {
    for (const [uid, node] of this._nodes) {
      const g = this._nodesGroup.querySelector(`[data-uid="${uid}"]`) as SVGGElement;
      if (!g) continue;

      const isSelected = this.selectedUids.has(uid);
      g.classList.toggle('selected', isSelected);

      const outline = g.querySelector('.selection-outline') as SVGRectElement;
      if (outline) {
        outline.setAttribute('stroke', isSelected ? '#00f5d4' : 'transparent');
      }
    }

    // Wires selection
    const pathElems = this._wiresGroup.querySelectorAll('path.wire-path');
    let idx = 0;
    for (const conn of this._engine.connections) {
      if (idx < pathElems.length) {
        const path = pathElems[idx] as SVGPathElement;
        const val = conn.outputCircuit.getOutputAt(conn.outputIndex);
        const isSelected = this._selectedConnection === conn;
        path.setAttribute('class', WireRenderer.getWireCssClass(val, isSelected));
        idx++;
      }
    }
  }

  public updateDynamicVisuals(): void {
    for (const [uid, node] of this._nodes) {
      const nodeElem = this._nodesGroup.querySelector(`[data-uid="${uid}"]`);
      if (!nodeElem) continue;

      // Update LightBulb
      if (node.circuit instanceof LightBulbCircuit) {
        const comp = nodeElem.querySelector('.lightbulb-component');
        const isOn = node.circuit.isOn;
        if (comp) {
          comp.classList.toggle('bulb-on', isOn);
          comp.classList.toggle('bulb-off', !isOn);
        }
      }

      // Update Clock
      else if (node.circuit instanceof ClockCircuit) {
        const comp = nodeElem.querySelector('.clock-component');
        const isHigh = node.circuit.getOutputAt(0) === true;
        if (comp) {
          comp.classList.toggle('clock-high', isHigh);
          comp.classList.toggle('clock-low', !isHigh);
        }
      }

      // Update 4-bit Digit Display
      else if (node.circuit instanceof DigitDisplayCircuit) {
        const textElem = nodeElem.querySelector('.digit-char');
        if (textElem) {
          const char = node.circuit.hexChar;
          if (textElem.textContent !== char) {
            textElem.textContent = char;
          }
        }
      }

      // Update Switch
      else if (node.circuit instanceof SwitchCircuit) {
        const comp = nodeElem.querySelector('.switch-component');
        const knob = nodeElem.querySelector('.switch-knob');
        const isOn = node.circuit.state;
        if (comp) {
          comp.classList.toggle('switch-on', isOn);
          comp.classList.toggle('switch-off', !isOn);
        }
        if (knob) {
          knob.setAttribute('cx', isOn ? '32' : '18');
        }
      }

      // Update PushButton
      else if (node.circuit instanceof PushButtonCircuit) {
        const comp = nodeElem.querySelector('.pushbutton-component');
        const knob = nodeElem.querySelector('.button-knob');
        const isPressed = node.circuit.isPressed;
        if (comp) {
          comp.classList.toggle('btn-pressed', isPressed);
          comp.classList.toggle('btn-released', !isPressed);
        }
        if (knob) {
          knob.setAttribute('r', isPressed ? '10' : '12');
        }
      }
    }
  }

  public updateWireSignals(): void {
    const pathElems = this._wiresGroup.querySelectorAll('path.wire-path');
    let idx = 0;
    for (const conn of this._engine.connections) {
      if (idx < pathElems.length) {
        const path = pathElems[idx] as SVGPathElement;
        const val = this._enableWireColors ? conn.outputCircuit.getOutputAt(conn.outputIndex) : false;
        const isSelected = this._selectedConnection === conn;
        const cls = WireRenderer.getWireCssClass(val, isSelected);
        if (path.getAttribute('class') !== cls) {
          path.setAttribute('class', cls);
        }
        idx++;
      }
    }
  }

  /**
   * Fast in-place bezier path updates for all wires connected to moving nodes
   */
  private updateWiresForNodes(movedUids: Set<string>): void {
    for (const conn of this._engine.connections) {
      const outUid = conn.outputCircuit.uid;
      const inUid = conn.inputCircuit.uid;
      if (movedUids.has(outUid) || movedUids.has(inUid)) {
        this.updateWirePath(conn);
      }
    }
  }

  public updateWirePath(conn: LogicConnection): void {
    const outNode = this._nodes.get(conn.outputCircuit.uid);
    const inNode = this._nodes.get(conn.inputCircuit.uid);
    if (!outNode || !inNode) return;

    const outJack = outNode.renderResult.jacks.find((j) => !j.isInput && j.index === conn.outputIndex);
    const inJack = inNode.renderResult.jacks.find((j) => j.isInput && j.index === conn.inputIndex);
    if (!outJack || !inJack) return;

    const start = this.getRotatedJackPosition(outNode, outJack);
    const end = this.getRotatedJackPosition(inNode, inJack);
    const pathD = WireRenderer.generateBezierPath(start, end, conn.points || [], this._snapOrthogonalWires);

    const connId = this.getConnectionId(conn);
    const group = this._wiresGroup.querySelector(`.wire-group[data-conn-id="${connId}"]`);
    if (group) {
      group.querySelectorAll('path').forEach((p) => p.setAttribute('d', pathD));
    }
  }

  private renderNodes(): void {
    this._nodesGroup.innerHTML = '';

    for (const [uid, node] of this._nodes) {
      const isSelected = this.selectedUids.has(uid);
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', `circuit-node ${isSelected ? 'selected' : ''}`);

      if (node.rotation !== 0) {
        const cx = node.renderResult.width / 2;
        const cy = node.renderResult.height / 2;
        g.setAttribute('transform', `translate(${node.x}, ${node.y}) rotate(${node.rotation}, ${cx}, ${cy})`);
      } else {
        g.setAttribute('transform', `translate(${node.x}, ${node.y})`);
      }
      g.dataset.uid = uid;

      // Selection outline
      const outline = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      outline.setAttribute('class', 'selection-outline');
      outline.setAttribute('x', '-6');
      outline.setAttribute('y', '-6');
      outline.setAttribute('width', (node.renderResult.width + 12).toString());
      outline.setAttribute('height', (node.renderResult.height + 12).toString());
      outline.setAttribute('rx', '6');
      outline.setAttribute('fill', 'transparent');
      outline.setAttribute('stroke', isSelected ? '#00f5d4' : 'transparent');
      outline.setAttribute('stroke-width', '1.5');
      outline.setAttribute('stroke-dasharray', '4 3');
      g.appendChild(outline);

      // Symbol graphics
      const symbolContainer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      symbolContainer.innerHTML = node.renderResult.svgContent;
      g.appendChild(symbolContainer);

      // Jack pins (visual circle + accurate 8px hitbox that doesn't swallow the gate)
      for (const jack of node.renderResult.jacks) {
        const jackGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        jackGroup.setAttribute('class', 'jack-group');

        // Visual pin
        const jackCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        jackCircle.setAttribute('class', 'jack-pin');
        jackCircle.setAttribute('cx', jack.x.toString());
        jackCircle.setAttribute('cy', jack.y.toString());
        jackCircle.setAttribute('r', '4.5');
        jackCircle.setAttribute('fill', '#111827');
        jackCircle.setAttribute('stroke', jack.isInput ? '#64748b' : '#00b4d8');
        jackCircle.setAttribute('stroke-width', '2');

        // Focused Hitbox (8px radius)
        const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        hitArea.setAttribute('class', 'jack-hit-area');
        hitArea.setAttribute('cx', jack.x.toString());
        hitArea.setAttribute('cy', jack.y.toString());
        hitArea.setAttribute('r', '8');
        hitArea.setAttribute('fill', 'transparent');
        hitArea.style.cursor = 'crosshair';
        hitArea.dataset.isInput = jack.isInput.toString();
        hitArea.dataset.jackIndex = jack.index.toString();
        hitArea.dataset.circuitUid = uid;

        jackGroup.appendChild(jackCircle);
        jackGroup.appendChild(hitArea);
        g.appendChild(jackGroup);
      }

      this._nodesGroup.appendChild(g);
    }
  }

  public renderWires(): void {
    this._wiresGroup.innerHTML = '';

    for (const conn of this._engine.connections) {
      const outNode = this._nodes.get(conn.outputCircuit.uid);
      const inNode = this._nodes.get(conn.inputCircuit.uid);
      if (!outNode || !inNode) continue;

      const outJack = outNode.renderResult.jacks.find((j) => !j.isInput && j.index === conn.outputIndex);
      const inJack = inNode.renderResult.jacks.find((j) => j.isInput && j.index === conn.inputIndex);
      if (!outJack || !inJack) continue;

      const start = this.getRotatedJackPosition(outNode, outJack);
      const end = this.getRotatedJackPosition(inNode, inJack);

      const pathD = WireRenderer.generateBezierPath(start, end, conn.points || [], this._snapOrthogonalWires);
      const value = this._enableWireColors ? conn.outputCircuit.getOutputAt(conn.outputIndex) : false;
      const isSelected = this._selectedConnection === conn;
      const cssClass = WireRenderer.getWireCssClass(value, isSelected);

      const connId = this.getConnectionId(conn);
      const wireGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      wireGroup.setAttribute('class', `wire-group ${isSelected ? 'selected' : ''}`);
      wireGroup.dataset.connId = connId;

      // 1. Transparent wide hit-area (16px stroke) for easy clicking and direct dragging to adjust shape
      const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hitArea.setAttribute('d', pathD);
      hitArea.setAttribute('class', 'wire-hit-area');
      hitArea.setAttribute('fill', 'none');
      hitArea.setAttribute('stroke', 'transparent');
      hitArea.setAttribute('stroke-width', '16');
      hitArea.style.cursor = 'grab';

      // 2. Visible styled wire path
      const pathElem = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathElem.setAttribute('d', pathD);
      pathElem.setAttribute('class', cssClass);
      pathElem.style.pointerEvents = 'none';

      // Attach wire mousedown for immediate selection + drag-to-bend
      hitArea.addEventListener('mousedown', (e: MouseEvent) => {
        if (e.button !== 0) return; // Left click only
        e.stopPropagation();

        const worldPos = this.screenToWorld(e.clientX, e.clientY);
        const insertIndex = WireRenderer.findClosestSegment(worldPos, start, end, conn.points || []);

        this._selectedConnection = conn;
        this.selectedUids.clear();
        this.updateSelectionVisuals();
        this.renderWaypoints();
        if (this.onSelectionChange) this.onSelectionChange(null, []);
        if (this.onConnectionSelectionChange) this.onConnectionSelectionChange(conn);

        this._wireDragCandidate = {
          conn,
          clickWorldPos: worldPos,
          clickClientPos: { x: e.clientX, y: e.clientY },
          insertIndex,
          hasStartedDrag: false
        };
      });

      // Double-click wire to insert permanent waypoint
      hitArea.addEventListener('dblclick', (e: MouseEvent) => {
        e.stopPropagation();
        const pt = this.screenToWorld(e.clientX, e.clientY);
        if (this._gridSnap) {
          pt.x = Math.round(pt.x / this._gridSize) * this._gridSize;
          pt.y = Math.round(pt.y / this._gridSize) * this._gridSize;
        }
        if (!conn.points) conn.points = [];
        const insertIdx = WireRenderer.findClosestSegment(pt, start, end, conn.points);
        conn.points.splice(insertIdx, 0, pt);
        this._selectedConnection = conn;
        this.renderWires();
        this.renderWaypoints();
        if (this.onCircuitModified) this.onCircuitModified(`Add Waypoint`);
        if (this.onConnectionSelectionChange) this.onConnectionSelectionChange(conn);
      });

      // Right-click wire to delete
      hitArea.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        this._engine.disconnect(conn);
        this._selectedConnection = null;
        if (this.onConnectionSelectionChange) this.onConnectionSelectionChange(null);
        this.renderWires();
        this.renderWaypoints();
        if (this.onCircuitModified) this.onCircuitModified(`Delete Wire`);
      });

      wireGroup.appendChild(hitArea);
      wireGroup.appendChild(pathElem);
      this._wiresGroup.appendChild(wireGroup);
    }
  }

  private renderWaypoints(): void {
    this._waypointsGroup.innerHTML = '';
    const conn = this._selectedConnection;
    if (!conn || !conn.points || conn.points.length === 0) return;

    conn.points.forEach((pt, idx) => {
      const handleGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      handleGroup.setAttribute('class', 'waypoint-group');
      handleGroup.dataset.pointIndex = idx.toString();

      // Visual handle
      const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      handle.setAttribute('class', 'waypoint-handle');
      handle.setAttribute('cx', pt.x.toString());
      handle.setAttribute('cy', pt.y.toString());
      handle.setAttribute('r', '6');
      handle.dataset.pointIndex = idx.toString();

      // Larger 14px hit area for easy grabbing
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      hit.setAttribute('class', 'waypoint-hit-area');
      hit.setAttribute('cx', pt.x.toString());
      hit.setAttribute('cy', pt.y.toString());
      hit.setAttribute('r', '14');
      hit.setAttribute('fill', 'transparent');
      hit.style.cursor = 'grab';
      hit.dataset.pointIndex = idx.toString();

      hit.addEventListener('mousedown', (e: MouseEvent) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        this._draggingWaypoint = { conn, pointIndex: idx };
        hit.style.cursor = 'grabbing';
      });

      // Double-click waypoint to delete it
      hit.addEventListener('dblclick', (e: MouseEvent) => {
        e.stopPropagation();
        conn.points!.splice(idx, 1);
        this.renderWires();
        this.renderWaypoints();
        if (this.onCircuitModified) this.onCircuitModified(`Delete Waypoint`);
        if (this.onConnectionSelectionChange) this.onConnectionSelectionChange(conn);
      });

      // Right-click waypoint to delete it
      hit.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        conn.points!.splice(idx, 1);
        this.renderWires();
        this.renderWaypoints();
        if (this.onCircuitModified) this.onCircuitModified(`Delete Waypoint`);
        if (this.onConnectionSelectionChange) this.onConnectionSelectionChange(conn);
      });

      handleGroup.appendChild(handle);
      handleGroup.appendChild(hit);
      this._waypointsGroup.appendChild(handleGroup);
    });
  }

  private attachEventListeners(): void {
    // Prevent default context menu on empty canvas background so right-click pan works cleanly
    this._svg.addEventListener('contextmenu', (e: MouseEvent) => {
      if (this._placementType) {
        e.preventDefault();
        e.stopPropagation();
        this.cancelPlacementMode();
        return;
      }

      const target = e.target as SVGElement;
      const isBackground = !target.closest('.circuit-node') &&
                           !target.closest('.wire-group') &&
                           !target.closest('.waypoint-group') &&
                           !target.closest('.jack-group');
      if (isBackground) {
        e.preventDefault();
      }
    });

    this._svg.addEventListener('mouseenter', () => {
      if (this._placementType && this._placementGhostRender) {
        this._placementGhostGroup.style.display = 'block';
      }
    });

    this._svg.addEventListener('mouseleave', () => {
      if (this._placementGhostGroup) {
        this._placementGhostGroup.style.display = 'none';
      }
    });

    // Canvas Mousedown
    this._svg.addEventListener('mousedown', (e: MouseEvent) => {
      const target = e.target as SVGElement;
      const isBackground = !target.closest('.circuit-node') &&
                           !target.closest('.wire-group') &&
                           !target.closest('.waypoint-group') &&
                           !target.closest('.jack-group');

      // Right-click handling: cancels placement mode, active wire draft OR pans canvas if on background
      if (e.button === 2) {
        if (this._placementType) {
          e.preventDefault();
          e.stopPropagation();
          this.cancelPlacementMode();
          return;
        }

        if (this._wireDraftStart) {
          e.preventDefault();
          this.cancelWireDraft();
          return;
        }

        if (isBackground) {
          e.preventDefault();
          this._isPanning = true;
          this._lastMouse = { x: e.clientX, y: e.clientY };
          this._svg.style.cursor = 'grabbing';
          return;
        }
      }

      // Hand / Pan Tool mode or middle-click: pan canvas immediately
      if (e.button === 1 || (this._currentTool === 'pan' && e.button === 0 && isBackground)) {
        this._isPanning = true;
        this._lastMouse = { x: e.clientX, y: e.clientY };
        this._svg.style.cursor = 'grabbing';
        return;
      }

      // Only handle left (0) or middle (1) click
      if (e.button !== 0 && e.button !== 1) return;

      // 0. Placement / Stamping Mode Left-Click
      if (this._placementType && e.button === 0) {
        e.preventDefault();
        e.stopPropagation();

        const isMulti = e.ctrlKey || e.metaKey;
        const worldPos = this.screenToWorld(e.clientX, e.clientY);
        const renderW = this._placementGhostRender?.width ?? 60;
        const renderH = this._placementGhostRender?.height ?? 40;
        const posX = worldPos.x - renderW / 2;
        const posY = worldPos.y - renderH / 2;

        if (this._placementFactory) {
          const newCircuit = this._placementFactory();
          if (newCircuit) {
            this.addComponent(newCircuit, posX, posY);
            if (this.onCircuitModified) {
              this.onCircuitModified(`Place ${this._placementType}`);
            }
          }
        }

        if (!isMulti) {
          this.cancelPlacementMode();
        } else {
          // Keep placement mode active for subsequent clicks
          if (this._placementFactory) {
            try {
              this._placementGhostCircuit = this._placementFactory();
              if (this._placementGhostCircuit) {
                this._placementGhostRender = SymbolRenderer.renderComponent(this._placementGhostCircuit, this._isAnsi);
                this._placementGhostGroup.innerHTML = this._placementGhostRender.svgContent;
              }
            } catch {}
          }
        }
        return;
      }

      const worldPos = this.screenToWorld(e.clientX, e.clientY);

      // 1. If currently in click-to-connect draft mode, click attempts to complete
      if (this._wireDraftStart) {
        let candidate = this._activeSnapCandidate;
        if (!candidate) {
          candidate = this.findNearestCompatibleJack(e.clientX, e.clientY, {
            isInput: this._wireDraftStart.isInput,
            circuitUid: this._wireDraftStart.circuit.uid,
            jackIndex: this._wireDraftStart.jackIndex
          }, 28);
        }

        if (candidate) {
          this.completeConnection(this._wireDraftStart, candidate);
        }
        this.cancelWireDraft();
        return;
      }

      // 2. Check if clicking waypoint handle
      if (target.classList.contains('waypoint-handle') || target.classList.contains('waypoint-hit-area')) {
        const pIdx = parseInt(target.dataset.pointIndex || '0', 10);
        if (this._selectedConnection) {
          this._draggingWaypoint = { conn: this._selectedConnection, pointIndex: pIdx };
          return;
        }
      }

      // 3. Check if clicking interactive controls (switch / button toggle)
      if (target.closest('.switch-component')) {
        const nodeElem = target.closest('.circuit-node') as SVGElement;
        if (nodeElem && nodeElem.dataset.uid) {
          const node = this._nodes.get(nodeElem.dataset.uid);
          if (node && node.circuit instanceof SwitchCircuit) {
            node.circuit.toggle();
            this._engine.propagateAll();
            this.updateDynamicVisuals();
            this.updateWireSignals();
            if (this.onCircuitModified) this.onCircuitModified(`Toggle Switch`);
            return;
          }
        }
      }

      if (target.closest('.pushbutton-component')) {
        const nodeElem = target.closest('.circuit-node') as SVGElement;
        if (nodeElem && nodeElem.dataset.uid) {
          const node = this._nodes.get(nodeElem.dataset.uid);
          if (node && node.circuit instanceof PushButtonCircuit) {
            node.circuit.press();
            this._engine.propagateAll();
            this.updateDynamicVisuals();
            this.updateWireSignals();
            const mouseUpHandler = () => {
              (node.circuit as PushButtonCircuit).release();
              this._engine.propagateAll();
              this.updateDynamicVisuals();
              this.updateWireSignals();
              window.removeEventListener('mouseup', mouseUpHandler);
            };
            window.addEventListener('mouseup', mouseUpHandler);
            return;
          }
        }
      }

      // 4. Check if clicking a Jack pin to start a wire
      // CRITICAL FIX: Only start a wire if the user EXPLICITLY clicked a jack element!
      const isJackClick = target.classList.contains('jack-hit-area') ||
                          target.classList.contains('jack-pin') ||
                          Boolean(target.closest('.jack-group'));

      if (isJackClick) {
        const hitArea = target.classList.contains('jack-hit-area')
          ? target
          : (target.closest('.jack-group')?.querySelector('.jack-hit-area') as SVGElement);

        if (hitArea && hitArea.dataset.circuitUid) {
          const isInput = hitArea.dataset.isInput === 'true';
          const jackIndex = parseInt(hitArea.dataset.jackIndex || '0', 10);
          const circuitUid = hitArea.dataset.circuitUid;
          const node = this._nodes.get(circuitUid);
          if (node) {
            const jack = node.renderResult.jacks.find((j) => j.isInput === isInput && j.index === jackIndex);
            if (jack) {
              this._wireDraftStart = {
                circuit: node.circuit,
                jackIndex,
                isInput,
                jackPos: this.getRotatedJackPosition(node, jack)
              };
              this._wireDraftMouseDownPos = { x: e.clientX, y: e.clientY };
              this._activeSnapCandidate = null;
              return;
            }
          }
        }
      }

      // 5. Check if clicking on a component node body (Select / Move)
      const nodeElem = target.closest('.circuit-node') as SVGElement;
      if (nodeElem && nodeElem.dataset.uid) {
        const uid = nodeElem.dataset.uid;
        const node = this._nodes.get(uid);
        if (node) {
          // Label double-click in-place canvas edit
          if (node.circuit instanceof LabelCircuit && e.detail === 2) {
            e.preventDefault();
            e.stopPropagation();
            this.startInPlaceLabelEditing(node);
            return;
          }

          // Multi-selection handling (Shift / Ctrl adds to selection)
          const isMultiKey = e.shiftKey || e.ctrlKey || e.metaKey;
          if (isMultiKey) {
            if (this.selectedUids.has(uid)) {
              this.selectedUids.delete(uid);
            } else {
              this.selectedUids.add(uid);
            }
          } else {
            // Normal click: if clicking a node NOT in selection, make it the sole selection
            // If already in selection, keep multi-selection intact for dragging!
            if (!this.selectedUids.has(uid)) {
              this.selectedUids.clear();
              this.selectedUids.add(uid);
            }
          }

          // Clear wire selection
          this._selectedConnection = null;
          this.updateSelectionVisuals();
          this.renderWaypoints();

          // Prepare smooth multi-drag
          this._isDraggingNodes = true;
          this._hasMovedDuringDrag = false;
          this._dragStartMouse = worldPos;
          this._nodeDragOrigins.clear();

          for (const selUid of this.selectedUids) {
            const selNode = this._nodes.get(selUid);
            if (selNode) {
              this._nodeDragOrigins.set(selUid, { x: selNode.x, y: selNode.y });
            }
          }

          if (this.onSelectionChange) {
            this.onSelectionChange(this.selectedCircuit, this.selectedCircuits);
          }
          if (this.onConnectionSelectionChange) {
            this.onConnectionSelectionChange(null);
          }
          return;
        }
      }

      // 6. Click on empty canvas background
      // Check middle-click or space+click for Pan
      if (e.button === 1 || this._isSpacePressed) {
        this._isPanning = true;
        this._lastMouse = { x: e.clientX, y: e.clientY };
        return;
      }

      // Left click on background: clear selection or start marquee
      if (!e.shiftKey && !e.ctrlKey) {
        this.selectedUids.clear();
        this._selectedConnection = null;
        this.updateSelectionVisuals();
        this.renderWaypoints();
        if (this.onSelectionChange) this.onSelectionChange(null, []);
        if (this.onConnectionSelectionChange) this.onConnectionSelectionChange(null);
      }

      // Start marquee selection box
      this._isBoxSelecting = true;
      this._boxSelectStart = worldPos;
      this._marqueeRect.setAttribute('x', worldPos.x.toString());
      this._marqueeRect.setAttribute('y', worldPos.y.toString());
      this._marqueeRect.setAttribute('width', '0');
      this._marqueeRect.setAttribute('height', '0');
      this._marqueeRect.style.display = 'block';
    });

    // Mousemove
    window.addEventListener('mousemove', (e: MouseEvent) => {
      const worldPos = this.screenToWorld(e.clientX, e.clientY);

      // Panning canvas
      if (this._isPanning) {
        const dx = e.clientX - this._lastMouse.x;
        const dy = e.clientY - this._lastMouse.y;
        this.panX += dx;
        this.panY += dy;
        this._lastMouse = { x: e.clientX, y: e.clientY };
        this.updateTransform();
        if (this.onViewChanged) this.onViewChanged();
        return;
      }

      // Placement / Stamping ghost preview tracking
      if (this._placementType && this._placementGhostRender) {
        const w = this._placementGhostRender.width;
        const h = this._placementGhostRender.height;
        const rawX = worldPos.x - w / 2;
        const rawY = worldPos.y - h / 2;
        const snap = this._gridSnap;
        const gx = snap ? Math.round(rawX / this._gridSize) * this._gridSize : rawX;
        const gy = snap ? Math.round(rawY / this._gridSize) * this._gridSize : rawY;
        this._placementGhostGroup.setAttribute('transform', `translate(${gx}, ${gy})`);
        this._placementGhostGroup.style.display = 'block';
      }

      // 1. Check wire drag candidate (pulling on a wire segment to bend/create a waypoint)
      if (this._wireDragCandidate) {
        const distMoved = Math.hypot(
          e.clientX - this._wireDragCandidate.clickClientPos.x,
          e.clientY - this._wireDragCandidate.clickClientPos.y
        );

        if (distMoved >= 3) {
          const conn = this._wireDragCandidate.conn;
          if (!conn.points) conn.points = [];

          let newX = worldPos.x;
          let newY = worldPos.y;
          if (this._gridSnap) {
            newX = Math.round(newX / this._gridSize) * this._gridSize;
            newY = Math.round(newY / this._gridSize) * this._gridSize;
          }

          const insertIdx = this._wireDragCandidate.insertIndex;

          if (this._snapOrthogonalWires) {
            const outNode = this._nodes.get(conn.outputCircuit.uid);
            const inNode = this._nodes.get(conn.inputCircuit.uid);
            const outJack = outNode?.renderResult.jacks.find((j) => !j.isInput && j.index === conn.outputIndex);
            const inJack = inNode?.renderResult.jacks.find((j) => j.isInput && j.index === conn.inputIndex);
            const startPt = outNode && outJack ? this.getRotatedJackPosition(outNode, outJack) : null;
            const endPt = inNode && inJack ? this.getRotatedJackPosition(inNode, inJack) : null;

            const prevPt = insertIdx > 0 ? conn.points[insertIdx - 1] : startPt;
            const nextPt = insertIdx < conn.points.length ? conn.points[insertIdx] : endPt;

            const SNAP_THRESHOLD = 14;
            const neighbors = [prevPt, nextPt].filter(Boolean) as Point[];
            let bestY = newY;
            let minDiffY = SNAP_THRESHOLD;
            let bestX = newX;
            let minDiffX = SNAP_THRESHOLD;

            for (const nb of neighbors) {
              const dy = Math.abs(newY - nb.y);
              if (dy < minDiffY) {
                minDiffY = dy;
                bestY = nb.y;
              }
              const dx = Math.abs(newX - nb.x);
              if (dx < minDiffX) {
                minDiffX = dx;
                bestX = nb.x;
              }
            }
            newY = bestY;
            newX = bestX;
          }

          conn.points.splice(insertIdx, 0, { x: newX, y: newY });
          this._draggingWaypoint = {
            conn,
            pointIndex: insertIdx
          };
          this._wireDragCandidate = null;

          this.updateWirePath(conn);
          this.renderWaypoints();
          if (this.onConnectionSelectionChange) this.onConnectionSelectionChange(conn);
          return;
        }
      }

      // 2. Dragging active waypoint
      if (this._draggingWaypoint) {
        let newX = worldPos.x;
        let newY = worldPos.y;
        if (this._gridSnap) {
          newX = Math.round(newX / this._gridSize) * this._gridSize;
          newY = Math.round(newY / this._gridSize) * this._gridSize;
        }

        const conn = this._draggingWaypoint.conn;
        const pIdx = this._draggingWaypoint.pointIndex;

        // Orthogonal 90° magnetic snapping (Logicly style)
        if (this._snapOrthogonalWires && conn.points) {
          const outNode = this._nodes.get(conn.outputCircuit.uid);
          const inNode = this._nodes.get(conn.inputCircuit.uid);
          const outJack = outNode?.renderResult.jacks.find((j) => !j.isInput && j.index === conn.outputIndex);
          const inJack = inNode?.renderResult.jacks.find((j) => j.isInput && j.index === conn.inputIndex);
          const startPt = outNode && outJack ? this.getRotatedJackPosition(outNode, outJack) : null;
          const endPt = inNode && inJack ? this.getRotatedJackPosition(inNode, inJack) : null;

          const prevPt = pIdx > 0 ? conn.points[pIdx - 1] : startPt;
          const nextPt = pIdx < conn.points.length - 1 ? conn.points[pIdx + 1] : endPt;

          const SNAP_THRESHOLD = 14;
          const neighbors = [prevPt, nextPt].filter(Boolean) as Point[];
          let bestY = newY;
          let minDiffY = SNAP_THRESHOLD;
          let bestX = newX;
          let minDiffX = SNAP_THRESHOLD;

          for (const nb of neighbors) {
            const dy = Math.abs(newY - nb.y);
            if (dy < minDiffY) {
              minDiffY = dy;
              bestY = nb.y;
            }
            const dx = Math.abs(newX - nb.x);
            if (dx < minDiffX) {
              minDiffX = dx;
              bestX = nb.x;
            }
          }
          newY = bestY;
          newX = bestX;
        }

        if (conn.points && conn.points[pIdx]) {
          conn.points[pIdx] = { x: newX, y: newY };
          this.updateWirePath(conn);
          const hGroup = this._waypointsGroup.querySelector(`.waypoint-group[data-point-index="${pIdx}"]`);
          if (hGroup) {
            hGroup.querySelectorAll('circle').forEach(c => {
              c.setAttribute('cx', newX.toString());
              c.setAttribute('cy', newY.toString());
            });
          }
        }
        return;
      }

      // Multi-node dragging (buttery smooth in-place transform updates)
      if (this._isDraggingNodes && this._nodeDragOrigins.size > 0) {
        const dx = worldPos.x - this._dragStartMouse.x;
        const dy = worldPos.y - this._dragStartMouse.y;

        let snapDx = dx;
        let snapDy = dy;
        if (this._gridSnap) {
          snapDx = Math.round(dx / this._gridSize) * this._gridSize;
          snapDy = Math.round(dy / this._gridSize) * this._gridSize;
        }

        if (Math.abs(snapDx) > 1 || Math.abs(snapDy) > 1) {
          this._hasMovedDuringDrag = true;
        }

        for (const [uid, origin] of this._nodeDragOrigins) {
          const node = this._nodes.get(uid);
          if (node) {
            node.x = origin.x + snapDx;
            node.y = origin.y + snapDy;

            const g = this._nodesGroup.querySelector(`[data-uid="${uid}"]`) as SVGGElement;
            if (g) {
              if (node.rotation !== 0) {
                const cx = node.renderResult.width / 2;
                const cy = node.renderResult.height / 2;
                g.setAttribute('transform', `translate(${node.x}, ${node.y}) rotate(${node.rotation}, ${cx}, ${cy})`);
              } else {
                g.setAttribute('transform', `translate(${node.x}, ${node.y})`);
              }
            }
          }
        }

        // Fast wire bezier updates for moving nodes
        this.updateWiresForNodes(this.selectedUids);
        return;
      }

      // Marquee box selecting
      if (this._isBoxSelecting) {
        const minX = Math.min(this._boxSelectStart.x, worldPos.x);
        const maxX = Math.max(this._boxSelectStart.x, worldPos.x);
        const minY = Math.min(this._boxSelectStart.y, worldPos.y);
        const maxY = Math.max(this._boxSelectStart.y, worldPos.y);

        this._marqueeRect.setAttribute('x', minX.toString());
        this._marqueeRect.setAttribute('y', minY.toString());
        this._marqueeRect.setAttribute('width', (maxX - minX).toString());
        this._marqueeRect.setAttribute('height', (maxY - minY).toString());

        // Test overlap with component bounds
        for (const [uid, node] of this._nodes) {
          const nodeW = node.renderResult.width;
          const nodeH = node.renderResult.height;
          const overlap = node.x < maxX && node.x + nodeW > minX &&
                          node.y < maxY && node.y + nodeH > minY;

          if (overlap) {
            this.selectedUids.add(uid);
          } else if (!e.shiftKey && !e.ctrlKey) {
            this.selectedUids.delete(uid);
          }
        }
        this.updateSelectionVisuals();
        return;
      }

      // Wire draft with magnetic proximity snapping
      if (this._wireDraftStart) {
        const nearest = this.findNearestCompatibleJack(
          e.clientX,
          e.clientY,
          {
            isInput: this._wireDraftStart.isInput,
            circuitUid: this._wireDraftStart.circuit.uid,
            jackIndex: this._wireDraftStart.jackIndex
          },
          28
        );
        this._activeSnapCandidate = nearest;

        const startPos = this._wireDraftStart.jackPos;
        const endPos = nearest ? nearest.worldPos : worldPos;

        const outPos = this._wireDraftStart.isInput ? endPos : startPos;
        const inPos = this._wireDraftStart.isInput ? startPos : endPos;
        const pathD = WireRenderer.generateBezierPath(outPos, inPos);

        this._dragWireGroup.innerHTML = `
          <path d="${pathD}" class="wire-path wire-high wire-draft" style="stroke-dasharray: 4, 3; opacity: 0.85; pointer-events: none;" />
          <circle cx="${startPos.x}" cy="${startPos.y}" r="7" class="jack-draft-origin" />
          ${nearest ? `
            <circle cx="${nearest.worldPos.x}" cy="${nearest.worldPos.y}" r="11" class="jack-snap-target" />
            <circle cx="${nearest.worldPos.x}" cy="${nearest.worldPos.y}" r="4.5" class="jack-snap-inner" />
          ` : ''}
        `;
      }
    });

    // Mouseup
    window.addEventListener('mouseup', (e: MouseEvent) => {
      if (this._isPanning) {
        this._isPanning = false;
        this._svg.style.cursor = (this._isSpacePressed || this._currentTool === 'pan') ? 'grab' : '';
      }

      if (this._draggingWaypoint) {
        this._draggingWaypoint = null;
        this.renderWires();
        this.renderWaypoints();
        if (this.onCircuitModified) this.onCircuitModified(`Adjust Wire Shape`);
      }

      if (this._wireDragCandidate) {
        this._wireDragCandidate = null;
      }

      if (this._isDraggingNodes) {
        this._isDraggingNodes = false;
        if (this._hasMovedDuringDrag) {
          this._hasMovedDuringDrag = false;
          this.renderWires(); // Re-render with clean listeners
          this.renderWaypoints();
          if (this.onCircuitModified) this.onCircuitModified(`Move Component(s)`);
        }
      }

      if (this._isBoxSelecting) {
        this._isBoxSelecting = false;
        this._marqueeRect.style.display = 'none';
        if (this.onSelectionChange) {
          this.onSelectionChange(this.selectedCircuit, this.selectedCircuits);
        }
      }

      if (this._wireDraftStart) {
        const distMoved = Math.hypot(
          e.clientX - this._wireDraftMouseDownPos.x,
          e.clientY - this._wireDraftMouseDownPos.y
        );

        let candidate = this._activeSnapCandidate;
        if (!candidate) {
          candidate = this.findNearestCompatibleJack(
            e.clientX,
            e.clientY,
            {
              isInput: this._wireDraftStart.isInput,
              circuitUid: this._wireDraftStart.circuit.uid,
              jackIndex: this._wireDraftStart.jackIndex
            },
            28
          );
        }

        if (candidate) {
          this.completeConnection(this._wireDraftStart, candidate);
          this.cancelWireDraft();
        } else if (distMoved < 6) {
          // Clicked on jack without dragging: stay in draft mode for click-to-connect!
        } else {
          this.cancelWireDraft();
        }
      }
    });

    // Double-click on canvas node
    this._svg.addEventListener('dblclick', (e: MouseEvent) => {
      const target = e.target as SVGElement;
      const nodeElem = target.closest('.circuit-node') as SVGElement;
      if (nodeElem && nodeElem.dataset.uid) {
        const uid = nodeElem.dataset.uid;
        const node = this._nodes.get(uid);
        if (node) {
          if (node.circuit instanceof LabelCircuit) {
            e.stopPropagation();
            e.preventDefault();
            this.startInPlaceLabelEditing(node);
          } else {
            e.stopPropagation();
            e.preventDefault();
            this.selectedCircuit = node.circuit;
            if (this.onComponentDoubleClick) {
              this.onComponentDoubleClick(node.circuit);
            }
          }
        }
      }
    });

    // Zoom on wheel & Pinch-to-Zoom Normalization
    this._svg.addEventListener('wheel', (e: WheelEvent) => {
      this.commitActiveLabelEdit();
      e.preventDefault();

      let zoomFactor: number;
      if (e.ctrlKey) {
        // Trackpad pinch-to-zoom or Ctrl+Wheel: gentle, continuous scaling
        const factor = Math.exp(-e.deltaY * 0.003);
        zoomFactor = Math.min(1.04, Math.max(0.96, factor));
      } else {
        // Standard mouse wheel
        const factor = Math.exp(-e.deltaY * 0.0015);
        zoomFactor = Math.min(1.15, Math.max(0.85, factor));
      }

      const newZoom = Math.min(3.0, Math.max(0.3, this.zoom * zoomFactor));
      if (Math.abs(newZoom - this.zoom) < 1e-6) return;

      const rect = this._svg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      this.panX = mouseX - (mouseX - this.panX) * (newZoom / this.zoom);
      this.panY = mouseY - (mouseY - this.panY) * (newZoom / this.zoom);
      this.zoom = newZoom;

      this.updateTransform();
      if (this.onViewChanged) this.onViewChanged();
    }, { passive: false });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable) {
        return;
      }

      if (e.code === 'Space') {
        this._isSpacePressed = true;
        this._svg.style.cursor = 'grab';
      }
      if (e.key === 'v' || e.key === 'V') {
        this.setTool('select');
      }
      if (e.key === 'h' || e.key === 'H') {
        this.setTool('pan');
      }
      if (e.key === 'r' || e.key === 'R') {
        this.rotateSelected();
      }
      if (e.key === 'Escape') {
        if (this._placementType) {
          e.preventDefault();
          e.stopPropagation();
          this.cancelPlacementMode();
          return;
        }
        this.deselectAll();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        this.deleteSelected();
      }
      if ((e.shiftKey && (e.key === 'F' || e.key === 'f')) || ((e.ctrlKey || e.metaKey) && e.key === '9')) {
        e.preventDefault();
        this.zoomToFit();
      }
    });

    window.addEventListener('keyup', (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        this._isSpacePressed = false;
        this._svg.style.cursor = this._currentTool === 'pan' ? 'grab' : (this._placementType ? 'crosshair' : '');
      }
    });
  }

  public clear(): void {
    this.cancelPlacementMode();
    for (const [, node] of this._nodes) {
      this._engine.unregisterCircuit(node.circuit);
    }
    this._nodes.clear();
    this.selectedUids.clear();
    this._selectedConnection = null;
    this.cancelWireDraft();
    this.render();
    if (this.onSelectionChange) this.onSelectionChange(null, []);
    if (this.onConnectionSelectionChange) this.onConnectionSelectionChange(null);
    if (this.onCircuitModified) this.onCircuitModified(`Clear Canvas`);
  }

  public loadDocument(doc: ParsedCircuitDocument, restoreSelection?: string[]): void {
    this.cancelPlacementMode();
    // 1. Wipe existing canvas nodes
    for (const [, node] of this._nodes) {
      this._engine.unregisterCircuit(node.circuit);
    }
    this._nodes.clear();
    this.selectedUids.clear();
    this._selectedConnection = null;
    this.cancelWireDraft();

    // 2. Load all circuits with locations
    for (const [uid, circuit] of doc.circuits) {
      const meta = doc.metadata.get(uid) || { x: 50, y: 50, rotation: 0 };
      const renderResult = SymbolRenderer.renderComponent(circuit, this._isAnsi);
      const node: ComponentNode = {
        circuit,
        x: meta.x,
        y: meta.y,
        rotation: meta.rotation,
        renderResult
      };
      this._nodes.set(uid, node);
      this._engine.registerCircuit(circuit);
    }

    // 3. Reconstitute connections
    for (const conn of doc.engine.connections) {
      this._engine.connect(
        conn.outputCircuit,
        conn.outputIndex,
        conn.inputCircuit,
        conn.inputIndex,
        conn.points ? [...conn.points] : []
      );
    }

    // 4. Restore selection if specified
    if (restoreSelection && restoreSelection.length > 0) {
      for (const uid of restoreSelection) {
        if (this._nodes.has(uid)) {
          this.selectedUids.add(uid);
        }
      }
    }

    // 5. Settle engine to pristine quiescent reset point and render
    this._engine.reset();
    this.render();
    this.updateDynamicVisuals();

    if (this.onSelectionChange) {
      this.onSelectionChange(this.selectedCircuit, this.selectedCircuits);
    }
    if (this.onConnectionSelectionChange) {
      this.onConnectionSelectionChange(null);
    }
  }
}
