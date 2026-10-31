import { TestSuite, assert, assertEqual } from './runner';
import { SettingsModel, DEFAULT_SETTINGS } from '../simulation/settings';

export function runSettingsTests(): boolean {
  const suite = new TestSuite('Application Preferences & Settings Model');

  suite.test('Default settings match Logicly specifications', () => {
    const model = new SettingsModel();
    const s = model.settings;

    assertEqual(s.themeMode, 'system');
    assertEqual(s.snapToGrid, true);
    assertEqual(s.snapOrthogonalWires, true);
    assertEqual(s.gridSize, 15);
    assertEqual(s.showGrid, true);
    assertEqual(s.showPalette, true);
    assertEqual(s.skinName, 'ansi');
    assertEqual(s.enableWireColors, true);
    assertEqual(s.highSignalColor, '#00f5d4');
    assertEqual(s.unknownSignalColor, '#ef4444');
    assertEqual(s.defaultFloatSignal, 'undefined');
  });

  suite.test('Settings update dispatches onSettingsChanged', () => {
    const model = new SettingsModel();
    let notified = false;

    model.onSettingsChanged = (updated) => {
      notified = true;
      assertEqual(updated.gridSize, 20);
      assertEqual(updated.skinName, 'iec');
      assertEqual(updated.snapOrthogonalWires, false);
      assertEqual(updated.defaultFloatSignal, 'false');
    };

    model.update({ gridSize: 20, skinName: 'iec', snapOrthogonalWires: false, defaultFloatSignal: 'false' });
    assert(notified, 'Listener should have been notified');
    assertEqual(model.settings.gridSize, 20);
    assertEqual(model.settings.skinName, 'iec');
    assertEqual(model.settings.snapOrthogonalWires, false);
    assertEqual(model.settings.defaultFloatSignal, 'false');
  });

  suite.test('Reset to defaults restores pristine configuration', () => {
    const model = new SettingsModel();
    model.update({ gridSize: 30, highSignalColor: '#ff0000', snapToGrid: false });
    assertEqual(model.settings.gridSize, 30);

    model.resetToDefaults();
    assertEqual(model.settings.gridSize, DEFAULT_SETTINGS.gridSize);
    assertEqual(model.settings.highSignalColor, DEFAULT_SETTINGS.highSignalColor);
    assertEqual(model.settings.snapToGrid, DEFAULT_SETTINGS.snapToGrid);
  });

  return suite.report();
}
