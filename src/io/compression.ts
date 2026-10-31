// Node.js zlib support with browser fallback
let nodeZlib: any = null;
try {
  if (typeof require !== 'undefined') {
    nodeZlib = require('zlib');
  }
} catch {
  // Browser or bundled environment
}

function getZlib(): any {
  if (nodeZlib) return nodeZlib;
  try {
    if (typeof require !== 'undefined') {
      nodeZlib = require('zlib');
      return nodeZlib;
    }
  } catch {
    // Ignored in browser
  }
  return null;
}

export interface DecompressResult {
  xml: string;
  isCompressed: boolean;
  method?: 'deflate-raw' | 'deflate-zlib' | 'gzip' | 'none';
}

/**
 * Checks whether the given buffer starts with XML '<' (accounting for optional UTF-8 BOM and leading whitespace).
 */
export function isXmlData(buffer: Buffer | Uint8Array): boolean {
  let start = 0;
  // Check for UTF-8 BOM (0xEF, 0xBB, 0xBF)
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    start = 3;
  }

  // Skip leading whitespace: space (0x20), tab (0x09), LF (0x0A), CR (0x0D)
  while (
    start < buffer.length &&
    (buffer[start] === 0x20 ||
      buffer[start] === 0x09 ||
      buffer[start] === 0x0a ||
      buffer[start] === 0x0d)
  ) {
    start++;
  }

  // Check if first non-whitespace character is '<' (0x3C)
  return start < buffer.length && buffer[start] === 0x3c;
}

/**
 * Decompresses raw deflate, zlib, or gzip buffer into UTF-8 XML string.
 * If data is already plain XML, returns it directly as UTF-8 string.
 */
export function decompressLogiclyData(buffer: Buffer): DecompressResult {
  if (isXmlData(buffer)) {
    return {
      xml: buffer.toString('utf-8'),
      isCompressed: false,
      method: 'none'
    };
  }

  const z = getZlib();
  if (!z) {
    return {
      xml: buffer.toString('utf-8'),
      isCompressed: false,
      method: 'none'
    };
  }

  // 1. Try raw deflate (Logicly's standard compression format: windowBits = -15)
  try {
    const inflated = z.inflateRawSync(buffer);
    return {
      xml: inflated.toString('utf-8'),
      isCompressed: true,
      method: 'deflate-raw'
    };
  } catch (errRaw) {
    // 2. Try standard zlib (deflate with zlib header)
    try {
      const inflated = z.inflateSync(buffer);
      return {
        xml: inflated.toString('utf-8'),
        isCompressed: true,
        method: 'deflate-zlib'
      };
    } catch (errZlib) {
      // 3. Try gzip
      try {
        const gunzipped = z.gunzipSync(buffer);
        return {
          xml: gunzipped.toString('utf-8'),
          isCompressed: true,
          method: 'gzip'
        };
      } catch (errGzip) {
        // Fallback: return as UTF-8 string
        return {
          xml: buffer.toString('utf-8'),
          isCompressed: false,
          method: 'none'
        };
      }
    }
  }
}

/**
 * Compresses an XML string into Logicly-compatible raw deflate binary data.
 */
export function compressLogiclyData(xml: string): Buffer {
  const z = getZlib();
  if (z && typeof z.deflateRawSync === 'function') {
    return z.deflateRawSync(Buffer.from(xml, 'utf-8'));
  }
  return Buffer.from(xml, 'utf-8');
}

/**
 * Prepares file content for writing based on target extension or compression flag.
 * If target file is .plgc, .plgclib, .logicly, or .logiclylib (or compress is true), returns raw deflate buffer.
 * If target is .plgcx, .plgclibx, .logiclyx, .logiclylibx, or .xml (or compress is false), returns plain UTF-8 buffer.
 */
export function prepareFileContent(filePath: string, xml: string, compress?: boolean): Buffer {
  const lower = filePath.toLowerCase();
  const shouldCompress =
    compress !== undefined
      ? compress
      : lower.endsWith('.plgc') ||
        lower.endsWith('.plgclib') ||
        lower.endsWith('.logicly') ||
        lower.endsWith('.logiclylib');

  if (shouldCompress) {
    return compressLogiclyData(xml);
  }
  return Buffer.from(xml, 'utf-8');
}
