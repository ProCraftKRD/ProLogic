import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { TestSuite, assert, assertEqual } from './runner';
import {
  extractFilePathFromArgv,
  readLogicFile,
  readLogicFileAsync,
  SUPPORTED_LOGIC_EXTENSIONS
} from '../electron/fileLaunch';
import { FIXTURE_68_BIN_BUFFER } from './fixtures';

export async function runShellIntegrationTests(): Promise<boolean> {
  const suite = new TestSuite('OS Shell File Integration & Launch Architecture');

  suite.test('extractFilePathFromArgv filters executables, entrypoints, and CLI flags', () => {
    // Empty / null argv
    assertEqual(extractFilePathFromArgv([]), null);
    assertEqual(extractFilePathFromArgv(null as any), null);

    // Only executables and script entrypoints
    assertEqual(extractFilePathFromArgv(['ProLogic.exe']), null);
    assertEqual(extractFilePathFromArgv(['C:\\Program Files\\ProLogic\\ProLogic.exe']), null);
    assertEqual(extractFilePathFromArgv(['electron.exe', 'dist/electron/main.js']), null);
    assertEqual(extractFilePathFromArgv(['electron', '.']), null);
    assertEqual(extractFilePathFromArgv(['node', 'src/electron/main.ts']), null);

    // Flags only
    assertEqual(extractFilePathFromArgv(['electron.exe', '--inspect=5858', '-d', '--no-sandbox']), null);
  });

  suite.test('extractFilePathFromArgv extracts supported circuit files in packaged and dev environments', () => {
    // Packaged double-click / explorer launch with primary .plgc
    const packagedPlgcArgv = [
      'C:\\Program Files\\ProLogic\\ProLogic.exe',
      'C:\\Circuits\\HalfAdder.plgc'
    ];
    assertEqual(extractFilePathFromArgv(packagedPlgcArgv), 'C:\\Circuits\\HalfAdder.plgc');

    // Packaged double-click / explorer launch with legacy .logicly
    const packagedArgv = [
      'C:\\Program Files\\ProLogic\\ProLogic.exe',
      'C:\\Circuits\\HalfAdder.logicly'
    ];
    assertEqual(extractFilePathFromArgv(packagedArgv), 'C:\\Circuits\\HalfAdder.logicly');

    // Packaged launch with CLI flags
    const packagedWithFlags = [
      'C:\\Program Files\\ProLogic\\ProLogic.exe',
      '--hidden',
      '--enable-logging',
      'C:\\Circuits\\Counter.circ'
    ];
    assertEqual(extractFilePathFromArgv(packagedWithFlags), 'C:\\Circuits\\Counter.circ');

    // Dev environment launch (electron . path/to/file)
    const devArgv = ['electron', '.', 'projects/alu.dig'];
    const resolvedDev = path.resolve(process.cwd(), 'projects/alu.dig');
    assertEqual(extractFilePathFromArgv(devArgv), resolvedDev);

    // Dev environment launch (electron dist/electron/main.js path/to/file)
    const devMainArgv = ['electron.exe', 'dist/electron/main.js', 'circuits/subcircuit.cdd'];
    const resolvedMain = path.resolve(process.cwd(), 'circuits/subcircuit.cdd');
    assertEqual(extractFilePathFromArgv(devMainArgv), resolvedMain);

    // Quoted file path
    const quotedArgv = ['ProLogic.exe', '"C:\\My Circuits\\test.simcir"'];
    assertEqual(extractFilePathFromArgv(quotedArgv), 'C:\\My Circuits\\test.simcir');
  });

  suite.test('extractFilePathFromArgv handles all universal logic file extensions', () => {
    for (const ext of SUPPORTED_LOGIC_EXTENSIONS) {
      const fileName = `test_circuit${ext}`;
      const argv = ['ProLogic.exe', fileName];
      const resolved = path.resolve(process.cwd(), fileName);
      assertEqual(extractFilePathFromArgv(argv), resolved, `Must match extension ${ext}`);

      // Also verify uppercase extension
      const upperFileName = `test_circuit${ext.toUpperCase()}`;
      const upperArgv = ['ProLogic.exe', upperFileName];
      const resolvedUpper = path.resolve(process.cwd(), upperFileName);
      assertEqual(extractFilePathFromArgv(upperArgv), resolvedUpper, `Must match case-insensitive extension ${ext}`);
    }
  });

  suite.test('extractFilePathFromArgv respects custom workingDirectory for second-instance launches', () => {
    const customWorkDir = 'D:\\LogicProjects\\Circuits';
    const relativeArgv = ['ProLogic.exe', 'modules\\adder.logicly'];
    const expected = path.resolve(customWorkDir, 'modules\\adder.logicly');
    assertEqual(extractFilePathFromArgv(relativeArgv, customWorkDir), expected);
  });

  suite.test('extractFilePathFromArgv recognizes existing file on disk', () => {
    const packageJsonPath = path.resolve(process.cwd(), 'package.json');
    const argv = ['ProLogic.exe', 'package.json'];
    assertEqual(extractFilePathFromArgv(argv), packageJsonPath);
  });

  await suite.testAsync('readLogicFile and readLogicFileAsync read and decompress circuit files', async () => {
    const tempSampleBin = path.join(os.tmpdir(), 'prologic_test_sample_68.bin');
    fs.writeFileSync(tempSampleBin, FIXTURE_68_BIN_BUFFER);
    try {
      // Synchronous read
      const syncResult = readLogicFile(tempSampleBin);
      assert(syncResult !== null, 'readLogicFile should return file data');
      assertEqual(syncResult!.filePath, tempSampleBin);
      assertEqual(syncResult!.name, 'prologic_test_sample_68.bin');
      assert(syncResult!.isCompressed, 'prologic_test_sample_68.bin is raw deflate compressed');
      assert(syncResult!.content.includes('<logicly') || syncResult!.content.includes('<circuit'), 'Content must contain decompressed circuit XML');

      // Asynchronous read
      const asyncResult = await readLogicFileAsync(tempSampleBin);
      assert(asyncResult !== null, 'readLogicFileAsync should return file data');
      assertEqual(asyncResult!.filePath, tempSampleBin);
      assertEqual(asyncResult!.content, syncResult!.content);
    } finally {
      if (fs.existsSync(tempSampleBin)) {
        try { fs.unlinkSync(tempSampleBin); } catch {}
      }
    }

    // Test native .plgc reading and decompression in OS temp directory
    const tempPlgcPath = path.join(os.tmpdir(), 'temp_test_circuit.plgc');
    try {
      const testXml = '<logicly xmlns="http://ns.logic.ly/1.2"><object type="buffer@logic.ly" uid="b1"/></logicly>';
      const { prepareFileContent } = await import('../io/compression');
      const plgcBuffer = prepareFileContent(tempPlgcPath, testXml);
      fs.writeFileSync(tempPlgcPath, plgcBuffer);

      // Synchronous read of .plgc
      const plgcSync = readLogicFile(tempPlgcPath);
      assert(plgcSync !== null, 'readLogicFile must read .plgc');
      assertEqual(plgcSync!.name, 'temp_test_circuit.plgc');
      assertEqual(plgcSync!.isCompressed, true, '.plgc must be recognized as compressed');
      assertEqual(plgcSync!.content, testXml);

      // Asynchronous read of .plgc
      const plgcAsync = await readLogicFileAsync(tempPlgcPath);
      assert(plgcAsync !== null, 'readLogicFileAsync must read .plgc');
      assertEqual(plgcAsync!.content, testXml);
      assertEqual(plgcAsync!.isCompressed, true);
    } finally {
      if (fs.existsSync(tempPlgcPath)) {
        try { fs.unlinkSync(tempPlgcPath); } catch {}
      }
    }
  });

  suite.test('package.json registers all universal fileAssociations under build config', () => {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    assert(pkg.build, 'package.json must contain build field');
    assert(Array.isArray(pkg.build.fileAssociations), 'build.fileAssociations must be an array');

    const associations: Array<{ ext: string; name: string; role: string }> = pkg.build.fileAssociations;
    const extensions = associations.map((a) => a.ext);

    assert(extensions.includes('plgc'), 'fileAssociations must include plgc');
    assert(extensions.includes('plgclib'), 'fileAssociations must include plgclib');
    assert(extensions.includes('plgcx'), 'fileAssociations must include plgcx');
    assert(extensions.includes('plgclibx'), 'fileAssociations must include plgclibx');
    assert(extensions.includes('logicly'), 'fileAssociations must include logicly');
    assert(extensions.includes('logiclylib'), 'fileAssociations must include logiclylib');
    assert(extensions.includes('circ'), 'fileAssociations must include circ');
    assert(extensions.includes('dig'), 'fileAssociations must include dig');
    assert(extensions.includes('cdd'), 'fileAssociations must include cdd');
    assert(extensions.includes('cv'), 'fileAssociations must include cv');
    assert(extensions.includes('simcir'), 'fileAssociations must include simcir');

    const plgcAssoc = associations.find((a) => a.ext === 'plgc');
    assertEqual(plgcAssoc?.role, 'Editor');
    assertEqual(plgcAssoc?.name, 'ProLogic Circuit Document');
    assertEqual(associations[0].ext, 'plgc', 'Primary file association must be .plgc');

    const logiclyAssoc = associations.find((a) => a.ext === 'logicly');
    assertEqual(logiclyAssoc?.role, 'Editor');

    const circAssoc = associations.find((a) => a.ext === 'circ');
    assertEqual(circAssoc?.role, 'Viewer');
  });

  suite.test('Initial File and Second-Instance Queue lifecycle simulation', () => {
    let pendingInitialFile: { filePath: string; name: string; content: string; isCompressed: boolean } | null = null;

    // Simulate initial launch with CLI argument using primary .plgc
    const mockCliArgv = ['ProLogic.exe', 'C:\\Circuits\\Multiplier.plgc'];
    const initialPath = extractFilePathFromArgv(mockCliArgv);
    assert(initialPath !== null);

    pendingInitialFile = {
      filePath: initialPath,
      name: path.basename(initialPath),
      content: '<circuit id="multiplier"/>',
      isCompressed: true
    };

    // Simulate renderer calling window.api.getInitialFile()
    const getInitialFileIpc = () => {
      const file = pendingInitialFile;
      pendingInitialFile = null;
      return file;
    };

    const firstFetch = getInitialFileIpc();
    assert(firstFetch !== null, 'First fetch retrieves initial launch file');
    assertEqual(firstFetch!.filePath, 'C:\\Circuits\\Multiplier.plgc');

    // Second call returns null (consumed)
    const secondFetch = getInitialFileIpc();
    assertEqual(secondFetch, null, 'Second fetch returns null because pending cache was consumed');

    // Simulate second-instance arrival: dispatches to onOpenFile with legacy .logicly file
    let openedViaEvent: any = null;
    const onOpenFileCallback = (data: any) => {
      openedViaEvent = data;
    };

    const secondInstanceArgv = ['ProLogic.exe', 'C:\\Circuits\\Legacy_ALU.logicly'];
    const secondPath = extractFilePathFromArgv(secondInstanceArgv);
    assert(secondPath !== null);

    onOpenFileCallback({
      filePath: secondPath,
      name: path.basename(secondPath),
      content: '<circuit id="alu"/>',
      isCompressed: true
    });

    assert(openedViaEvent !== null, 'Second-instance event dispatches to onOpenFile');
    assertEqual(openedViaEvent.filePath, 'C:\\Circuits\\Legacy_ALU.logicly');
  });

  return suite.report();
}
