import { TestSuite, assertEqual } from './runner';
import { SimulationEngine } from '../simulation/engine';
import { SwitchCircuit, PushButtonCircuit } from '../simulation/circuits/controls';
import { LightBulbCircuit } from '../simulation/circuits/outputs';
import { ANDGateCircuit, XORGateCircuit, NORGateCircuit, NOTGateCircuit } from '../simulation/circuits/gates';

export function runSimulationTests(): boolean {
  const suite = new TestSuite('Simulation Engine Propagation');
  console.log('--- Running Simulation Engine Propagation Tests ---');

  suite.test('Half Adder circuit propagation', () => {
    const engine = new SimulationEngine();

    // Inputs: A, B
    const switchA = new SwitchCircuit(false);
    const switchB = new SwitchCircuit(false);

    // Gates: XOR for Sum, AND for Carry
    const xorGate = new XORGateCircuit(2);
    const andGate = new ANDGateCircuit(2);

    // Outputs: SumLamp, CarryLamp
    const sumLamp = new LightBulbCircuit();
    const carryLamp = new LightBulbCircuit();

    engine.registerCircuit(switchA);
    engine.registerCircuit(switchB);
    engine.registerCircuit(xorGate);
    engine.registerCircuit(andGate);
    engine.registerCircuit(sumLamp);
    engine.registerCircuit(carryLamp);

    // Connect A & B to XOR
    engine.connect(switchA, 0, xorGate, 0);
    engine.connect(switchB, 0, xorGate, 1);

    // Connect A & B to AND
    engine.connect(switchA, 0, andGate, 0);
    engine.connect(switchB, 0, andGate, 1);

    // Connect gates to lamps
    engine.connect(xorGate, 0, sumLamp, 0);
    engine.connect(andGate, 0, carryLamp, 0);

    engine.propagateAll();

    // 0 + 0 = Sum: 0, Carry: 0
    assertEqual(sumLamp.isOn, false, '0+0 Sum');
    assertEqual(carryLamp.isOn, false, '0+0 Carry');

    // 1 + 0 = Sum: 1, Carry: 0
    switchA.toggle(true);
    engine.propagateAll();
    assertEqual(sumLamp.isOn, true, '1+0 Sum');
    assertEqual(carryLamp.isOn, false, '1+0 Carry');

    // 1 + 1 = Sum: 0, Carry: 1
    switchB.toggle(true);
    engine.propagateAll();
    assertEqual(sumLamp.isOn, false, '1+1 Sum');
    assertEqual(carryLamp.isOn, true, '1+1 Carry');

    // 0 + 1 = Sum: 1, Carry: 0
    switchA.toggle(false);
    engine.propagateAll();
    assertEqual(sumLamp.isOn, true, '0+1 Sum');
    assertEqual(carryLamp.isOn, false, '0+1 Carry');
  });

  suite.test('Cross-coupled NOR SR Latch feedback loop and memory storage', () => {
    const engine = new SimulationEngine();

    const setSwitch = new SwitchCircuit(false);
    const resetSwitch = new SwitchCircuit(false);

    const nor1 = new NORGateCircuit(2); // Top NOR (outputs Q)
    const nor2 = new NORGateCircuit(2); // Bottom NOR (outputs Q')

    const qLamp = new LightBulbCircuit();
    const qBarLamp = new LightBulbCircuit();

    engine.registerCircuit(setSwitch);
    engine.registerCircuit(resetSwitch);
    engine.registerCircuit(nor1);
    engine.registerCircuit(nor2);
    engine.registerCircuit(qLamp);
    engine.registerCircuit(qBarLamp);

    // Set -> nor2 input 1
    engine.connect(setSwitch, 0, nor2, 1);
    // Reset -> nor1 input 0
    engine.connect(resetSwitch, 0, nor1, 0);

    // Cross-coupled feedback
    engine.connect(nor1, 0, nor2, 0); // Q -> nor2 input 0
    engine.connect(nor2, 0, nor1, 1); // Q' -> nor1 input 1

    engine.connect(nor1, 0, qLamp, 0);
    engine.connect(nor2, 0, qBarLamp, 0);

    engine.propagateAll();

    // Pulse Set high
    setSwitch.toggle(true);
    engine.propagateAll();
    // Q should be 1, Q' should be 0
    assertEqual(qLamp.isOn, true, 'After Set=1, Q is 1');
    assertEqual(qBarLamp.isOn, false, 'After Set=1, Q\' is 0');

    // Release Set (back to 0) -> state MUST be retained by memory feedback!
    setSwitch.toggle(false);
    engine.propagateAll();
    assertEqual(qLamp.isOn, true, 'Memory hold: Q stays 1');
    assertEqual(qBarLamp.isOn, false, 'Memory hold: Q\' stays 0');

    // Pulse Reset high
    resetSwitch.toggle(true);
    engine.propagateAll();
    assertEqual(qLamp.isOn, false, 'After Reset=1, Q is 0');
    assertEqual(qBarLamp.isOn, true, 'After Reset=1, Q\' is 1');

    // Release Reset (back to 0) -> state MUST be retained
    resetSwitch.toggle(false);
    engine.propagateAll();
    assertEqual(qLamp.isOn, false, 'Memory hold: Q stays 0');
    assertEqual(qBarLamp.isOn, true, 'Memory hold: Q\' stays 1');
  });

  suite.test('Default Floating Input: Unconnected NOT gate with false (Pull-Down) outputs true', () => {
    const engine = new SimulationEngine();
    engine.setDefaultFloatSignal('false');

    const notGate = new NOTGateCircuit();
    engine.registerCircuit(notGate);
    engine.propagateAll();

    assertEqual(notGate.getInputAt(0), false, 'Floating input should default to false');
    assertEqual(notGate.getOutputAt(0), true, 'NOT gate should invert false to true');
  });

  suite.test('Default Floating Input: Unconnected NOT gate with true (Pull-Up) outputs false', () => {
    const engine = new SimulationEngine();
    engine.setDefaultFloatSignal('true');

    const notGate = new NOTGateCircuit();
    engine.registerCircuit(notGate);
    engine.propagateAll();

    assertEqual(notGate.getInputAt(0), true, 'Floating input should default to true');
    assertEqual(notGate.getOutputAt(0), false, 'NOT gate should invert true to false');
  });

  suite.test('Default Floating Input: Dynamically changing defaultFloatSignal updates circuits immediately', () => {
    const engine = new SimulationEngine();
    const notGate = new NOTGateCircuit();
    const bulb = new LightBulbCircuit();

    engine.registerCircuit(notGate);
    engine.registerCircuit(bulb);
    engine.connect(notGate, 0, bulb, 0);

    // 1. Initial default is 'undefined'
    engine.propagateAll();
    assertEqual(notGate.getInputAt(0), undefined, 'Initial floating input is undefined');
    assertEqual(notGate.getOutputAt(0), undefined, 'Initial output is undefined');
    assertEqual(bulb.isOn, false, 'Bulb is initially off');

    // 2. Dynamically change to Pull-Down ('false')
    engine.setDefaultFloatSignal('false');
    assertEqual(notGate.getInputAt(0), false, 'Input immediately adopts false');
    assertEqual(notGate.getOutputAt(0), true, 'Output immediately evaluates to true');
    assertEqual(bulb.isOn, true, 'Bulb immediately turns ON through propagation');

    // 3. Dynamically change to Pull-Up ('true')
    engine.setDefaultFloatSignal('true');
    assertEqual(notGate.getInputAt(0), true, 'Input immediately adopts true');
    assertEqual(notGate.getOutputAt(0), false, 'Output immediately evaluates to false');
    assertEqual(bulb.isOn, false, 'Bulb immediately turns OFF');

    // 4. Dynamic change back to High-Z ('undefined')
    engine.setDefaultFloatSignal('undefined');
    assertEqual(notGate.getInputAt(0), undefined, 'Input returns to undefined');
    assertEqual(notGate.getOutputAt(0), undefined, 'Output returns to undefined');
    assertEqual(bulb.isOn, false, 'Bulb remains off');

    // 5. Connect explicit driver then disconnect: input should revert to current defaultFloatSignal
    engine.setDefaultFloatSignal('false');
    const switchA = new SwitchCircuit(true);
    engine.registerCircuit(switchA);
    const conn = engine.connect(switchA, 0, notGate, 0);
    engine.propagateAll();
    assertEqual(notGate.getInputAt(0), true, 'Connected pin receives switch output true');

    // Disconnect -> pin reverts to defaultFloatSignal ('false')
    engine.disconnect(conn);
    engine.propagateAll();
    assertEqual(notGate.getInputAt(0), false, 'Disconnected pin adopts defaultFloatSignal false');
    assertEqual(notGate.getOutputAt(0), true, 'Output inverts to true');
    assertEqual(bulb.isOn, true, 'Bulb turns back ON after wire disconnection');
  });

  suite.test('Reset: Switch and PushButton restore default states', () => {
    const engine = new SimulationEngine();
    const sw = new SwitchCircuit(false);
    const btn = new PushButtonCircuit();

    engine.registerCircuit(sw);
    engine.registerCircuit(btn);

    sw.toggle(true);
    btn.press();
    assertEqual(sw.state, true, 'Switch toggled to true');
    assertEqual(btn.isPressed, true, 'Button is pressed');

    engine.reset();
    assertEqual(sw.state, false, 'Switch restored to default false on reset');
    assertEqual(btn.isPressed, false, 'Button released on reset');
  });

  suite.test('Reset: 4-Bit JK Ripple Counter powers on and resets cleanly to 0000', () => {
    const { LogiclyParser } = require('../io/parser');
    const { SAMPLE_CIRCUITS } = require('../ui/samples');
    const parser = new LogiclyParser();
    const doc = parser.parse(SAMPLE_CIRCUITS['4-Bit JK Ripple Counter']);

    const ff0 = doc.circuits.get('ff0')!;
    const ff1 = doc.circuits.get('ff1')!;
    const ff2 = doc.circuits.get('ff2')!;
    const ff3 = doc.circuits.get('ff3')!;
    const clk = doc.circuits.get('clk')!;

    // Initial quiescent state must be 0000
    assertEqual(ff0.getOutputAt(0), false, 'FF0 starts at Q=0');
    assertEqual(ff1.getOutputAt(0), false, 'FF1 starts at Q=0');
    assertEqual(ff2.getOutputAt(0), false, 'FF2 starts at Q=0');
    assertEqual(ff3.getOutputAt(0), false, 'FF3 starts at Q=0');

    // Count through pulses 1 to 10
    for (let c = 1; c <= 10; c++) {
      clk.setOutputAt(0, true);
      doc.engine.propagateAll();
      clk.setOutputAt(0, false);
      doc.engine.propagateAll();

      const q0 = ff0.getOutputAt(0) ? 1 : 0;
      const q1 = ff1.getOutputAt(0) ? 1 : 0;
      const q2 = ff2.getOutputAt(0) ? 1 : 0;
      const q3 = ff3.getOutputAt(0) ? 1 : 0;
      const val = (q3 << 3) | (q2 << 2) | (q1 << 1) | q0;
      assertEqual(val, c, `Counter matches expected pulse count ${c}`);
    }

    // Now call engine.reset() mid-simulation
    doc.engine.reset();
    assertEqual(ff0.getOutputAt(0), false, 'FF0 reset back to Q=0');
    assertEqual(ff1.getOutputAt(0), false, 'FF1 reset back to Q=0');
    assertEqual(ff2.getOutputAt(0), false, 'FF2 reset back to Q=0');
    assertEqual(ff3.getOutputAt(0), false, 'FF3 reset back to Q=0');

    // Next pulse after reset must count to 1
    clk.setOutputAt(0, true);
    doc.engine.propagateAll();
    clk.setOutputAt(0, false);
    doc.engine.propagateAll();

    const q0After = ff0.getOutputAt(0) ? 1 : 0;
    const q1After = ff1.getOutputAt(0) ? 1 : 0;
    const q2After = ff2.getOutputAt(0) ? 1 : 0;
    const q3After = ff3.getOutputAt(0) ? 1 : 0;
    const valAfter = (q3After << 3) | (q2After << 2) | (q1After << 1) | q0After;
    assertEqual(valAfter, 1, 'Counter resumed counting at 1 after reset');
  });

  suite.test('Reset: 4-Bit Ripple Counter with Hex Display powers on and resets cleanly to 0', () => {
    const { LogiclyParser } = require('../io/parser');
    const { SAMPLE_CIRCUITS } = require('../ui/samples');
    const parser = new LogiclyParser();
    const doc = parser.parse(SAMPLE_CIRCUITS['4-Bit Ripple Counter']);

    const hex = doc.circuits.get('hexDisplay') as any;
    const clk1 = doc.circuits.get('clk1')!;

    // Initial quiescent state must be 0
    assertEqual(hex.numericValue, 0, 'Hex display starts at 0 on initial parse');

    // Count 5 pulses
    for (let c = 1; c <= 5; c++) {
      clk1.setOutputAt(0, true);
      doc.engine.propagateAll();
      clk1.setOutputAt(0, false);
      doc.engine.propagateAll();
      assertEqual(hex.numericValue, c, `Hex display value matches pulse ${c}`);
    }

    // Reset
    doc.engine.reset();
    assertEqual(hex.numericValue, 0, 'Hex display resets cleanly back to 0');
  });

  return suite.report();
}
