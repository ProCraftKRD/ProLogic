import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { decompressLogiclyData, prepareFileContent } from '../io/compression';
import {
  extractFilePathFromArgv,
  readLogicFile,
  readLogicFileAsync,
  OpenFileData,
  SUPPORTED_LOGIC_EXTENSIONS
} from './fileLaunch';

export { extractFilePathFromArgv, readLogicFile, readLogicFileAsync, SUPPORTED_LOGIC_EXTENSIONS, OpenFileData };

// Single-Instance Lock: Quit immediately if another instance is running
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  let splashWindow: BrowserWindow | null = null;
  let pendingInitialFile: OpenFileData | null = null;
  let isForceClosing = false;

  // Initial File Launch Handling: check process.argv on initial launch
  const initialFilePath = extractFilePathFromArgv(process.argv);
  if (initialFilePath) {
    const initialData = readLogicFile(initialFilePath);
    if (initialData) {
      pendingInitialFile = initialData;
    }
  }

  // Dispatches file to renderer or caches it if window is not yet ready
  const dispatchOpenFile = async (filePath: string) => {
    const fileData = await readLogicFileAsync(filePath);
    if (!fileData) return;

    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
      mainWindow.webContents.send('file:open-external', fileData);
    } else {
      pendingInitialFile = fileData;
    }
  };

  // Listen to second instance launch (e.g. CLI, file double-click while already running)
  app.on('second-instance', async (_event, argv, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }

    const filePath = extractFilePathFromArgv(argv, workingDirectory);
    if (filePath) {
      await dispatchOpenFile(filePath);
    }
  });

  // macOS open-file event handler
  app.on('open-file', async (event, filePath) => {
    event.preventDefault();
    await dispatchOpenFile(filePath);
  });

  function createSplash(iconPath: string): void {
    splashWindow = new BrowserWindow({
      width: 500,
      height: 310,
      frame: false,
      resizable: false,
      center: true,
      show: false,
      backgroundColor: '#121620',
      alwaysOnTop: true,
      skipTaskbar: false,
      icon: iconPath,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    const splashPath = path.join(__dirname, '../ui/splash.html');
    splashWindow.loadFile(splashPath);

    splashWindow.once('ready-to-show', () => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.show();
        splashWindow.focus();
      }
    });

    splashWindow.on('closed', () => {
      splashWindow = null;
    });
  }

  function createWindow(): void {
    const iconPath = fs.existsSync(path.join(__dirname, '../../build/icon.ico'))
      ? path.join(__dirname, '../../build/icon.ico')
      : fs.existsSync(path.join(__dirname, '../../build/icon.png'))
      ? path.join(__dirname, '../../build/icon.png')
      : path.join(__dirname, '../ui/assets/logo.png');

    // Launch splash screen first for smooth startup
    createSplash(iconPath);

    mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 500,
      minHeight: 400,
      title: 'ProLogic v1.0.0 - Digital Logic Simulator',
      icon: iconPath,
      backgroundColor: '#161922',
      frame: false,
      titleBarStyle: 'hidden',
      titleBarOverlay: false,
      show: false, // Initially hidden while splash screen runs
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true
      },
      autoHideMenuBar: true
    });

    // Load the web app index.html
    const indexPath = path.join(__dirname, '../ui/index.html');
    mainWindow.loadFile(indexPath);

    const startTime = Date.now();
    const MIN_SPLASH_TIME = 2200; // Minimum time to display splash checkpoints

    let splashClosed = false;
    const finishSplash = () => {
      if (splashClosed) return;
      splashClosed = true;

      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, MIN_SPLASH_TIME - elapsed);

      setTimeout(() => {
        if (splashWindow && !splashWindow.isDestroyed()) {
          splashWindow.close();
          splashWindow = null;
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
      }, remaining);
    };

    mainWindow.webContents.once('did-finish-load', finishSplash);

    // Safety fallback: ensure mainWindow shows even if did-finish-load is delayed
    setTimeout(() => {
      finishSplash();
    }, 4500);

    mainWindow.on('maximize', () => {
      mainWindow?.webContents.send('window:maximized-change', true);
    });

    mainWindow.on('unmaximize', () => {
      mainWindow?.webContents.send('window:maximized-change', false);
    });

    mainWindow.on('close', (e) => {
      if (isForceClosing) {
        return;
      }
      e.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('window:request-close');
      }
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
      }
    });
  }

  app.on('before-quit', () => {
    // Allows clean shutdown on explicit app quit / OS termination
  });

  app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // IPC Handlers for native file dialogs and shell integration
  ipcMain.handle('file:getInitialFile', async () => {
    const file = pendingInitialFile;
    pendingInitialFile = null;
    return file;
  });

  ipcMain.handle('dialog:openFile', async () => {
    if (!mainWindow) return { canceled: true };
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Circuit or Library',
      filters: [
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
      ],
      properties: ['openFile']
    });

    if (res.canceled || res.filePaths.length === 0) {
      return { canceled: true };
    }

    const filePath = res.filePaths[0];
    const buffer = await fs.promises.readFile(filePath);
    const decompressed = decompressLogiclyData(buffer);
    return {
      canceled: false,
      filePath,
      name: path.basename(filePath),
      content: decompressed.xml,
      isCompressed: decompressed.isCompressed
    };
  });

  const performSaveDialog = async (
    defaultName?: string,
    content?: string,
    compress?: boolean,
    strictPlgc?: boolean
  ) => {
    if (!mainWindow) return { canceled: true };
    const lowerName = (defaultName || '').toLowerCase();
    const isPng = lowerName.endsWith('.png');
    const isSvg = lowerName.endsWith('.svg');

    let dialogTitle = 'Save Circuit Document';
    let filters: Electron.FileFilter[];

    if (strictPlgc) {
      dialogTitle = 'Save ProLogic Circuit';
      filters = [
        { name: 'ProLogic Circuit (*.plgc)', extensions: ['plgc'] }
      ];
    } else if (isPng && !content?.startsWith('<')) {
      dialogTitle = 'Export PNG Schematic';
      filters = [
        { name: 'PNG Image (*.png)', extensions: ['png'] },
        { name: 'All Files (*.*)', extensions: ['*'] }
      ];
    } else if (isSvg) {
      dialogTitle = 'Export SVG Schematic';
      filters = [
        { name: 'Scalable Vector Graphics (*.svg)', extensions: ['svg'] },
        { name: 'All Files (*.*)', extensions: ['*'] }
      ];
    } else {
      dialogTitle = 'Save Circuit Document';
      filters = [
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
    }

    let defaultPath = defaultName;
    if (strictPlgc) {
      if (!defaultPath) {
        defaultPath = 'circuit.plgc';
      } else if (!defaultPath.toLowerCase().endsWith('.plgc')) {
        defaultPath = defaultPath.replace(/\.[^/.]+$/, '') + '.plgc';
      }
    } else if (!defaultPath) {
      defaultPath = isPng ? 'circuit.png' : 'circuit.plgc';
    }

    const res = await dialog.showSaveDialog(mainWindow, {
      title: dialogTitle,
      defaultPath,
      filters
    });

    if (res.canceled || !res.filePath) {
      return { canceled: true };
    }

    if (typeof content === 'string') {
      const lowerSelected = res.filePath.toLowerCase();
      const isSavingPng = lowerSelected.endsWith('.png');
      const isSavingLib =
        lowerSelected.endsWith('.plgclib') ||
        lowerSelected.endsWith('.plgclibx') ||
        lowerSelected.endsWith('.logiclylib') ||
        lowerSelected.endsWith('.logiclylibx');

      if (isSavingPng) {
        if (content.startsWith('data:image/png;base64,') || !content.trim().startsWith('<')) {
          const base64Data = content.includes(',') ? content.split(',')[1] : content;
          const buffer = Buffer.from(base64Data, 'base64');
          await fs.promises.writeFile(res.filePath, buffer);
        }
      } else if (isSavingLib && !content.includes('/library/')) {
        // Circuit XML passed for library save; renderer will serialize library custom packages
      } else {
        const fileBuffer = prepareFileContent(res.filePath, content, compress);
        await fs.promises.writeFile(res.filePath, fileBuffer);
      }
    }

    return {
      canceled: false,
      filePath: res.filePath
    };
  };

  ipcMain.handle('dialog:saveFileStrictPlgc', async (_event, defaultName?: string, content?: string) => {
    return performSaveDialog(defaultName, content, true, true);
  });

  ipcMain.handle('dialog:saveFile', async (_event, defaultName?: string, content?: string, compress?: boolean, strictPlgc?: boolean) => {
    return performSaveDialog(defaultName, content, compress, strictPlgc);
  });

  ipcMain.handle('file:read', async (_event, filePath: string) => {
    const buffer = await fs.promises.readFile(filePath);
    const decompressed = decompressLogiclyData(buffer);
    return decompressed.xml;
  });

  ipcMain.handle('file:write', async (_event, filePath: string, content: string, compress?: boolean) => {
    try {
      const isPng = filePath.toLowerCase().endsWith('.png') || content.startsWith('data:image/png;base64,');
      if (isPng) {
        const base64Data = content.includes(',') ? content.split(',')[1] : content;
        const buffer = Buffer.from(base64Data, 'base64');
        await fs.promises.writeFile(filePath, buffer);
      } else {
        const fileBuffer = prepareFileContent(filePath, content, compress);
        await fs.promises.writeFile(filePath, fileBuffer);
      }
      return true;
    } catch (err) {
      console.error('Failed to write file:', filePath, err);
      return false;
    }
  });

  ipcMain.handle('file:writeBinary', async (_event, filePath: string, base64Data: string) => {
    try {
      const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
      const buffer = Buffer.from(cleanBase64, 'base64');
      await fs.promises.writeFile(filePath, buffer);
      return true;
    } catch (err) {
      console.error('Failed to write binary file:', filePath, err);
      return false;
    }
  });

  ipcMain.on('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.on('window:close', () => {
    mainWindow?.close();
  });

  ipcMain.on('window:force-close', () => {
    isForceClosing = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  });

  ipcMain.handle('window:isMaximized', () => {
    return mainWindow?.isMaximized() ?? false;
  });

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
      await shell.openExternal(url);
    }
  });
}
