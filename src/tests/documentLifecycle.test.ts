import { TestSuite, assert, assertEqual } from './runner';
import { prepareFileContent, decompressLogiclyData } from '../io/compression';

export async function runDocumentLifecycleTests(): Promise<boolean> {
  const suite = new TestSuite('Document Lifecycle & Save/Save As Architecture');

  const sampleXml = '<xml><circuit version="1.0"><components/><connections/></circuit></xml>';

  suite.test('prepareFileContent handles case-insensitive extensions and compression flags', () => {
    // ProLogic Circuit (.plgc) & IC Library (.plgclib) - Primary native extensions (compressed)
    const bufPlgcLower = prepareFileContent('circuit.plgc', sampleXml);
    assert(decompressLogiclyData(bufPlgcLower).isCompressed, '.plgc must be compressed');

    const bufPlgcUpper = prepareFileContent('CIRCUIT.PLGC', sampleXml);
    assert(decompressLogiclyData(bufPlgcUpper).isCompressed, '.PLGC must be compressed');

    const bufPlgclib = prepareFileContent('chips.plgclib', sampleXml);
    assert(decompressLogiclyData(bufPlgclib).isCompressed, '.plgclib must be compressed');

    // Uncompressed ProLogic formats (.plgcx, .plgclibx)
    const bufPlgcx = prepareFileContent('circuit.plgcx', sampleXml);
    assert(!decompressLogiclyData(bufPlgcx).isCompressed, '.plgcx must remain uncompressed');
    assertEqual(bufPlgcx.toString('utf-8'), sampleXml);

    const bufPlgclibx = prepareFileContent('library.plgclibx', sampleXml);
    assert(!decompressLogiclyData(bufPlgclibx).isCompressed, '.plgclibx must remain uncompressed');
    assertEqual(bufPlgclibx.toString('utf-8'), sampleXml);

    // Backward-compatible Logicly extensions (.logicly, .logiclylib)
    const bufLower = prepareFileContent('circuit.logicly', sampleXml);
    assert(decompressLogiclyData(bufLower).isCompressed, '.logicly must be compressed');

    // Uppercase
    const bufUpper = prepareFileContent('CIRCUIT.LOGICLY', sampleXml);
    assert(decompressLogiclyData(bufUpper).isCompressed, '.LOGICLY must be compressed');

    // Mixed case library
    const bufLibUpper = prepareFileContent('Custom.LogiclyLib', sampleXml);
    assert(decompressLogiclyData(bufLibUpper).isCompressed, '.LogiclyLib must be compressed');

    // Uncompressed XML and logiclyx
    const bufXml = prepareFileContent('circuit.xml', sampleXml);
    assert(!decompressLogiclyData(bufXml).isCompressed, '.xml must remain uncompressed');
    assertEqual(bufXml.toString('utf-8'), sampleXml);

    const bufLogiclyx = prepareFileContent('circuit.LOGICLYX', sampleXml);
    assert(!decompressLogiclyData(bufLogiclyx).isCompressed, '.LOGICLYX must remain uncompressed');

    // Explicit override flags
    const bufExplicitRawPlgc = prepareFileContent('circuit.plgc', sampleXml, false);
    assert(!decompressLogiclyData(bufExplicitRawPlgc).isCompressed, 'Explicit compress=false overrides .plgc');

    const bufExplicitRaw = prepareFileContent('circuit.logicly', sampleXml, false);
    assert(!decompressLogiclyData(bufExplicitRaw).isCompressed, 'Explicit compress=false overrides extension');

    const bufExplicitComp = prepareFileContent('circuit.xml', sampleXml, true);
    assert(decompressLogiclyData(bufExplicitComp).isCompressed, 'Explicit compress=true overrides extension');
  });

  suite.test('Document title and dirty state indicator synchronization', () => {
    let currentDocumentTitle = 'Half Adder';
    let isDirty = false;
    let windowTitle = '';
    let indicatorVisible = false;

    const setDocumentTitle = (title: string, dirty: boolean = false) => {
      currentDocumentTitle = title;
      setDirty(dirty);
    };

    const setDirty = (dirty: boolean) => {
      isDirty = dirty;
      indicatorVisible = dirty;
      const dirtySuffix = dirty ? ' •' : '';
      windowTitle = `${currentDocumentTitle}${dirtySuffix}`;
    };

    // Initial state: pristine Half Adder
    setDocumentTitle('Half Adder', false);
    assertEqual(windowTitle, 'Half Adder');
    assertEqual(indicatorVisible, false);
    assertEqual(isDirty, false);

    // Mutation occurs: mark dirty
    setDirty(true);
    assertEqual(windowTitle, 'Half Adder •');
    assertEqual(indicatorVisible, true);
    assertEqual(isDirty, true);

    // Saved: clear dirty
    setDirty(false);
    assertEqual(windowTitle, 'Half Adder');
    assertEqual(indicatorVisible, false);
    assertEqual(isDirty, false);

    // Save As new filename with native .plgc: title updates and remains clean
    setDocumentTitle('FullAdder_v2.plgc', false);
    assertEqual(windowTitle, 'FullAdder_v2.plgc');
    assertEqual(indicatorVisible, false);
    assertEqual(isDirty, false);

    // New mutation on saved document
    setDirty(true);
    assertEqual(windowTitle, 'FullAdder_v2.plgc •');
    assertEqual(indicatorVisible, true);

    // Backward compatibility: opening or saving as .logicly
    setDocumentTitle('Legacy_ALU.logicly', false);
    assertEqual(windowTitle, 'Legacy_ALU.logicly');
    assertEqual(indicatorVisible, false);
    assertEqual(isDirty, false);
  });

  await suite.testAsync('Save / Save As Document Lifecycle Model & Repetitive Prompt Prevention', async () => {
    let currentFilePath: string | null = null;
    let currentDocumentTitle = 'Half Adder';
    let isDirty = false;
    let saveDialogCallCount = 0;
    let writeFileCallCount = 0;
    let lastWrittenPath: string | null = null;
    let lastWrittenContent: string | null = null;
    let dialogReturnValue: { canceled: boolean; filePath?: string } = { canceled: false, filePath: 'C:/Circuits/my_circuit.plgc' };

    const mockApi = {
      saveFileDialog: async (defaultPath: string, content: string) => {
        saveDialogCallCount++;
        if (!dialogReturnValue.canceled && dialogReturnValue.filePath) {
          lastWrittenPath = dialogReturnValue.filePath;
          lastWrittenContent = content;
        }
        return dialogReturnValue;
      },
      writeFile: async (filePath: string, content: string) => {
        writeFileCallCount++;
        lastWrittenPath = filePath;
        lastWrittenContent = content;
        return true;
      }
    };

    const getFileName = (p: string) => p.split(/[/\\]/).pop() || p;

    const handleSaveFileAs = async () => {
      const xml = sampleXml;
      let defaultPath = currentFilePath;
      if (!defaultPath) {
        defaultPath = currentDocumentTitle ? `${currentDocumentTitle}.plgc` : 'circuit.plgc';
      }

      const res = await mockApi.saveFileDialog(defaultPath, xml);
      if (res.canceled || !res.filePath) {
        return;
      }
      currentFilePath = res.filePath;
      const fileName = getFileName(res.filePath);
      currentDocumentTitle = fileName;
      isDirty = false;
    };

    const handleSaveFile = async () => {
      if (currentFilePath) {
        const xml = sampleXml;
        await mockApi.writeFile(currentFilePath, xml);
        isDirty = false;
        return;
      }
      await handleSaveFileAs();
    };

    const handleOpenFile = (openedPath: string) => {
      currentFilePath = openedPath;
      currentDocumentTitle = getFileName(openedPath);
      isDirty = false;
    };

    const handleLoadSample = (sampleName: string) => {
      currentFilePath = null;
      currentDocumentTitle = sampleName;
      isDirty = false;
    };

    const handleNewCircuit = () => {
      currentFilePath = null;
      currentDocumentTitle = 'Untitled Circuit';
      isDirty = false;
    };

    // 1. Initial State: Newly created / sample circuit, _currentFilePath is null
    assertEqual(currentFilePath, null);
    isDirty = true;

    // 2. First Save: Triggers Save As dialog because currentFilePath is null; defaults to .plgc
    dialogReturnValue = { canceled: false, filePath: 'C:/Circuits/adder.plgc' };
    await handleSaveFile();
    assertEqual(saveDialogCallCount, 1, 'First save must open save dialog');
    assertEqual(writeFileCallCount, 0, 'First save delegates to save dialog');
    assertEqual(currentFilePath, 'C:/Circuits/adder.plgc');
    assertEqual(currentDocumentTitle, 'adder.plgc');
    assertEqual(isDirty, false, 'Dirty state cleared on successful save');

    // 3. Subsequent Save (Ctrl+S): MUST NOT open save dialog! Saves directly to currentFilePath
    isDirty = true;
    await handleSaveFile();
    assertEqual(saveDialogCallCount, 1, 'Subsequent save must NOT open save dialog');
    assertEqual(writeFileCallCount, 1, 'Subsequent save calls writeFile directly');
    assertEqual(lastWrittenPath, 'C:/Circuits/adder.plgc');
    assertEqual(isDirty, false, 'Dirty state cleared after direct overwrite');

    // 4. Save As (Ctrl+Shift+S): Allows saving to .logicly for backward compatibility
    dialogReturnValue = { canceled: false, filePath: 'D:/Backups/adder_backup.logicly' };
    await handleSaveFileAs();
    assertEqual(saveDialogCallCount, 2, 'Save As must always prompt');
    assertEqual(currentFilePath, 'D:/Backups/adder_backup.logicly', 'Current file path updated to new path');
    assertEqual(currentDocumentTitle, 'adder_backup.logicly');
    assertEqual(isDirty, false);

    // 5. Save As Cancellation: Aborts without modifying path or dirty state
    isDirty = true;
    dialogReturnValue = { canceled: true };
    await handleSaveFileAs();
    assertEqual(saveDialogCallCount, 3);
    assertEqual(currentFilePath, 'D:/Backups/adder_backup.logicly', 'Path remains intact on cancel');
    assertEqual(isDirty, true, 'Dirty state remains true on cancel');

    // 6. Loading a sample circuit resets currentFilePath to null
    handleLoadSample('4-Bit Ripple Counter');
    assertEqual(currentFilePath, null, 'Sample circuit resets currentFilePath to null');
    assertEqual(currentDocumentTitle, '4-Bit Ripple Counter');

    // Next save will prompt again and default to .plgc
    dialogReturnValue = { canceled: false, filePath: 'C:/Circuits/my_counter.plgc' };
    await handleSaveFile();
    assertEqual(saveDialogCallCount, 4, 'Saving loaded sample prompts for destination');
    assertEqual(currentFilePath, 'C:/Circuits/my_counter.plgc');

    // 7. Creating a New Circuit resets currentFilePath to null
    handleNewCircuit();
    assertEqual(currentFilePath, null, 'New circuit resets currentFilePath to null');
    assertEqual(currentDocumentTitle, 'Untitled Circuit');

    // 8. Opening a .logicly file records currentFilePath so subsequent saves overwrite cleanly
    handleOpenFile('C:/LogicProjects/alu.logicly');
    assertEqual(currentFilePath, 'C:/LogicProjects/alu.logicly');
    assertEqual(currentDocumentTitle, 'alu.logicly');

    isDirty = true;
    await handleSaveFile();
    assertEqual(saveDialogCallCount, 4, 'Saving opened file directly overwrites without dialog prompt');
    assertEqual(writeFileCallCount, 2);
    assertEqual(lastWrittenPath, 'C:/LogicProjects/alu.logicly');
    assertEqual(isDirty, false);

    // 9. Opening a native .plgc file records currentFilePath so subsequent saves overwrite cleanly
    handleOpenFile('C:/LogicProjects/alu_v2.plgc');
    assertEqual(currentFilePath, 'C:/LogicProjects/alu_v2.plgc');
    assertEqual(currentDocumentTitle, 'alu_v2.plgc');

    isDirty = true;
    await handleSaveFile();
    assertEqual(saveDialogCallCount, 4);
    assertEqual(writeFileCallCount, 3);
    assertEqual(lastWrittenPath, 'C:/LogicProjects/alu_v2.plgc');
    assertEqual(isDirty, false);
  });

  suite.test('Save and Open dialog filter configurations prioritize .plgc while preserving all formats', () => {
    // Strict Save Dialog filters: ONLY .plgc
    const strictSaveFilters = [
      { name: 'ProLogic Circuit (*.plgc)', extensions: ['plgc'] }
    ];
    assertEqual(strictSaveFilters.length, 1, 'Strict Save filter must have exactly 1 file option');
    assertEqual(strictSaveFilters[0].extensions[0], 'plgc');

    // Expected Save As Dialog filters with all 11 file formats
    const saveAsFilters = [
      { name: 'ProLogic Circuit (*.plgc)', extensions: ['plgc'] },
      { name: 'ProLogic IC Library (*.plgclib)', extensions: ['plgclib'] },
      { name: 'ProLogic Uncompressed Circuit (*.plgcx)', extensions: ['plgcx'] },
      { name: 'ProLogic Uncompressed Library (*.plgclibx)', extensions: ['plgclibx'] },
      { name: 'PNG Image (*.png)', extensions: ['png'] },
      { name: 'Logicly Circuit (*.logicly)', extensions: ['logicly'] },
      { name: 'Logicly IC Library (*.logiclylib)', extensions: ['logiclylib'] },
      { name: 'Logicly Uncompressed Circuit (*.logiclyx)', extensions: ['logiclyx'] },
      { name: 'Logicly Uncompressed Library (*.logiclylibx)', extensions: ['logiclylibx'] },
      { name: 'XML Document (*.xml)', extensions: ['xml'] },
      { name: 'All Files (*.*)', extensions: ['*'] }
    ];

    assertEqual(saveAsFilters.length, 11, 'Save As must contain exactly 11 format filters');
    assertEqual(saveAsFilters[0].extensions[0], 'plgc', 'Primary save filter must be .plgc');
    assertEqual(saveAsFilters[1].extensions[0], 'plgclib', 'Second save filter must be .plgclib');
    assertEqual(saveAsFilters[2].extensions[0], 'plgcx', 'Third save filter must be .plgcx');
    assertEqual(saveAsFilters[3].extensions[0], 'plgclibx', 'Fourth save filter must be .plgclibx');
    assertEqual(saveAsFilters[4].extensions[0], 'png', 'Fifth save filter must be .png');
    assertEqual(saveAsFilters[5].extensions[0], 'logicly', 'Sixth save filter must be .logicly');
    assertEqual(saveAsFilters[6].extensions[0], 'logiclylib', 'Seventh save filter must be .logiclylib');
    assertEqual(saveAsFilters[7].extensions[0], 'logiclyx', 'Eighth save filter must be .logiclyx');
    assertEqual(saveAsFilters[8].extensions[0], 'logiclylibx', 'Ninth save filter must be .logiclylibx');
    assertEqual(saveAsFilters[9].extensions[0], 'xml', 'Tenth save filter must be .xml');
    assertEqual(saveAsFilters[10].extensions[0], '*', 'Eleventh save filter must be *');

    // Expected Open Dialog filters according to spec
    const openFilters = [
      { name: 'All Supported Logic Files (*.plgc, *.plgclib, *.plgcx, *.plgclibx, *.logicly, *.circ, *.dig, *.cdd, *.cv, *.simcir, *.xml, *.json)', extensions: ['plgc', 'plgclib', 'plgcx', 'plgclibx', 'logicly', 'circ', 'dig', 'cdd', 'cv', 'simcir', 'logiclylib', 'xml', 'json', 'logiclyx', 'logiclylibx'] },
      { name: 'ProLogic Circuit (*.plgc, *.plgcx)', extensions: ['plgc', 'plgcx'] },
      { name: 'ProLogic IC Library (*.plgclib, *.plgclibx)', extensions: ['plgclib', 'plgclibx'] },
      { name: 'Logicly Circuit (*.logicly, *.logiclyx)', extensions: ['logicly', 'logiclyx'] },
      { name: 'Logisim Circuit (*.circ)', extensions: ['circ'] },
      { name: 'Digital Circuit (*.dig)', extensions: ['dig'] },
      { name: 'CircuitVerse Document (*.cdd, *.cv, *.json)', extensions: ['cdd', 'cv', 'json'] },
      { name: 'SimcirJS Document (*.simcir, *.json)', extensions: ['simcir', 'json'] },
      { name: 'Logicly IC Library (*.logiclylib, *.logiclylibx)', extensions: ['logiclylib', 'logiclylibx'] },
      { name: 'XML Document (*.xml)', extensions: ['xml'] },
      { name: 'JSON Document (*.json)', extensions: ['json'] },
      { name: 'All Files (*.*)', extensions: ['*'] }
    ];

    assert(openFilters[0].extensions.includes('plgc'), 'All supported open filters must include plgc');
    assert(openFilters[0].extensions.includes('plgclib'), 'All supported open filters must include plgclib');
    assert(openFilters[0].extensions.includes('plgcx'), 'All supported open filters must include plgcx');
    assert(openFilters[0].extensions.includes('plgclibx'), 'All supported open filters must include plgclibx');
    assert(openFilters[0].extensions.includes('logicly'), 'All supported open filters must include logicly');
    assertEqual(openFilters[1].extensions[0], 'plgc', 'First individual format filter must be plgc');
  });

  suite.test('Roundtrip compression and decompression for native .plgc documents', () => {
    const complexCircuitXml = `<?xml version="1.0" encoding="utf-8"?>
<logicly xmlns="http://ns.logic.ly/1.2">
  <object type="switch@logic.ly" uid="sw1" x="80" y="120" rotation="0"/>
  <object type="switch@logic.ly" uid="sw2" x="80" y="180" rotation="0"/>
  <object type="gate_xor@logic.ly" uid="xor1" x="220" y="140" rotation="0"/>
  <object type="light_bulb@logic.ly" uid="bulb1" x="340" y="140" rotation="0"/>
  <connection outputUID="sw1" outputIndex="0" inputUID="xor1" inputIndex="0">
    <waypoint x="150" y="120"/>
    <waypoint x="150" y="130"/>
  </connection>
  <connection outputUID="sw2" outputIndex="0" inputUID="xor1" inputIndex="1"/>
  <connection outputUID="xor1" outputIndex="0" inputUID="bulb1" inputIndex="0"/>
</logicly>`;

    // 1. Write as .plgc
    const plgcBuffer = prepareFileContent('alu_unit.plgc', complexCircuitXml);
    assert(plgcBuffer.length > 0);
    assert(plgcBuffer.length < Buffer.byteLength(complexCircuitXml), '.plgc compressed binary should be smaller than raw XML');

    // 2. Read back .plgc
    const decompressed = decompressLogiclyData(plgcBuffer);
    assertEqual(decompressed.isCompressed, true);
    assertEqual(decompressed.method, 'deflate-raw');
    assertEqual(decompressed.xml, complexCircuitXml, 'Decompressed XML must match original circuit XML verbatim');
  });

  suite.test('Save As PNG exports binary without modifying currentFilePath', async () => {
    let currentFilePath: string | null = 'C:/Circuits/main_alu.plgc';
    let writtenBinaryPath = '';
    let writtenBinaryData = '';

    const mockApi = {
      saveFileDialog: async () => ({
        canceled: false,
        filePath: 'C:/Exports/schematic.png'
      }),
      writeBinaryFile: async (filePath: string, base64Data: string) => {
        writtenBinaryPath = filePath;
        writtenBinaryData = base64Data;
        return true;
      }
    };

    // Simulate Save As when user chooses PNG
    const res = await mockApi.saveFileDialog();
    assert(!res.canceled && Boolean(res.filePath));
    if (res.filePath.toLowerCase().endsWith('.png')) {
      const mockBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      await mockApi.writeBinaryFile(res.filePath, mockBase64);
      // Ensure currentFilePath remains the circuit path!
      assertEqual(currentFilePath, 'C:/Circuits/main_alu.plgc', 'currentFilePath must not change when exporting PNG in Save As');
      assertEqual(writtenBinaryPath, 'C:/Exports/schematic.png');
      assert(writtenBinaryData.length > 0);
    }
  });

  suite.test('Strict Save button only prompts for .plgc and enforces .plgc extension', async () => {
    let requestedStrict = false;
    let requestedFilters: Array<{ name: string; extensions: string[] }> = [];
    let savedPath = '';

    const mockApi = {
      saveFileDialog: async (defaultName: string, _content: string, _compress?: boolean, strictPlgc?: boolean) => {
        requestedStrict = !!strictPlgc;
        if (strictPlgc) {
          requestedFilters = [{ name: 'ProLogic Circuit (*.plgc)', extensions: ['plgc'] }];
          const target = defaultName.toLowerCase().endsWith('.plgc') ? defaultName : `${defaultName}.plgc`;
          savedPath = `C:/Projects/${target}`;
        }
        return { canceled: false, filePath: savedPath };
      }
    };

    // 1. Initial document without file path
    let currentFilePath: string | null = null;
    const documentTitle = 'Custom ALU';

    const cleanTitle = documentTitle.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_\- ]/g, '').trim();
    const defaultFileName = cleanTitle ? `${cleanTitle}.plgc` : 'circuit.plgc';

    const res = await mockApi.saveFileDialog(defaultFileName, sampleXml, true, true);
    assert(!res.canceled && Boolean(res.filePath));
    assertEqual(requestedStrict, true, 'Save without existing path must use strictPlgc mode');
    assertEqual(requestedFilters.length, 1, 'Strict save must provide exactly 1 filter');
    assertEqual(requestedFilters[0].name, 'ProLogic Circuit (*.plgc)');
    assertEqual(requestedFilters[0].extensions[0], 'plgc');
    assertEqual(res.filePath, 'C:/Projects/Custom ALU.plgc');
  });

  suite.test('Save As Library format serializes custom packages and formats accurately', () => {
    const libraryXml = `<logicly xmlns="http://ns.logic.ly/library/1.3">
  <custom type="demo@user" name="Demo IC" label="IC"/>
</logicly>`;

    // 1. Compressed ProLogic Library (.plgclib)
    const bufPlgclib = prepareFileContent('my_chips.plgclib', libraryXml);
    assert(decompressLogiclyData(bufPlgclib).isCompressed, '.plgclib must be raw deflate compressed');
    assertEqual(decompressLogiclyData(bufPlgclib).xml, libraryXml);

    // 2. Uncompressed ProLogic Library (.plgclibx)
    const bufPlgclibx = prepareFileContent('my_chips.plgclibx', libraryXml);
    assert(!decompressLogiclyData(bufPlgclibx).isCompressed, '.plgclibx must be uncompressed UTF-8 XML');
    assertEqual(bufPlgclibx.toString('utf-8'), libraryXml);
  });

  return suite.report();
}
