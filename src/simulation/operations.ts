import { LogicValue } from './types';

/**
 * 3-valued Logic Operations matching Logicly's verified execution semantics
 */

export function buffer(input: LogicValue): LogicValue {
  return input;
}

export function not(input: LogicValue): LogicValue {
  if (input === undefined || input === null) {
    return undefined;
  }
  return !input;
}

export function and(...inputs: LogicValue[]): LogicValue {
  if (inputs.length === 0) return undefined;
  let hasUndefined = false;
  for (const val of inputs) {
    // Immediate dominant short-circuit: if any input is strictly false, output is strictly false
    if (val === false) {
      return false;
    }
    if (val === undefined || val === null) {
      hasUndefined = true;
    }
  }
  return hasUndefined ? undefined : true;
}

export function or(...inputs: LogicValue[]): LogicValue {
  if (inputs.length === 0) return undefined;
  let hasUndefined = false;
  for (const val of inputs) {
    // Immediate dominant short-circuit: if any input is strictly true, output is strictly true
    if (val === true) {
      return true;
    }
    if (val === undefined || val === null) {
      hasUndefined = true;
    }
  }
  return hasUndefined ? undefined : false;
}

export function nand(...inputs: LogicValue[]): LogicValue {
  return not(and(...inputs));
}

export function nor(...inputs: LogicValue[]): LogicValue {
  return not(or(...inputs));
}

/**
 * Multi-input parity XOR (Logicly's default multi-input XOR mode)
 * Output is undefined if any input is floating/undefined.
 * Otherwise returns true if an odd number of inputs are true.
 */
export function xor(...inputs: LogicValue[]): LogicValue {
  if (inputs.length === 0) return undefined;
  let oddParity = false;
  for (const val of inputs) {
    if (val === undefined || val === null) {
      return undefined;
    }
    if (val === true) {
      oddParity = !oddParity;
    }
  }
  return oddParity;
}

/**
 * Strict XOR (exactly-one-true mode)
 * Returns true if and only if exactly 1 input is true.
 */
export function xor2(...inputs: LogicValue[]): LogicValue {
  if (inputs.length === 0) return undefined;
  let trueCount = 0;
  for (const val of inputs) {
    if (val === undefined || val === null) {
      return undefined;
    }
    if (val === true) {
      trueCount++;
    }
  }
  return trueCount === 1;
}

export function xnor(...inputs: LogicValue[]): LogicValue {
  return not(xor(...inputs));
}

/**
 * Strict XNOR (exactly-one-low / not(strict XOR) mode)
 * Inverted strict XOR: returns true if not exactly 1 input is true.
 */
export function xnor2(...inputs: LogicValue[]): LogicValue {
  return not(xor2(...inputs));
}

/**
 * Tri-State Buffer
 * Passes input if enable is strictly true; otherwise enters high-impedance (undefined).
 */
export function triState(input: LogicValue, enable: LogicValue): LogicValue {
  if (enable === true) {
    return input;
  }
  return undefined;
}

/**
 * Bus Driver Resolution
 * Resolves multiple tri-state drivers wired to a common net:
 * - If only one driver is active, passes that driver's signal.
 * - If multiple active drivers conflict (true vs false), yields undefined (bus contention).
 * - If all drivers are undefined, yields undefined (floating bus).
 */
export function bus(...drivers: (LogicValue | LogicValue[])[]): LogicValue {
  const flatDrivers: LogicValue[] = drivers.length === 1 && Array.isArray(drivers[0])
    ? drivers[0]
    : (drivers as LogicValue[]);
  let activeSignal: boolean | undefined = undefined;
  for (const sig of flatDrivers) {
    if (sig === undefined || sig === null) {
      continue;
    }
    if (activeSignal === undefined) {
      activeSignal = sig;
    } else if (activeSignal !== sig) {
      return undefined; // Contention conflict
    }
  }
  return activeSignal;
}
