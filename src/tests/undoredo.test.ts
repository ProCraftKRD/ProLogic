import { TestSuite, assert, assertEqual } from './runner';
import { UndoRedoManager, UndoState } from '../simulation/undoRedo';

export function runUndoRedoTests(): boolean {
  const suite = new TestSuite('Undo / Redo History Engine');

  suite.test('Initial state: cannot undo or redo', () => {
    const mgr = new UndoRedoManager(10);
    assert(!mgr.canUndo, 'Should not be able to undo initially');
    assert(!mgr.canRedo, 'Should not be able to redo initially');
    assertEqual(mgr.undoCount, 0);
    assertEqual(mgr.redoCount, 0);
  });

  suite.test('Pushing states enables undo and clears redo', () => {
    const mgr = new UndoRedoManager(5);
    mgr.pushState({ xml: '<circuit id="1"/>', description: 'Action 1' });
    assertEqual(mgr.canUndo, true);
    assertEqual(mgr.canRedo, false);
    assertEqual(mgr.undoCount, 1);
    assertEqual(mgr.lastUndoActionName, 'Action 1');

    mgr.pushState({ xml: '<circuit id="2"/>', description: 'Action 2' });
    assertEqual(mgr.undoCount, 2);
    assertEqual(mgr.lastUndoActionName, 'Action 2');
  });

  suite.test('Undo transitions state to redo stack', () => {
    const mgr = new UndoRedoManager(5);
    mgr.pushState({ xml: '<circuit id="1"/>', description: 'Add Gate' });

    const current: UndoState = { xml: '<circuit id="2"/>', description: 'Current' };
    const previous = mgr.undo(current);

    assert(previous !== null, 'Previous state should exist');
    assertEqual(previous!.xml, '<circuit id="1"/>');
    assertEqual(previous!.description, 'Add Gate');
    assertEqual(mgr.canUndo, false);
    assertEqual(mgr.canRedo, true);
    assertEqual(mgr.redoCount, 1);
    assertEqual(mgr.nextRedoActionName, 'Current');
  });

  suite.test('Redo transitions state back to undo stack', () => {
    const mgr = new UndoRedoManager(5);
    mgr.pushState({ xml: '<circuit id="1"/>', description: 'State 1' });

    const current: UndoState = { xml: '<circuit id="2"/>', description: 'State 2' };
    mgr.undo(current);

    const redoingState: UndoState = { xml: '<circuit id="1"/>', description: 'Restored 1' };
    const redone = mgr.redo(redoingState);

    assert(redone !== null, 'Redone state should exist');
    assertEqual(redone!.xml, '<circuit id="2"/>');
    assertEqual(mgr.canUndo, true);
    assertEqual(mgr.canRedo, false);
  });

  suite.test('Stack depth respects max actions limit', () => {
    const mgr = new UndoRedoManager(3);
    for (let i = 1; i <= 6; i++) {
      mgr.pushState({ xml: `<circuit id="${i}"/>`, description: `Action ${i}` });
    }
    assertEqual(mgr.undoCount, 3);
    assertEqual(mgr.lastUndoActionName, 'Action 6');
  });

  suite.test('New mutation clears existing redo stack', () => {
    const mgr = new UndoRedoManager(5);
    mgr.pushState({ xml: '<circuit id="1"/>', description: 'State 1' });
    mgr.pushState({ xml: '<circuit id="2"/>', description: 'State 2' });

    mgr.undo({ xml: '<circuit id="3"/>', description: 'State 3' });
    assertEqual(mgr.canRedo, true);

    // New action performed
    mgr.pushState({ xml: '<circuit id="4"/>', description: 'State 4' });
    assertEqual(mgr.canRedo, false, 'Redo stack should be cleared upon new action');
  });

  return suite.report();
}
