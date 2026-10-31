import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  openFileDialog: () => Promise<{ canceled: boolean; filePath?: string; name?: string; content?: string; isCompressed?: boolean }>;
  saveFileDialog: (defaultName?: string, content?: string, compress?: boolean, strictPlgc?: boolean) => Promise<{ canceled: boolean; filePath?: string }>;
  saveFileStrictPlgcDialog?: (defaultName?: string, content?: string) => Promise<{ canceled: boolean; filePath?: string }>;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string, compress?: boolean) => Promise<boolean>;
  writeBinaryFile: (filePath: string, base64Data: string) => Promise<boolean>;
  getInitialFile: () => Promise<{ filePath?: string; name?: string; content?: string; isCompressed?: boolean } | null>;
  onOpenFile: (callback: (data: { filePath: string; name: string; content: string; isCompressed: boolean }) => void) => void;
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
  forceCloseWindow?: () => void;
  onRequestClose?: (callback: () => void) => void;
  isMaximized?: () => Promise<boolean>;
  onMaximizedChange?: (callback: (isMaximized: boolean) => void) => void;
  openExternal?: (url: string) => Promise<void>;
}

const api: ElectronAPI = {
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  saveFileDialog: (defaultName?: string, content?: string, compress?: boolean, strictPlgc?: boolean) => ipcRenderer.invoke('dialog:saveFile', defaultName, content, compress, strictPlgc),
  saveFileStrictPlgcDialog: (defaultName?: string, content?: string) => ipcRenderer.invoke('dialog:saveFileStrictPlgc', defaultName, content),
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  writeFile: (filePath: string, content: string, compress?: boolean) => ipcRenderer.invoke('file:write', filePath, content, compress),
  writeBinaryFile: (filePath: string, base64Data: string) => ipcRenderer.invoke('file:writeBinary', filePath, base64Data),
  getInitialFile: () => ipcRenderer.invoke('file:getInitialFile'),
  onOpenFile: (callback: (data: { filePath: string; name: string; content: string; isCompressed: boolean }) => void) => {
    ipcRenderer.on('file:open-external', (_event, data) => callback(data));
  },
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  forceCloseWindow: () => ipcRenderer.send('window:force-close'),
  onRequestClose: (callback: () => void) => {
    ipcRenderer.on('window:request-close', () => callback());
  },
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximizedChange: (callback: (isMaximized: boolean) => void) => {
    ipcRenderer.on('window:maximized-change', (_event, isMaximized) => callback(isMaximized));
  },
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url)
};

contextBridge.exposeInMainWorld('api', api);

declare global {
  interface Window {
    api?: ElectronAPI;
  }
}
