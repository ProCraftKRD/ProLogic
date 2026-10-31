import { TestSuite, assertEqual } from './runner';
import * as ops from '../simulation/operations';

export function runOperationsTests(): boolean {
  const suite = new TestSuite('3-Valued Logic Operations');
  console.log('--- Running 3-Valued Logic Operations Tests ---');

  suite.test('Buffer passes true, false, undefined unmodified', () => {
    assertEqual(ops.buffer(true), true);
    assertEqual(ops.buffer(false), false);
    assertEqual(ops.buffer(undefined), undefined);
  });

  suite.test('NOT inverts booleans and returns undefined for undefined', () => {
    assertEqual(ops.not(true), false);
    assertEqual(ops.not(false), true);
    assertEqual(ops.not(undefined), undefined);
  });

  suite.test('AND standard truth table', () => {
    assertEqual(ops.and(false, false), false);
    assertEqual(ops.and(false, true), false);
    assertEqual(ops.and(true, false), false);
    assertEqual(ops.and(true, true), true);
  });

  suite.test('AND 3-state short-circuit semantics (verified from Logicly)', () => {
    // If any input is false, result MUST be false even if other inputs are undefined
    assertEqual(ops.and(false, undefined), false);
    assertEqual(ops.and(undefined, false), false);
    // If true and undefined, result is undefined
    assertEqual(ops.and(true, undefined), undefined);
    assertEqual(ops.and(undefined, undefined), undefined);
  });

  suite.test('OR standard truth table', () => {
    assertEqual(ops.or(false, false), false);
    assertEqual(ops.or(false, true), true);
    assertEqual(ops.or(true, false), true);
    assertEqual(ops.or(true, true), true);
  });

  suite.test('OR 3-state short-circuit semantics (verified from Logicly)', () => {
    // If any input is true, result MUST be true even if other inputs are undefined
    assertEqual(ops.or(true, undefined), true);
    assertEqual(ops.or(undefined, true), true);
    // If false and undefined, result is undefined
    assertEqual(ops.or(false, undefined), undefined);
    assertEqual(ops.or(undefined, undefined), undefined);
  });

  suite.test('NAND and NOR composite operations', () => {
    assertEqual(ops.nand(true, true), false);
    assertEqual(ops.nand(false, undefined), true);
    assertEqual(ops.nor(false, false), true);
    assertEqual(ops.nor(true, undefined), false);
  });

  suite.test('XOR parity and strict mode', () => {
    assertEqual(ops.xor(false, false), false);
    assertEqual(ops.xor(true, false), true);
    assertEqual(ops.xor(false, true), true);
    assertEqual(ops.xor(true, true), false);
    // 3-input parity
    assertEqual(ops.xor(true, true, true), true);
    assertEqual(ops.xor(true, true, false), false);
    // undefined propagates
    assertEqual(ops.xor(true, undefined), undefined);

    // strict XOR (xor2)
    assertEqual(ops.xor2(true, false, false), true);
    assertEqual(ops.xor2(true, true, false), false);
    assertEqual(ops.xor2(true, true, true), false);

    // XNOR parity (xnor: odd number of inputs are low)
    assertEqual(ops.xnor(false, false), true);
    assertEqual(ops.xnor(true, false), false);
    assertEqual(ops.xnor(false, true), false);
    assertEqual(ops.xnor(true, true), true);
    assertEqual(ops.xnor(false, false, false), true); // 3 low inputs (odd) -> true
    assertEqual(ops.xnor(true, true, false), true);   // 1 low input (odd) -> true
    assertEqual(ops.xnor(true, false, false), false);  // 2 low inputs (even) -> false
    assertEqual(ops.xnor(true, true, true), false);   // 0 low inputs (even) -> false

    // strict XNOR (xnor2: not(strict XOR))
    assertEqual(ops.xnor2(true, false, false), false); // 1 high -> strict XOR true -> inverted false
    assertEqual(ops.xnor2(true, true, false), true);   // 2 high -> strict XOR false -> inverted true
    assertEqual(ops.xnor2(false, false, false), true);  // 0 high -> strict XOR false -> inverted true
    assertEqual(ops.xnor2(true, true, true), true);    // 3 high -> strict XOR false -> inverted true
  });

  suite.test('TriState and Bus Resolution', () => {
    // Enabled passes signal
    assertEqual(ops.triState(true, true), true);
    assertEqual(ops.triState(false, true), false);
    // Disabled or floating yields high-Z (undefined)
    assertEqual(ops.triState(true, false), undefined);
    assertEqual(ops.triState(true, undefined), undefined);

    // Bus resolution
    assertEqual(ops.bus([undefined, true, undefined]), true);
    assertEqual(ops.bus([undefined, false, undefined]), false);
    // Conflict yields undefined
    assertEqual(ops.bus([true, false]), undefined);
    assertEqual(ops.bus([undefined, undefined]), undefined);
  });

  return suite.report();
}
