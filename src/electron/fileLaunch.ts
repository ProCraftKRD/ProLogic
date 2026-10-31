import * as path from 'path';
import * as fs from 'fs';
import { decompressLogiclyData } from '../io/compression';

export const SUPPORTED_LOGIC_EXTENSIONS = [
  '.plgc',
  '.plgclib',
  '.plgcx',
  '.plgclibx',
  '.logicly',
  '.logiclylib',
  '.logiclyx',
  '.logiclylibx',
  '.circ',
  '.dig',
  '.cdd',
  '.cv',
  '.simcir',
  '.xml',
  '.json'
];

export interface OpenFileData {
  filePath: string;
  name: string;
  content: string;
  isCompressed: boolean;
}

/**
 * Extracts a candidate file path from an argument vector (process.argv or second-instance argv).
 * Handles packaged executables, dev environments, relative paths, and OS flags.
 */
export function extractFilePathFromArgv(argv: string[], workingDir: string = process.cwd()): string | null {
  if (!argv || !Array.isArray(argv)) return null;

  for (let i = 0; i < argv.length; i++) {
    const rawArg = argv[i];
    if (!rawArg) continue;
    const arg = rawArg.trim().replace(/^["']|["']$/g, '');
    if (!arg) continue;

    // Skip flags (e.g. -d, --inspect, --allow-file-access-from-files)
    if (arg.startsWith('-')) continue;

    // Skip current/parent directory references
    if (arg === '.' || arg === '..') continue;

    const lower = arg.toLowerCase();

    // Skip executables and script entrypoints
    if (
      lower.endsWith('.exe') ||
      lower.endsWith('main.js') ||
      lower.endsWith('main.ts') ||
      lower.endsWith('electron')
    ) {
      continue;
    }

    const resolved = path.isAbsolute(arg) ? arg : path.resolve(workingDir, arg);
    const ext = path.extname(arg).toLowerCase();

    // Check if the argument ends with a known logic extension
    if (SUPPORTED_LOGIC_EXTENSIONS.includes(ext)) {
      if (fs.existsSync(resolved)) {
        try {
          if (fs.statSync(resolved).isFile()) {
            return resolved;
          }
        } catch {
          return resolved;
        }
      }
      return resolved;
    }

    // Check if it is an existing file on disk
    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        return resolved;
      }
    } catch {
      // Ignore filesystem check errors
    }
  }

  return null;
}

/**
 * Synchronously reads a circuit or logic file, decompressing raw deflate if necessary.
 */
export function readLogicFile(filePath: string): OpenFileData | null {
  try {
    const buffer = fs.readFileSync(filePath);
    const decompressed = decompressLogiclyData(buffer);
    return {
      filePath,
      name: path.basename(filePath),
      content: decompressed.xml,
      isCompressed: decompressed.isCompressed
    };
  } catch (err) {
    console.error('Failed to read logic file synchronously:', filePath, err);
    return null;
  }
}

/**
 * Asynchronously reads a circuit or logic file, decompressing raw deflate if necessary.
 */
export async function readLogicFileAsync(filePath: string): Promise<OpenFileData | null> {
  try {
    const buffer = await fs.promises.readFile(filePath);
    const decompressed = decompressLogiclyData(buffer);
    return {
      filePath,
      name: path.basename(filePath),
      content: decompressed.xml,
      isCompressed: decompressed.isCompressed
    };
  } catch (err) {
    console.error('Failed to read logic file asynchronously:', filePath, err);
    return null;
  }
}
