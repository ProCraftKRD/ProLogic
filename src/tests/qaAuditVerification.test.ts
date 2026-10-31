import { TestSuite, assertEqual, assert } from './runner';
import * as ops from '../simulation/operations';
import { XORGateCircuit, XNORGateCircuit, NOTGateCircuit, ANDGateCircuit } from '../simulation/circuits/gates';
import { SwitchCircuit, PushButtonCircuit } from '../simulation/circuits/controls';
import { LightBulbCircuit } from '../simulation/circuits/outputs';
import { ComplexCircuit } from '../simulation/circuits/complex';
import { SimulationEngine } from '../simulation/engine';
import { createDefaultParser } from '../simulation/registry';
import { COMPONENT_CATALOG } from '../simulation/registry';
import { SymbolRenderer } from '../ui/canvas/symbolRenderer';
import { BUILTIN_IC_TEMPLATES } from '../simulation/templates';
import { LogicValue } from '../simulation/types';

export function runQAAuditVerificationTests(): boolean {
  const suite = new TestSuite('QA Audit: Comprehensive Feature & Defect Verification');
  console.log('--- Running QA Audit Verification Tests ---');

  // =========================================================================
  // 1. XOR & XNOR Truth Tables (2-input, 3-input, 4-input)
  // =========================================================================

  suite.test('XOR & XNOR 2-Input Exhaustive Truth Table (Parity & Strict Modes)', () => {
    const inputs2: [boolean, boolean][] = [
      [false, false],
      [false, true],
      [true, false],
      [true, true]
    ];

    // For 2 inputs: Mode 0 (parity) and Mode 1 (strict) MUST be 100% identical.
    // XOR: (0,0)->F, (0,1)->T, (1,0)->T, (1,1)->F
    const expectedXOR = [false, true, true, false];
    // XNOR: (0,0)->T, (0,1)->F, (1,0)->F, (1,1)->T
    const expectedXNOR = [true, false, false, true];

    const xorGate0 = new XORGateCircuit(2, 'xor0', 0);
    const xorGate1 = new XORGateCircuit(2, 'xor1', 1);
    const xnorGate0 = new XNORGateCircuit(2, 'xnor0', 0);
    const xnorGate1 = new XNORGateCircuit(2, 'xnor1', 1);

    for (let i = 0; i < inputs2.length; i++) {
      const [a, b] = inputs2[i];

      // Direct Operations
      assertEqual(ops.xor(a, b), expectedXOR[i], `ops.xor 2-in [${a}, ${b}]`);
      assertEqual(ops.xor2(a, b), expectedXOR[i], `ops.xor2 2-in [${a}, ${b}]`);
      assertEqual(ops.xnor(a, b), expectedXNOR[i], `ops.xnor 2-in [${a}, ${b}]`);
      assertEqual(ops.xnor2(a, b), expectedXNOR[i], `ops.xnor2 2-in [${a}, ${b}]`);

      // Circuit Instances
      xorGate0.setInputAt(0, a);
      xorGate0.setInputAt(1, b);
      assertEqual(xorGate0.getOutputAt(0), expectedXOR[i], `XOR circuit mode 0 [${a}, ${b}]`);

      xorGate1.setInputAt(0, a);
      xorGate1.setInputAt(1, b);
      assertEqual(xorGate1.getOutputAt(0), expectedXOR[i], `XOR circuit mode 1 [${a}, ${b}]`);

      xnorGate0.setInputAt(0, a);
      xnorGate0.setInputAt(1, b);
      assertEqual(xnorGate0.getOutputAt(0), expectedXNOR[i], `XNOR circuit mode 0 [${a}, ${b}]`);

      xnorGate1.setInputAt(0, a);
      xnorGate1.setInputAt(1, b);
      assertEqual(xnorGate1.getOutputAt(0), expectedXNOR[i], `XNOR circuit mode 1 [${a}, ${b}]`);
    }
  });

  suite.test('XOR & XNOR 3-Input Exhaustive Truth Table (All 8 Combinations)', () => {
    const inputs3: [boolean, boolean, boolean][] = [
      [false, false, false], // 0 high, 3 low
      [false, false, true],  // 1 high, 2 low
      [false, true, false],  // 1 high, 2 low
      [false, true, true],   // 2 high, 1 low
      [true, false, false],  // 1 high, 2 low
      [true, false, true],   // 2 high, 1 low
      [true, true, false],   // 2 high, 1 low
      [true, true, true]    // 3 high, 0 low
    ];

    const xorGate0 = new XORGateCircuit(3, 'xor3_0', 0);
    const xorGate1 = new XORGateCircuit(3, 'xor3_1', 1);
    const xnorGate0 = new XNORGateCircuit(3, 'xnor3_0', 0);
    const xnorGate1 = new XNORGateCircuit(3, 'xnor3_1', 1);

    for (const [a, b, c] of inputs3) {
      const highCount = (a ? 1 : 0) + (b ? 1 : 0) + (c ? 1 : 0);
      const lowCount = 3 - highCount;

      // Mode 0: Parity
      // XOR: Odd number of inputs are high (1 or 3 high)
      const expectedXorParity = highCount % 2 === 1;
      // XNOR: Odd number of inputs are low (1 or 3 low) -> equivalent to not(XOR parity)
      const expectedXnorParity = lowCount % 2 === 1;

      // Mode 1: Strict
      // XOR: Exactly one input is high
      const expectedXorStrict = highCount === 1;
      // XNOR: Exactly one input is low / not(strict XOR)
      const expectedXnorStrict = !expectedXorStrict;

      // Direct Operations
      assertEqual(ops.xor(a, b, c), expectedXorParity, `ops.xor 3-in parity [${a},${b},${c}]`);
      assertEqual(ops.xor2(a, b, c), expectedXorStrict, `ops.xor2 3-in strict [${a},${b},${c}]`);
      assertEqual(ops.xnor(a, b, c), expectedXnorParity, `ops.xnor 3-in parity [${a},${b},${c}]`);
      assertEqual(ops.xnor2(a, b, c), expectedXnorStrict, `ops.xnor2 3-in strict [${a},${b},${c}]`);

      // Circuit Instances
      xorGate0.setInputAt(0, a);
      xorGate0.setInputAt(1, b);
      xorGate0.setInputAt(2, c);
      assertEqual(xorGate0.getOutputAt(0), expectedXorParity, `XOR circuit 3-in mode 0`);

      xorGate1.setInputAt(0, a);
      xorGate1.setInputAt(1, b);
      xorGate1.setInputAt(2, c);
      assertEqual(xorGate1.getOutputAt(0), expectedXorStrict, `XOR circuit 3-in mode 1`);

      xnorGate0.setInputAt(0, a);
      xnorGate0.setInputAt(1, b);
      xnorGate0.setInputAt(2, c);
      assertEqual(xnorGate0.getOutputAt(0), expectedXnorParity, `XNOR circuit 3-in mode 0`);

      xnorGate1.setInputAt(0, a);
      xnorGate1.setInputAt(1, b);
      xnorGate1.setInputAt(2, c);
      assertEqual(xnorGate1.getOutputAt(0), expectedXnorStrict, `XNOR circuit 3-in mode 1`);
    }

    // Specific divergence check for (true, true, true):
    assertEqual(ops.xor(true, true, true), true, 'XOR parity(1,1,1) is true (3 is odd)');
    assertEqual(ops.xor2(true, true, true), false, 'XOR strict(1,1,1) is false (3 != 1)');
    assertEqual(ops.xnor(true, true, true), false, 'XNOR parity(1,1,1) is false (0 lows is even)');
    assertEqual(ops.xnor2(true, true, true), true, 'XNOR strict(1,1,1) is true (not exactly one true)');
  });

  suite.test('XOR & XNOR 4-Input Exhaustive Truth Table (All 16 Combinations)', () => {
    const xorGate0 = new XORGateCircuit(4, 'xor4_0', 0);
    const xorGate1 = new XORGateCircuit(4, 'xor4_1', 1);
    const xnorGate0 = new XNORGateCircuit(4, 'xnor4_0', 0);
    const xnorGate1 = new XNORGateCircuit(4, 'xnor4_1', 1);

    for (let i = 0; i < 16; i++) {
      const a = (i & 8) !== 0;
      const b = (i & 4) !== 0;
      const c = (i & 2) !== 0;
      const d = (i & 1) !== 0;

      const highCount = (a ? 1 : 0) + (b ? 1 : 0) + (c ? 1 : 0) + (d ? 1 : 0);

      // Mode 0: Parity (odd number of highs for XOR; even number of highs for XNOR)
      const expectedXorParity = highCount % 2 === 1;
      const expectedXnorParity = !expectedXorParity;

      // Mode 1: Strict (exactly one high for XOR; not exactly one high for XNOR)
      const expectedXorStrict = highCount === 1;
      const expectedXnorStrict = !expectedXorStrict;

      assertEqual(ops.xor(a, b, c, d), expectedXorParity, `ops.xor 4-in #${i}`);
      assertEqual(ops.xor2(a, b, c, d), expectedXorStrict, `ops.xor2 4-in #${i}`);
      assertEqual(ops.xnor(a, b, c, d), expectedXnorParity, `ops.xnor 4-in #${i}`);
      assertEqual(ops.xnor2(a, b, c, d), expectedXnorStrict, `ops.xnor2 4-in #${i}`);

      xorGate0.setInputAt(0, a);
      xorGate0.setInputAt(1, b);
      xorGate0.setInputAt(2, c);
      xorGate0.setInputAt(3, d);
      assertEqual(xorGate0.getOutputAt(0), expectedXorParity, `XOR 4-in circuit mode 0 #${i}`);

      xorGate1.setInputAt(0, a);
      xorGate1.setInputAt(1, b);
      xorGate1.setInputAt(2, c);
      xorGate1.setInputAt(3, d);
      assertEqual(xorGate1.getOutputAt(0), expectedXorStrict, `XOR 4-in circuit mode 1 #${i}`);

      xnorGate0.setInputAt(0, a);
      xnorGate0.setInputAt(1, b);
      xnorGate0.setInputAt(2, c);
      xnorGate0.setInputAt(3, d);
      assertEqual(xnorGate0.getOutputAt(0), expectedXnorParity, `XNOR 4-in circuit mode 0 #${i}`);

      xnorGate1.setInputAt(0, a);
      xnorGate1.setInputAt(1, b);
      xnorGate1.setInputAt(2, c);
      xnorGate1.setInputAt(3, d);
      assertEqual(xnorGate1.getOutputAt(0), expectedXnorStrict, `XNOR 4-in circuit mode 1 #${i}`);
    }
  });

  // =========================================================================
  // 2. Undefined / Floating Input Handling
  // =========================================================================

  suite.test('Undefined & Floating Input Handling for XOR & XNOR', () => {
    // 0 inputs
    assertEqual(ops.xor(), undefined, 'ops.xor() with no inputs returns undefined');
    assertEqual(ops.xor2(), undefined, 'ops.xor2() with no inputs returns undefined');
    assertEqual(ops.xnor(), undefined, 'ops.xnor() with no inputs returns undefined');
    assertEqual(ops.xnor2(), undefined, 'ops.xnor2() with no inputs returns undefined');

    // 2 inputs with undefined
    const undefPairs: [LogicValue, LogicValue][] = [
      [undefined, false],
      [false, undefined],
      [undefined, true],
      [true, undefined],
      [undefined, undefined]
    ];

    for (const [u1, u2] of undefPairs) {
      assertEqual(ops.xor(u1, u2), undefined, `ops.xor(${u1}, ${u2}) yields undefined`);
      assertEqual(ops.xor2(u1, u2), undefined, `ops.xor2(${u1}, ${u2}) yields undefined`);
      assertEqual(ops.xnor(u1, u2), undefined, `ops.xnor(${u1}, ${u2}) yields undefined`);
      assertEqual(ops.xnor2(u1, u2), undefined, `ops.xnor2(${u1}, ${u2}) yields undefined`);
    }

    // 3 and 4 inputs with partial undefined
    assertEqual(ops.xor(true, true, undefined), undefined);
    assertEqual(ops.xor2(true, false, undefined), undefined);
    assertEqual(ops.xnor(false, false, undefined), undefined);
    assertEqual(ops.xnor2(true, true, true, undefined), undefined);

    // Circuit level unassigned/floating pins
    const xorGate = new XORGateCircuit(3);
    assertEqual(xorGate.getOutputAt(0), undefined, 'Default unassigned inputs yield undefined');

    xorGate.setInputAt(0, true);
    xorGate.setInputAt(1, false);
    assertEqual(xorGate.getOutputAt(0), undefined, '2 of 3 inputs set still yields undefined');

    xorGate.setInputAt(2, true);
    assertEqual(xorGate.getOutputAt(0), false, 'All 3 inputs set evaluates properly');

    // Dynamically changing functionIndex maintains undefined when inputs are undefined
    xorGate.setInputAt(1, undefined);
    assertEqual(xorGate.getOutputAt(0), undefined, 'Re-introducing undefined yields undefined');
    xorGate.functionIndex = 1;
    assertEqual(xorGate.getOutputAt(0), undefined, 'Strict mode preserves undefined');
  });

  // =========================================================================
  // 3. Switch defaultState and SimulationEngine.reset()
  // =========================================================================

  suite.test('Switch defaultState initialization and manual reset', () => {
    // Default constructor is false
    const swDef = new SwitchCircuit();
    assertEqual(swDef.state, false, 'Default constructor state is false');
    assertEqual(swDef.defaultState, false, 'Default constructor defaultState is false');
    assertEqual(swDef.getOutputAt(0), false, 'Output pin evaluates to false');

    // Explicit constructor with false
    const swLow = new SwitchCircuit(false);
    assertEqual(swLow.state, false);
    assertEqual(swLow.defaultState, false);

    // Explicit constructor with true
    const swHigh = new SwitchCircuit(true);
    assertEqual(swHigh.state, true);
    assertEqual(swHigh.defaultState, true);
    assertEqual(swHigh.getOutputAt(0), true);

    // Toggle swLow and call manual reset()
    swLow.toggle(true);
    assertEqual(swLow.state, true);
    swLow.reset();
    assertEqual(swLow.state, false, 'swLow.reset() restores false');

    // Toggle swHigh and call manual reset()
    swHigh.toggle(false);
    assertEqual(swHigh.state, false);
    swHigh.reset();
    assertEqual(swHigh.state, true, 'swHigh.reset() restores true');

    // Mutate defaultState
    swLow.defaultState = true;
    swLow.toggle(false);
    swLow.reset();
    assertEqual(swLow.state, true, 'Updated defaultState true is restored on reset');

    swHigh.defaultState = false;
    swHigh.toggle(true);
    swHigh.reset();
    assertEqual(swHigh.state, false, 'Updated defaultState false is restored on reset');
  });

  suite.test('SimulationEngine.reset() propagates switch defaultState through gates to outputs', () => {
    const engine = new SimulationEngine();

    // Switch 1: defaultState = false -> NOT gate 1 -> Bulb 1
    const sw1 = new SwitchCircuit(false);
    const not1 = new NOTGateCircuit();
    const bulb1 = new LightBulbCircuit();

    // Switch 2: defaultState = true -> NOT gate 2 -> Bulb 2
    const sw2 = new SwitchCircuit(true);
    const not2 = new NOTGateCircuit();
    const bulb2 = new LightBulbCircuit();

    // Switch 3 (default true) & Switch 4 (default false) -> XOR gate (parity) -> Bulb 3
    const sw3 = new SwitchCircuit(true);
    const sw4 = new SwitchCircuit(false);
    const xorGate = new XORGateCircuit(2);
    const bulb3 = new LightBulbCircuit();

    engine.registerCircuit(sw1);
    engine.registerCircuit(not1);
    engine.registerCircuit(bulb1);

    engine.registerCircuit(sw2);
    engine.registerCircuit(not2);
    engine.registerCircuit(bulb2);

    engine.registerCircuit(sw3);
    engine.registerCircuit(sw4);
    engine.registerCircuit(xorGate);
    engine.registerCircuit(bulb3);

    engine.connect(sw1, 0, not1, 0);
    engine.connect(not1, 0, bulb1, 0);

    engine.connect(sw2, 0, not2, 0);
    engine.connect(not2, 0, bulb2, 0);

    engine.connect(sw3, 0, xorGate, 0);
    engine.connect(sw4, 0, xorGate, 1);
    engine.connect(xorGate, 0, bulb3, 0);

    engine.propagateAll();

    // Initial steady state:
    // sw1=false -> not1=true -> bulb1=true
    assertEqual(bulb1.isOn, true, 'Initial: Bulb 1 is ON');
    // sw2=true -> not2=false -> bulb2=false
    assertEqual(bulb2.isOn, false, 'Initial: Bulb 2 is OFF');
    // sw3=true, sw4=false -> xor(1,0)=true -> bulb3=true
    assertEqual(bulb3.isOn, true, 'Initial: Bulb 3 is ON');

    // Mutate state mid-simulation:
    sw1.toggle(true);
    sw2.toggle(false);
    sw3.toggle(false);
    engine.propagateAll();

    assertEqual(bulb1.isOn, false, 'Toggled: Bulb 1 is now OFF');
    assertEqual(bulb2.isOn, true, 'Toggled: Bulb 2 is now ON');
    assertEqual(bulb3.isOn, false, 'Toggled: Bulb 3 is now OFF');

    // Reset simulation engine:
    engine.reset();

    // All switches and downstream gates MUST cleanly return to default state:
    assertEqual(sw1.state, false, 'sw1 returned to defaultState false');
    assertEqual(sw2.state, true, 'sw2 returned to defaultState true');
    assertEqual(sw3.state, true, 'sw3 returned to defaultState true');
    assertEqual(sw4.state, false, 'sw4 remained defaultState false');

    assertEqual(bulb1.isOn, true, 'Reset: Bulb 1 cleanly restored to ON');
    assertEqual(bulb2.isOn, false, 'Reset: Bulb 2 cleanly restored to OFF');
    assertEqual(bulb3.isOn, true, 'Reset: Bulb 3 cleanly restored to ON');
  });

  // =========================================================================
  // 4. Serialization and Roundtrip Parsing
  // =========================================================================

  suite.test('XOR / XNOR functionIndex and Switch outputs XML roundtrip serialization', () => {
    const parser = createDefaultParser();
    const engine = new SimulationEngine();

    // Gates:
    // xorParity (default 0) -> should omit functionIndex in XML
    const xorParity = new XORGateCircuit(2, 'xor_parity', 0);
    // xorStrict (1) -> should serialize functionIndex="1"
    const xorStrict = new XORGateCircuit(3, 'xor_strict', 1);
    // xnorParity (default 0) -> should omit functionIndex in XML
    const xnorParity = new XNORGateCircuit(2, 'xnor_parity', 0);
    // xnorStrict (1) -> should serialize functionIndex="1"
    const xnorStrict = new XNORGateCircuit(4, 'xnor_strict', 1);

    // Switches:
    const swLow = new SwitchCircuit(false, 'sw_low');
    const swHigh = new SwitchCircuit(true, 'sw_high');

    // Bulb for checking connectivity
    const bulb = new LightBulbCircuit('bulb1');

    engine.registerCircuit(xorParity);
    engine.registerCircuit(xorStrict);
    engine.registerCircuit(xnorParity);
    engine.registerCircuit(xnorStrict);
    engine.registerCircuit(swLow);
    engine.registerCircuit(swHigh);
    engine.registerCircuit(bulb);

    engine.connect(xorStrict, 0, bulb, 0);

    const circuits = new Map();
    circuits.set('xor_parity', xorParity);
    circuits.set('xor_strict', xorStrict);
    circuits.set('xnor_parity', xnorParity);
    circuits.set('xnor_strict', xnorStrict);
    circuits.set('sw_low', swLow);
    circuits.set('sw_high', swHigh);
    circuits.set('bulb1', bulb);

    const metadata = new Map();
    metadata.set('xor_parity', { x: 10, y: 10, rotation: 0 });
    metadata.set('xor_strict', { x: 20, y: 10, rotation: 0 });
    metadata.set('xnor_parity', { x: 30, y: 10, rotation: 0 });
    metadata.set('xnor_strict', { x: 40, y: 10, rotation: 0 });
    metadata.set('sw_low', { x: 50, y: 10, rotation: 0 });
    metadata.set('sw_high', { x: 60, y: 10, rotation: 0 });
    metadata.set('bulb1', { x: 70, y: 10, rotation: 0 });

    const serialized = parser.serialize({
      engine,
      circuits,
      metadata,
      locations: { left: [], right: [], top: [], bottom: [] }
    });

    // 1. Omit functionIndex when 0
    assert(!serialized.includes('uid="xor_parity" x="10" y="10" rotation="0" functionIndex'), 'xor_parity omits functionIndex');
    assert(!serialized.includes('uid="xnor_parity" x="30" y="10" rotation="0" functionIndex'), 'xnor_parity omits functionIndex');

    // 2. Include functionIndex when 1
    assert(serialized.includes('uid="xor_strict" x="20" y="10" rotation="0" inputs="3" functionIndex="1"'), 'xor_strict serializes inputs="3" functionIndex="1"');
    assert(serialized.includes('uid="xnor_strict" x="40" y="10" rotation="0" inputs="4" functionIndex="1"'), 'xnor_strict serializes inputs="4" functionIndex="1"');

    // 3. Switch outputs serialization
    assert(serialized.includes('uid="sw_low" x="50" y="10" rotation="0" outputs="false"'), 'sw_low serializes outputs="false"');
    assert(serialized.includes('uid="sw_high" x="60" y="10" rotation="0" outputs="true"'), 'sw_high serializes outputs="true"');

    // 4. Parse back and verify roundtrip fidelity
    const doc = parser.parse(serialized);

    const parsedXorP = doc.circuits.get('xor_parity') as XORGateCircuit;
    const parsedXorS = doc.circuits.get('xor_strict') as XORGateCircuit;
    const parsedXnorP = doc.circuits.get('xnor_parity') as XNORGateCircuit;
    const parsedXnorS = doc.circuits.get('xnor_strict') as XNORGateCircuit;
    const parsedSwLow = doc.circuits.get('sw_low') as SwitchCircuit;
    const parsedSwHigh = doc.circuits.get('sw_high') as SwitchCircuit;

    assertEqual(parsedXorP.functionIndex, 0, 'Roundtrip xor_parity functionIndex is 0');
    assertEqual(parsedXorP.inputsCount, 2, 'Roundtrip xor_parity inputsCount is 2');

    assertEqual(parsedXorS.functionIndex, 1, 'Roundtrip xor_strict functionIndex is 1');
    assertEqual(parsedXorS.inputsCount, 3, 'Roundtrip xor_strict inputsCount is 3');

    assertEqual(parsedXnorP.functionIndex, 0, 'Roundtrip xnor_parity functionIndex is 0');
    assertEqual(parsedXnorP.inputsCount, 2, 'Roundtrip xnor_parity inputsCount is 2');

    assertEqual(parsedXnorS.functionIndex, 1, 'Roundtrip xnor_strict functionIndex is 1');
    assertEqual(parsedXnorS.inputsCount, 4, 'Roundtrip xnor_strict inputsCount is 4');

    assertEqual(parsedSwLow.state, false, 'Roundtrip sw_low state is false');
    assertEqual(parsedSwLow.defaultState, false, 'Roundtrip sw_low defaultState is false');

    assertEqual(parsedSwHigh.state, true, 'Roundtrip sw_high state is true');
    assertEqual(parsedSwHigh.defaultState, true, 'Roundtrip sw_high defaultState is true');

    // Verify parsed circuit connection preserved
    assertEqual(doc.engine.connections.length, 1, 'Preserved wire connection to bulb');
  });

  suite.test('Switch outputs serialization preserves defaultState even if state was mutated', () => {
    const parser = createDefaultParser();
    const engine = new SimulationEngine();

    // Switch configured with defaultState = false, but toggled to true before saving
    const sw1 = new SwitchCircuit(false, 'sw1');
    sw1.toggle(true);
    assertEqual(sw1.state, true);
    assertEqual(sw1.defaultState, false);

    // Switch configured with defaultState = true, but toggled to false before saving
    const sw2 = new SwitchCircuit(true, 'sw2');
    sw2.toggle(false);
    assertEqual(sw2.state, false);
    assertEqual(sw2.defaultState, true);

    engine.registerCircuit(sw1);
    engine.registerCircuit(sw2);

    const circuits = new Map();
    circuits.set('sw1', sw1);
    circuits.set('sw2', sw2);

    const metadata = new Map();
    metadata.set('sw1', { x: 0, y: 0, rotation: 0 });
    metadata.set('sw2', { x: 50, y: 0, rotation: 0 });

    const serialized = parser.serialize({
      engine,
      circuits,
      metadata,
      locations: { left: [], right: [], top: [], bottom: [] }
    });

    // In Logicly, @_outputs records the reset signal (defaultState)
    assert(serialized.includes('uid="sw1" x="0" y="0" rotation="0" outputs="false"'), 'sw1 serializes defaultState false');
    assert(serialized.includes('uid="sw2" x="50" y="0" rotation="0" outputs="true"'), 'sw2 serializes defaultState true');
  });

  // =========================================================================
  // 5. SR Flip-Flop Naming, Backward Compatibility & Simulation
  // =========================================================================

  suite.test('SR Flip-Flop: Catalog definition and canonical naming', () => {
    // 1. Catalog entry
    const srDef = COMPONENT_CATALOG.find((c) => c.type === 'sr_flip_flop@logic.ly');
    assert(srDef !== undefined, 'sr_flip_flop@logic.ly is present in catalog');
    assertEqual(srDef!.name, 'SR Flip-Flop');
    assertEqual(srDef!.category, 'Flip-Flop');
    assertEqual(srDef!.defaultInputs, 3);
    assertEqual(srDef!.defaultOutputs, 2);

    // 2. No duplicate rs_flip_flop in catalog
    const rsDef = COMPONENT_CATALOG.find((c) => c.type === 'rs_flip_flop@logic.ly');
    assertEqual(rsDef, undefined, 'rs_flip_flop@logic.ly is NOT listed in catalog (unified)');

    // 3. Templates mapping
    assert(BUILTIN_IC_TEMPLATES['sr_flip_flop@logic.ly'] !== undefined, 'sr_flip_flop template exists');
    assert(BUILTIN_IC_TEMPLATES['rs_flip_flop@logic.ly'] !== undefined, 'rs_flip_flop template exists for legacy');
    assertEqual(
      BUILTIN_IC_TEMPLATES['sr_flip_flop@logic.ly'],
      BUILTIN_IC_TEMPLATES['rs_flip_flop@logic.ly'],
      'sr and rs templates are identical'
    );
  });

  suite.test('SR Flip-Flop: Parsing, label rendering and legacy rs_flip_flop alias', () => {
    const parser = createDefaultParser();

    // 1. Normalization of aliases
    assertEqual(parser.normalizeComponentType('sr_flip_flop'), 'sr_flip_flop@logic.ly');
    assertEqual(parser.normalizeComponentType('SR_Flip_Flop'), 'sr_flip_flop@logic.ly');
    assertEqual(parser.normalizeComponentType('rs_flip_flop'), 'sr_flip_flop@logic.ly');
    assertEqual(parser.normalizeComponentType('RS_Flip_Flop'), 'sr_flip_flop@logic.ly');
    assertEqual(parser.normalizeComponentType('rsff'), 'sr_flip_flop@logic.ly');
    assertEqual(parser.normalizeComponentType('srff'), 'sr_flip_flop@logic.ly');

    // 2. Direct instantiation via parser
    const srCircuit = parser.createCircuitInstance('sr_flip_flop@logic.ly') as ComplexCircuit;
    assert(srCircuit instanceof ComplexCircuit, 'srCircuit is ComplexCircuit');
    assertEqual(srCircuit.label, 'SR FLIP FLOP', 'srCircuit label is SR FLIP FLOP');

    const rsCircuit = parser.createCircuitInstance('rs_flip_flop@logic.ly') as ComplexCircuit;
    assert(rsCircuit instanceof ComplexCircuit, 'rsCircuit is ComplexCircuit');
    assertEqual(rsCircuit.label, 'SR FLIP FLOP', 'rsCircuit label is SR FLIP FLOP');

    // 3. SymbolRenderer SVG output
    const srRender = SymbolRenderer.renderComponent(srCircuit, true);
    assert(srRender.svgContent.includes('SR FLIP FLOP'), 'Render output contains "SR FLIP FLOP"');
    assert(!srRender.svgContent.includes('RS FLIP FLOP'), 'Render output does NOT contain "RS FLIP FLOP"');

    const rsRender = SymbolRenderer.renderComponent(rsCircuit, true);
    assert(rsRender.svgContent.includes('SR FLIP FLOP'), 'Legacy render output contains "SR FLIP FLOP"');
    assert(!rsRender.svgContent.includes('RS FLIP FLOP'), 'Legacy render output does NOT contain "RS FLIP FLOP"');
  });

  suite.test('SR Flip-Flop: Full functional simulation for both sr and rs types', () => {
    const parser = createDefaultParser();

    // Test both types identically
    for (const type of ['sr_flip_flop@logic.ly', 'rs_flip_flop@logic.ly']) {
      const circuit = parser.createCircuitInstance(type, `ff_${type}`) as ComplexCircuit;
      assert(circuit !== null, `Instantiated ${type}`);

      // Internal subcircuit inputs:
      // index 0: S (Set)
      // index 1: > (Clock)
      // index 2: R (Reset)
      // Outputs:
      // index 0: Q
      // index 1: Q' (Q Bar)

      // Initial state: Set clock low
      circuit.setInputAt(0, false);
      circuit.setInputAt(1, false);
      circuit.setInputAt(2, false);

      // Pulse clock to establish quiescent state
      circuit.setInputAt(1, true);
      circuit.setInputAt(1, false);

      // 1. SET operation: S=1, R=0, Clock pulse
      circuit.setInputAt(0, true);
      circuit.setInputAt(2, false);
      // Clock rising edge
      circuit.setInputAt(1, true);
      // Clock falling edge
      circuit.setInputAt(1, false);

      assertEqual(circuit.getOutputAt(0), true, `${type}: Q is true after SET`);
      assertEqual(circuit.getOutputAt(1), false, `${type}: Q' is false after SET`);

      // 2. HOLD operation: S=0, R=0, Clock pulse
      circuit.setInputAt(0, false);
      circuit.setInputAt(2, false);
      circuit.setInputAt(1, true);
      circuit.setInputAt(1, false);

      assertEqual(circuit.getOutputAt(0), true, `${type}: Q remains true during HOLD`);
      assertEqual(circuit.getOutputAt(1), false, `${type}: Q' remains false during HOLD`);

      // 3. RESET operation: S=0, R=1, Clock pulse
      circuit.setInputAt(0, false);
      circuit.setInputAt(2, true);
      circuit.setInputAt(1, true);
      circuit.setInputAt(1, false);

      assertEqual(circuit.getOutputAt(0), false, `${type}: Q is false after RESET`);
      assertEqual(circuit.getOutputAt(1), true, `${type}: Q' is true after RESET`);

      // 4. HOLD operation again: S=0, R=0, Clock pulse
      circuit.setInputAt(0, false);
      circuit.setInputAt(2, false);
      circuit.setInputAt(1, true);
      circuit.setInputAt(1, false);

      assertEqual(circuit.getOutputAt(0), false, `${type}: Q remains false during HOLD`);
      assertEqual(circuit.getOutputAt(1), true, `${type}: Q' remains true during HOLD`);
    }
  });

  // =========================================================================
  // 6. Double-Click Interaction and Focus Dispatch
  // =========================================================================

  suite.test('Double-Click Interaction: Callback dispatch and label exclusion', () => {
    const { LabelCircuit } = require('../simulation/circuits/annotation');
    const xorGate = new XORGateCircuit(2, 'xor1');
    const labelCircuit = new LabelCircuit('label1');

    let doubleClickedCircuit: any = null;
    let labelEditTriggered = false;

    // Simulate InteractionManager event listener behavior for double click
    const handleNodeDoubleClick = (node: { circuit: any }) => {
      if (node.circuit instanceof LabelCircuit) {
        labelEditTriggered = true;
      } else {
        doubleClickedCircuit = node.circuit;
      }
    };

    // 1. Double click on gate
    handleNodeDoubleClick({ circuit: xorGate });
    assertEqual(doubleClickedCircuit, xorGate, 'Gate double-click dispatches to circuit handler');
    assertEqual(labelEditTriggered, false, 'Gate double-click does NOT trigger label edit');

    // 2. Double click on label
    doubleClickedCircuit = null;
    handleNodeDoubleClick({ circuit: labelCircuit });
    assertEqual(doubleClickedCircuit, null, 'Label double-click does NOT dispatch to generic circuit handler');
    assertEqual(labelEditTriggered, true, 'Label double-click triggers in-place label editing');
  });

  return suite.report();
}
