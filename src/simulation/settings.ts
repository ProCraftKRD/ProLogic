export type ThemeMode = 'dark' | 'light' | 'system';

export interface AppSettings {
  // Appearance & Theme
  themeMode: ThemeMode;

  // Editing Surface
  snapToGrid: boolean;
  snapOrthogonalWires: boolean;
  gridSize: number;
  showGrid: boolean;
  showPalette: boolean;
  skinName: 'ansi' | 'iec';

  // Wire & Signal Colors
  enableWireColors: boolean;
  highSignalColor: string;
  lowSignalColor: string;
  unknownSignalColor: string;
  hiZSignalColor: string;

  // Simulation
  limitPropagationToFrameRate: boolean;
  pauseSimulationOnChangeDocument: boolean;
  defaultFloatSignal: 'undefined' | 'false' | 'true';
}

export const DEFAULT_SETTINGS: AppSettings = {
  themeMode: 'system',

  snapToGrid: true,
  snapOrthogonalWires: true,
  gridSize: 15,
  showGrid: true,
  showPalette: true,
  skinName: 'ansi',

  enableWireColors: true,
  highSignalColor: '#00f5d4', // Logicly vibrant cyan/green
  lowSignalColor: '#475569',  // Dark slate
  unknownSignalColor: '#ef4444', // Red conflict
  hiZSignalColor: '#f59e0b', // Amber / high-Z

  limitPropagationToFrameRate: false,
  pauseSimulationOnChangeDocument: false,
  defaultFloatSignal: 'undefined'
};

const STORAGE_KEY = 'prologic_app_settings';

export class SettingsModel {
  private _settings: AppSettings;
  public onSettingsChanged?: (settings: AppSettings) => void;

  constructor() {
    this._settings = { ...DEFAULT_SETTINGS };
    this.loadFromStorage();
  }

  public get settings(): AppSettings {
    return { ...this._settings };
  }

  public update(patch: Partial<AppSettings>): void {
    this._settings = { ...this._settings, ...patch };
    this.saveToStorage();
    if (this.onSettingsChanged) {
      this.onSettingsChanged(this._settings);
    }
  }

  public resetToDefaults(): void {
    this._settings = { ...DEFAULT_SETTINGS };
    this.saveToStorage();
    if (this.onSettingsChanged) {
      this.onSettingsChanged(this._settings);
    }
  }

  private loadFromStorage(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          this._settings = { ...DEFAULT_SETTINGS, ...parsed };
        }
      }
    } catch {
      // Ignore localStorage errors (e.g. security sandbox)
    }
  }

  private saveToStorage(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this._settings));
      }
    } catch {
      // Ignore
    }
  }
}
