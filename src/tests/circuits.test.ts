import { TestSuite, assertEqual, assert } from './runner';
import {
  ANDGateCircuit,
  ORGateCircuit,
  NOTGateCircuit,
  XORGateCircuit,
  XNORGateCircuit,
  TriStateCircuit,
  BusCircuit
} from '../simulation/circuits/gates';
import { SwitchCircuit, PushButtonCircuit, ConstantHighCircuit, ConstantLowCircuit } from '../simulation/circuits/controls';
import { LightBulbCircuit, DigitDisplayCircuit } from '../simulation/circuits/outputs';
import { ClockCircuit } from '../simulation/circuits/clock';

export function runCircuitsTests(): boolean {
  const suite = new TestSuite('Circuit Components (22 Components Coverage)');
  console.log('--- Running Circuit Component Tests ---');

  suite.test('Logic Gate variable input scaling', () => {
    const andGate = new ANDGateCircuit(2);
    assertEqual(andGate.inputsCount, 2);
    andGate.setInputAt(0, true);
    andGate.setInputAt(1, true);
    assertEqual(andGate.getOutputAt(0), true);

    // Expand to 4 inputs
    andGate.setInputsCount(4);
    assertEqual(andGate.inputsCount, 4);
    // Since inputs 2 and 3 are undefined, output becomes undefined
    assertEqual(andGate.getOutputAt(0), undefined);

    andGate.setInputAt(2, true);
    andGate.setInputAt(3, true);
    assertEqual(andGate.getOutputAt(0), true);

    andGate.setInputAt(3, false);
    assertEqual(andGate.getOutputAt(0), false);
  });

  suite.test('Controls: Switch, PushButton, and Constants', () => {
    const sw = new SwitchCircuit(false);
    assertEqual(sw.getOutputAt(0), false);
    sw.toggle();
    assertEqual(sw.getOutputAt(0), true);
    sw.toggle(false);
    assertEqual(sw.getOutputAt(0), false);

    const btn = new PushButtonCircuit();
    assertEqual(btn.getOutputAt(0), false);
    btn.press();
    assertEqual(btn.getOutputAt(0), true);
    btn.release();
    assertEqual(btn.getOutputAt(0), false);

    const vcc = new ConstantHighCircuit();
    assertEqual(vcc.getOutputAt(0), true);
    const gnd = new ConstantLowCircuit();
    assertEqual(gnd.getOutputAt(0), false);
  });

  suite.test('Outputs: Light Bulb and 4-Bit Hex Digit Display', () => {
    const bulb = new LightBulbCircuit();
    assertEqual(bulb.isOn, false);
    bulb.setInputAt(0, true);
    assertEqual(bulb.isOn, true);
    bulb.setInputAt(0, false);
    assertEqual(bulb.isOn, false);
    bulb.setInputAt(0, undefined);
    assertEqual(bulb.isOn, false);

    const digit = new DigitDisplayCircuit();
    assertEqual(digit.hexChar, '-'); // undefined bits show '-'

    // 0000 -> 0
    digit.setInputAt(0, false);
    digit.setInputAt(1, false);
    digit.setInputAt(2, false);
    digit.setInputAt(3, false);
    assertEqual(digit.numericValue, 0);
    assertEqual(digit.hexChar, '0');

    // 1001 (9)
    digit.setInputAt(0, true);
    digit.setInputAt(3, true);
    assertEqual(digit.numericValue, 9);
    assertEqual(digit.hexChar, '9');

    // 1111 (15 -> F)
    digit.setInputAt(1, true);
    digit.setInputAt(2, true);
    assertEqual(digit.numericValue, 15);
    assertEqual(digit.hexChar, 'F');

    // 1010 (10 -> A)
    digit.setInputAt(0, false);
    digit.setInputAt(1, true);
    digit.setInputAt(2, false);
    digit.setInputAt(3, true);
    assertEqual(digit.numericValue, 10);
    assertEqual(digit.hexChar, 'A');
  });

  suite.test('Clock Circuit accumulation and oscillation', () => {
    const clock = new ClockCircuit(1000); // 1000ms period -> 500ms per half-cycle
    assertEqual(clock.getOutputAt(0), false);

    clock.advance(200); // 200ms elapsed
    assertEqual(clock.getOutputAt(0), false);

    clock.advance(350); // total 550ms -> toggles to true!
    assertEqual(clock.getOutputAt(0), true);

    clock.advance(500); // total 1050ms -> toggles to false!
    assertEqual(clock.getOutputAt(0), false);

    clock.reset();
    assertEqual(clock.getOutputAt(0), false);
  });

  suite.test('Bus Circuit tri-state contention resolution and variable inputs', () => {
    const bus = new BusCircuit(4);
    assertEqual(bus.type, 'bus@logic.ly');
    assertEqual(bus.inputsCount, 4);
    assertEqual(bus.outputsCount, 1);
    assertEqual(bus.label, 'BUS');
    // Initially all undefined -> undefined
    assertEqual(bus.getOutputAt(0), undefined);

    // One driver active true -> true
    bus.setInputAt(1, true);
    assertEqual(bus.getOutputAt(0), true);

    // Another driver active false -> contention! undefined
    bus.setInputAt(2, false);
    assertEqual(bus.getOutputAt(0), undefined);

    // Remove conflicting driver (set back to high-Z undefined)
    bus.setInputAt(2, undefined);
    assertEqual(bus.getOutputAt(0), true);

    // Dynamic variable input scaling (e.g. to 8 pins)
    bus.setInputsCount(8);
    assertEqual(bus.inputsCount, 8);
    assertEqual(bus.getOutputAt(0), true);
  });

  suite.test('XOR and XNOR Gate behavior selection (parity vs strict)', () => {
    // 3-input XOR Gate
    const xorGate = new XORGateCircuit(3);
    assertEqual(xorGate.functionIndex, 0, 'Default functionIndex is 0');
    xorGate.setInputAt(0, true);
    xorGate.setInputAt(1, true);
    xorGate.setInputAt(2, true);
    assertEqual(xorGate.getOutputAt(0), true, '3 true inputs in parity XOR outputs true (odd count)');

    // Switch to strict mode (functionIndex = 1)
    xorGate.functionIndex = 1;
    assertEqual(xorGate.functionIndex, 1);
    assertEqual(xorGate.getOutputAt(0), false, '3 true inputs in strict XOR outputs false (not exactly one)');

    xorGate.setInputAt(1, false);
    xorGate.setInputAt(2, false);
    assertEqual(xorGate.getOutputAt(0), true, 'Exactly 1 true input in strict XOR outputs true');

    // 3-input XNOR Gate
    const xnorGate = new XNORGateCircuit(3);
    assertEqual(xnorGate.functionIndex, 0, 'Default functionIndex is 0');
    xnorGate.setInputAt(0, false);
    xnorGate.setInputAt(1, false);
    xnorGate.setInputAt(2, false);
    assertEqual(xnorGate.getOutputAt(0), true, '3 low inputs in parity XNOR outputs true (odd number of inputs are low)');

    xnorGate.setInputAt(0, true);
    xnorGate.setInputAt(1, true);
    xnorGate.setInputAt(2, true);
    assertEqual(xnorGate.getOutputAt(0), false, '0 low inputs in parity XNOR outputs false (even number)');

    // Switch to strict mode (functionIndex = 1)
    xnorGate.functionIndex = 1;
    assertEqual(xnorGate.getOutputAt(0), true, '3 high inputs in strict XNOR outputs true (not(strict XOR))');

    xnorGate.setInputAt(0, true);
    xnorGate.setInputAt(1, false);
    xnorGate.setInputAt(2, false);
    assertEqual(xnorGate.getOutputAt(0), false, '1 high input in strict XNOR outputs false (not(strict XOR))');
  });

  suite.test('Switch defaultState and signal after reset', () => {
    const swLow = new SwitchCircuit(false);
    assertEqual(swLow.defaultState, false);
    assertEqual(swLow.state, false);
    swLow.toggle(true);
    assertEqual(swLow.state, true);
    swLow.reset();
    assertEqual(swLow.state, false, 'Reset restores defaultState false');

    const swHigh = new SwitchCircuit(true);
    assertEqual(swHigh.defaultState, true);
    assertEqual(swHigh.state, true);
    swHigh.toggle(false);
    assertEqual(swHigh.state, false);
    swHigh.reset();
    assertEqual(swHigh.state, true, 'Reset restores defaultState true');

    // Changing defaultState mid-simulation
    swLow.defaultState = true;
    swLow.toggle(false);
    assertEqual(swLow.state, false);
    swLow.reset();
    assertEqual(swLow.state, true, 'Reset restores newly set defaultState true');
  });

  return suite.report();
}
