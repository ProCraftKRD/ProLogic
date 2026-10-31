import { TestSuite, assertEqual, assert } from './runner';
import { createDefaultParser } from '../simulation/registry';
import { decompressLogiclyData, compressLogiclyData, isXmlData, prepareFileContent } from '../io/compression';
import { BusCircuit } from '../simulation/circuits/gates';
import { ComplexCircuit } from '../simulation/circuits/complex';
import { SwitchCircuit } from '../simulation/circuits/controls';
import { LightBulbCircuit } from '../simulation/circuits/outputs';
import {
  FIXTURE_65_XML,
  FIXTURE_67_XML,
  FIXTURE_68_XML,
  FIXTURE_65_BIN_BUFFER,
  FIXTURE_67_BIN_BUFFER,
  FIXTURE_68_BIN_BUFFER
} from './fixtures';

export function runParserTests(): boolean {
  const suite = new TestSuite('Logicly XML Document Parser & Interoperability');
  console.log('--- Running Logicly Document Parser Tests ---');

  const parser = createDefaultParser();

  suite.test('Parse extracted D-Latch sample circuit (data_id_65_decompressed.xml)', () => {
    const xmlContent = FIXTURE_65_XML;
    const doc = parser.parse(xmlContent);

    // Verify parsed structure
    assert(doc.circuits.size === 10, `Expected 10 components, got ${doc.circuits.size}`);
    assert(doc.engine.connections.length === 11, `Expected 11 connections, got ${doc.engine.connections.length}`);

    // Verify roundtrip serialization
    const serialized = parser.serialize(doc);
    assert(serialized.includes('xmlns="http://ns.logic.ly/1.2"'), 'Serialized XML includes Logicly namespace');
    assert(serialized.includes('type="nor@logic.ly"'), 'Serialized XML includes nor gates');
    assert(serialized.includes('type="clock@logic.ly"'), 'Serialized XML includes clock');

    // Parse back the serialized XML
    const roundtripDoc = parser.parse(serialized);
    assertEqual(roundtripDoc.circuits.size, doc.circuits.size, 'Roundtrip circuit count preserved');
    assertEqual(roundtripDoc.engine.connections.length, doc.engine.connections.length, 'Roundtrip connection count preserved');
  });

  suite.test('Parse extracted 4-Bit Counter sample circuit (data_id_67_decompressed.xml)', () => {
    const xmlContent = FIXTURE_67_XML;
    const doc = parser.parse(xmlContent);

    assert(doc.circuits.size >= 12, '4-Bit Counter components loaded');
    assert(doc.engine.connections.length >= 14, '4-Bit Counter connections wired');
  });

  suite.test('Parse authentic extracted 1-bit Full Adder sample circuit (data_id_68_decompressed.xml)', () => {
    const xmlContent = FIXTURE_68_XML;
    const doc = parser.parse(xmlContent);

    assertEqual(doc.circuits.size, 15, 'Full adder has 15 components (3 switches, 5 gates, 2 bulbs, 5 labels)');
    assertEqual(doc.engine.connections.length, 12, 'Full adder has 12 connections');
  });

  // =========================================================================
  // Raw Deflate Binary Decompression & Parsing Tests (.logicly / .logiclylib)
  // =========================================================================

  suite.test('Decompress and parse raw deflate sample binary: data_id_65.bin (D-Latch)', () => {
    const rawBuffer = FIXTURE_65_BIN_BUFFER;
    assertEqual(isXmlData(rawBuffer), false, 'data_id_65.bin is binary compressed, not plain XML');

    const result = decompressLogiclyData(rawBuffer);
    assertEqual(result.isCompressed, true, 'Detected as compressed binary');
    assertEqual(result.method, 'deflate-raw', 'Decompressed using raw deflate');
    assert(result.xml.includes('<logicly xmlns="http://ns.logic.ly/1.0">'), 'Contains Logicly XML header');

    const doc = parser.parse(result.xml);
    assertEqual(doc.circuits.size, 10, 'Parsed 10 circuits from raw deflate file');
    assertEqual(doc.engine.connections.length, 11, 'Parsed 11 connections from raw deflate file');
  });

  suite.test('Decompress and parse raw deflate sample binary: data_id_67.bin (Counter/Display)', () => {
    const rawBuffer = FIXTURE_67_BIN_BUFFER;
    assertEqual(isXmlData(rawBuffer), false, 'data_id_67.bin is binary compressed');

    const result = decompressLogiclyData(rawBuffer);
    assertEqual(result.isCompressed, true, 'Decompressed successfully');
    assertEqual(result.method, 'deflate-raw');
    assert(result.xml.includes('BE147EA9-C373-F6B2-5F44-CA3E35DE9FCD'), 'Contains expected component UID');

    const doc = parser.parse(result.xml);
    assert(doc.circuits.size >= 12, 'Circuits loaded from data_id_67.bin');
    assert(doc.engine.connections.length >= 14, 'Connections loaded from data_id_67.bin');
  });

  suite.test('Decompress and parse raw deflate sample binary: data_id_68.bin (Full Adder)', () => {
    const rawBuffer = FIXTURE_68_BIN_BUFFER;
    const result = decompressLogiclyData(rawBuffer);
    assertEqual(result.isCompressed, true);
    assertEqual(result.method, 'deflate-raw');
    assert(result.xml.includes('CFE57C55-1F1C-9EF2-DE7B-5A4A234D7A8D'), 'Contains switch UID');

    const doc = parser.parse(result.xml);
    assertEqual(doc.circuits.size, 15, 'Full adder circuit contains 15 components');
    assertEqual(doc.engine.connections.length, 12, 'Full adder circuit contains 12 connections');

    // Roundtrip test: compress -> decompress -> parse
    const recompressed = compressLogiclyData(result.xml);
    const roundtrip = decompressLogiclyData(recompressed);
    const roundtripDoc = parser.parse(roundtrip.xml);
    assertEqual(roundtripDoc.circuits.size, 15, 'Roundtrip compressed binary preserves circuits');
  });

  suite.test('File content preparation handles .plgc, .logicly and .xml extensions accurately', () => {
    const sampleXml = '<logicly xmlns="http://ns.logic.ly/1.2"><object type="buffer@logic.ly" uid="b1"/></logicly>';

    // .plgc should be compressed (native ProLogic format)
    const plgcBuf = prepareFileContent('circuit.plgc', sampleXml);
    assertEqual(isXmlData(plgcBuf), false, 'Saved .plgc file is compressed binary');
    const decompPlgc = decompressLogiclyData(plgcBuf);
    assertEqual(decompPlgc.isCompressed, true);
    assertEqual(decompPlgc.xml, sampleXml);

    // .plgclib should be compressed (native ProLogic IC Library format)
    const plgclibBuf = prepareFileContent('library.plgclib', sampleXml);
    assertEqual(isXmlData(plgclibBuf), false, 'Saved .plgclib file is compressed binary');
    const decompPlgclib = decompressLogiclyData(plgclibBuf);
    assertEqual(decompPlgclib.isCompressed, true);
    assertEqual(decompPlgclib.xml, sampleXml);

    // .plgcx should be uncompressed (native ProLogic uncompressed circuit)
    const plgcxBuf = prepareFileContent('circuit.plgcx', sampleXml);
    assertEqual(isXmlData(plgcxBuf), true, 'Saved .plgcx file is plain text XML');
    assertEqual(plgcxBuf.toString('utf-8'), sampleXml);

    // .plgclibx should be uncompressed (native ProLogic uncompressed library)
    const plgclibxBuf = prepareFileContent('library.plgclibx', sampleXml);
    assertEqual(isXmlData(plgclibxBuf), true, 'Saved .plgclibx file is plain text XML');
    assertEqual(plgclibxBuf.toString('utf-8'), sampleXml);

    // .logicly should be compressed (backward compatibility)
    const logiclyBuf = prepareFileContent('circuit.logicly', sampleXml);
    assertEqual(isXmlData(logiclyBuf), false, 'Saved .logicly file is compressed binary');
    const decompLogicly = decompressLogiclyData(logiclyBuf);
    assertEqual(decompLogicly.isCompressed, true);
    assertEqual(decompLogicly.xml, sampleXml);

    // .logiclylib should be compressed
    const libBuf = prepareFileContent('custom.logiclylib', sampleXml);
    assertEqual(isXmlData(libBuf), false, 'Saved .logiclylib file is compressed binary');

    // .xml should be uncompressed
    const xmlBuf = prepareFileContent('circuit.xml', sampleXml);
    assertEqual(isXmlData(xmlBuf), true, 'Saved .xml file is plain text XML');
    assertEqual(xmlBuf.toString('utf-8'), sampleXml);

    // .logiclyx should be uncompressed
    const logiclyxBuf = prepareFileContent('circuit.logiclyx', sampleXml);
    assertEqual(isXmlData(logiclyxBuf), true, 'Saved .logiclyx file is plain text XML');
  });

  // =========================================================================
  // Library Documents (.logiclylib) & Custom Packages Tests
  // =========================================================================

  const sampleLibraryXml = `<logicly xmlns="http://ns.logic.ly/library/1.3">
  <custom type="half_adder@demo" name="Half Adder IC" label="HA">
    <object type="switch@logic.ly" uid="sw_a" x="50" y="50" rotation="0" exportName="A"/>
    <object type="switch@logic.ly" uid="sw_b" x="50" y="150" rotation="0" exportName="B"/>
    <object type="xor@logic.ly" uid="xor_gate" x="200" y="50" rotation="0"/>
    <object type="and@logic.ly" uid="and_gate" x="200" y="150" rotation="0"/>
    <object type="light_bulb@logic.ly" uid="bulb_sum" x="350" y="50" rotation="0" exportName="Sum"/>
    <object type="light_bulb@logic.ly" uid="bulb_cout" x="350" y="150" rotation="0" exportName="Cout"/>
    <connection outputUID="sw_a" outputIndex="0" inputUID="xor_gate" inputIndex="0"/>
    <connection outputUID="sw_b" outputIndex="0" inputUID="xor_gate" inputIndex="1"/>
    <connection outputUID="sw_a" outputIndex="0" inputUID="and_gate" inputIndex="0"/>
    <connection outputUID="sw_b" outputIndex="0" inputUID="and_gate" inputIndex="1"/>
    <connection outputUID="xor_gate" outputIndex="0" inputUID="bulb_sum" inputIndex="0"/>
    <connection outputUID="and_gate" outputIndex="0" inputUID="bulb_cout" inputIndex="0"/>
    <location id="left" uids="sw_a,sw_b"/>
    <location id="right" uids="bulb_sum,bulb_cout"/>
  </custom>
</logicly>`;

  suite.test('Detect and parse Logicly library XML documents', () => {
    assertEqual(parser.isLibrary(sampleLibraryXml), true, 'Recognized as library document');
    assertEqual(parser.isLibrary('<logicly xmlns="http://ns.logic.ly/1.2"><object/></logicly>'), false, 'Circuit doc is not library');

    const packages = parser.parseLibrary(sampleLibraryXml);
    assertEqual(packages.length, 1, 'Extracted 1 custom package from library');
    assertEqual(packages[0].type, 'half_adder@demo');
    assertEqual(packages[0].name, 'Half Adder IC');
    assertEqual(packages[0].label, 'HA');
    assert(packages[0].xml.includes('half_adder@demo') === false, 'Inner circuit is pure circuit XML');
    assert(packages[0].xml.includes('exportName="Sum"'), 'Inner circuit retains pin metadata');

    // Verify it was registered in parser templates
    assert(parser.customTemplates.has('half_adder@demo'), 'Custom template registered into parser');

    // Instantiate custom IC from the library
    const haInstance = parser.createCircuitInstance('half_adder@demo', 'ha_1') as ComplexCircuit;
    assert(haInstance !== null, 'Custom IC instantiated successfully');
    assertEqual(haInstance.type, 'half_adder@demo');
    assertEqual(haInstance.inputsCount, 2, 'Half adder IC has 2 inputs');
    assertEqual(haInstance.outputsCount, 2, 'Half adder IC has 2 outputs');
    assertEqual(haInstance.label, 'HA', 'Chip symbol label matches');

    // Test simulation through custom IC
    // A=0, B=0 -> Sum=0, Cout=0
    haInstance.setInputAt(0, false);
    haInstance.setInputAt(1, false);
    assertEqual(haInstance.getOutputAt(0), false, '0 + 0: Sum is false');
    assertEqual(haInstance.getOutputAt(1), false, '0 + 0: Cout is false');

    // A=1, B=0 -> Sum=1, Cout=0
    haInstance.setInputAt(0, true);
    haInstance.setInputAt(1, false);
    assertEqual(haInstance.getOutputAt(0), true, '1 + 0: Sum is true');
    assertEqual(haInstance.getOutputAt(1), false, '1 + 0: Cout is false');

    // A=1, B=1 -> Sum=0, Cout=1
    haInstance.setInputAt(0, true);
    haInstance.setInputAt(1, true);
    assertEqual(haInstance.getOutputAt(0), false, '1 + 1: Sum is false');
    assertEqual(haInstance.getOutputAt(1), true, '1 + 1: Cout is true');

    // Serialize library
    const serializedLib = parser.serializeLibrary(packages);
    assert(serializedLib.includes('xmlns="http://ns.logic.ly/library/1.3"'), 'Library namespace preserved');
    assert(serializedLib.includes('type="half_adder@demo"'), 'Custom type preserved');
  });

  // =========================================================================
  // Project Documents with Embedded Custom ICs & Bus Circuits
  // =========================================================================

  suite.test('Parse circuit document with embedded <custom> templates and custom instances', () => {
    const projectXmlWithCustom = `<logicly xmlns="http://ns.logic.ly/1.2">
  <custom type="custom_xor@proj" name="Custom XOR Gate" label="XOR">
    <object type="switch@logic.ly" uid="sw_x" exportName="In1"/>
    <object type="switch@logic.ly" uid="sw_y" exportName="In2"/>
    <object type="xor@logic.ly" uid="x_core"/>
    <object type="light_bulb@logic.ly" uid="bulb_out" exportName="Out"/>
    <connection outputUID="sw_x" outputIndex="0" inputUID="x_core" inputIndex="0"/>
    <connection outputUID="sw_y" outputIndex="0" inputUID="x_core" inputIndex="1"/>
    <connection outputUID="x_core" outputIndex="0" inputUID="bulb_out" inputIndex="0"/>
    <location id="left" uids="sw_x,sw_y"/>
    <location id="right" uids="bulb_out"/>
  </custom>
  <object type="switch@logic.ly" uid="sw_main_1" x="100" y="100" outputs="true"/>
  <object type="switch@logic.ly" uid="sw_main_2" x="100" y="200" outputs="false"/>
  <object type="custom_xor@proj" uid="ic_inst" x="300" y="150"/>
  <object type="light_bulb@logic.ly" uid="bulb_main" x="500" y="150"/>
  <connection outputUID="sw_main_1" outputIndex="0" inputUID="ic_inst" inputIndex="0"/>
  <connection outputUID="sw_main_2" outputIndex="0" inputUID="ic_inst" inputIndex="1"/>
  <connection outputUID="ic_inst" outputIndex="0" inputUID="bulb_main" inputIndex="0"/>
</logicly>`;

    const doc = parser.parse(projectXmlWithCustom);
    assertEqual(doc.circuits.size, 4, 'Parsed 4 top-level circuits');
    assertEqual(doc.engine.connections.length, 3, 'Parsed 3 top-level connections');

    const customInstance = doc.circuits.get('ic_inst');
    assert(customInstance !== undefined, 'Custom IC instance found');
    assertEqual(customInstance!.type, 'custom_xor@proj');

    // Verify propagation through custom IC
    const mainBulb = doc.circuits.get('bulb_main') as LightBulbCircuit;
    assertEqual(mainBulb.state, true, '1 XOR 0 propagates true to output bulb through custom IC');

    // Test serialization with embedded custom templates
    const serialized = parser.serialize(doc, { includeCustomTemplates: true });
    assert(serialized.includes('<custom'), 'Serialized document includes <custom> element');
    assert(serialized.includes('type="custom_xor@proj"'), 'Custom type defined in serialized XML');
    assert(serialized.includes('type="switch@logic.ly"'), 'Contains top-level switch');

    // Roundtrip parse
    const roundtripDoc = parser.parse(serialized);
    assertEqual(roundtripDoc.circuits.size, 4, 'Roundtrip preserves 4 circuits');
  });

  suite.test('Bus Circuit: Handle bus@logic.ly and bus aliases with tri-state contention resolution', () => {
    // 1. Creation by alias 'bus@logic.ly'
    const bus1 = parser.createCircuitInstance('bus@logic.ly', 'bus_1', { inputs: 4 }) as BusCircuit;
    assert(bus1 !== null, 'Created BusCircuit via bus@logic.ly');
    assertEqual(bus1.inputsCount, 4, 'Default inputs is 4');
    assertEqual(bus1.outputsCount, 1, 'Bus has 1 output');
    assertEqual(bus1.label, 'BUS', 'Bus has BUS label');

    // 2. Creation by alias 'bus'
    const bus2 = parser.createCircuitInstance('bus', 'bus_2', { inputs: 8 }) as BusCircuit;
    assert(bus2 !== null, 'Created BusCircuit via bus');
    assertEqual(bus2.inputsCount, 8, 'Specified inputs count is 8');

    // 3. Tri-state bus resolution logic
    // Floating bus (all undefined) -> undefined
    assertEqual(bus1.getOutputAt(0), undefined, 'Floating bus outputs undefined');

    // Single active driver (driver 1 is true) -> true
    bus1.setInputAt(1, true);
    assertEqual(bus1.getOutputAt(0), true, 'Single active driver true passes through');

    // Single active driver (driver 1 changes to false) -> false
    bus1.setInputAt(1, false);
    assertEqual(bus1.getOutputAt(0), false, 'Single active driver false passes through');

    // Two active drivers agreeing (driver 1 false, driver 2 false) -> false
    bus1.setInputAt(2, false);
    assertEqual(bus1.getOutputAt(0), false, 'Matching drivers pass through');

    // Bus contention (driver 1 false, driver 2 true) -> undefined
    bus1.setInputAt(2, true);
    assertEqual(bus1.getOutputAt(0), undefined, 'Conflicting drivers produce bus contention (undefined)');

    // Contention resolved by releasing driver 2 back to undefined (High-Z)
    bus1.setInputAt(2, undefined);
    assertEqual(bus1.getOutputAt(0), false, 'Releasing driver restores clean signal');
  });

  suite.test('Handle both rs_flip_flop@logic.ly and sr_flip_flop@logic.ly aliases', () => {
    const rs = parser.createCircuitInstance('rs_flip_flop@logic.ly', 'test_rs');
    assert(rs !== null, 'rs_flip_flop@logic.ly instantiated');
    assertEqual(rs!.type, 'rs_flip_flop@logic.ly');
    assertEqual((rs as any).inputsCount, 3, 'RS-FF has 3 inputs (S, >, R)');
    assertEqual((rs as any).outputsCount, 2, 'RS-FF has 2 outputs (Q, Q\')');

    const sr = parser.createCircuitInstance('sr_flip_flop@logic.ly', 'test_sr');
    assert(sr !== null, 'sr_flip_flop@logic.ly instantiated');
    assertEqual(sr!.type, 'sr_flip_flop@logic.ly');
    assertEqual((sr as any).inputsCount, 3, 'SR-FF has 3 inputs (S, >, R)');
    assertEqual((sr as any).outputsCount, 2, 'SR-FF has 2 outputs (Q, Q\')');
  });

  // =========================================================================
  // Standard Flip-Flop Component Coverage Tests
  // =========================================================================

  suite.test('Instantiate and verify built-in D Flip-Flop subcircuit IC', () => {
    const dff = parser.createCircuitInstance('d_flip_flop@logic.ly', 'test-dff');
    assert(dff !== null, 'D Flip-Flop instance created');
    assertEqual(dff!.type, 'd_flip_flop@logic.ly');
    const inputCircuit = dff as any;
    assertEqual(inputCircuit.inputsCount, 4, 'D Flip-Flop has 4 inputs');
    assertEqual(inputCircuit.outputsCount, 2, 'D Flip-Flop has 2 outputs (Q, Q\')');
  });

  suite.test('Instantiate and verify built-in JK Flip-Flop subcircuit IC', () => {
    const jk = parser.createCircuitInstance('jk_flip_flop@logic.ly', 'test-jk');
    assert(jk !== null, 'JK Flip-Flop instance created');
    const inputCircuit = jk as any;
    assertEqual(inputCircuit.inputsCount, 5, 'JK Flip-Flop has 5 inputs (J, >, K, PRE\', CLR\')');
    assertEqual(inputCircuit.outputsCount, 2, 'JK Flip-Flop has 2 outputs');
  });

  suite.test('Instantiate and verify built-in T Flip-Flop subcircuit IC', () => {
    const tff = parser.createCircuitInstance('t_flip_flop@logic.ly', 'test-tff');
    assert(tff !== null, 'T Flip-Flop instance created');
    const inputCircuit = tff as any;
    assertEqual(inputCircuit.inputsCount, 4, 'T Flip-Flop has 4 inputs (T, >, PRE\', CLR\')');
    assertEqual(inputCircuit.outputsCount, 2, 'T Flip-Flop has 2 outputs');
  });

  suite.test('Package and instantiate custom IC from template', () => {
    const templateXml = `<logicly xmlns="http://ns.logic.ly/1.2">
      <object type="switch@logic.ly" uid="sw1" x="50" y="50" rotation="0" exportName="In1"/>
      <object type="not@logic.ly" uid="not1" x="150" y="50" rotation="0"/>
      <object type="light_bulb@logic.ly" uid="bulb1" x="250" y="50" rotation="0" exportName="Out1"/>
      <connection outputUID="sw1" outputIndex="0" inputUID="not1" inputIndex="0"/>
      <connection outputUID="not1" outputIndex="0" inputUID="bulb1" inputIndex="0"/>
    </logicly>`;
    parser.registerCustomTemplate('custom_inv@logic.ly', templateXml, { name: 'Inverter IC', label: 'INV' });
    const ic = parser.createCircuitInstance('custom_inv@logic.ly', 'my-ic');
    assert(ic !== null, 'Custom IC instantiated');
    assertEqual(ic!.type, 'custom_inv@logic.ly');
    assertEqual(ic!.label, 'INV');
    const complex = ic as any;
    assertEqual(complex.inputsCount, 1);
    assertEqual(complex.outputsCount, 1);
    assertEqual(complex.getInputExportNameAt(0), 'In1');
    assertEqual(complex.getOutputExportNameAt(0), 'Out1');

    // Test propagation through custom IC
    complex.setInputAt(0, true);
    assertEqual(complex.getOutputAt(0), false);
    complex.setInputAt(0, false);
    assertEqual(complex.getOutputAt(0), true);
  });

  suite.test('Unregister custom template cleanly removes template and metadata', () => {
    const testParser = createDefaultParser();
    const typeId = 'temp_ic@logic.ly';
    const xml = `<logicly xmlns="http://ns.logic.ly/1.2"><object type="buffer@logic.ly" uid="b1" x="0" y="0"/></logicly>`;
    
    testParser.registerCustomTemplate(typeId, xml, { name: 'Temporary IC', label: 'TMP' });
    assertEqual(testParser.customTemplates.has(typeId), true);
    assertEqual(testParser.getCustomTemplate(typeId), xml);
    assertEqual(testParser.getCustomMetadata(typeId)?.name, 'Temporary IC');
    assertEqual(testParser.getCustomMetadata(typeId)?.label, 'TMP');

    // Unregister template
    const result = testParser.unregisterCustomTemplate(typeId);
    assertEqual(result, true, 'unregisterCustomTemplate returned true');
    assertEqual(testParser.customTemplates.has(typeId), false, 'Template deleted from customTemplates');
    assertEqual(testParser.getCustomTemplate(typeId), undefined);
    assertEqual(testParser.customMetadata.has(typeId), false, 'Metadata deleted from customMetadata');
    assertEqual(testParser.getCustomMetadata(typeId), undefined);

    // Unregistering again returns false
    const secondResult = testParser.unregisterCustomTemplate(typeId);
    assertEqual(secondResult, false, 'Unregistering non-existent template returns false');
  });

  suite.test('Normalize component type aliases (PascalCase, snake_case, EDA symbols)', () => {
    const testParser = createDefaultParser();
    assertEqual(testParser.normalizeComponentType('HighConstant'), 'constant_high@logic.ly');
    assertEqual(testParser.normalizeComponentType('LowConstant'), 'constant_low@logic.ly');
    assertEqual(testParser.normalizeComponentType('Clock'), 'clock@logic.ly');
    assertEqual(testParser.normalizeComponentType('JK_Flip_Flop'), 'jk_flip_flop@logic.ly');
    assertEqual(testParser.normalizeComponentType('D_Flip_Flop'), 'd_flip_flop@logic.ly');
    assertEqual(testParser.normalizeComponentType('T_Flip_Flop'), 't_flip_flop@logic.ly');
    assertEqual(testParser.normalizeComponentType('Light_Bulb'), 'light_bulb@logic.ly');
    assertEqual(testParser.normalizeComponentType('Toggle_Switch'), 'switch@logic.ly');
    assertEqual(testParser.normalizeComponentType('Push_Button'), 'push_button@logic.ly');
    assertEqual(testParser.normalizeComponentType('And_Gate'), 'and@logic.ly');
    assertEqual(testParser.normalizeComponentType('VCC'), 'constant_high@logic.ly');
    assertEqual(testParser.normalizeComponentType('GND'), 'constant_low@logic.ly');
  });

  suite.test('Parse JK FlipFlop.xml with PascalCase/underscore types and verify 24 connections', () => {
    const testParser = createDefaultParser();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<logicly xmlns="http://ns.logic.ly/">
    <object type="HighConstant" uid="vcc" x="50" y="100" />
    <object type="Clock" uid="clk" x="50" y="300" />
    <object type="JK_Flip_Flop" uid="ff0" x="200" y="250" />
    <object type="JK_Flip_Flop" uid="ff1" x="400" y="250" />
    <object type="JK_Flip_Flop" uid="ff2" x="600" y="250" />
    <object type="JK_Flip_Flop" uid="ff3" x="800" y="250" />
    <object type="Light_Bulb" uid="led0" x="300" y="400" />
    <object type="Light_Bulb" uid="led1" x="500" y="400" />
    <object type="Light_Bulb" uid="led2" x="700" y="400" />
    <object type="Light_Bulb" uid="led3" x="900" y="400" />
    <connection outputUID="vcc" outputIndex="0" inputUID="ff0" inputIndex="0" />
    <connection outputUID="vcc" outputIndex="0" inputUID="ff0" inputIndex="2" />
    <connection outputUID="vcc" outputIndex="0" inputUID="ff0" inputIndex="3" />
    <connection outputUID="vcc" outputIndex="0" inputUID="ff0" inputIndex="4" />
    <connection outputUID="vcc" outputIndex="0" inputUID="ff1" inputIndex="0" />
    <connection outputUID="vcc" outputIndex="0" inputUID="ff1" inputIndex="2" />
    <connection outputUID="vcc" outputIndex="0" inputUID="ff1" inputIndex="3" />
    <connection outputUID="vcc" outputIndex="0" inputUID="ff1" inputIndex="4" />
    <connection outputUID="vcc" outputIndex="0" inputUID="ff2" inputIndex="0" />
    <connection outputUID="vcc" outputIndex="0" inputUID="ff2" inputIndex="2" />
    <connection outputUID="vcc" outputIndex="0" inputUID="ff2" inputIndex="3" />
    <connection outputUID="vcc" outputIndex="0" inputUID="ff2" inputIndex="4" />
    <connection outputUID="vcc" outputIndex="0" inputUID="ff3" inputIndex="0" />
    <connection outputUID="vcc" outputIndex="0" inputUID="ff3" inputIndex="2" />
    <connection outputUID="vcc" outputIndex="0" inputUID="ff3" inputIndex="3" />
    <connection outputUID="vcc" outputIndex="0" inputUID="ff3" inputIndex="4" />
    <connection outputUID="clk" outputIndex="0" inputUID="ff0" inputIndex="1" />
    <connection outputUID="ff0" outputIndex="1" inputUID="ff1" inputIndex="1" />
    <connection outputUID="ff1" outputIndex="1" inputUID="ff2" inputIndex="1" />
    <connection outputUID="ff2" outputIndex="1" inputUID="ff3" inputIndex="1" />
    <connection outputUID="ff0" outputIndex="0" inputUID="led0" inputIndex="0" />
    <connection outputUID="ff1" outputIndex="0" inputUID="led1" inputIndex="0" />
    <connection outputUID="ff2" outputIndex="0" inputUID="led2" inputIndex="0" />
    <connection outputUID="ff3" outputIndex="0" inputUID="led3" inputIndex="0" />
</logicly>`;

    const doc = testParser.parse(xml);
    assertEqual(doc.circuits.size, 10, 'Expected 10 instantiated components');
    assertEqual(doc.engine.connections.length, 24, 'Expected 24 connections');
    assertEqual(doc.circuits.get('vcc')?.type, 'constant_high@logic.ly');
    assertEqual(doc.circuits.get('clk')?.type, 'clock@logic.ly');
    assertEqual(doc.circuits.get('ff0')?.type, 'jk_flip_flop@logic.ly');
    assertEqual(doc.circuits.get('led0')?.type, 'light_bulb@logic.ly');

    // Verify simulation stepping runs smoothly without throwing
    doc.engine.step();
    assertEqual(doc.engine.circuits.length > 0, true);
  });

  suite.test('Throws descriptive error when all components in an XML are unrecognized', () => {
    const testParser = createDefaultParser();
    const badXml = `<logicly xmlns="http://ns.logic.ly/">
      <object type="CompletelyUnknownWidget123" uid="u1" x="0" y="0" />
      <object type="NonExistentType456" uid="u2" x="100" y="0" />
    </logicly>`;

    let threw = false;
    try {
      testParser.parse(badXml);
    } catch (e: any) {
      threw = true;
      assertEqual(e.message.includes('Unrecognized component types'), true);
      assertEqual(e.message.includes('CompletelyUnknownWidget123'), true);
    }
    assertEqual(threw, true, 'Expected parser to throw on unrecognized components');
  });

  suite.test('Logicly Compatibility: Serialized XML has no XML declaration and starts directly with <logicly', () => {
    const testParser = createDefaultParser();
    const { SAMPLE_CIRCUITS } = require('../ui/samples');
    const doc = testParser.parse(SAMPLE_CIRCUITS['4-Bit JK Ripple Counter']);
    const serialized = testParser.serialize(doc);

    assertEqual(serialized.startsWith('<?xml'), false, 'Serialized XML must NOT have <?xml declaration');
    assertEqual(serialized.startsWith('<logicly'), true, 'Serialized XML must start directly with <logicly');
  });

  suite.test('Logicly Compatibility: Flip-flops, digits, bulbs, and switches never serialize @_inputs attribute', () => {
    const testParser = createDefaultParser();
    const { SAMPLE_CIRCUITS } = require('../ui/samples');
    const doc = testParser.parse(SAMPLE_CIRCUITS['4-Bit JK Ripple Counter']);
    const serialized = testParser.serialize(doc);

    // Verify flip-flop objects have NO inputs= attribute
    const lines = serialized.split('\n');
    for (const line of lines) {
      if (
        line.includes('type="jk_flip_flop@logic.ly"') ||
        line.includes('type="t_flip_flop@logic.ly"') ||
        line.includes('type="d_flip_flop@logic.ly"') ||
        line.includes('type="digit@logic.ly"') ||
        line.includes('type="light_bulb@logic.ly"') ||
        line.includes('type="switch@logic.ly"')
      ) {
        assertEqual(line.includes('inputs='), false, `Object line must not contain inputs= attribute: ${line}`);
      }
    }
  });

  suite.test('Logicly Compatibility: Connection waypoints serialized as @_points attribute and parsed accurately', () => {
    const testParser = createDefaultParser();
    const { SwitchCircuit } = require('../simulation/circuits/controls');
    const { LightBulbCircuit } = require('../simulation/circuits/outputs');
    const { SimulationEngine } = require('../simulation/engine');

    const engine = new SimulationEngine();
    const sw = new SwitchCircuit(false, 'sw1');
    const bulb = new LightBulbCircuit('bulb1');
    engine.registerCircuit(sw);
    engine.registerCircuit(bulb);

    const waypoints = [
      { x: 120, y: 150 },
      { x: 200, y: 150 },
      { x: 200, y: 220 }
    ];
    engine.connect(sw, 0, bulb, 0, waypoints);

    const circuits = new Map();
    circuits.set('sw1', sw);
    circuits.set('bulb1', bulb);
    const metadata = new Map();
    metadata.set('sw1', { x: 50, y: 150, rotation: 0 });
    metadata.set('bulb1', { x: 300, y: 220, rotation: 0 });

    const serialized = testParser.serialize({
      engine,
      circuits,
      metadata,
      locations: { left: [], right: [], top: [], bottom: [] }
    });

    assertEqual(serialized.includes('points="120,150,200,150,200,220"'), true, 'Waypoints serialized as points attribute');

    // Parse back and verify waypoints are restored
    const parsedDoc = testParser.parse(serialized);
    const parsedConn = parsedDoc.engine.connections[0];
    assertEqual(parsedConn.points?.length, 3, 'Restored 3 waypoints');
    assertEqual(parsedConn.points?.[0].x, 120, 'First waypoint x=120');
    assertEqual(parsedConn.points?.[0].y, 150, 'First waypoint y=150');
    assertEqual(parsedConn.points?.[2].x, 200, 'Last waypoint x=200');
    assertEqual(parsedConn.points?.[2].y, 220, 'Last waypoint y=220');
  });

  suite.test('Logicly Compatibility: XOR/XNOR functionIndex and Switch outputs serialization/parsing', () => {
    const testParser = createDefaultParser();
    const { XORGateCircuit, XNORGateCircuit } = require('../simulation/circuits/gates');
    const { SwitchCircuit } = require('../simulation/circuits/controls');
    const { SimulationEngine } = require('../simulation/engine');

    const engine = new SimulationEngine();
    const xorDef = new XORGateCircuit(2, 'xor0', 0);
    const xorStrict = new XORGateCircuit(3, 'xor1', 1);
    const xnorDef = new XNORGateCircuit(2, 'xnor0', 0);
    const xnorStrict = new XNORGateCircuit(3, 'xnor1', 1);
    const swLow = new SwitchCircuit(false, 'swLow');
    const swHigh = new SwitchCircuit(true, 'swHigh');

    engine.registerCircuit(xorDef);
    engine.registerCircuit(xorStrict);
    engine.registerCircuit(xnorDef);
    engine.registerCircuit(xnorStrict);
    engine.registerCircuit(swLow);
    engine.registerCircuit(swHigh);

    const circuits = new Map();
    circuits.set('xor0', xorDef);
    circuits.set('xor1', xorStrict);
    circuits.set('xnor0', xnorDef);
    circuits.set('xnor1', xnorStrict);
    circuits.set('swLow', swLow);
    circuits.set('swHigh', swHigh);

    const metadata = new Map();
    metadata.set('xor0', { x: 0, y: 0, rotation: 0 });
    metadata.set('xor1', { x: 50, y: 0, rotation: 0 });
    metadata.set('xnor0', { x: 100, y: 0, rotation: 0 });
    metadata.set('xnor1', { x: 150, y: 0, rotation: 0 });
    metadata.set('swLow', { x: 200, y: 0, rotation: 0 });
    metadata.set('swHigh', { x: 250, y: 0, rotation: 0 });

    const serialized = testParser.serialize({
      engine,
      circuits,
      metadata,
      locations: { left: [], right: [], top: [], bottom: [] }
    });

    // Default mode (0) should omit functionIndex
    assert(!serialized.includes('uid="xor0" x="0" y="0" rotation="0" functionIndex'), 'xor0 omits functionIndex');
    assert(!serialized.includes('uid="xnor0" x="100" y="0" rotation="0" functionIndex'), 'xnor0 omits functionIndex');

    // Strict mode (1) should serialize functionIndex="1"
    assert(serialized.includes('functionIndex="1"'), 'strict mode serializes functionIndex="1"');
    assert(serialized.includes('outputs="false"'), 'swLow serializes outputs="false"');
    assert(serialized.includes('outputs="true"'), 'swHigh serializes outputs="true"');

    // Parse back
    const doc = testParser.parse(serialized);
    const parsedXor0 = doc.circuits.get('xor0') as any;
    const parsedXor1 = doc.circuits.get('xor1') as any;
    const parsedXnor0 = doc.circuits.get('xnor0') as any;
    const parsedXnor1 = doc.circuits.get('xnor1') as any;
    const parsedSwLow = doc.circuits.get('swLow') as any;
    const parsedSwHigh = doc.circuits.get('swHigh') as any;

    assertEqual(parsedXor0.functionIndex, 0, 'xor0 parsed functionIndex is 0');
    assertEqual(parsedXor1.functionIndex, 1, 'xor1 parsed functionIndex is 1');
    assertEqual(parsedXnor0.functionIndex, 0, 'xnor0 parsed functionIndex is 0');
    assertEqual(parsedXnor1.functionIndex, 1, 'xnor1 parsed functionIndex is 1');

    assertEqual(parsedSwLow.state, false, 'swLow parsed state is false');
    assertEqual(parsedSwLow.defaultState, false, 'swLow parsed defaultState is false');
    assertEqual(parsedSwHigh.state, true, 'swHigh parsed state is true');
    assertEqual(parsedSwHigh.defaultState, true, 'swHigh parsed defaultState is true');
  });

  suite.test('SR Flip-Flop: Unified SR FLIP FLOP display and SymbolRenderer verification', () => {
    const testParser = createDefaultParser();
    const { SymbolRenderer } = require('../ui/canvas/symbolRenderer');
    const { COMPONENT_CATALOG } = require('../simulation/registry');

    // Check catalog registration
    const catalogItem = COMPONENT_CATALOG.find((c: any) => c.name === 'SR Flip-Flop');
    assert(catalogItem !== undefined, 'SR Flip-Flop exists in COMPONENT_CATALOG');
    assertEqual(catalogItem!.type, 'sr_flip_flop@logic.ly');

    // Parse both sr and legacy rs flip-flops
    const srXml = `<logicly xmlns="http://ns.logic.ly/1.0">
      <object type="sr_flip_flop@logic.ly" uid="sr1" x="50" y="50" rotation="0"/>
      <object type="rs_flip_flop@logic.ly" uid="rs1" x="200" y="50" rotation="0"/>
    </logicly>`;

    const doc = testParser.parse(srXml);
    const sr1 = doc.circuits.get('sr1')!;
    const rs1 = doc.circuits.get('rs1')!;

    assertEqual(sr1.label, 'SR FLIP FLOP', 'sr1 label is SR FLIP FLOP');
    assertEqual(rs1.label, 'SR FLIP FLOP', 'rs1 label is SR FLIP FLOP');

    const renderSr = SymbolRenderer.renderComponent(sr1, true);
    const renderRs = SymbolRenderer.renderComponent(rs1, true);

    assert(renderSr.svgContent.includes('SR FLIP FLOP'), 'Rendered SR FF SVG contains "SR FLIP FLOP"');
    assert(renderRs.svgContent.includes('SR FLIP FLOP'), 'Rendered legacy RS FF SVG contains "SR FLIP FLOP"');
    assert(!renderRs.svgContent.includes('RS FLIP FLOP'), 'Rendered SVG does NOT contain "RS FLIP FLOP"');
  });

  return suite.report();
}
