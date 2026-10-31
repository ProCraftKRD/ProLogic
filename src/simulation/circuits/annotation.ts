import { BaseCircuit } from './base';

export interface LabelFormatting {
  fontSize?: number; // 10, 12, 14, 16, 18, 24, 32, 48 (default: 13)
  bold?: boolean;
  italic?: boolean;
  alignment?: 'left' | 'center' | 'right';
  color?: string; // hex color or undefined (theme default)
}

export class LabelCircuit extends BaseCircuit {
  public text: string = '';
  private _fontSize: number = 13;
  private _bold: boolean = false;
  private _italic: boolean = false;
  private _alignment: 'left' | 'center' | 'right' = 'left';
  private _color?: string;

  constructor(text: string = '', uid?: string, formatting?: LabelFormatting) {
    super('label@logic.ly', uid);
    this.text = text;
    if (formatting) {
      if (formatting.fontSize !== undefined) this._fontSize = formatting.fontSize;
      if (formatting.bold !== undefined) this._bold = formatting.bold;
      if (formatting.italic !== undefined) this._italic = formatting.italic;
      if (formatting.alignment !== undefined) this._alignment = formatting.alignment;
      if (formatting.color !== undefined) this._color = formatting.color;
    }
  }

  get fontSize(): number {
    return this._fontSize;
  }

  set fontSize(val: number) {
    this._fontSize = val;
  }

  get bold(): boolean {
    return this._bold;
  }

  set bold(val: boolean) {
    this._bold = val;
  }

  get italic(): boolean {
    return this._italic;
  }

  set italic(val: boolean) {
    this._italic = val;
  }

  get alignment(): 'left' | 'center' | 'right' {
    return this._alignment;
  }

  set alignment(val: 'left' | 'center' | 'right') {
    this._alignment = val;
  }

  get color(): string | undefined {
    return this._color;
  }

  set color(val: string | undefined) {
    this._color = val;
  }
}
