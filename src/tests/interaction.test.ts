import { TestSuite, assertEqual, assert } from './runner';
import { createDefaultParser } from '../simulation/registry';
import { SimulationEngine } from '../simulation/engine';
import { SAMPLE_CIRCUITS, SAMPLE_FULL_ADDER_IC_XML } from '../ui/samples';
import { SwitchCircuit, PushButtonCircuit } from '../simulation/circuits/controls';
import { LightBulbCircuit } from '../simulation/circuits/outputs';
import { ClockCircuit } from '../simulation/circuits/clock';
import { ComplexCircuit } from '../simulation/circuits/complex';
import { SymbolRenderer } from '../ui/canvas/symbolRenderer';
import { WireRenderer } from '../ui/canvas/wireRenderer';

export function runInteractionTests(): boolean {
  const suite = new TestSuite('Canvas Interactions, Snapping & Document Restoration');
  console.log('--- Running Canvas Interaction & Restoration Tests ---');

  const parser = createDefaultParser();

  suite.test('Document Loading: Restores all connections into clean simulation engine', () => {
    const halfAdderXml = SAMPLE_CIRCUITS['Half Adder'];
    const doc = parser.parse(halfAdderXml);

    const appEngine = new SimulationEngine();

    // Verify parser parsed 7 circuits and 6 connections
    assertEqual(doc.circuits.size, 7, 'Expected 7 circuits in Half Adder');
    assertEqual(doc.engine.connections.length, 6, 'Expected 6 connections in Half Adder');

    // Simulate loadDocument
    for (const [, circuit] of doc.circuits) {
      appEngine.registerCircuit(circuit);
    }
    for (const conn of doc.engine.connections) {
      appEngine.connect(
        conn.outputCircuit,
        conn.outputIndex,
        conn.inputCircuit,
        conn.inputIndex,
        conn.points ? [...conn.points] : undefined
      );
    }
    appEngine.propagateAll();

    // Verify all 6 connections restored into appEngine
    assertEqual(appEngine.connections.length, 6, 'All 6 wires restored into app engine');

    // Verify simulation propagation through loaded connections
    const swA = doc.circuits.get('swA') as SwitchCircuit;
    const swB = doc.circuits.get('swB') as SwitchCircuit;
    const lampSum = doc.circuits.get('lampSum') as LightBulbCircuit;
    const lampCarry = doc.circuits.get('lampCarry') as LightBulbCircuit;

    assert(swA !== undefined && swB !== undefined, 'Switches found');
    assert(lampSum !== undefined && lampCarry !== undefined, 'Lamps found');

    // Initial 0 + 0 = Sum: 0, Carry: 0
    assertEqual(lampSum.isOn, false, 'Sum is 0 initially');
    assertEqual(lampCarry.isOn, false, 'Carry is 0 initially');

    // Set A = 1 -> 1 + 0 = Sum: 1, Carry: 0
    swA.toggle();
    appEngine.propagateAll();
    assertEqual(lampSum.isOn, true, 'Sum is 1 when A=1, B=0');
    assertEqual(lampCarry.isOn, false, 'Carry is 0 when A=1, B=0');

    // Set B = 1 -> 1 + 1 = Sum: 0, Carry: 1
    swB.toggle();
    appEngine.propagateAll();
    assertEqual(lampSum.isOn, false, 'Sum is 0 when A=1, B=1');
    assertEqual(lampCarry.isOn, true, 'Carry is 1 when A=1, B=1');
  });

  suite.test('Coordinate Transform: Mathematical accuracy and exact roundtrip inverse', () => {
    // Testing the exact math of screenToWorld and worldToScreen
    const rect = { left: 260, top: 48 }; // Typical sidebar and header offsets
    const testCases = [
      { panX: 0, panY: 0, zoom: 1.0 },
      { panX: 120, panY: -80, zoom: 0.5 },
      { panX: -300, panY: 250, zoom: 2.5 },
      { panX: 50, panY: 50, zoom: 1.75 }
    ];

    for (const tc of testCases) {
      const worldToScreen = (wx: number, wy: number) => ({
        x: wx * tc.zoom + tc.panX + rect.left,
        y: wy * tc.zoom + tc.panY + rect.top
      });

      const screenToWorld = (cx: number, cy: number) => ({
        x: (cx - rect.left - tc.panX) / tc.zoom,
        y: (cy - rect.top - tc.panY) / tc.zoom
      });

      // Test point
      const originalWorld = { x: 345.5, y: 198.25 };
      const screen = worldToScreen(originalWorld.x, originalWorld.y);
      const recoveredWorld = screenToWorld(screen.x, screen.y);

      assert(Math.abs(recoveredWorld.x - originalWorld.x) < 1e-6, `X roundtrip failed for zoom ${tc.zoom}`);
      assert(Math.abs(recoveredWorld.y - originalWorld.y) < 1e-6, `Y roundtrip failed for zoom ${tc.zoom}`);
    }
  });

  suite.test('All Built-in Sample Circuits: Restore all connections cleanly without loss', () => {
    for (const [sampleName, xml] of Object.entries(SAMPLE_CIRCUITS)) {
      const doc = parser.parse(xml);
      const engine = new SimulationEngine();

      for (const [, circuit] of doc.circuits) {
        engine.registerCircuit(circuit);
      }
      for (const conn of doc.engine.connections) {
        engine.connect(
          conn.outputCircuit,
          conn.outputIndex,
          conn.inputCircuit,
          conn.inputIndex,
          conn.points ? [...conn.points] : undefined
        );
      }
      engine.propagateAll();

      assertEqual(
        engine.connections.length,
        doc.engine.connections.length,
        `All connections restored for sample: ${sampleName}`
      );
      assert(engine.connections.length > 0, `Sample ${sampleName} has wires`);
    }
  });

  suite.test('Dynamic Viewport Resizing: Focal center stability math', () => {
    // Tests viewport transform preservation on window / sidebar resizing
    const initialWidth = 1000;
    const initialHeight = 600;
    let panX = 100;
    let panY = 50;
    const zoom = 1.25;

    // Calculate world coordinate at center of viewport
    const centerWorldX = (initialWidth / 2 - panX) / zoom;
    const centerWorldY = (initialHeight / 2 - panY) / zoom;

    // Window / sidebars resize container to new dimensions
    const newWidth = 1400;
    const newHeight = 900;
    const dw = newWidth - initialWidth;
    const dh = newHeight - initialHeight;

    // Dynamic resize adjustment
    panX += dw / 2;
    panY += dh / 2;

    // Recalculate world coordinate at new center of viewport
    const newCenterWorldX = (newWidth / 2 - panX) / zoom;
    const newCenterWorldY = (newHeight / 2 - panY) / zoom;

    assert(Math.abs(newCenterWorldX - centerWorldX) < 1e-6, 'Center world X coordinate stays perfectly stable');
    assert(Math.abs(newCenterWorldY - centerWorldY) < 1e-6, 'Center world Y coordinate stays perfectly stable');
  });

  suite.test('Zoom to Fit: Mathematical bounds and scale clamping', () => {
    // Test bounding box computation and scaling logic
    const nodes = [
      { x: 100, y: 150, width: 80, height: 60 },
      { x: 500, y: 400, width: 80, height: 60 }
    ];

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }

    const circuitW = maxX - minX; // 580 - 100 = 480
    const circuitH = maxY - minY; // 460 - 150 = 310

    assertEqual(circuitW, 480, 'Circuit width computed correctly');
    assertEqual(circuitH, 310, 'Circuit height computed correctly');

    const containerW = 1000;
    const containerH = 800;
    const padding = 60;
    const availableW = containerW - padding * 2; // 880
    const availableH = containerH - padding * 2; // 680

    const scaleX = availableW / circuitW; // 880 / 480 = 1.833
    const scaleY = availableH / circuitH; // 680 / 310 = 2.1935
    const targetZoom = Math.min(2.5, Math.max(0.2, Math.min(scaleX, scaleY)));

    assert(targetZoom > 1.5 && targetZoom < 2.0, `Zoom scaled properly: ${targetZoom}`);

    const centerX = minX + circuitW / 2;
    const centerY = minY + circuitH / 2;
    const panX = containerW / 2 - centerX * targetZoom;
    const panY = containerH / 2 - centerY * targetZoom;

    // Verify center of circuit lands at center of container
    const screenCenterX = centerX * targetZoom + panX;
    const screenCenterY = centerY * targetZoom + panY;

    assert(Math.abs(screenCenterX - containerW / 2) < 1e-6, 'Circuit center aligns with container center X');
    assert(Math.abs(screenCenterY - containerH / 2) < 1e-6, 'Circuit center aligns with container center Y');
  });

  suite.test('Custom IC: Template registration, %custom@logic.ly fallback, and Full Adder propagation', () => {
    const customParser = createDefaultParser();

    // 1. Initially, %custom@logic.ly has no user custom templates registered -> returns null
    const beforeCustom = customParser.createCircuitInstance('%custom@logic.ly');
    assertEqual(beforeCustom, null, '%custom@logic.ly returns null when no custom ICs are registered');

    // 2. Register SAMPLE_FULL_ADDER_IC_XML
    customParser.registerCustomTemplate('full_adder_custom@logic.ly', SAMPLE_FULL_ADDER_IC_XML, {
      name: '1-Bit Full Adder',
      label: 'ADDER'
    });

    // 3. Now, %custom@logic.ly instantiates the registered custom IC!
    const icFromAbstract = customParser.createCircuitInstance('%custom@logic.ly');
    assert(icFromAbstract !== null, '%custom@logic.ly resolves to custom template');
    assert(icFromAbstract instanceof ComplexCircuit, 'Instance is ComplexCircuit');

    const ic = icFromAbstract as ComplexCircuit;
    assertEqual(ic.inputsCount, 3, 'Full Adder has 3 inputs (A, B, Cin)');
    assertEqual(ic.outputsCount, 2, 'Full Adder has 2 outputs (Sum, Cout)');

    // 4. Test Full Adder truth table through internal simulation
    // A=0, B=0, Cin=0 -> Sum=0, Cout=0
    ic.setInputAt(0, false);
    ic.setInputAt(1, false);
    ic.setInputAt(2, false);
    assertEqual(ic.getOutputAt(0), false, '0+0+0: Sum is 0');
    assertEqual(ic.getOutputAt(1), false, '0+0+0: Cout is 0');

    // A=1, B=0, Cin=0 -> Sum=1, Cout=0
    ic.setInputAt(0, true);
    assertEqual(ic.getOutputAt(0), true, '1+0+0: Sum is 1');
    assertEqual(ic.getOutputAt(1), false, '1+0+0: Cout is 0');

    // A=1, B=1, Cin=0 -> Sum=0, Cout=1
    ic.setInputAt(1, true);
    assertEqual(ic.getOutputAt(0), false, '1+1+0: Sum is 0');
    assertEqual(ic.getOutputAt(1), true, '1+1+0: Cout is 1');

    // A=1, B=1, Cin=1 -> Sum=1, Cout=1
    ic.setInputAt(2, true);
    assertEqual(ic.getOutputAt(0), true, '1+1+1: Sum is 1');
    assertEqual(ic.getOutputAt(1), true, '1+1+1: Cout is 1');

    // 5. Unregister custom IC and verify fallback resolution is cleared
    const unregResult = customParser.unregisterCustomTemplate('full_adder_custom@logic.ly');
    assertEqual(unregResult, true, 'Custom IC template unregistered');
    const afterDelete = customParser.createCircuitInstance('%custom@logic.ly');
    assertEqual(afterDelete, null, '%custom@logic.ly returns null again once custom template deleted');

    // 6. Placed instances remain functional after template deletion
    ic.setInputAt(0, false);
    ic.setInputAt(1, true);
    ic.setInputAt(2, false);
    assertEqual(ic.getOutputAt(0), true, 'Placed canvas instance remains functional after template deletion: 0+1+0 Sum is 1');
    assertEqual(ic.getOutputAt(1), false, 'Placed canvas instance remains functional after template deletion: 0+1+0 Cout is 0');
  });

  suite.test('Dynamic Component Rendering: Switch, Button, Bulb, and Clock state classes', () => {
    // Switch state classes and knob geometry
    const swOff = new SwitchCircuit(false);
    const renderSwOff = SymbolRenderer.renderSwitch(swOff);
    assert(renderSwOff.svgContent.includes('switch-off'), 'Switch false renders switch-off class');
    assert(renderSwOff.svgContent.includes('cx="18"'), 'Switch false knob positioned at cx=18');

    const swOn = new SwitchCircuit(true);
    const renderSwOn = SymbolRenderer.renderSwitch(swOn);
    assert(renderSwOn.svgContent.includes('switch-on'), 'Switch true renders switch-on class');
    assert(renderSwOn.svgContent.includes('cx="32"'), 'Switch true knob positioned at cx=32');

    // LightBulb state classes
    const bulb = new LightBulbCircuit();
    const renderBulbOff = SymbolRenderer.renderLightBulb(bulb);
    assert(renderBulbOff.svgContent.includes('bulb-off'), 'Bulb unlit renders bulb-off class');

    bulb.setInputAt(0, true);
    const renderBulbOn = SymbolRenderer.renderLightBulb(bulb);
    assert(renderBulbOn.svgContent.includes('bulb-on'), 'Bulb lit renders bulb-on class');

    // PushButton state classes and knob radius
    const btn = new PushButtonCircuit();
    const renderBtnRel = SymbolRenderer.renderPushButton(btn);
    assert(renderBtnRel.svgContent.includes('btn-released'), 'Released button renders btn-released class');
    assert(renderBtnRel.svgContent.includes('r="12"'), 'Released button knob radius is 12');

    btn.press();
    const renderBtnPrs = SymbolRenderer.renderPushButton(btn);
    assert(renderBtnPrs.svgContent.includes('btn-pressed'), 'Pressed button renders btn-pressed class');
    assert(renderBtnPrs.svgContent.includes('r="10"'), 'Pressed button knob radius is 10');

    // Clock state classes
    const clk = new ClockCircuit(100);
    const renderClk = SymbolRenderer.renderClock(clk);
    assert(renderClk.svgContent.includes('clock-high') || renderClk.svgContent.includes('clock-low'), 'Clock renders clock state class');
  });

  suite.test('Wire Shape & Routing: Bezier spline generation, closest segment detection, and CSS classes', () => {
    // 1. Direct 2-point wire bezier path
    const pDirect = WireRenderer.generateBezierPath({ x: 0, y: 100 }, { x: 200, y: 100 });
    assert(pDirect.startsWith('M 0 100 C'), 'Direct wire starts with M 0 100 C');
    assert(pDirect.endsWith('200 100'), 'Direct wire ends at 200 100');

    // 2. Wire with 1 intermediate waypoint
    const pWithWaypoint = WireRenderer.generateBezierPath(
      { x: 0, y: 100 },
      { x: 400, y: 100 },
      [{ x: 200, y: 250 }]
    );
    assert(pWithWaypoint.includes('200.0 250.0'), 'Path passes through waypoint at 200, 250');
    assert(pWithWaypoint.split(' C ').length === 3, 'Path contains 2 cubic Bezier curves');

    // 3. Closest segment detection for direct dragging insertion
    const start = { x: 0, y: 0 };
    const wp0 = { x: 100, y: 50 };
    const end = { x: 200, y: 0 };

    // Point near first segment (0,0) -> (100, 50)
    const idx0 = WireRenderer.findClosestSegment({ x: 30, y: 15 }, start, end, [wp0]);
    assertEqual(idx0, 0, 'Point near segment 0 maps to index 0');

    // Point near second segment (100, 50) -> (200, 0)
    const idx1 = WireRenderer.findClosestSegment({ x: 170, y: 15 }, start, end, [wp0]);
    assertEqual(idx1, 1, 'Point near segment 1 maps to index 1');

    // 4. CSS class generation for all 3 logic states + selection
    assertEqual(WireRenderer.getWireCssClass(true, false), 'wire-path wire-high');
    assertEqual(WireRenderer.getWireCssClass(false, false), 'wire-path wire-low');
    assertEqual(WireRenderer.getWireCssClass(undefined, false), 'wire-path wire-hiz');
    assertEqual(WireRenderer.getWireCssClass(true, true), 'wire-path wire-high wire-selected');
    assertEqual(WireRenderer.getWireCssClass(undefined, true), 'wire-path wire-hiz wire-selected');
  });

  suite.test('Orthogonal 90° Wire Routing (Logicly style) with Waypoints & Snap Toggle', () => {
    const start = { x: 50, y: 100 };
    const end = { x: 250, y: 200 };
    const nonParWaypoint = { x: 150, y: 140 }; // Not parallel to start (y=100) or end (y=200)
    const endParWaypoint = { x: 150, y: 200 }; // Parallel to end on Y axis (y=200)
    const startParWaypoint = { x: 150, y: 100 }; // Parallel to start on Y axis (y=100)

    // 1. Unedited wire MUST always return singleBezier curve, never orthogonal
    const uneditedSpline = WireRenderer.generateBezierPath(start, end, [], false);
    const uneditedOrthogonal = WireRenderer.generateBezierPath(start, end, [], true);
    assert(uneditedSpline.includes(' C '), 'Unedited wire without snap is natural bezier curve');
    assertEqual(uneditedOrthogonal, uneditedSpline, 'Unedited wire with snapOrthogonal=true MUST stay natural bezier curve');

    // 2. Edited wire with snapOrthogonal=false returns smooth cubic spline without straightening
    const editedCurved = WireRenderer.generateBezierPath(start, end, [nonParWaypoint], false);
    assert(editedCurved.includes(' C '), 'Edited wire with snapOrthogonal=false contains cubic Bezier curve segments');
    assert(!editedCurved.includes(' L '), 'Edited wire with snapOrthogonal=false has no straight L segments');

    // 3. User bends wire but point is NOT parallel: wire remains smooth natural curve through waypoint
    const editedNonPar = WireRenderer.generateBezierPath(start, end, [nonParWaypoint], true);
    assert(editedNonPar.includes(' C '), 'Non-parallel segment remains natural curve');
    assert(!editedNonPar.includes(' L '), 'Non-parallel wire contains zero artificial straight corners');
    assert(editedNonPar.includes('150.0 140.0'), 'Curve passes cleanly through user waypoint');

    // 4. User bends wire so waypoint is parallel to end pin (Y-axis):
    // First segment is a curve, second segment becomes a straight line (L)
    const editedEndPar = WireRenderer.generateBezierPath(start, end, [endParWaypoint], true);
    assert(editedEndPar.includes(' C '), 'Segment to waypoint is smooth curve');
    assert(editedEndPar.includes(' L 250 200'), 'Parallel segment to end pin is a straight line');
    assert(!editedEndPar.includes(' L 150'), 'Zero artificial elbow corners before the waypoint');

    // 5. User bends wire so waypoint is parallel to start pin (Y-axis):
    // First segment is a straight line (L), second segment is a curve (C)
    const editedStartPar = WireRenderer.generateBezierPath(start, end, [startParWaypoint], true);
    assert(editedStartPar.includes(' L 150 100'), 'Parallel segment from start pin is a straight line');
    assert(editedStartPar.includes(' C '), 'Segment from waypoint to end pin is a smooth curve');

    // 6. User aligns waypoints orthogonally on X and Y (sharp 90° corners, Logicly style):
    const cornerWp1 = { x: 150, y: 100 }; // Parallel to start on Y (horizontal)
    const cornerWp2 = { x: 150, y: 200 }; // Parallel to Wp1 on X (vertical), and parallel to end on Y (horizontal)
    const pureOrthogonal = WireRenderer.generateBezierPath(start, end, [cornerWp1, cornerWp2], true);
    assert(!pureOrthogonal.includes(' C '), 'All-parallel wire contains no curves');
    assertEqual(pureOrthogonal, 'M 50 100 L 150 100 L 150 200 L 250 200', 'Pure orthogonal wire with 90° corners at waypoints');

    // 7. Waypoint magnetic snapping logic (aligning within SNAP_THRESHOLD = 14px)
    const SNAP_THRESHOLD = 14;
    const prevPt = { x: 100, y: 150 };
    let dragPos = { x: 108, y: 155 }; // close in X (dist 8 < 14), close in Y (dist 5 < 14)
    if (Math.abs(dragPos.x - prevPt.x) < SNAP_THRESHOLD) dragPos.x = prevPt.x;
    if (Math.abs(dragPos.y - prevPt.y) < SNAP_THRESHOLD) dragPos.y = prevPt.y;
    assertEqual(dragPos.x, 100, 'X snaps orthogonally to previous point coordinate');
    assertEqual(dragPos.y, 150, 'Y snaps orthogonally to previous point coordinate');
  });

  suite.test('Panning Methods, Tool Switching & Pinch-to-Zoom / Wheel Force Normalization', () => {
    // 1. Programmatic pan math (setPan & panBy)
    let currentPanX = 50;
    let currentPanY = 50;

    const setPan = (x: number, y: number) => {
      currentPanX = x;
      currentPanY = y;
    };
    const panBy = (dx: number, dy: number) => {
      currentPanX += dx;
      currentPanY += dy;
    };

    setPan(120, -80);
    assertEqual(currentPanX, 120, 'setPan sets panX correctly');
    assertEqual(currentPanY, -80, 'setPan sets panY correctly');

    panBy(35, 45);
    assertEqual(currentPanX, 155, 'panBy increments panX correctly');
    assertEqual(currentPanY, -35, 'panBy increments panY correctly');

    // 2. Tool state and switching
    let activeTool: 'select' | 'pan' = 'select';
    let toolCallbackTriggered = false;
    const onToolChange = (tool: 'select' | 'pan') => {
      toolCallbackTriggered = true;
      activeTool = tool;
    };

    const setTool = (t: 'select' | 'pan') => {
      activeTool = t;
      onToolChange(t);
    };

    setTool('pan');
    assertEqual(activeTool, 'pan', 'Tool switches to pan');
    assert(toolCallbackTriggered, 'Tool change callback fired');

    toolCallbackTriggered = false;
    setTool('select');
    assertEqual(activeTool, 'select', 'Tool switches back to select');
    assert(toolCallbackTriggered, 'Tool change callback fired for select');

    // 3. Zoom focal point transform stability
    // Under mouse zoom, world point under cursor must remain invariant:
    // (mouseX - panX_old) / zoom_old === (mouseX - panX_new) / zoom_new
    const mouseX = 400;
    const mouseY = 300;
    const zoomOld = 1.0;
    const zoomNew = 1.5;
    const panXOld = 50;
    const panYOld = 50;

    const panXNew = mouseX - (mouseX - panXOld) * (zoomNew / zoomOld);
    const panYNew = mouseY - (mouseY - panYOld) * (zoomNew / zoomOld);

    const worldBeforeX = (mouseX - panXOld) / zoomOld;
    const worldBeforeY = (mouseY - panYOld) / zoomOld;
    const worldAfterX = (mouseX - panXNew) / zoomNew;
    const worldAfterY = (mouseY - panYNew) / zoomNew;

    assert(Math.abs(worldBeforeX - worldAfterX) < 1e-6, 'Focal world X under cursor remains invariant during zoom');
    assert(Math.abs(worldBeforeY - worldAfterY) < 1e-6, 'Focal world Y under cursor remains invariant during zoom');

    // 4. Pinch-to-zoom vs Mouse Wheel normalization math
    // Pinch gesture: Math.exp(-deltaY * 0.003) clamped to [0.96, 1.04]
    const pinchZoomIn = Math.min(1.04, Math.max(0.96, Math.exp(-(-15) * 0.003)));
    const pinchZoomOut = Math.min(1.04, Math.max(0.96, Math.exp(-(15) * 0.003)));
    assert(pinchZoomIn > 1.0 && pinchZoomIn <= 1.04, 'Trackpad pinch zoom-in factor is smoothly clamped');
    assert(pinchZoomOut < 1.0 && pinchZoomOut >= 0.96, 'Trackpad pinch zoom-out factor is smoothly clamped');

    // Extreme pinch trackpad delta (e.g. fast flick) must not jump
    const extremePinchIn = Math.min(1.04, Math.max(0.96, Math.exp(-(-500) * 0.003)));
    const extremePinchOut = Math.min(1.04, Math.max(0.96, Math.exp(-(500) * 0.003)));
    assertEqual(extremePinchIn, 1.04, 'Extreme pinch delta safely clamps to 1.04 ceiling');
    assertEqual(extremePinchOut, 0.96, 'Extreme pinch delta safely clamps to 0.96 floor');

    // Mouse wheel: Math.exp(-deltaY * 0.0015) clamped to [0.85, 1.15]
    const wheelZoomIn = Math.min(1.15, Math.max(0.85, Math.exp(-(-100) * 0.0015)));
    const wheelZoomOut = Math.min(1.15, Math.max(0.85, Math.exp(-(100) * 0.0015)));
    assert(wheelZoomIn > 1.0 && wheelZoomIn <= 1.15, 'Mouse wheel zoom in factor is gentle');
    assert(wheelZoomOut < 1.0 && wheelZoomOut >= 0.85, 'Mouse wheel zoom out factor is gentle');

    // Extreme mouse wheel impulses (e.g. rapid wheel spin)
    const extremeWheelIn = Math.min(1.15, Math.max(0.85, Math.exp(-(-1200) * 0.0015)));
    const extremeWheelOut = Math.min(1.15, Math.max(0.85, Math.exp(-(1200) * 0.0015)));
    assertEqual(extremeWheelIn, 1.15, 'Extreme wheel impulse safely clamps to 1.15 ceiling');
    assertEqual(extremeWheelOut, 0.85, 'Extreme wheel impulse safely clamps to 0.85 floor');

    // Canvas zoom clamping [0.3, 3.0]
    const clampedMinZoom = Math.min(3.0, Math.max(0.3, 0.1));
    const clampedMaxZoom = Math.min(3.0, Math.max(0.3, 4.5));
    assertEqual(clampedMinZoom, 0.3, 'Minimum zoom clamp respected');
    assertEqual(clampedMaxZoom, 3.0, 'Maximum zoom clamp respected');
  });

  suite.test('Sample 4-Bit Ripple Counter: PRE and CLR tie-offs connect to VCC', () => {
    const xml = SAMPLE_CIRCUITS['4-Bit Ripple Counter'];
    const doc = parser.parse(xml);

    assert(doc.circuits.has('vcc'), 'Contains VCC power rail');
    const vcc = doc.circuits.get('vcc')!;

    // For all 4 T-flip-flops, verify PRE' (input 2) and CLR' (input 3) are tied to VCC
    for (const tffUid of ['tff0', 'tff1', 'tff2', 'tff3']) {
      assert(doc.circuits.has(tffUid), `Contains ${tffUid}`);
      const tff = doc.circuits.get(tffUid)!;

      const preConn = doc.engine.connections.find(
        (c) => c.outputCircuit === vcc && c.inputCircuit === tff && c.inputIndex === 2
      );
      assert(preConn !== undefined, `${tffUid} PRE' (input 2) tied to VCC`);

      const clrConn = doc.engine.connections.find(
        (c) => c.outputCircuit === vcc && c.inputCircuit === tff && c.inputIndex === 3
      );
      assert(clrConn !== undefined, `${tffUid} CLR' (input 3) tied to VCC`);
    }
  });

  suite.test('Sample 4-Bit JK Ripple Counter: Components, wiring, and labels are verified', () => {
    const xml = SAMPLE_CIRCUITS['4-Bit JK Ripple Counter'];
    assert(xml !== undefined, 'SAMPLE_CIRCUITS["4-Bit JK Ripple Counter"] is defined');

    const doc = parser.parse(xml);
    assertEqual(doc.circuits.size, 14, 'Contains 14 components');

    // Components presence
    assert(doc.circuits.has('vcc'), 'Contains vcc');
    assert(doc.circuits.has('clk'), 'Contains clk');
    const vcc = doc.circuits.get('vcc')!;
    const clk = doc.circuits.get('clk')!;

    for (let i = 0; i < 4; i++) {
      assert(doc.circuits.has(`ff${i}`), `Contains ff${i}`);
      assert(doc.circuits.has(`led${i}`), `Contains led${i}`);
      assert(doc.circuits.has(`lbl${i}`), `Contains lbl${i}`);
    }

    // Verify VCC ties off J (0), K (2), PRE' (3), CLR' (4) on all 4 JK flip-flops
    for (let i = 0; i < 4; i++) {
      const ff = doc.circuits.get(`ff${i}`)!;
      for (const inIdx of [0, 2, 3, 4]) {
        const hasVcc = doc.engine.connections.some(
          (c) => c.outputCircuit === vcc && c.inputCircuit === ff && c.inputIndex === inIdx
        );
        assert(hasVcc, `ff${i} input ${inIdx} connected to VCC`);
      }
    }

    // Verify clock chain
    const ff0 = doc.circuits.get('ff0')!;
    const ff1 = doc.circuits.get('ff1')!;
    const ff2 = doc.circuits.get('ff2')!;
    const ff3 = doc.circuits.get('ff3')!;

    assert(
      doc.engine.connections.some((c) => c.outputCircuit === clk && c.inputCircuit === ff0 && c.inputIndex === 1),
      'clk connects to ff0 clock input'
    );
    assert(
      doc.engine.connections.some((c) => c.outputCircuit === ff0 && c.outputIndex === 1 && c.inputCircuit === ff1 && c.inputIndex === 1),
      'ff0 Q-bar connects to ff1 clock input'
    );
    assert(
      doc.engine.connections.some((c) => c.outputCircuit === ff1 && c.outputIndex === 1 && c.inputCircuit === ff2 && c.inputIndex === 1),
      'ff1 Q-bar connects to ff2 clock input'
    );
    assert(
      doc.engine.connections.some((c) => c.outputCircuit === ff2 && c.outputIndex === 1 && c.inputCircuit === ff3 && c.inputIndex === 1),
      'ff2 Q-bar connects to ff3 clock input'
    );

    // Verify LEDs
    for (let i = 0; i < 4; i++) {
      const ff = doc.circuits.get(`ff${i}`)!;
      const led = doc.circuits.get(`led${i}`)!;
      assert(
        doc.engine.connections.some((c) => c.outputCircuit === ff && c.outputIndex === 0 && c.inputCircuit === led && c.inputIndex === 0),
        `ff${i} Q connects to led${i}`
      );
    }

    // Verify labels
    const expectedTexts = ['0001', '0010', '0100', '1000'];
    for (let i = 0; i < 4; i++) {
      const lbl = doc.circuits.get(`lbl${i}`) as any;
      assertEqual(lbl.text, expectedTexts[i], `lbl${i} text is ${expectedTexts[i]}`);
    }
  });

  return suite.report();
}
