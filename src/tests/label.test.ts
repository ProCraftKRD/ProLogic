import { TestSuite, assertEqual, assert } from './runner';
import { LabelCircuit } from '../simulation/circuits/annotation';
import { SymbolRenderer } from '../ui/canvas/symbolRenderer';
import { LogiclyParser } from '../io/parser';
import { SimulationEngine } from '../simulation/engine';
import { ComponentNode } from '../ui/canvas/interactionManager';
import { SvgExporter } from '../ui/export/svgExporter';

export function runLabelTests(): boolean {
  const suite = new TestSuite('Label Formatting, Serialization, Rendering & Interaction');
  console.log('--- Running Text Label Tests ---');

  const parser = new LogiclyParser();

  suite.test('LabelCircuit: Defaults and property getters/setters', () => {
    const label = new LabelCircuit('Test Label');
    assertEqual(label.text, 'Test Label', 'Text matches constructor input');
    assertEqual(label.fontSize, 13, 'Default fontSize is 13');
    assertEqual(label.bold, false, 'Default bold is false');
    assertEqual(label.italic, false, 'Default italic is false');
    assertEqual(label.alignment, 'left', 'Default alignment is left');
    assertEqual(label.color, undefined, 'Default color is undefined');

    // Mutate properties
    label.fontSize = 24;
    label.bold = true;
    label.italic = true;
    label.alignment = 'center';
    label.color = '#ef4444';

    assertEqual(label.fontSize, 24, 'Updated fontSize');
    assertEqual(label.bold, true, 'Updated bold');
    assertEqual(label.italic, true, 'Updated italic');
    assertEqual(label.alignment, 'center', 'Updated alignment');
    assertEqual(label.color, '#ef4444', 'Updated color');

    // Test constructor with formatting interface
    const formatted = new LabelCircuit('Formatted', 'uid-123', {
      fontSize: 18,
      bold: true,
      italic: false,
      alignment: 'right',
      color: '#00f5d4'
    });
    assertEqual(formatted.fontSize, 18, 'Constructor formatting: fontSize');
    assertEqual(formatted.bold, true, 'Constructor formatting: bold');
    assertEqual(formatted.italic, false, 'Constructor formatting: italic');
    assertEqual(formatted.alignment, 'right', 'Constructor formatting: alignment');
    assertEqual(formatted.color, '#00f5d4', 'Constructor formatting: color');
  });

  suite.test('SymbolRenderer: Multi-line and formatted label rendering', () => {
    const multiLine = new LabelCircuit('Line 1\nLine 2\nLine 3');
    multiLine.fontSize = 16;
    multiLine.bold = true;
    multiLine.italic = true;
    multiLine.alignment = 'center';
    multiLine.color = '#10b981';

    const result = SymbolRenderer.renderComponent(multiLine, true);
    assert(result.width >= 16, 'Label width hugs text dynamically');
    assert(result.height >= 45, 'Label multi-line dynamic height calculated');
    assertEqual(result.jacks.length, 0, 'Labels have no electrical pin jacks');

    // Verify SVG markup
    assert(result.svgContent.includes('font-size: 16px'), 'Contains font-size style');
    assert(result.svgContent.includes('font-weight: 700'), 'Contains bold weight 700');
    assert(result.svgContent.includes('font-style: italic'), 'Contains italic style');
    assert(result.svgContent.includes('text-anchor: middle'), 'Contains center text-anchor');
    assert(result.svgContent.includes('fill: #10b981'), 'Contains custom color fill');
    assert(result.svgContent.includes('<tspan'), 'Contains tspan for multi-line lines');
    assert(result.svgContent.includes('Line 1'), 'Contains Line 1');
    assert(result.svgContent.includes('Line 2'), 'Contains Line 2');
    assert(result.svgContent.includes('Line 3'), 'Contains Line 3');
  });

  suite.test('SymbolRenderer: Alignment anchor positions and right alignment', () => {
    const rightAlign = new LabelCircuit('Right Aligned Text');
    rightAlign.alignment = 'right';
    const result = SymbolRenderer.renderComponent(rightAlign, true);

    assert(result.svgContent.includes('text-anchor: end'), 'Right alignment maps to end anchor');
    assert(result.svgContent.includes(`x="${result.width - 8}"`), 'Anchor X positioned near right boundary');
  });

  suite.test('LogiclyParser: Backward compatibility with standard legacy XML files', () => {
    const legacyXml = `
      <logicly xmlns="http://ns.logic.ly/1.2">
        <object type="label@logic.ly" uid="lbl-legacy" x="120" y="80" rotation="0" text="Legacy Note"/>
      </logicly>
    `;
    const doc = parser.parse(legacyXml);
    assert(doc.circuits.has('lbl-legacy'), 'Parsed legacy label');
    const label = doc.circuits.get('lbl-legacy') as LabelCircuit;
    assertEqual(label.text, 'Legacy Note', 'Extracted text');
    assertEqual(label.fontSize, 13, 'Defaults to 13px');
    assertEqual(label.bold, false, 'Defaults to unbold');
    assertEqual(label.italic, false, 'Defaults to non-italic');
    assertEqual(label.alignment, 'left', 'Defaults to left aligned');
    assertEqual(label.color, undefined, 'Defaults to undefined color');
  });

  suite.test('LogiclyParser: Serialization and deserialization of formatting attributes', () => {
    const engine = new SimulationEngine();
    const label = new LabelCircuit('Rich Formatted Label', 'lbl-rich');
    label.fontSize = 32;
    label.bold = true;
    label.italic = true;
    label.alignment = 'center';
    label.color = '#ef4444';
    engine.registerCircuit(label);

    const metadata = new Map();
    metadata.set(label.uid, { x: 200, y: 150, rotation: 0 });

    const doc = {
      engine,
      circuits: new Map([[label.uid, label]]),
      metadata,
      locations: { left: [], right: [], top: [], bottom: [] }
    };

    const xml = parser.serialize(doc);
    assert(xml.includes('fontSize="32"'), 'Serialized fontSize');
    assert(xml.includes('bold="true"'), 'Serialized bold');
    assert(xml.includes('italic="true"'), 'Serialized italic');
    assert(xml.includes('alignment="center"'), 'Serialized alignment');
    assert(xml.includes('color="#ef4444"'), 'Serialized color');

    // Parse back
    const roundtrip = parser.parse(xml);
    const roundtripLabel = roundtrip.circuits.get('lbl-rich') as LabelCircuit;
    assert(roundtripLabel !== undefined, 'Found roundtrip label');
    assertEqual(roundtripLabel.text, 'Rich Formatted Label', 'Roundtrip text');
    assertEqual(roundtripLabel.fontSize, 32, 'Roundtrip fontSize');
    assertEqual(roundtripLabel.bold, true, 'Roundtrip bold');
    assertEqual(roundtripLabel.italic, true, 'Roundtrip italic');
    assertEqual(roundtripLabel.alignment, 'center', 'Roundtrip alignment');
    assertEqual(roundtripLabel.color, '#ef4444', 'Roundtrip color');
  });

  suite.test('SvgExporter: Formatted label in schematic export', () => {
    const engine = new SimulationEngine();
    const label = new LabelCircuit('Schematic Title\nSubtitle Line', 'lbl-schem');
    label.fontSize = 24;
    label.bold = true;
    label.italic = false;
    label.alignment = 'right';
    label.color = '#00f5d4';
    engine.registerCircuit(label);

    const renderResult = SymbolRenderer.renderComponent(label, true);
    const nodes = new Map<string, ComponentNode>();
    nodes.set(label.uid, {
      circuit: label,
      x: 50,
      y: 50,
      rotation: 0,
      renderResult
    });

    const svg = SvgExporter.generateSvg(engine, nodes, { theme: 'dark' });

    assert(svg.includes('font-size: 24px'), 'Exported SVG includes font-size');
    assert(svg.includes('font-weight: 700'), 'Exported SVG includes bold weight');
    assert(svg.includes('text-anchor: end'), 'Exported SVG includes right alignment');
    assert(svg.includes('fill: #00f5d4') || svg.includes('fill="#00f5d4"'), 'Exported SVG preserves custom color');
    assert(svg.includes('Schematic Title'), 'Contains first line');
    assert(svg.includes('Subtitle Line'), 'Contains second line');
  });

  suite.test('SymbolRenderer: Dynamic dimensions scale with font size and line length', () => {
    const smallLabel = new LabelCircuit('Short');
    smallLabel.fontSize = 10;
    const renderSmall = SymbolRenderer.renderComponent(smallLabel, true);

    const largeLabel = new LabelCircuit('Short');
    largeLabel.fontSize = 48;
    const renderLarge = SymbolRenderer.renderComponent(largeLabel, true);

    assert(renderLarge.height > renderSmall.height, 'Height scales with font size');
    assert(renderLarge.width > renderSmall.width, 'Width scales with font size');

    const multiLine48 = new LabelCircuit('Line 1\nLine 2\nLine 3\nLine 4');
    multiLine48.fontSize = 24;
    const renderMulti = SymbolRenderer.renderComponent(multiLine48, true);
    assert(renderMulti.height >= 4 * Math.round(24 * 1.35), 'Height accommodates all 4 lines at 24px');
  });

  suite.test('SymbolRenderer: Special characters escaping', () => {
    const escapeLabel = new LabelCircuit('A & B < C > D "quoted" \'single\'');
    const result = SymbolRenderer.renderComponent(escapeLabel, true);

    assert(result.svgContent.includes('&amp;'), 'Escapes ampersand');
    assert(result.svgContent.includes('&lt;'), 'Escapes less than');
    assert(result.svgContent.includes('&gt;'), 'Escapes greater than');
    assert(result.svgContent.includes('&quot;'), 'Escapes double quote');
    assert(result.svgContent.includes('&apos;'), 'Escapes single quote');
  });

  suite.test('SvgExporter: Light theme schematic export color resolution', () => {
    const engine = new SimulationEngine();
    const defaultLabel = new LabelCircuit('Default Color');
    const customLabel = new LabelCircuit('Custom Color');
    customLabel.color = '#ef4444';
    engine.registerCircuit(defaultLabel);
    engine.registerCircuit(customLabel);

    const nodes = new Map<string, ComponentNode>();
    nodes.set(defaultLabel.uid, {
      circuit: defaultLabel,
      x: 0,
      y: 0,
      rotation: 0,
      renderResult: SymbolRenderer.renderComponent(defaultLabel, true)
    });
    nodes.set(customLabel.uid, {
      circuit: customLabel,
      x: 100,
      y: 0,
      rotation: 0,
      renderResult: SymbolRenderer.renderComponent(customLabel, true)
    });

    const lightSvg = SvgExporter.generateSvg(engine, nodes, { theme: 'light' });
    assert(lightSvg.includes('fill="#0f172a"'), 'Default label resolves to light theme dark text (#0f172a)');
    assert(lightSvg.includes('fill="#ef4444"'), 'Custom label preserves custom color in light theme');
  });

  suite.test('SymbolRenderer: Dynamic auto-resizing hugs text tightly and preserves default for empty/blank', () => {
    // 1. Empty and whitespace labels keep default box dimensions (80x25)
    const emptyLabel = new LabelCircuit('');
    const renderEmpty = SymbolRenderer.renderComponent(emptyLabel, true);
    assertEqual(renderEmpty.width, 80, 'Empty label width is default 80');
    assertEqual(renderEmpty.height, 25, 'Empty label height is default 25');

    const blankSpaces = new LabelCircuit('    ');
    const renderSpaces = SymbolRenderer.renderComponent(blankSpaces, true);
    assertEqual(renderSpaces.width, 80, 'Whitespace label width is default 80');
    assertEqual(renderSpaces.height, 25, 'Whitespace label height is default 25');

    // 2. Short non-empty label (like "0001" under a counter) hugs text tightly without wide right void
    const counterLabel = new LabelCircuit('0001');
    const renderCounter = SymbolRenderer.renderComponent(counterLabel, true);
    assert(renderCounter.width < 60, `Short label "0001" is tightly hugged (${renderCounter.width}px < 60px)`);
    assert(renderCounter.width >= 16, 'Short label respects minimum tight bound 16px');

    // 3. Proportional scaling with content
    const singleChar = new LabelCircuit('A');
    const renderSingle = SymbolRenderer.renderComponent(singleChar, true);
    assert(renderCounter.width > renderSingle.width, '4-char label is wider than 1-char label');

    const multiLine = new LabelCircuit('0001\n0010');
    const renderMulti = SymbolRenderer.renderComponent(multiLine, true);
    assertEqual(renderMulti.width, renderCounter.width, 'Same line-length multi-line has same tight width');
  });

  return suite.report();
}
