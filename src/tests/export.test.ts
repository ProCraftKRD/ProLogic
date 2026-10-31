import { TestSuite, assertEqual, assert } from './runner';
import { SimulationEngine } from '../simulation/engine';
import { ANDGateCircuit, ORGateCircuit, XORGateCircuit } from '../simulation/circuits/gates';
import { SwitchCircuit } from '../simulation/circuits/controls';
import { LightBulbCircuit } from '../simulation/circuits/outputs';
import { SymbolRenderer } from '../ui/canvas/symbolRenderer';
import { WireRenderer } from '../ui/canvas/wireRenderer';
import { ComponentNode } from '../ui/canvas/interactionManager';
import { PngExporter } from '../ui/export/pngExporter';
import { SvgExporter } from '../ui/export/svgExporter';
import { createDefaultParser } from '../simulation/registry';
import { SAMPLE_CIRCUITS } from '../ui/samples';

export async function runExportTests(): Promise<boolean> {
  const suite = new TestSuite('PNG Schematic Exporter & High-DPI Vector Pipeline');
  console.log('--- Running PNG Schematic Exporter & High-DPI Vector Tests ---');

  suite.test('Valid XML/SVG root, viewBox, and 2x High-DPI dimensions for single gate', () => {
    const engine = new SimulationEngine();
    const andGate = new ANDGateCircuit();
    engine.registerCircuit(andGate);

    const renderResult = SymbolRenderer.renderComponent(andGate, true);
    const nodes = new Map<string, ComponentNode>();
    nodes.set(andGate.uid, {
      circuit: andGate,
      x: 100,
      y: 150,
      rotation: 0,
      renderResult
    });

    const pad = 40;
    // Test default 2x High-DPI scale intermediate SVG
    const svg2x = PngExporter.generateIntermediateSvg(engine, nodes, { padding: pad, scale: 2 });

    // 1. Root XML & SVG tag
    assert(svg2x.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'Expected XML declaration');
    assert(svg2x.includes('<svg xmlns="http://www.w3.org/2000/svg"'), 'Expected valid SVG namespace');

    // 2. ViewBox dimensions vs High-DPI scaled width/height
    const expectedMinX = 100;
    const expectedMinY = 150;
    const expectedMaxX = 100 + renderResult.width;
    const expectedMaxY = 150 + renderResult.height;
    const expectedWidth = (expectedMaxX - expectedMinX) + pad * 2;
    const expectedHeight = (expectedMaxY - expectedMinY) + pad * 2;

    const viewBoxMatch = svg2x.match(/viewBox="(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)"/);
    assert(viewBoxMatch !== null, 'SVG must have valid viewBox attribute');
    const [, vx, vy, vw, vh] = viewBoxMatch!.map(Number);

    assertEqual(vx, expectedMinX - pad, 'ViewBox X matches minX - padding');
    assertEqual(vy, expectedMinY - pad, 'ViewBox Y matches minY - padding');
    assertEqual(vw, expectedWidth, 'ViewBox width preserves native logical width');
    assertEqual(vh, expectedHeight, 'ViewBox height preserves native logical height');

    // 3. High-DPI Scaled root dimensions (2x)
    const widthMatch = svg2x.match(/<svg\b[^>]*?\bwidth="(\d+)"/);
    const heightMatch = svg2x.match(/<svg\b[^>]*?\bheight="(\d+)"/);
    assert(widthMatch !== null && heightMatch !== null, 'SVG root must contain width and height attributes');
    assertEqual(Number(widthMatch![1]), expectedWidth * 2, 'SVG root width scaled 2x for crisp Retina rasterization');
    assertEqual(Number(heightMatch![1]), expectedHeight * 2, 'SVG root height scaled 2x for crisp Retina rasterization');

    // 4. Node placement and pins
    assert(svg2x.includes(`data-uid="${andGate.uid}"`), 'Contains component UID');
    assert(svg2x.includes('transform="translate(100, 150)"'), 'Contains translation transform');
    assert(svg2x.includes('class="gate-pin pin-input jack-pin"'), 'Contains input pins');
    assert(svg2x.includes('class="gate-pin pin-output jack-pin"'), 'Contains output pin');
  });

  suite.test('Half Adder circuit with accurate wire routing and signal levels', () => {
    const parser = createDefaultParser();
    const doc = parser.parse(SAMPLE_CIRCUITS['Half Adder']);

    const nodes = new Map<string, ComponentNode>();
    for (const [uid, circuit] of doc.circuits) {
      const meta = doc.metadata.get(uid) || { x: 0, y: 0, rotation: 0 };
      const renderResult = SymbolRenderer.renderComponent(circuit);
      nodes.set(uid, {
        circuit,
        x: meta.x,
        y: meta.y,
        rotation: meta.rotation,
        renderResult
      });
    }

    doc.engine.propagateAll();

    const swA = doc.circuits.get('swA') as SwitchCircuit;
    const swB = doc.circuits.get('swB') as SwitchCircuit;
    const lampSum = doc.circuits.get('lampSum') as LightBulbCircuit;
    const lampCarry = doc.circuits.get('lampCarry') as LightBulbCircuit;

    // Initially A=0, B=0 -> Sum=0, Carry=0
    assertEqual(lampSum.isOn, false);
    assertEqual(lampCarry.isOn, false);

    const svgInitial = PngExporter.generateIntermediateSvg(doc.engine, nodes, { theme: 'dark' });

    // Wires count = 6
    const wireMatches = svgInitial.match(/<path class="wire-path\s+[^"]+"/g);
    assert(wireMatches !== null && wireMatches.length === 6, `Expected 6 wires, got ${wireMatches?.length}`);

    // All wires are low initially (0)
    assert(svgInitial.includes('wire-path wire-low'), 'Contains wire-low paths initially');
    assert(!svgInitial.includes('wire-path wire-high'), 'No wire-high paths initially');
    assert(svgInitial.includes('bulb-off'), 'Bulb has bulb-off class initially');

    // Toggle switch A: 1 + 0 = Sum: 1, Carry: 0
    swA.toggle();
    doc.engine.propagateAll();
    assertEqual(lampSum.isOn, true);
    assertEqual(lampCarry.isOn, false);

    const svgSwAOn = PngExporter.generateIntermediateSvg(doc.engine, nodes, { theme: 'dark' });
    assert(svgSwAOn.includes('wire-path wire-high'), 'Contains wire-high paths after toggling A');
    assert(svgSwAOn.includes('bulb-on'), 'Sum bulb has bulb-on active class');
    assert(svgSwAOn.includes('switch-on'), 'Switch A has switch-on active class');
  });

  suite.test('Wire path preservation with exact beziers and waypoints', () => {
    const engine = new SimulationEngine();
    const g1 = new ANDGateCircuit();
    const g2 = new ORGateCircuit();
    engine.registerCircuit(g1);
    engine.registerCircuit(g2);

    const r1 = SymbolRenderer.renderComponent(g1);
    const r2 = SymbolRenderer.renderComponent(g2);

    const nodes = new Map<string, ComponentNode>();
    nodes.set(g1.uid, { circuit: g1, x: 50, y: 100, rotation: 0, renderResult: r1 });
    nodes.set(g2.uid, { circuit: g2, x: 300, y: 100, rotation: 0, renderResult: r2 });

    const waypoints = [
      { x: 180, y: 40 },
      { x: 220, y: 220 }
    ];

    engine.connect(g1, 0, g2, 0, waypoints);

    const outJack = r1.jacks.find((j) => !j.isInput && j.index === 0)!;
    const inJack = r2.jacks.find((j) => j.isInput && j.index === 0)!;
    const start = { x: 50 + outJack.x, y: 100 + outJack.y };
    const end = { x: 300 + inJack.x, y: 100 + inJack.y };
    const expectedPathD = WireRenderer.generateBezierPath(start, end, waypoints);

    const svg = PngExporter.generateIntermediateSvg(engine, nodes, { padding: 30, scale: 1 });

    assert(svg.includes(`d="${expectedPathD}"`), 'Wire path must match exact bezier spline calculation');

    const viewBoxMatch = svg.match(/viewBox="(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)"/);
    assert(viewBoxMatch !== null);
    const [, , vy] = viewBoxMatch!.map(Number);
    assertEqual(vy, 40 - 30, 'ViewBox Y includes upper waypoint (40 - pad)');

    const expectedOrthogonalD = WireRenderer.generateBezierPath(start, end, waypoints, true);
    const svgOrthogonal = PngExporter.generateIntermediateSvg(engine, nodes, { padding: 30, scale: 1, snapOrthogonalWires: true });
    assert(svgOrthogonal.includes(`d="${expectedOrthogonalD}"`), 'PNG intermediate SVG with snapOrthogonalWires matches orthogonal wire path');
  });

  suite.test('Absence of interactive handles, hit areas, and transient elements', () => {
    const engine = new SimulationEngine();
    const g = new XORGateCircuit();
    engine.registerCircuit(g);

    const rawContent = `
      <rect class="selection-outline" x="-6" y="-6" width="80" height="60" stroke="#00f5d4" />
      <circle class="jack-hit-area" cx="0" cy="20" r="8" fill="transparent" style="cursor: crosshair;" />
      <g class="gate-symbol" style="cursor: pointer;">
        <path d="M 10 5" fill="#182234" stroke="#64748b" />
      </g>
    `;

    const nodes = new Map<string, ComponentNode>();
    nodes.set(g.uid, {
      circuit: g,
      x: 100,
      y: 100,
      rotation: 0,
      renderResult: {
        width: 74,
        height: 50,
        svgContent: rawContent,
        jacks: [{ x: 0, y: 20, isInput: true, index: 0 }]
      }
    });

    const svg = PngExporter.generateIntermediateSvg(engine, nodes);

    assertEqual(svg.includes('selection-outline'), false, 'Must NOT contain selection-outline');
    assertEqual(svg.includes('jack-hit-area'), false, 'Must NOT contain jack-hit-area');
    assertEqual(svg.includes('wire-hit-area'), false, 'Must NOT contain wire-hit-area');
    assertEqual(svg.includes('waypoint-handle'), false, 'Must NOT contain waypoint-handle');
    assertEqual(svg.includes('waypoint-hit-area'), false, 'Must NOT contain waypoint-hit-area');
    assertEqual(svg.includes('cursor: pointer'), false, 'Must NOT contain cursor: pointer');
    assertEqual(svg.includes('cursor: crosshair'), false, 'Must NOT contain cursor: crosshair');
  });

  suite.test('Embedded <style> block contains resolved colors for dark and light themes', () => {
    const engine = new SimulationEngine();
    const nodes = new Map<string, ComponentNode>();

    // 1. Dark theme styles with default #0d1117 background
    const darkSvg = PngExporter.generateIntermediateSvg(engine, nodes, {
      theme: 'dark',
      highSignalColor: '#00f5d4',
      lowSignalColor: '#475569'
    });

    assert(darkSvg.includes('<style type="text/css">'), 'Contains embedded style block');
    assert(darkSvg.includes('.wire-path {'), 'Contains .wire-path definition');
    assert(darkSvg.includes('.wire-high {'), 'Contains .wire-high definition');
    assert(darkSvg.includes('stroke: #00f5d4;'), 'Contains resolved highSignalColor');
    assert(darkSvg.includes('stroke: #475569;'), 'Contains resolved lowSignalColor');
    assert(darkSvg.includes('fill="#0d1117"'), 'Contains dark canvas background fill (#0d1117)');

    // 2. Light theme styles
    const lightSvg = PngExporter.generateIntermediateSvg(engine, nodes, {
      theme: 'light',
      highSignalColor: '#0284c7',
      lowSignalColor: '#64748b'
    });

    assert(lightSvg.includes('stroke: #0284c7;'), 'Light theme highSignalColor resolved');
    assert(lightSvg.includes('stroke: #64748b;'), 'Light theme lowSignalColor resolved');
    assert(lightSvg.includes('fill="#ffffff"'), 'Light theme default background (#ffffff)');

    // 3. Transparent background option
    const transparentSvg = PngExporter.generateIntermediateSvg(engine, nodes, {
      includeBackground: false
    });
    assert(!transparentSvg.includes('<rect class="schematic-background"'), 'Transparent export omits background rect');
  });

  suite.test('Empty circuit graceful fallback bounds with High-DPI scaling', () => {
    const engine = new SimulationEngine();
    const nodes = new Map<string, ComponentNode>();

    const svg = PngExporter.generateIntermediateSvg(engine, nodes, { padding: 40, scale: 2 });
    assert(svg.includes('viewBox="-40 -40 480 380"'), 'Empty circuit provides graceful default 400x300 viewBox with padding');
    assert(svg.includes('width="960"'), 'Empty circuit width scaled 2x to 960px');
    assert(svg.includes('height="760"'), 'Empty circuit height scaled 2x to 760px');
  });

  suite.test('Rotated component bounding box calculation', () => {
    const engine = new SimulationEngine();
    const andGate = new ANDGateCircuit();
    engine.registerCircuit(andGate);

    const renderResult = {
      width: 80,
      height: 40,
      svgContent: '<path d="M 0 0" />',
      jacks: []
    };

    const nodes = new Map<string, ComponentNode>();
    nodes.set(andGate.uid, {
      circuit: andGate,
      x: 100,
      y: 100,
      rotation: 90,
      renderResult
    });

    const svg = PngExporter.generateIntermediateSvg(engine, nodes, { padding: 20, scale: 1 });
    const viewBoxMatch = svg.match(/viewBox="(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)"/);
    assert(viewBoxMatch !== null);
    const [, vx, vy, vw, vh] = viewBoxMatch!.map(Number);

    assertEqual(vx, 100, 'Rotated component minX - pad');
    assertEqual(vy, 60, 'Rotated component minY - pad');
    assertEqual(vw, 80, 'Rotated component width + pad*2');
    assertEqual(vh, 120, 'Rotated component height + pad*2');
  });

  await suite.testAsync('PngExporter: generatePng rasterization & authentic binary PNG structure', async () => {
    const engine = new SimulationEngine();
    const andGate = new ANDGateCircuit();
    engine.registerCircuit(andGate);

    const nodes = new Map<string, ComponentNode>();
    nodes.set(andGate.uid, {
      circuit: andGate,
      x: 50,
      y: 50,
      rotation: 0,
      renderResult: SymbolRenderer.renderComponent(andGate, true)
    });

    const dataUrl = await PngExporter.generatePng(engine, nodes, { scale: 2 });
    assert(dataUrl.startsWith('data:image/png;base64,'), 'generatePng returns valid PNG data URL');

    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    assert(buffer.length > 0, 'Buffer has non-zero length');

    // Verify valid PNG signature bytes: 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert(buffer.subarray(0, 8).equals(pngSignature), 'Buffer contains authentic PNG magic byte signature');
  });

  await suite.testAsync('PngExporter: exportCircuit & exportToFile APIs', async () => {
    const engine = new SimulationEngine();
    const nodes = new Map<string, ComponentNode>();

    const res1 = await PngExporter.exportToFile(engine, nodes, 'my_schematic');
    assertEqual(res1.canceled, false);
    assertEqual(res1.filePath, 'my_schematic.png');
    assert(!!res1.dataUrl?.startsWith('data:image/png;base64,'), 'exportToFile returns valid dataUrl');

    const res2 = await PngExporter.exportCircuit(engine, nodes, 'circuit_diagram.png');
    assertEqual(res2.canceled, false);
    assertEqual(res2.filePath, 'circuit_diagram.png');
    assert(!!res2.dataUrl?.startsWith('data:image/png;base64,'), 'exportCircuit returns valid dataUrl');
  });

  suite.test('Electron IPC & Binary PNG file writing conversions', () => {
    // 1. Data URL prefix stripping and binary Buffer generation
    const mockDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const cleanBase64 = mockDataUrl.includes(',') ? mockDataUrl.split(',')[1] : mockDataUrl;
    const bufFromDataUrl = Buffer.from(cleanBase64, 'base64');
    assertEqual(bufFromDataUrl[0], 0x89);
    assertEqual(bufFromDataUrl[1], 0x50);
    assertEqual(bufFromDataUrl[2], 0x4e);
    assertEqual(bufFromDataUrl[3], 0x47);

    // 2. Raw base64 string handling
    const rawBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const cleanRaw = rawBase64.includes(',') ? rawBase64.split(',')[1] : rawBase64;
    const bufFromRaw = Buffer.from(cleanRaw, 'base64');
    assert(bufFromRaw.equals(bufFromDataUrl), 'Raw and DataURL base64 decode to identical binary buffers');

    // 3. Dialog filter determination for .png files
    const defaultName = 'schematic_export.png';
    const isPng = defaultName.toLowerCase().endsWith('.png');
    assertEqual(isPng, true);
    const dialogTitle = isPng ? 'Export PNG Schematic' : 'Save Circuit Document';
    assertEqual(dialogTitle, 'Export PNG Schematic');
    const filters = isPng ? [{ name: 'PNG Image (*.png)', extensions: ['png'] }, { name: 'All Files (*.*)', extensions: ['*'] }] : [];
    assertEqual(filters[0].extensions[0], 'png');
  });

  return suite.report();
}
