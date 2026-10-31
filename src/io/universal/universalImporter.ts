import { ParsedCircuitDocument } from '../parser';
import { detectCircuitFormat, CircuitFormat, FormatDetectionResult } from './formatDetector';
import { LogisimAdapter } from './logisimAdapter';
import { DigitalAdapter } from './digitalAdapter';
import { SimcirAdapter } from './simcirAdapter';
import { CircuitVerseAdapter } from './circuitVerseAdapter';
import { NetlistAdapter } from './netlistAdapter';
import { LogiclyParser } from '../parser';
import { decompressLogiclyData } from '../compression';

export interface ImportOptions {
  parser?: LogiclyParser;
  idRemap?: Map<string, string>;
  forceFormat?: CircuitFormat;
}

/**
 * Unified facade for multi-format CAD circuit translation and importing into ProLogic.
 * Supports Logisim (.circ), Digital by HNeemann (.dig), SimcirJS (.simcir, .json),
 * CircuitVerse (.cdd, .cv, .json), and Logicly (.logicly, .logiclylib, .logiclyx, .logiclylibx, .xml).
 */
export class UniversalCircuitImporter {
  /**
   * Detects the circuit document format.
   */
  public static detect(content: string | Uint8Array | Buffer, filename?: string): FormatDetectionResult {
    return detectCircuitFormat(content, filename);
  }

  /**
   * Automatically detects and imports any supported digital circuit file into a ProLogic ParsedCircuitDocument.
   */
  public static importCircuit(
    content: string | Uint8Array | Buffer,
    filename?: string,
    options?: ImportOptions
  ): ParsedCircuitDocument {
    const detection = this.detect(content, filename);
    const targetFormat = options?.forceFormat || detection.format;
    const textContent = detection.decompressedText || (typeof content === 'string' ? content : Buffer.from(content).toString('utf-8'));
    const logiclyParser = options?.parser || new LogiclyParser();

    switch (targetFormat) {
      case 'logisim':
        return LogisimAdapter.importCircuit(textContent, { parser: logiclyParser, idRemap: options?.idRemap });

      case 'digital':
        return DigitalAdapter.importCircuit(textContent, { parser: logiclyParser, idRemap: options?.idRemap });

      case 'simcir':
        return SimcirAdapter.importCircuit(textContent, { parser: logiclyParser, idRemap: options?.idRemap });

      case 'circuitverse':
        return CircuitVerseAdapter.importCircuit(textContent, { parser: logiclyParser, idRemap: options?.idRemap });

      case 'netlist':
        return NetlistAdapter.importCircuit(textContent, { parser: logiclyParser, idRemap: options?.idRemap });

      case 'logicly':
        return logiclyParser.parseNative(textContent, options?.idRemap);

      default: {
        // Fallback cascade: try to detect by trial parse
        if (textContent.trim().startsWith('{') || textContent.trim().startsWith('[')) {
          try {
            return SimcirAdapter.importCircuit(textContent, { parser: logiclyParser, idRemap: options?.idRemap });
          } catch {
            try {
              return CircuitVerseAdapter.importCircuit(textContent, { parser: logiclyParser, idRemap: options?.idRemap });
            } catch {
              // Fallback
            }
          }
        }

        if (textContent.includes('<project') || textContent.includes('<wire from=')) {
          return LogisimAdapter.importCircuit(textContent, { parser: logiclyParser, idRemap: options?.idRemap });
        }

        if (textContent.includes('<visualElements>') || textContent.includes('<elementName>')) {
          return DigitalAdapter.importCircuit(textContent, { parser: logiclyParser, idRemap: options?.idRemap });
        }

        if (textContent.includes('<Components') || textContent.includes('<components') || textContent.includes('<Net ') || textContent.includes('<net ')) {
          return NetlistAdapter.importCircuit(textContent, { parser: logiclyParser, idRemap: options?.idRemap });
        }

        return logiclyParser.parseNative(textContent, options?.idRemap);
      }
    }
  }
}
