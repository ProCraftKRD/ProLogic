import { isXmlData, decompressLogiclyData } from '../compression';

export type CircuitFormat = 'logicly' | 'logisim' | 'digital' | 'simcir' | 'circuitverse' | 'netlist' | 'unknown';

export interface FormatDetectionResult {
  format: CircuitFormat;
  confidence: number;
  isCompressed?: boolean;
  decompressedText?: string;
  detectedExtension?: string;
}

/**
 * Detects the circuit file format based on filename extension, binary magic bytes,
 * XML tags, or JSON keys.
 */
export function detectCircuitFormat(
  content: string | Uint8Array | Buffer,
  filename?: string
): FormatDetectionResult {
  let text = '';
  let isCompressed = false;

  // 1. Process binary buffer if provided
  if (typeof content !== 'string') {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content.buffer, content.byteOffset, content.byteLength);
    if (isXmlData(buf)) {
      text = buf.toString('utf-8');
    } else {
      try {
        const decomp = decompressLogiclyData(buf);
        if (decomp.isCompressed && decomp.xml) {
          text = decomp.xml;
          isCompressed = true;
        } else {
          text = buf.toString('utf-8');
        }
      } catch {
        text = buf.toString('utf-8');
      }
    }
  } else {
    text = content;
  }

  const ext = filename ? getFileExtension(filename).toLowerCase() : '';

  // 2. Direct extension checks with high confidence if matching known format extensions
  if (ext === 'plgc' || ext === 'plgclib' || ext === 'plgcx' || ext === 'plgclibx') {
    return { format: 'logicly', confidence: 0.99, isCompressed, detectedExtension: ext, decompressedText: text };
  }
  if (ext === 'circ') {
    return { format: 'logisim', confidence: 0.99, detectedExtension: ext, decompressedText: text };
  }
  if (ext === 'dig') {
    return { format: 'digital', confidence: 0.99, detectedExtension: ext, decompressedText: text };
  }
  if (ext === 'simcir') {
    return { format: 'simcir', confidence: 0.99, detectedExtension: ext, decompressedText: text };
  }
  if (ext === 'cdd' || ext === 'cv') {
    return { format: 'circuitverse', confidence: 0.99, detectedExtension: ext, decompressedText: text };
  }
  if (ext === 'logicly' || ext === 'logiclylib' || ext === 'logiclyx' || ext === 'logiclylibx') {
    return { format: 'logicly', confidence: 0.99, isCompressed, detectedExtension: ext, decompressedText: text };
  }

  // 3. Inspect text content
  const trimmed = text.trim();

  // 3a. JSON-based formats (SimcirJS, CircuitVerse)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);

      // SimcirJS check
      if (
        (parsed && Array.isArray(parsed.devices) && Array.isArray(parsed.connectors)) ||
        (parsed && Array.isArray(parsed.devices) && parsed.width !== undefined) ||
        (parsed && parsed.toolbox && Array.isArray(parsed.devices))
      ) {
        return { format: 'simcir', confidence: 0.95, detectedExtension: ext, decompressedText: text };
      }

      // CircuitVerse check
      if (
        (parsed && Array.isArray(parsed.scopes)) ||
        (parsed && (Array.isArray(parsed.allElementList) || Array.isArray(parsed.allNodes))) ||
        (parsed && parsed.projectId && parsed.focussedCircuit !== undefined)
      ) {
        return { format: 'circuitverse', confidence: 0.95, detectedExtension: ext, decompressedText: text };
      }

      // Logicly JSON (if any)
      if (parsed && (parsed.logicly || (parsed.objects && parsed.connections))) {
        return { format: 'logicly', confidence: 0.9, detectedExtension: ext, decompressedText: text };
      }
    } catch {
      // Not valid JSON, continue to string analysis
    }
  }

  // 3b. XML-based formats (Logisim, Digital, Logicly)
  const lower = trimmed.toLowerCase();

  // Logisim .circ detection
  if (
    lower.includes('<project') &&
    (lower.includes('<circuit') || lower.includes('source=') || lower.includes('com.cburch.logisim') || lower.includes('<lib desc='))
  ) {
    return { format: 'logisim', confidence: 0.98, detectedExtension: ext, decompressedText: text };
  }

  // Digital by HNeemann .dig detection
  if (
    lower.includes('<visualelements>') ||
    lower.includes('<visualelement>') ||
    (lower.includes('<elementname>') && lower.includes('<wires>')) ||
    (lower.includes('<circuit>') && lower.includes('<visualelement'))
  ) {
    return { format: 'digital', confidence: 0.98, detectedExtension: ext, decompressedText: text };
  }

  // XML Schematic Netlist detection (<Circuit><Components>...<Connections><Net>...)
  if (
    (lower.includes('<components') && (lower.includes('<connections') || lower.includes('<net'))) ||
    (lower.includes('<component') && (lower.includes('<net') || lower.includes('<connections')))
  ) {
    return { format: 'netlist', confidence: 0.98, detectedExtension: ext, decompressedText: text };
  }

  // Logicly native XML detection
  if (
    lower.includes('http://ns.logic.ly') ||
    lower.includes('<logicly') ||
    (lower.includes('<circuit') && lower.includes('<object') && lower.includes('<connection'))
  ) {
    return { format: 'logicly', confidence: 0.98, isCompressed, detectedExtension: ext, decompressedText: text };
  }

  // 4. Secondary heuristics if extension is known
  if (ext === 'xml') {
    if (lower.includes('elementname') || lower.includes('visualelement')) {
      return { format: 'digital', confidence: 0.8, detectedExtension: ext, decompressedText: text };
    }
    if (lower.includes('project') || lower.includes('wire from=')) {
      return { format: 'logisim', confidence: 0.8, detectedExtension: ext, decompressedText: text };
    }
    return { format: 'logicly', confidence: 0.6, detectedExtension: ext, decompressedText: text };
  }

  if (ext === 'json') {
    if (lower.includes('connector') || lower.includes('devices')) {
      return { format: 'simcir', confidence: 0.8, detectedExtension: ext, decompressedText: text };
    }
    if (lower.includes('scopes') || lower.includes('allelementlist') || lower.includes('wirelist')) {
      return { format: 'circuitverse', confidence: 0.8, detectedExtension: ext, decompressedText: text };
    }
  }

  return { format: 'unknown', confidence: 0, detectedExtension: ext, decompressedText: text };
}

function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) return '';
  return filename.substring(lastDot + 1);
}
