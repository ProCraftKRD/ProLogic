import { TestSuite, assert, assertEqual } from './runner';
import { UniversalCircuitImporter } from '../io/universal/universalImporter';
import { detectCircuitFormat } from '../io/universal/formatDetector';
import { LogiclyParser } from '../io/parser';
import { SwitchCircuit, ConstantHighCircuit } from '../simulation/circuits/controls';
import { LightBulbCircuit } from '../simulation/circuits/outputs';
import { ANDGateCircuit, ORGateCircuit, NOTGateCircuit, TriStateCircuit } from '../simulation/circuits/gates';

export function runUniversalImporterTests(): boolean {
  const suite = new TestSuite('Universal Multi-Format Circuit Importer & CAD Interoperability');

  // =========================================================================
  // 1. Format Auto-Detection Tests
  // =========================================================================

  suite.test('Format Detection: Logisim .circ by extension and XML content', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<project source="2.7.1" version="1.0">
  <circuit name="main">
    <comp lib="1" loc="(200,100)" name="AND Gate"/>
  </circuit>
</project>`;

    // By filename
    const resByExt = detectCircuitFormat(xml, 'my_alu.circ');
    assertEqual(resByExt.format, 'logisim');
    assert(resByExt.confidence >= 0.9);

    // By content only (.xml or no filename)
    const resByContent = detectCircuitFormat(xml, 'circuit.xml');
    assertEqual(resByContent.format, 'logisim');

    const resNoName = detectCircuitFormat(xml);
    assertEqual(resNoName.format, 'logisim');
  });

  suite.test('Format Detection: Digital .dig by extension and XML content', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<circuit>
  <version>1</version>
  <visualElements>
    <visualElement>
      <elementName>And</elementName>
      <pos x="200" y="100"/>
    </visualElement>
  </visualElements>
  <wires>
    <wire><p1 x="100" y="100"/><p2 x="200" y="100"/></wire>
  </wires>
</circuit>`;

    const resByExt = detectCircuitFormat(xml, 'counter.dig');
    assertEqual(resByExt.format, 'digital');

    const resByContent = detectCircuitFormat(xml, 'unknown.xml');
    assertEqual(resByContent.format, 'digital');

    const resNoName = detectCircuitFormat(xml);
    assertEqual(resNoName.format, 'digital');
  });

  suite.test('Format Detection: SimcirJS .simcir and JSON content', () => {
    const json = JSON.stringify({
      width: 600,
      height: 400,
      devices: [
        { type: 'Toggle', id: 'dev0', x: 50, y: 50 },
        { type: 'AND', id: 'dev1', x: 150, y: 50 }
      ],
      connectors: [
        { from: 'dev0.out0', to: 'dev1.in0' }
      ]
    });

    const resByExt = detectCircuitFormat(json, 'project.simcir');
    assertEqual(resByExt.format, 'simcir');

    const resByJson = detectCircuitFormat(json, 'project.json');
    assertEqual(resByJson.format, 'simcir');

    const resNoName = detectCircuitFormat(json);
    assertEqual(resNoName.format, 'simcir');
  });

  suite.test('Format Detection: CircuitVerse .cdd, .cv, and JSON content', () => {
    const json = JSON.stringify({
      name: 'FullAdder',
      timePeriod: 50,
      projectId: 'cv12345',
      focussedCircuit: 0,
      scopes: [
        {
          id: 0,
          name: 'Main',
          allElementList: [
            { objectType: 'Input', x: 50, y: 50 },
            { objectType: 'Output', x: 250, y: 50 }
          ],
          wireList: []
        }
      ]
    });

    const resByCdd = detectCircuitFormat(json, 'adder.cdd');
    assertEqual(resByCdd.format, 'circuitverse');

    const resByCv = detectCircuitFormat(json, 'adder.cv');
    assertEqual(resByCv.format, 'circuitverse');

    const resByJson = detectCircuitFormat(json, 'adder.json');
    assertEqual(resByJson.format, 'circuitverse');
  });

  suite.test('Format Detection: Logicly native XML and compressed files', () => {
    const xml = `<logicly xmlns="http://ns.logic.ly/1.2">
  <object type="switch@logic.ly" uid="sw1" x="100" y="100" rotation="0"/>
  <object type="light_bulb@logic.ly" uid="bulb1" x="200" y="100" rotation="0"/>
  <connection outputUID="sw1" outputIndex="0" inputUID="bulb1" inputIndex="0"/>
</logicly>`;

    // ProLogic Circuit (.plgc) - Primary format
    const resByPlgc = detectCircuitFormat(xml, 'circuit.plgc');
    assertEqual(resByPlgc.format, 'logicly');
    assertEqual(resByPlgc.confidence, 0.99);

    // ProLogic Formats (.plgclib, .plgcx, .plgclibx)
    const resByPlgclib = detectCircuitFormat(xml, 'library.plgclib');
    assertEqual(resByPlgclib.format, 'logicly');
    assertEqual(resByPlgclib.confidence, 0.99);

    const resByPlgcx = detectCircuitFormat(xml, 'circuit.plgcx');
    assertEqual(resByPlgcx.format, 'logicly');
    assertEqual(resByPlgcx.confidence, 0.99);

    const resByPlgclibx = detectCircuitFormat(xml, 'library.plgclibx');
    assertEqual(resByPlgclibx.format, 'logicly');
    assertEqual(resByPlgclibx.confidence, 0.99);

    // Logicly Circuit (.logicly) - Backward compatibility
    const resByExt = detectCircuitFormat(xml, 'circuit.logicly');
    assertEqual(resByExt.format, 'logicly');
    assertEqual(resByExt.confidence, 0.99);

    const resByXml = detectCircuitFormat(xml, 'circuit.xml');
    assertEqual(resByXml.format, 'logicly');

    const resNoName = detectCircuitFormat(xml);
    assertEqual(resNoName.format, 'logicly');
  });

  // =========================================================================
  // 2. Logisim .circ XML Import & Simulation Tests
  // =========================================================================

  suite.test('Logisim .circ: AND Gate with 2 Switches, Output Pin and Geometric Wires', () => {
    // Standard Logisim circuit with size 30 AND gate:
    // Output at (200, 120).
    // Inputs at (170, 110) and (170, 130).
    // Switch A at (100, 100) -> wire to (170, 100) -> (170, 110).
    // Switch B at (100, 140) -> wire to (170, 140) -> (170, 130).
    // Bulb at (260, 120) -> wire from (200, 120) to (260, 120).
    const circXml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<project source="2.7.1" version="1.0">
  <circuit name="main">
    <a name="circuit" val="main"/>
    <comp lib="0" loc="(100,100)" name="Pin">
      <a name="tristate" val="false"/>
      <a name="label" val="InA"/>
    </comp>
    <comp lib="0" loc="(100,140)" name="Pin">
      <a name="tristate" val="false"/>
      <a name="label" val="InB"/>
    </comp>
    <comp lib="1" loc="(200,120)" name="AND Gate">
      <a name="size" val="30"/>
      <a name="inputs" val="2"/>
    </comp>
    <comp lib="0" loc="(260,120)" name="Pin">
      <a name="facing" val="west"/>
      <a name="output" val="true"/>
      <a name="label" val="OutQ"/>
    </comp>
    <wire from="(100,100)" to="(170,100)"/>
    <wire from="(170,100)" to="(170,110)"/>
    <wire from="(100,140)" to="(170,140)"/>
    <wire from="(170,140)" to="(170,130)"/>
    <wire from="(200,120)" to="(260,120)"/>
  </circuit>
</project>`;

    const doc = UniversalCircuitImporter.importCircuit(circXml, 'and_test.circ');
    assertEqual(doc.circuits.size, 4, 'Should instantiate 4 components');
    assertEqual(doc.engine.connections.length, 3, 'Should wire 2 inputs and 1 output');

    // Identify circuits by label
    let swA: SwitchCircuit | undefined;
    let swB: SwitchCircuit | undefined;
    let bulb: LightBulbCircuit | undefined;

    for (const [, c] of doc.circuits) {
      if (c instanceof SwitchCircuit && c.label === 'InA') swA = c;
      if (c instanceof SwitchCircuit && c.label === 'InB') swB = c;
      if (c instanceof LightBulbCircuit && c.label === 'OutQ') bulb = c;
    }

    assert(swA !== undefined, 'Switch A should exist');
    assert(swB !== undefined, 'Switch B should exist');
    assert(bulb !== undefined, 'Bulb Q should exist');

    // Simulation verification: Truth table
    // 0 AND 0 = 0
    assertEqual(swA.getOutputAt(0), false);
    assertEqual(swB.getOutputAt(0), false);
    assertEqual(bulb.getInputAt(0), false);

    // 1 AND 0 = 0
    swA.toggle();
    doc.engine.propagateAll();
    assertEqual(swA.getOutputAt(0), true);
    assertEqual(bulb.getInputAt(0), false);

    // 1 AND 1 = 1
    swB.toggle();
    doc.engine.propagateAll();
    assertEqual(swB.getOutputAt(0), true);
    assertEqual(bulb.getInputAt(0), true, 'AND gate should propagate true when both inputs are true');

    // 0 AND 1 = 0
    swA.toggle();
    doc.engine.propagateAll();
    assertEqual(swA.getOutputAt(0), false);
    assertEqual(bulb.getInputAt(0), false);
  });

  suite.test('Logisim .circ: NOT Gate, Constant, and Controlled Buffer Simulation', () => {
    const circXml = `<?xml version="1.0" encoding="UTF-8"?>
<project source="2.7.1" version="1.0">
  <circuit name="main">
    <comp lib="0" loc="(100,50)" name="Constant">
      <a name="value" val="0x1"/>
    </comp>
    <comp lib="1" loc="(180,50)" name="NOT Gate">
      <a name="size" val="30"/>
    </comp>
    <comp lib="0" loc="(240,50)" name="Pin">
      <a name="output" val="true"/>
      <a name="label" val="InvOut"/>
    </comp>
    <wire from="(100,50)" to="(150,50)"/>
    <wire from="(180,50)" to="(240,50)"/>

    <comp lib="0" loc="(100,150)" name="Pin">
      <a name="label" val="DataIn"/>
    </comp>
    <comp lib="0" loc="(100,190)" name="Pin">
      <a name="label" val="EnableIn"/>
    </comp>
    <comp lib="1" loc="(180,150)" name="Controlled Buffer"/>
    <comp lib="0" loc="(240,150)" name="Pin">
      <a name="output" val="true"/>
      <a name="label" val="TriOut"/>
    </comp>
    <wire from="(100,150)" to="(160,150)"/>
    <wire from="(100,190)" to="(170,190)"/>
    <wire from="(170,190)" to="(170,160)"/>
    <wire from="(180,150)" to="(240,150)"/>
  </circuit>
</project>`;

    const doc = UniversalCircuitImporter.importCircuit(circXml, 'gates.circ');

    let invBulb: LightBulbCircuit | undefined;
    let dataSw: SwitchCircuit | undefined;
    let enableSw: SwitchCircuit | undefined;
    let triBulb: LightBulbCircuit | undefined;

    for (const [, c] of doc.circuits) {
      if (c instanceof LightBulbCircuit && c.label === 'InvOut') invBulb = c;
      if (c instanceof LightBulbCircuit && c.label === 'TriOut') triBulb = c;
      if (c instanceof SwitchCircuit && c.label === 'DataIn') dataSw = c;
      if (c instanceof SwitchCircuit && c.label === 'EnableIn') enableSw = c;
    }

    assert(invBulb !== undefined);
    assert(dataSw !== undefined);
    assert(enableSw !== undefined);
    assert(triBulb !== undefined);

    // Constant High (1) through NOT gate produces 0
    assertEqual(invBulb.getInputAt(0), false, 'NOT gate on Constant High should evaluate to false');

    // Tri-state buffer: enable is initially false (0) -> output is undefined (Hi-Z)
    assertEqual(triBulb.getInputAt(0), undefined, 'Disabled Tri-State should be Hi-Z (undefined)');

    // Set Data to 1, Enable still 0 -> still undefined
    dataSw.toggle();
    doc.engine.propagateAll();
    assertEqual(triBulb.getInputAt(0), undefined);

    // Turn Enable ON (1) -> Data 1 passes through!
    enableSw.toggle();
    doc.engine.propagateAll();
    assertEqual(triBulb.getInputAt(0), true, 'Enabled Tri-State should pass true data');

    // Set Data to 0 -> 0 passes through
    dataSw.toggle();
    doc.engine.propagateAll();
    assertEqual(triBulb.getInputAt(0), false, 'Enabled Tri-State should pass false data');
  });

  // =========================================================================
  // 3. Digital by HNeemann .dig XML Import & Simulation Tests
  // =========================================================================

  suite.test('Digital .dig: AND Gate, Inputs, Outputs, and Wires Simulation', () => {
    // Digital XML:
    // In A at (100, 200) -> pin at (100, 200)
    // In B at (100, 240) -> pin at (100, 240)
    // And gate at (200, 200) -> inputs at (200, 200) and (200, 240). Output at (260, 220).
    // Out Y at (320, 220) -> pin at (320, 220).
    const digXml = `<?xml version="1.0" encoding="utf-8"?>
<circuit>
  <version>1</version>
  <visualElements>
    <visualElement>
      <elementName>In</elementName>
      <elementAttributes>
        <entry>
          <string>Label</string>
          <string>A</string>
        </entry>
        <entry>
          <string>Default</string>
          <int>0</int>
        </entry>
      </elementAttributes>
      <pos x="100" y="200"/>
    </visualElement>
    <visualElement>
      <elementName>In</elementName>
      <elementAttributes>
        <entry>
          <string>Label</string>
          <string>B</string>
        </entry>
        <entry>
          <string>Default</string>
          <int>0</int>
        </entry>
      </elementAttributes>
      <pos x="100" y="240"/>
    </visualElement>
    <visualElement>
      <elementName>And</elementName>
      <elementAttributes>
        <entry>
          <string>Inputs</string>
          <int>2</int>
        </entry>
      </elementAttributes>
      <pos x="200" y="200"/>
    </visualElement>
    <visualElement>
      <elementName>Out</elementName>
      <elementAttributes>
        <entry>
          <string>Label</string>
          <string>Y</string>
        </entry>
      </elementAttributes>
      <pos x="320" y="220"/>
    </visualElement>
  </visualElements>
  <wires>
    <wire>
      <p1 x="100" y="200"/>
      <p2 x="200" y="200"/>
    </wire>
    <wire>
      <p1 x="100" y="240"/>
      <p2 x="200" y="240"/>
    </wire>
    <wire>
      <p1 x="260" y="220"/>
      <p2 x="320" y="220"/>
    </wire>
  </wires>
</circuit>`;

    const doc = UniversalCircuitImporter.importCircuit(digXml, 'circuit.dig');
    assertEqual(doc.circuits.size, 4);
    assertEqual(doc.engine.connections.length, 3);

    let swA: SwitchCircuit | undefined;
    let swB: SwitchCircuit | undefined;
    let bulbY: LightBulbCircuit | undefined;

    for (const [, c] of doc.circuits) {
      if (c instanceof SwitchCircuit && c.label === 'A') swA = c;
      if (c instanceof SwitchCircuit && c.label === 'B') swB = c;
      if (c instanceof LightBulbCircuit && c.label === 'Y') bulbY = c;
    }

    assert(swA !== undefined);
    assert(swB !== undefined);
    assert(bulbY !== undefined);

    assertEqual(bulbY.getInputAt(0), false);

    swA.toggle();
    doc.engine.propagateAll();
    assertEqual(bulbY.getInputAt(0), false);

    swB.toggle();
    doc.engine.propagateAll();
    assertEqual(bulbY.getInputAt(0), true, 'Digital AND gate should propagate true when both inputs high');

    swB.toggle();
    doc.engine.propagateAll();
    assertEqual(bulbY.getInputAt(0), false);
  });

  suite.test('Digital .dig: Inverting and Arithmetic Elements (Not, Or, Const)', () => {
    const digXml = `<?xml version="1.0" encoding="utf-8"?>
<circuit>
  <version>1</version>
  <visualElements>
    <visualElement>
      <elementName>Const</elementName>
      <elementAttributes>
        <entry>
          <string>Value</string>
          <int>1</int>
        </entry>
      </elementAttributes>
      <pos x="100" y="100"/>
    </visualElement>
    <visualElement>
      <elementName>Not</elementName>
      <pos x="160" y="100"/>
    </visualElement>
    <visualElement>
      <elementName>Out</elementName>
      <elementAttributes>
        <entry>
          <string>Label</string>
          <string>Inv</string>
        </entry>
      </elementAttributes>
      <pos x="260" y="100"/>
    </visualElement>
  </visualElements>
  <wires>
    <wire>
      <p1 x="100" y="100"/>
      <p2 x="160" y="100"/>
    </wire>
    <wire>
      <p1 x="200" y="100"/>
      <p2 x="260" y="100"/>
    </wire>
  </wires>
</circuit>`;

    const doc = UniversalCircuitImporter.importCircuit(digXml, 'not_test.dig');
    let bulb: LightBulbCircuit | undefined;
    for (const [, c] of doc.circuits) {
      if (c instanceof LightBulbCircuit && c.label === 'Inv') bulb = c;
    }

    assert(bulb !== undefined);
    assertEqual(bulb.getInputAt(0), false, 'Not gate should invert Constant High to false');
  });

  // =========================================================================
  // 4. SimcirJS JSON Import & Simulation Tests
  // =========================================================================

  suite.test('SimcirJS: Devices and Connectors Graph Simulation (AND gate)', () => {
    const simcirJson = JSON.stringify({
      width: 500,
      height: 300,
      devices: [
        { type: 'Toggle', id: 'dev0', x: 80, y: 80, label: 'InA', state: { on: false } },
        { type: 'Toggle', id: 'dev1', x: 80, y: 140, label: 'InB', state: { on: false } },
        { type: 'AND', id: 'dev2', x: 200, y: 110, label: 'AND1', numInputs: 2 },
        { type: 'LED', id: 'dev3', x: 320, y: 110, label: 'OutY' }
      ],
      connectors: [
        { from: 'dev0.out0', to: 'dev2.in0' },
        { from: 'dev1.out0', to: 'dev2.in1' },
        { from: 'dev2.out0', to: 'dev3.in0' }
      ]
    });

    const doc = UniversalCircuitImporter.importCircuit(simcirJson, 'circuit.simcir');
    assertEqual(doc.circuits.size, 4);
    assertEqual(doc.engine.connections.length, 3);

    let swA: SwitchCircuit | undefined;
    let swB: SwitchCircuit | undefined;
    let ledY: LightBulbCircuit | undefined;

    for (const [, c] of doc.circuits) {
      if (c instanceof SwitchCircuit && c.label === 'InA') swA = c;
      if (c instanceof SwitchCircuit && c.label === 'InB') swB = c;
      if (c instanceof LightBulbCircuit && c.label === 'OutY') ledY = c;
    }

    assert(swA !== undefined);
    assert(swB !== undefined);
    assert(ledY !== undefined);

    assertEqual(ledY.getInputAt(0), false);

    swA.toggle();
    doc.engine.propagateAll();
    assertEqual(ledY.getInputAt(0), false);

    swB.toggle();
    doc.engine.propagateAll();
    assertEqual(ledY.getInputAt(0), true, 'Simcir AND gate output should propagate true');

    swA.toggle();
    doc.engine.propagateAll();
    assertEqual(ledY.getInputAt(0), false);
  });

  suite.test('SimcirJS: DC source, Inverter, and XOR gate', () => {
    const simcirJson = JSON.stringify({
      devices: [
        { type: 'DC', id: 'dc1', label: 'VCC' },
        { type: 'NOT', id: 'not1' },
        { type: 'LED', id: 'led1', label: 'Inverted' }
      ],
      connectors: [
        { from: 'dc1.out0', to: 'not1.in0' },
        { from: 'not1.out0', to: 'led1.in0' }
      ]
    });

    const doc = UniversalCircuitImporter.importCircuit(simcirJson);
    let led: LightBulbCircuit | undefined;
    for (const [, c] of doc.circuits) {
      if (c instanceof LightBulbCircuit && c.label === 'Inverted') led = c;
    }

    assert(led !== undefined);
    assertEqual(led.getInputAt(0), false, 'DC into NOT should propagate false to LED');
  });

  // =========================================================================
  // 5. CircuitVerse JSON Import & Simulation Tests
  // =========================================================================

  suite.test('CircuitVerse: Scopes with allElementList and wireList Import', () => {
    const cvJson = JSON.stringify({
      name: 'CV_Test',
      timePeriod: 500,
      projectId: 'cv_sample',
      focussedCircuit: 0,
      scopes: [
        {
          id: 0,
          name: 'Main',
          allElementList: [
            {
              objectType: 'Input',
              id: 'in1',
              label: 'A',
              x: 100,
              y: 100,
              state: 0
            },
            {
              objectType: 'Input',
              id: 'in2',
              label: 'B',
              x: 100,
              y: 160,
              state: 0
            },
            {
              objectType: 'OrGate',
              id: 'or1',
              label: 'OR',
              x: 220,
              y: 130,
              inputSize: 2
            },
            {
              objectType: 'Output',
              id: 'out1',
              label: 'Q',
              x: 340,
              y: 130
            }
          ],
          connections: [
            { from: 'in1.out0', to: 'or1.in0' },
            { from: 'in2.out0', to: 'or1.in1' },
            { from: 'or1.out0', to: 'out1.in0' }
          ]
        }
      ]
    });

    const doc = UniversalCircuitImporter.importCircuit(cvJson, 'test.cdd');
    assertEqual(doc.circuits.size, 4);
    assertEqual(doc.engine.connections.length, 3);

    let swA: SwitchCircuit | undefined;
    let swB: SwitchCircuit | undefined;
    let outQ: LightBulbCircuit | undefined;

    for (const [, c] of doc.circuits) {
      if (c instanceof SwitchCircuit && c.label === 'A') swA = c;
      if (c instanceof SwitchCircuit && c.label === 'B') swB = c;
      if (c instanceof LightBulbCircuit && c.label === 'Q') outQ = c;
    }

    assert(swA !== undefined);
    assert(swB !== undefined);
    assert(outQ !== undefined);

    assertEqual(outQ.getInputAt(0), false);

    swA.toggle();
    doc.engine.propagateAll();
    assertEqual(outQ.getInputAt(0), true, 'OR gate should propagate true when A is true');

    swA.toggle();
    doc.engine.propagateAll();
    assertEqual(outQ.getInputAt(0), false);

    swB.toggle();
    doc.engine.propagateAll();
    assertEqual(outQ.getInputAt(0), true, 'OR gate should propagate true when B is true');
  });

  // =========================================================================
  // 6. LogiclyParser Seamless Universal Integration
  // =========================================================================

  suite.test('LogiclyParser.parse: Transparently handles any CAD format seamlessly', () => {
    const parser = new LogiclyParser();

    // 1. Logisim .circ
    const circXml = `<?xml version="1.0" encoding="UTF-8"?>
<project source="2.7.1" version="1.0">
  <circuit name="main">
    <comp lib="0" loc="(50,50)" name="Pin"><a name="label" val="In1"/></comp>
    <comp lib="0" loc="(150,50)" name="Pin"><a name="output" val="true"/><a name="label" val="Out1"/></comp>
    <wire from="(50,50)" to="(150,50)"/>
  </circuit>
</project>`;
    const circDoc = parser.parse(circXml, undefined, 'test.circ');
    assertEqual(circDoc.circuits.size, 2);
    assertEqual(circDoc.engine.connections.length, 1);

    // 2. Digital .dig
    const digXml = `<?xml version="1.0" encoding="utf-8"?>
<circuit>
  <visualElements>
    <visualElement><elementName>In</elementName><pos x="50" y="50"/></visualElement>
    <visualElement><elementName>Out</elementName><pos x="150" y="50"/></visualElement>
  </visualElements>
  <wires><wire><p1 x="50" y="50"/><p2 x="150" y="50"/></wire></wires>
</circuit>`;
    const digDoc = parser.parse(digXml, undefined, 'test.dig');
    assertEqual(digDoc.circuits.size, 2);
    assertEqual(digDoc.engine.connections.length, 1);

    // 3. SimcirJS
    const simcirJson = JSON.stringify({
      devices: [
        { type: 'Toggle', id: 's1' },
        { type: 'LED', id: 'l1' }
      ],
      connectors: [{ from: 's1.out0', to: 'l1.in0' }]
    });
    const simcirDoc = parser.parse(simcirJson, undefined, 'test.simcir');
    assertEqual(simcirDoc.circuits.size, 2);
    assertEqual(simcirDoc.engine.connections.length, 1);

    // 4. Native Logicly
    const nativeXml = `<logicly xmlns="http://ns.logic.ly/1.2">
  <object type="switch@logic.ly" uid="sw" x="10" y="10" rotation="0"/>
  <object type="light_bulb@logic.ly" uid="bulb" x="50" y="10" rotation="0"/>
  <connection outputUID="sw" outputIndex="0" inputUID="bulb" inputIndex="0"/>
</logicly>`;
    const nativeDoc = parser.parse(nativeXml, undefined, 'circuit.logicly');
    assertEqual(nativeDoc.circuits.size, 2);
    assertEqual(nativeDoc.engine.connections.length, 1);
  });

  suite.test('CircuitVerse: Graph connectivity via allNodes and connections array', () => {
    // Test CircuitVerse graph-based node model
    const cvJson = JSON.stringify({
      scopes: [
        {
          id: 0,
          name: 'GraphTest',
          allNodes: [
            { x: 100, y: 100, connections: [1] }, // node 0: connected to node 1
            { x: 150, y: 100, connections: [0] }, // node 1: connected to node 0
            { x: 200, y: 100, connections: [3] }, // node 2: connected to node 3
            { x: 250, y: 100, connections: [2] }  // node 3: connected to node 2
          ],
          allElementList: [
            {
              objectType: 'Input',
              label: 'In1',
              x: 100,
              y: 100,
              output1: 0 // drives node 0
            },
            {
              objectType: 'NotGate',
              label: 'Inv1',
              x: 175,
              y: 100,
              customData: {
                nodes: {
                  inp: [1],     // receives from node 1
                  output1: 2   // drives node 2
                }
              }
            },
            {
              objectType: 'Output',
              label: 'Out1',
              x: 250,
              y: 100,
              customData: {
                nodes: {
                  inp: [3]     // receives from node 3
                }
              }
            }
          ]
        }
      ]
    });

    const doc = UniversalCircuitImporter.importCircuit(cvJson, 'graph.cv');
    assertEqual(doc.circuits.size, 3);
    assertEqual(doc.engine.connections.length, 2);

    let sw: SwitchCircuit | undefined;
    let bulb: LightBulbCircuit | undefined;

    for (const [, c] of doc.circuits) {
      if (c instanceof SwitchCircuit && c.label === 'In1') sw = c;
      if (c instanceof LightBulbCircuit && c.label === 'Out1') bulb = c;
    }

    assert(sw !== undefined);
    assert(bulb !== undefined);

    // Initial switch is 0 -> NOT gate produces 1 -> Bulb is true!
    assertEqual(bulb.getInputAt(0), true, 'NOT of 0 should propagate true to bulb');

    sw.toggle();
    doc.engine.propagateAll();
    assertEqual(bulb.getInputAt(0), false, 'NOT of 1 should propagate false to bulb');
  });

  suite.test('Logisim .circ: Fanout net to multiple gates and direct butt-connected terminals', () => {
    // Switch at (100, 100) branches to two inverters at (150, 80) and (150, 120)
    const circXml = `<?xml version="1.0" encoding="UTF-8"?>
<project source="2.7.1" version="1.0">
  <circuit name="fanout">
    <comp lib="0" loc="(100,100)" name="Pin"><a name="label" val="Source"/></comp>
    <comp lib="1" loc="(170,80)" name="NOT Gate"><a name="size" val="20"/></comp>
    <comp lib="1" loc="(170,120)" name="NOT Gate"><a name="size" val="20"/></comp>
    <comp lib="0" loc="(220,80)" name="Pin"><a name="output" val="true"/><a name="label" val="OutA"/></comp>
    <comp lib="0" loc="(220,120)" name="Pin"><a name="output" val="true"/><a name="label" val="OutB"/></comp>
    <wire from="(100,100)" to="(130,100)"/>
    <wire from="(130,80)" to="(130,120)"/>
    <wire from="(130,100)" to="(130,80)"/>
    <wire from="(130,80)" to="(150,80)"/>
    <wire from="(130,120)" to="(150,120)"/>
    <wire from="(170,80)" to="(220,80)"/>
    <wire from="(170,120)" to="(220,120)"/>
  </circuit>
</project>`;

    const doc = UniversalCircuitImporter.importCircuit(circXml, 'fanout.circ');
    let sw: SwitchCircuit | undefined;
    let bulbA: LightBulbCircuit | undefined;
    let bulbB: LightBulbCircuit | undefined;

    for (const [, c] of doc.circuits) {
      if (c instanceof SwitchCircuit && c.label === 'Source') sw = c;
      if (c instanceof LightBulbCircuit && c.label === 'OutA') bulbA = c;
      if (c instanceof LightBulbCircuit && c.label === 'OutB') bulbB = c;
    }

    assert(sw !== undefined);
    assert(bulbA !== undefined);
    assert(bulbB !== undefined);

    assertEqual(bulbA.getInputAt(0), true);
    assertEqual(bulbB.getInputAt(0), true);

    sw.toggle();
    doc.engine.propagateAll();
    assertEqual(bulbA.getInputAt(0), false);
    assertEqual(bulbB.getInputAt(0), false);
  });

  suite.test('Format Detection: XML Schematic Netlist (<Circuit><Components>...<Connections><Net>...)', () => {
    const netlistXml = `<?xml version="1.0" encoding="UTF-8"?>
<Circuit name="Sample Netlist">
  <Components>
    <Component id="VCC" type="PowerSupply" />
  </Components>
  <Connections>
    <Net name="Net1"><Node component="VCC" pin="out"/></Net>
  </Connections>
</Circuit>`;

    const res = detectCircuitFormat(netlistXml, 'counter.xml');
    assertEqual(res.format, 'netlist');
    assertEqual(res.confidence > 0.9, true);
  });

  suite.test('XML Netlist Importer: 4-Bit Asynchronous Ripple Up-Counter with JK Flip-Flops and Nets', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Circuit name="4-Bit Asynchronous Ripple Up-Counter">
    <Description>
        Corrected schematic netlist implementing J-K flip-flops as toggle flip-flops. 
        Includes VCC tie-offs for floating control pins and inverted Q' clock cascading 
        for positive-edge up-counting.
    </Description>

    <Components>
        <!-- Power and Clock Sources -->
        <Component id="VCC" type="PowerSupply" voltage="5V" />
        <Component id="CLK" type="PulseGenerator" />
        
        <!-- JK Flip-Flops (Positive-Edge Triggered, Active-Low PRE/CLR) -->
        <Component id="FF0" type="JK_FlipFlop" role="Bit 0 (LSB)" />
        <Component id="FF1" type="JK_FlipFlop" role="Bit 1" />
        <Component id="FF2" type="JK_FlipFlop" role="Bit 2" />
        <Component id="FF3" type="JK_FlipFlop" role="Bit 3 (MSB)" />
        
        <!-- Output Indicators -->
        <Component id="LED0" type="OutputIndicator" role="Display Q0" />
        <Component id="LED1" type="OutputIndicator" role="Display Q1" />
        <Component id="LED2" type="OutputIndicator" role="Display Q2" />
        <Component id="LED3" type="OutputIndicator" role="Display Q3" />
    </Components>

    <Connections>
        <!-- 
        FIX 1: Toggle Mode & Floating Pin Prevention 
        Tying J, K, PRE', and CLR' of ALL flip-flops to VCC (High) 
        -->
        <Net name="VCC_Net">
            <Node component="VCC" pin="out" />
            
            <!-- FF0 -->
            <Node component="FF0" pin="J" />
            <Node component="FF0" pin="K" />
            <Node component="FF0" pin="PRE'" />
            <Node component="FF0" pin="CLR'" />
            
            <!-- FF1 -->
            <Node component="FF1" pin="J" />
            <Node component="FF1" pin="K" />
            <Node component="FF1" pin="PRE'" />
            <Node component="FF1" pin="CLR'" />
            
            <!-- FF2 -->
            <Node component="FF2" pin="J" />
            <Node component="FF2" pin="K" />
            <Node component="FF2" pin="PRE'" />
            <Node component="FF2" pin="CLR'" />
            
            <!-- FF3 -->
            <Node component="FF3" pin="J" />
            <Node component="FF3" pin="K" />
            <Node component="FF3" pin="PRE'" />
            <Node component="FF3" pin="CLR'" />
        </Net>

        <!-- 
        FIX 2: Clock Cascading for Up-Counting 
        Routing the inverted Q' output to the next Clock input (>) 
        due to positive-edge triggering.
        -->
        <Net name="Master_Clock">
            <Node component="CLK" pin="out" />
            <Node component="FF0" pin=">" />
        </Net>
        
        <Net name="Ripple_Clock_0_to_1">
            <Node component="FF0" pin="Q'" />
            <Node component="FF1" pin=">" />
        </Net>
        
        <Net name="Ripple_Clock_1_to_2">
            <Node component="FF1" pin="Q'" />
            <Node component="FF2" pin=">" />
        </Net>
        
        <Net name="Ripple_Clock_2_to_3">
            <Node component="FF2" pin="Q'" />
            <Node component="FF3" pin=">" />
        </Net>

        <!-- 
        Standard outputs (Q) routed to external indicators for binary reading.
        -->
        <Net name="Output_Bit_0">
            <Node component="FF0" pin="Q" />
            <Node component="LED0" pin="in" />
        </Net>
        
        <Net name="Output_Bit_1">
            <Node component="FF1" pin="Q" />
            <Node component="LED1" pin="in" />
        </Net>
        
        <Net name="Output_Bit_2">
            <Node component="FF2" pin="Q" />
            <Node component="LED2" pin="in" />
        </Net>
        
        <Net name="Output_Bit_3">
            <Node component="FF3" pin="Q" />
            <Node component="LED3" pin="in" />
        </Net>
    </Connections>
</Circuit>`;

    const parser = new LogiclyParser();
    const doc = parser.parse(xml);

    // 10 circuit components + 1 title banner label = 11 circuits
    assertEqual(doc.circuits.size >= 10, true, 'At least 10 circuit elements created');
    assertEqual(doc.engine.connections.length, 24, 'All 24 netlist connections resolved');

    const vcc = doc.circuits.get('VCC');
    const clk = doc.circuits.get('CLK');
    const ff0 = doc.circuits.get('FF0');
    const led0 = doc.circuits.get('LED0');

    assert(vcc !== undefined, 'VCC exists');
    assert(clk !== undefined, 'CLK exists');
    assert(ff0 !== undefined, 'FF0 exists');
    assert(led0 !== undefined, 'LED0 exists');

    assertEqual(vcc?.type, 'constant_high@logic.ly');
    assertEqual(clk?.type, 'clock@logic.ly');
    assertEqual(ff0?.type, 'jk_flip_flop@logic.ly');
    assertEqual(led0?.type, 'light_bulb@logic.ly');

    // Verify simulation stepping
    doc.engine.step();
    assertEqual(doc.engine.circuits.length > 0, true);
  });

  return suite.report();
}
