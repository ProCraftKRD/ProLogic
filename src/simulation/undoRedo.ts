export interface UndoState {
  xml: string;
  description: string;
  selectedUids?: string[];
}

export class UndoRedoManager {
  private _undoStack: UndoState[] = [];
  private _redoStack: UndoState[] = [];
  private _maxActions: number;
  private _isExecuting: boolean = false;

  public onStackChanged?: () => void;

  constructor(maxActions: number = 100) {
    this._maxActions = maxActions;
  }

  public get canUndo(): boolean {
    return this._undoStack.length > 0;
  }

  public get canRedo(): boolean {
    return this._redoStack.length > 0;
  }

  public get undoCount(): number {
    return this._undoStack.length;
  }

  public get redoCount(): number {
    return this._redoStack.length;
  }

  public get lastUndoActionName(): string | null {
    if (this._undoStack.length === 0) return null;
    return this._undoStack[this._undoStack.length - 1].description;
  }

  public get nextRedoActionName(): string | null {
    if (this._redoStack.length === 0) return null;
    return this._redoStack[this._redoStack.length - 1].description;
  }

  /**
   * Push a state before a mutation occurs, or after.
   */
  public pushState(state: UndoState): void {
    if (this._isExecuting) return;

    this._undoStack.push(state);
    if (this._undoStack.length > this._maxActions) {
      this._undoStack.shift();
    }
    // Clear redo stack on new action
    this._redoStack = [];

    if (this.onStackChanged) {
      this.onStackChanged();
    }
  }

  /**
   * Execute an undo step: returns the previous state to restore,
   * while pushing the current state onto redo stack.
   */
  public undo(currentState: UndoState): UndoState | null {
    if (!this.canUndo) return null;

    this._isExecuting = true;
    try {
      const targetState = this._undoStack.pop()!;
      this._redoStack.push(currentState);
      if (this.onStackChanged) this.onStackChanged();
      return targetState;
    } finally {
      this._isExecuting = false;
    }
  }

  /**
   * Execute a redo step: returns the next state to restore,
   * while pushing the current state onto undo stack.
   */
  public redo(currentState: UndoState): UndoState | null {
    if (!this.canRedo) return null;

    this._isExecuting = true;
    try {
      const targetState = this._redoStack.pop()!;
      this._undoStack.push(currentState);
      if (this.onStackChanged) this.onStackChanged();
      return targetState;
    } finally {
      this._isExecuting = false;
    }
  }

  public clear(): void {
    this._undoStack = [];
    this._redoStack = [];
    if (this.onStackChanged) this.onStackChanged();
  }
}
