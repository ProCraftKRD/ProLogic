/**
 * ProLogic - Professional SVG Schematic Exporter
 * 
 * Generates faithful, standalone, presentation-ready SVG vector schematics
 * with embedded CSS styles, resolved signal colors, exact Bezier wire splines,
 * and tight bounding boxes without transient canvas or interaction artifacts.
 */

import { SimulationEngine } from '../../simulation/engine';
import { ICircuit, LogicConnection } from '../../simulation/types';
import { LabelCircuit } from '../../simulation/circuits/annotation';
import { ComponentNode } from '../canvas/interactionManager';
import { Point, WireRenderer } from '../canvas/wireRenderer';
import { SymbolRenderer, JackPosition } from '../canvas/symbolRenderer';

export interface SvgExportOptions {
  /** Color theme for schematic export: 'dark' (default) or 'light' */
  theme?: 'dark' | 'light';
  /** Margin/padding in pixels around bounding box (default: 40px) */
  padding?: number;
  /** Whether to include a background rectangle (default: true) */
  includeBackground?: boolean;
  /** Custom background fill color (defaults to '#0f172a' for dark, '#ffffff' for light) */
  backgroundColor?: string;
  /** High signal level wire/glow color (defaults to '#00f5d4' for dark, '#0067c0' for light) */
  highSignalColor?: string;
  /** Low signal level wire color (defaults to '#475569' for dark, '#64748b' for light) */
  lowSignalColor?: string;
  /** Optional schematic title */
  title?: string;
  /** Whether to snap edited wires with waypoints to 90° orthogonal angles (Logicly style) */
  snapOrthogonalWires?: boolean;
}

export interface SvgExportResult {
  canceled: boolean;
  filePath?: string;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export class SvgExporter {
  /**
   * Computes the world position of a component jack considering component rotation
   */
  public static getRotatedJackPosition(node: ComponentNode, jack: JackPosition): Point {
    if (!node.rotation || node.rotation === 0) {
      return { x: node.x + jack.x, y: node.y + jack.y };
    }

    const cx = (node.renderResult?.width ?? 60) / 2;
    const cy = (node.renderResult?.height ?? 40) / 2;
    const rad = (node.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const relX = jack.x - cx;
    const relY = jack.y - cy;

    const rotX = relX * cos - relY * sin + cx;
    const rotY = relX * sin + relY * cos + cy;

    return { x: node.x + rotX, y: node.y + rotY };
  }

  /**
   * Cleans raw SVG content for export:
   * - Strips interactive artifacts (selection outlines, hit areas, grab cursors)
   * - Ensures active dynamic classes match the current simulation state
   * - Adapts inline presentation colors if light theme is active
   */
  public static cleanSvgContent(
    node: ComponentNode,
    theme: 'dark' | 'light',
    highSignalColor: string
  ): string {
    let content = '';

    // If circuit instance is present, generate pristine SVG symbol reflecting current simulation state
    if (node.circuit) {
      try {
        content = SymbolRenderer.renderComponent(node.circuit).svgContent;
      } catch {
        content = node.renderResult?.svgContent || '';
      }
    } else {
      content = node.renderResult?.svgContent || '';
    }

    // 1. Remove selection outline rectangles
    content = content.replace(/<rect[^>]*class="[^"]*selection-outline[^"]*"[^>]*\/?>/gi, '');
    content = content.replace(/<rect[^>]*class='[^']*selection-outline[^']*'[^>]*\/?>/gi, '');

    // 2. Remove interactive hit-areas and grab handles
    content = content.replace(/<circle[^>]*class="[^"]*jack-hit-area[^"]*"[^>]*\/?>/gi, '');
    content = content.replace(/<circle[^>]*class='[^']*jack-hit-area[^']*'[^>]*\/?>/gi, '');
    content = content.replace(/<path[^>]*class="[^"]*wire-hit-area[^"]*"[^>]*\/?>/gi, '');
    content = content.replace(/<path[^>]*class='[^']*wire-hit-area[^']*'[^>]*\/?>/gi, '');
    content = content.replace(/<circle[^>]*class="[^"]*waypoint-hit-area[^"]*"[^>]*\/?>/gi, '');
    content = content.replace(/<circle[^>]*class='[^']*waypoint-hit-area[^']*'[^>]*\/?>/gi, '');
    content = content.replace(/<circle[^>]*class="[^"]*waypoint-handle[^"]*"[^>]*\/?>/gi, '');
    content = content.replace(/<circle[^>]*class='[^']*waypoint-handle[^']*'[^>]*\/?>/gi, '');

    // 3. Remove inline cursor styles
    content = content.replace(/\s*style="[^"]*cursor:\s*[^;"]+;?[^"]*"/gi, '');
    content = content.replace(/\s*style='[^']*cursor:\s*[^;']+;?[^']*'/gi, '');

    // 4. Adapt light theme colors in inline attributes if needed
    if (theme === 'light') {
      content = content.replace(/fill="#182234"/gi, 'fill="#ffffff"');
      content = content.replace(/fill="#0b0f19"/gi, 'fill="#f8fafc"');
      content = content.replace(/stroke="#64748b"/gi, 'stroke="#334155"');
      content = content.replace(/stroke="#374b6b"/gi, 'stroke="#94a3b8"');
      if (!(node.circuit instanceof LabelCircuit && (node.circuit as LabelCircuit).color)) {
        content = content.replace(/fill="#00f5d4"/gi, `fill="${highSignalColor}"`);
      }
    }

    if (node.circuit instanceof LabelCircuit) {
      const lc = node.circuit as LabelCircuit;
      if (!lc.color) {
        const defaultFill = theme === 'dark' ? '#e2e8f0' : '#0f172a';
        content = content.replace(/fill="currentColor"/g, `fill="${defaultFill}"`);
      }
    }

    return content.trim();
  }

  /**
   * Generates a complete, self-contained SVG string of the circuit schematic
   */
  public static generateSvg(
    engine: SimulationEngine,
    nodes: Map<string, ComponentNode>,
    options?: SvgExportOptions
  ): string {
    // Determine effective theme
    let defaultTheme: 'dark' | 'light' = 'dark';
    if (typeof document !== 'undefined' && document.documentElement) {
      const current = document.documentElement.getAttribute('data-theme');
      if (current === 'light') {
        defaultTheme = 'light';
      }
    }
    const theme = options?.theme || defaultTheme;

    const pad = options?.padding !== undefined ? Math.max(0, options.padding) : 40;
    const includeBackground = options?.includeBackground !== undefined ? options.includeBackground : true;

    const backgroundColor = options?.backgroundColor || (theme === 'dark' ? '#0f172a' : '#ffffff');
    const highSignalColor = options?.highSignalColor || (theme === 'dark' ? '#00f5d4' : '#0067c0');
    const lowSignalColor = options?.lowSignalColor || (theme === 'dark' ? '#475569' : '#64748b');
    const hizSignalColor = '#f59e0b';
    const contentionSignalColor = '#ef4444';

    // Bounding Box Calculation
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    if (nodes.size === 0 && engine.connections.length === 0) {
      minX = 0;
      minY = 0;
      maxX = 400;
      maxY = 300;
    } else {
      for (const [, node] of nodes) {
        const w = node.renderResult?.width ?? 60;
        const h = node.renderResult?.height ?? 40;

        if (node.rotation && node.rotation !== 0) {
          const cx = node.x + w / 2;
          const cy = node.y + h / 2;
          const rad = (node.rotation * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const corners = [
            { x: -w / 2, y: -h / 2 },
            { x: w / 2, y: -h / 2 },
            { x: w / 2, y: h / 2 },
            { x: -w / 2, y: h / 2 }
          ];
          for (const c of corners) {
            const rx = cx + c.x * cos - c.y * sin;
            const ry = cy + c.x * sin + c.y * cos;
            minX = Math.min(minX, rx);
            minY = Math.min(minY, ry);
            maxX = Math.max(maxX, rx);
            maxY = Math.max(maxY, ry);
          }
        } else {
          minX = Math.min(minX, node.x);
          minY = Math.min(minY, node.y);
          maxX = Math.max(maxX, node.x + w);
          maxY = Math.max(maxY, node.y + h);
        }

        // Include jack pins in bounds
        if (node.renderResult?.jacks) {
          for (const jack of node.renderResult.jacks) {
            const p = SvgExporter.getRotatedJackPosition(node, jack);
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
          }
        }
      }

      // Include wire waypoints in bounds
      for (const conn of engine.connections) {
        if (conn.points) {
          for (const pt of conn.points) {
            minX = Math.min(minX, pt.x);
            minY = Math.min(minY, pt.y);
            maxX = Math.max(maxX, pt.x);
            maxY = Math.max(maxY, pt.y);
          }
        }
      }

      if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
        minX = 0;
        minY = 0;
        maxX = 400;
        maxY = 300;
      }
    }

    const boxWidth = maxX - minX;
    const boxHeight = maxY - minY;
    const totalWidth = Math.max(1, Math.round(boxWidth + pad * 2));
    const totalHeight = Math.max(1, Math.round(boxHeight + pad * 2));
    const viewBoxX = Math.round(minX - pad);
    const viewBoxY = Math.round(minY - pad);

    // Build Embedded Stylesheet
    const styleBlock = `
    /* ProLogic Vector Schematic Styles (${theme} theme) */
    .prologic-circuit {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    }
    
    /* Wires */
    .wire-path {
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .wire-high {
      stroke: ${highSignalColor};
      stroke-width: 3px;
    }
    .wire-low {
      stroke: ${lowSignalColor};
      stroke-width: 3px;
    }
    .wire-hiz {
      stroke: ${hizSignalColor};
      stroke-width: 3px;
      stroke-dasharray: 5 4;
    }
    .wire-contention {
      stroke: ${contentionSignalColor};
      stroke-width: 3px;
    }

    /* Logic Gate Symbols */
    .gate-symbol path,
    .gate-symbol polygon,
    .gate-symbol circle,
    .gate-body,
    .symbol-path {
      fill: ${theme === 'dark' ? '#182234' : '#ffffff'};
      stroke: ${theme === 'dark' ? '#64748b' : '#334155'};
      stroke-width: 2px;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .gate-symbol line {
      stroke: ${theme === 'dark' ? '#64748b' : '#334155'};
      stroke-width: 2px;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .gate-symbol text {
      fill: ${theme === 'dark' ? '#9ca3af' : '#1e293b'};
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      font-weight: bold;
    }

    /* Component Jack Pins */
    .gate-pin,
    .jack-pin {
      stroke-width: 1.5px;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .pin-input {
      fill: ${theme === 'dark' ? '#111827' : '#ffffff'};
      stroke: #64748b;
    }
    .pin-output {
      fill: ${theme === 'dark' ? '#111827' : '#ffffff'};
      stroke: ${theme === 'dark' ? '#00b4d8' : '#0067c0'};
    }

    /* Component Leads */
    .switch-lead,
    .bulb-lead,
    .button-lead,
    .clock-lead,
    .constant-lead,
    .digit-lead {
      stroke: #64748b;
      stroke-width: 2px;
      stroke-linecap: round;
    }

    /* Toggle Switch */
    .switch-track {
      fill: ${theme === 'dark' ? '#111827' : '#f1f5f9'};
      stroke: ${theme === 'dark' ? '#374b6b' : '#94a3b8'};
      stroke-width: 2px;
    }
    .switch-knob {
      fill: ${theme === 'dark' ? '#374151' : '#64748b'};
    }
    .switch-on .switch-track {
      fill: ${theme === 'dark' ? '#0c2b33' : '#0067c0'};
      stroke: ${theme === 'dark' ? highSignalColor : '#005a9e'};
    }
    .switch-on .switch-knob {
      fill: ${theme === 'dark' ? highSignalColor : '#ffffff'};
    }
    .switch-off .switch-track {
      fill: ${theme === 'dark' ? '#111827' : '#f1f5f9'};
      stroke: ${theme === 'dark' ? '#374b6b' : '#94a3b8'};
    }
    .switch-off .switch-knob {
      fill: ${theme === 'dark' ? '#374151' : '#64748b'};
    }

    /* Light Bulb */
    .bulb-circle {
      fill: ${theme === 'dark' ? '#182234' : '#f1f5f9'};
      stroke: ${theme === 'dark' ? '#374b6b' : '#94a3b8'};
      stroke-width: 2px;
    }
    .bulb-filament {
      stroke: ${theme === 'dark' ? '#4b5563' : '#cbd5e1'};
      stroke-width: 1.5px;
    }
    .bulb-on .bulb-circle {
      fill: ${theme === 'dark' ? highSignalColor : '#0078d4'};
      stroke: ${theme === 'dark' ? highSignalColor : '#005a9e'};
    }
    .bulb-on .bulb-filament {
      stroke: #ffffff;
    }
    .bulb-off .bulb-circle {
      fill: ${theme === 'dark' ? '#182234' : '#f1f5f9'};
      stroke: ${theme === 'dark' ? '#374b6b' : '#94a3b8'};
    }
    .bulb-off .bulb-filament {
      stroke: ${theme === 'dark' ? '#4b5563' : '#cbd5e1'};
    }

    /* Push Button */
    .button-box {
      fill: ${theme === 'dark' ? '#182234' : '#ffffff'};
      stroke: ${theme === 'dark' ? '#374b6b' : '#94a3b8'};
      stroke-width: 2px;
    }
    .btn-released .button-knob {
      fill: ${theme === 'dark' ? '#ef4444' : '#e11d48'};
    }
    .btn-pressed .button-box {
      stroke: ${theme === 'dark' ? highSignalColor : '#0067c0'};
    }
    .btn-pressed .button-knob {
      fill: ${theme === 'dark' ? highSignalColor : '#0067c0'};
    }

    /* Clock */
    .clock-box {
      fill: ${theme === 'dark' ? '#182234' : '#ffffff'};
      stroke: ${theme === 'dark' ? '#374b6b' : '#94a3b8'};
      stroke-width: 2px;
    }
    .clock-pulse {
      stroke: #9ca3af;
      stroke-width: 2px;
    }
    .clock-high .clock-box {
      stroke: ${highSignalColor};
    }
    .clock-high .clock-pulse {
      stroke: ${highSignalColor};
    }
    .clock-low .clock-box {
      stroke: ${theme === 'dark' ? '#374b6b' : '#94a3b8'};
    }
    .clock-low .clock-pulse {
      stroke: #9ca3af;
    }

    /* 4-Bit Hex Display */
    .digit-box {
      fill: ${theme === 'dark' ? '#0b0f19' : '#f8fafc'};
      stroke: ${theme === 'dark' ? '#374b6b' : '#94a3b8'};
      stroke-width: 2px;
    }
    .digit-char {
      fill: ${theme === 'dark' ? highSignalColor : '#0067c0'};
      font-family: 'Courier New', monospace;
      font-size: 34px;
      font-weight: 900;
    }

    /* Constants */
    .constant-box {
      fill: ${theme === 'dark' ? '#182234' : '#ffffff'};
      stroke-width: 1.5px;
    }
    .constant-vcc .constant-box,
    .constant-vcc .constant-text {
      stroke: ${highSignalColor};
      fill: ${highSignalColor};
    }
    .constant-gnd .constant-box {
      stroke: #9ca3af;
    }
    .constant-gnd .constant-text {
      fill: #9ca3af;
    }

    /* Integrated Circuits and Bus */
    .complex-ic rect,
    .bus-symbol rect,
    .ic-body {
      fill: ${theme === 'dark' ? '#182234' : '#ffffff'};
      stroke: ${theme === 'dark' ? '#374b6b' : '#94a3b8'};
      stroke-width: 2px;
    }
    .complex-ic text,
    .bus-symbol text,
    .ic-label {
      fill: ${theme === 'dark' ? highSignalColor : '#0067c0'};
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      font-weight: bold;
    }
    .complex-ic text[fill="#94a3b8"] {
      fill: ${theme === 'dark' ? '#94a3b8' : '#64748b'};
    }

    /* Labels and Annotations */
    .canvas-label-text,
    .label-component text {
      fill: ${theme === 'dark' ? '#e2e8f0' : '#0f172a'};
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    }
  `;

    // Render Wires
    let wiresSvg = '  <g class="wires-layer">\n';
    for (const conn of engine.connections) {
      const outNode = nodes.get(conn.outputCircuit?.uid);
      const inNode = nodes.get(conn.inputCircuit?.uid);
      if (!outNode || !inNode) continue;

      const outJack = outNode.renderResult?.jacks?.find((j) => !j.isInput && j.index === conn.outputIndex);
      const inJack = inNode.renderResult?.jacks?.find((j) => j.isInput && j.index === conn.inputIndex);
      if (!outJack || !inJack) continue;

      const start = SvgExporter.getRotatedJackPosition(outNode, outJack);
      const end = SvgExporter.getRotatedJackPosition(inNode, inJack);
      const snapOrthogonal = options?.snapOrthogonalWires === true;
      const pathD = WireRenderer.generateBezierPath(start, end, conn.points || [], snapOrthogonal);

      const val = conn.outputCircuit.getOutputAt(conn.outputIndex);
      let signalClass = 'wire-low';
      let strokeColor = lowSignalColor;

      if (val === true) {
        signalClass = 'wire-high';
        strokeColor = highSignalColor;
      } else if (val === false) {
        signalClass = 'wire-low';
        strokeColor = lowSignalColor;
      } else {
        signalClass = 'wire-hiz';
        strokeColor = hizSignalColor;
      }

      const dashAttr = signalClass === 'wire-hiz' ? ' stroke-dasharray="5 4"' : '';
      wiresSvg += `    <path class="wire-path ${signalClass}" d="${pathD}" stroke="${strokeColor}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"${dashAttr} />\n`;
    }
    wiresSvg += '  </g>\n';

    // Render Components
    let nodesSvg = '  <g class="components-layer">\n';
    for (const [uid, node] of nodes) {
      const w = node.renderResult?.width ?? 60;
      const h = node.renderResult?.height ?? 40;
      const cx = w / 2;
      const cy = h / 2;

      const transform = node.rotation && node.rotation !== 0
        ? `transform="translate(${node.x}, ${node.y}) rotate(${node.rotation}, ${cx}, ${cy})"`
        : `transform="translate(${node.x}, ${node.y})"`;

      // Clean SVG symbol content
      const innerSvg = SvgExporter.cleanSvgContent(node, theme, highSignalColor);

      // Render clean pin circles (NO interactive hit areas)
      let pinsSvg = '';
      if (node.renderResult?.jacks) {
        for (const jack of node.renderResult.jacks) {
          const pinClass = jack.isInput ? 'gate-pin pin-input jack-pin' : 'gate-pin pin-output jack-pin';
          const pinFill = theme === 'dark' ? '#111827' : '#ffffff';
          const pinStroke = jack.isInput ? '#64748b' : (theme === 'dark' ? '#00b4d8' : '#0067c0');
          pinsSvg += `      <circle class="${pinClass}" cx="${jack.x}" cy="${jack.y}" r="3.5" fill="${pinFill}" stroke="${pinStroke}" stroke-width="1.5" />\n`;
        }
      }

      nodesSvg += `    <g class="circuit-node" data-uid="${uid}" ${transform}>\n`;
      nodesSvg += `      ${innerSvg}\n`;
      if (pinsSvg) {
        nodesSvg += `      <g class="node-pins">\n${pinsSvg}      </g>\n`;
      }
      nodesSvg += `    </g>\n`;
    }
    nodesSvg += '  </g>\n';

    // Assemble Full Document
    const bgRect = includeBackground
      ? `  <rect class="schematic-background" x="${viewBoxX}" y="${viewBoxY}" width="${totalWidth}" height="${totalHeight}" fill="${backgroundColor}" />\n`
      : '';

    const titleText = options?.title ? escapeXml(options.title) : 'ProLogic Circuit Schematic';

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="${viewBoxX} ${viewBoxY} ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}" class="prologic-circuit">
  <title>${titleText}</title>
  <desc>Exported with ProLogic Digital Logic Simulator</desc>
  <defs>
    <style type="text/css"><![CDATA[${styleBlock}    ]]></style>
  </defs>
${bgRect}${wiresSvg}${nodesSvg}</svg>
`;
  }

  /**
   * Exports the circuit schematic to an SVG file.
   * Uses native Electron save dialog when running inside Electron,
   * or triggers browser Blob download when running in a web browser.
   */
  public static async exportToFile(
    engine: SimulationEngine,
    nodes: Map<string, ComponentNode>,
    defaultFileName: string = 'circuit.svg',
    options?: SvgExportOptions
  ): Promise<{ canceled: boolean; filePath?: string }> {
    const svg = this.generateSvg(engine, nodes, options);
    const fileName = defaultFileName.toLowerCase().endsWith('.svg')
      ? defaultFileName
      : `${defaultFileName}.svg`;

    // 1. Electron environment (via native dialog)
    if (typeof window !== 'undefined' && window.api && typeof window.api.saveFileDialog === 'function') {
      try {
        const res = await window.api.saveFileDialog(fileName, svg, false);
        return res;
      } catch (err) {
        console.error('Electron save dialog failed, falling back to browser download:', err);
      }
    }

    // 2. Browser DOM environment (via Blob URL download)
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      try {
        const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return { canceled: false, filePath: fileName };
      } catch (err) {
        console.error('Browser Blob download failed:', err);
        return { canceled: true };
      }
    }

    // 3. Node.js headless environment (unit tests or CLI)
    return { canceled: false, filePath: fileName };
  }

  /**
   * Convenience alias matching SvgExporter.exportCircuit API
   */
  public static async exportCircuit(
    engine: SimulationEngine,
    nodes: Map<string, ComponentNode>,
    defaultFileName: string = 'circuit.svg',
    options?: SvgExportOptions
  ): Promise<{ canceled: boolean; filePath?: string }> {
    return this.exportToFile(engine, nodes, defaultFileName, options);
  }
}
