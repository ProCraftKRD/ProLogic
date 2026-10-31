import { LogiclyParser } from '../io/parser';
import { BUILTIN_IC_TEMPLATES } from './templates';
import { ICircuit } from './types';

export interface ComponentDefinition {
  type: string;
  name: string;
  category: 'Input' | 'Output' | 'Logic Gate' | 'Flip-Flop' | 'Integrated Circuits' | 'Other';
  description: string;
  defaultInputs: number;
  defaultOutputs: number;
  isVariableInput?: boolean;
}

export const COMPONENT_CATALOG: ComponentDefinition[] = [
  // Logic Gates
  { type: 'and@logic.ly', name: 'AND Gate', category: 'Logic Gate', description: 'Outputs true if all inputs are true', defaultInputs: 2, defaultOutputs: 1, isVariableInput: true },
  { type: 'or@logic.ly', name: 'OR Gate', category: 'Logic Gate', description: 'Outputs true if any input is true', defaultInputs: 2, defaultOutputs: 1, isVariableInput: true },
  { type: 'not@logic.ly', name: 'NOT Gate', category: 'Logic Gate', description: 'Inverts the incoming signal', defaultInputs: 1, defaultOutputs: 1 },
  { type: 'nand@logic.ly', name: 'NAND Gate', category: 'Logic Gate', description: 'Outputs false only if all inputs are true', defaultInputs: 2, defaultOutputs: 1, isVariableInput: true },
  { type: 'nor@logic.ly', name: 'NOR Gate', category: 'Logic Gate', description: 'Outputs true only if all inputs are false', defaultInputs: 2, defaultOutputs: 1, isVariableInput: true },
  { type: 'xor@logic.ly', name: 'XOR Gate', category: 'Logic Gate', description: 'Outputs true if odd parity of inputs are true', defaultInputs: 2, defaultOutputs: 1, isVariableInput: true },
  { type: 'xnor@logic.ly', name: 'XNOR Gate', category: 'Logic Gate', description: 'Inverts XOR parity output', defaultInputs: 2, defaultOutputs: 1, isVariableInput: true },
  { type: 'buffer@logic.ly', name: 'Buffer', category: 'Logic Gate', description: 'Passes signal unchanged', defaultInputs: 1, defaultOutputs: 1 },
  { type: 'tri-state@logic.ly', name: 'Tri-State Buffer', category: 'Logic Gate', description: 'Passes signal when enable is true, else High-Z', defaultInputs: 2, defaultOutputs: 1 },

  // Input Controls
  { type: 'switch@logic.ly', name: 'Toggle Switch', category: 'Input', description: 'Toggles high/low output state', defaultInputs: 0, defaultOutputs: 1 },
  { type: 'push_button@logic.ly', name: 'Push Button', category: 'Input', description: 'Momentary contact high while held', defaultInputs: 0, defaultOutputs: 1 },
  { type: 'clock@logic.ly', name: 'Clock Oscillator', category: 'Input', description: 'Periodically oscillates between high and low', defaultInputs: 0, defaultOutputs: 1 },
  { type: 'constant_high@logic.ly', name: 'Constant High (VCC)', category: 'Input', description: 'Permanently emits logic true', defaultInputs: 0, defaultOutputs: 1 },
  { type: 'constant_low@logic.ly', name: 'Constant Low (GND)', category: 'Input', description: 'Permanently emits logic false', defaultInputs: 0, defaultOutputs: 1 },

  // Output Sinks
  { type: 'light_bulb@logic.ly', name: 'Light Bulb', category: 'Output', description: 'Illuminates when incoming signal is high', defaultInputs: 1, defaultOutputs: 0 },
  { type: 'digit@logic.ly', name: '4-Bit Hex Display', category: 'Output', description: 'Displays hexadecimal character (0-F) from 4 binary inputs', defaultInputs: 4, defaultOutputs: 0 },

  // Flip-Flops & Storage
  { type: 'd_flip_flop@logic.ly', name: 'D Flip-Flop', category: 'Flip-Flop', description: 'Edge-triggered data flip-flop with async PRE and CLR', defaultInputs: 4, defaultOutputs: 2 },
  { type: 'jk_flip_flop@logic.ly', name: 'JK Flip-Flop', category: 'Flip-Flop', description: 'Universal edge-triggered flip-flop', defaultInputs: 5, defaultOutputs: 2 },
  { type: 't_flip_flop@logic.ly', name: 'T Flip-Flop', category: 'Flip-Flop', description: 'Toggle flip-flop', defaultInputs: 4, defaultOutputs: 2 },
  { type: 'sr_flip_flop@logic.ly', name: 'SR Flip-Flop', category: 'Flip-Flop', description: 'Set-Reset flip-flop', defaultInputs: 3, defaultOutputs: 2 },

  // Annotations, Bus & Custom
  { type: 'bus@logic.ly', name: 'Bus', category: 'Other', description: 'Tri-state shared bus line with contention resolution', defaultInputs: 4, defaultOutputs: 1, isVariableInput: true },
  { type: 'label@logic.ly', name: 'Text Label', category: 'Other', description: 'Schematic text annotation', defaultInputs: 0, defaultOutputs: 0 },
  { type: '%custom@logic.ly', name: 'Custom Integrated Circuit', category: 'Other', description: 'User-defined packaged subcircuit', defaultInputs: 0, defaultOutputs: 0 }
];

export function createDefaultParser(): LogiclyParser {
  const parser = new LogiclyParser();
  for (const [type, xml] of Object.entries(BUILTIN_IC_TEMPLATES)) {
    parser.registerCustomTemplate(type, xml);
  }
  return parser;
}
