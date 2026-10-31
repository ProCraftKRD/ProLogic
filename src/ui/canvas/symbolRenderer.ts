import { ICircuit, LogicValue } from '../../simulation/types';
import { SwitchCircuit, PushButtonCircuit, ConstantHighCircuit, ConstantLowCircuit } from '../../simulation/circuits/controls';
import { LightBulbCircuit, DigitDisplayCircuit } from '../../simulation/circuits/outputs';
import { ClockCircuit } from '../../simulation/circuits/clock';
import { ComplexCircuit } from '../../simulation/circuits/complex';
import { LabelCircuit } from '../../simulation/circuits/annotation';

export interface JackPosition {
  x: number;
  y: number;
  isInput: boolean;
  index: number;
}

export interface RenderResult {
  width: number;
  height: number;
  svgContent: string;
  jacks: JackPosition[];
}

export class SymbolRenderer {
  public static renderComponent(circuit: ICircuit, isAnsi: boolean = true): RenderResult {
    const type = circuit.type;

    if (type.startsWith('and@')) {
      return this.renderGate(circuit, 'AND', isAnsi);
    } else if (type.startsWith('or@')) {
      return this.renderGate(circuit, 'OR', isAnsi);
    } else if (type.startsWith('not@')) {
      return this.renderNotGate(circuit);
    } else if (type.startsWith('nand@')) {
      return this.renderGate(circuit, 'NAND', isAnsi);
    } else if (type.startsWith('nor@')) {
      return this.renderGate(circuit, 'NOR', isAnsi);
    } else if (type.startsWith('xor@')) {
      return this.renderGate(circuit, 'XOR', isAnsi);
    } else if (type.startsWith('xnor@')) {
      return this.renderGate(circuit, 'XNOR', isAnsi);
    } else if (type.startsWith('buffer@')) {
      return this.renderBufferGate(circuit);
    } else if (type.startsWith('tri-state@')) {
      return this.renderTriStateGate(circuit);
    } else if (type.startsWith('switch@')) {
      return this.renderSwitch(circuit as SwitchCircuit);
    } else if (type.startsWith('push_button@')) {
      return this.renderPushButton(circuit as PushButtonCircuit);
    } else if (type.startsWith('clock@')) {
      return this.renderClock(circuit as ClockCircuit);
    } else if (type.startsWith('constant_high@')) {
      return this.renderConstant(true);
    } else if (type.startsWith('constant_low@')) {
      return this.renderConstant(false);
    } else if (type.startsWith('light_bulb@')) {
      return this.renderLightBulb(circuit as LightBulbCircuit);
    } else if (type.startsWith('digit@')) {
      return this.renderDigitDisplay(circuit as DigitDisplayCircuit);
    } else if (type.startsWith('label@')) {
      return this.renderLabel(circuit as LabelCircuit);
    } else if (type.startsWith('bus@') || type === 'bus') {
      return this.renderBus(circuit);
    } else if (circuit instanceof ComplexCircuit || type.includes('flip_flop') || type.startsWith('custom_') || type.startsWith('%custom')) {
      return this.renderComplexIC(circuit);
    }

    return this.renderGenericBox(circuit);
  }

  private static renderGate(circuit: any, gateType: string, isAnsi: boolean): RenderResult {
    const inputCount = circuit.inputsCount || 2;
    const height = Math.max(50, inputCount * 22);
    const bodyRight = 55; // Standard right edge for gate apex across all logic gates
    const jacks: JackPosition[] = [];

    const spacing = height / (inputCount + 1);
    for (let i = 0; i < inputCount; i++) {
      jacks.push({ x: 0, y: (i + 1) * spacing, isInput: true, index: i });
    }

    const hasInversion = gateType.startsWith('N') || gateType === 'XNOR';
    // Output jack positioned with clean lead wire stub to eliminate any overlap with inversion bubble
    const outX = hasInversion ? 76 : 68;
    jacks.push({ x: outX, y: height / 2, isInput: false, index: 0 });

    let pathD = '';
    if (isAnsi) {
      if (gateType === 'AND' || gateType === 'NAND') {
        pathD = `M 10 5 L 30 5 A 25 ${height / 2 - 5} 0 0 1 30 ${height - 5} L 10 ${height - 5} Z`;
      } else if (gateType === 'OR' || gateType === 'NOR') {
        pathD = `M 10 5 Q 22 ${height / 2} 10 ${height - 5} Q 35 ${height - 5} 55 ${height / 2} Q 35 5 10 5 Z`;
      } else if (gateType === 'XOR' || gateType === 'XNOR') {
        pathD = `M 15 5 Q 27 ${height / 2} 15 ${height - 5} Q 38 ${height - 5} 55 ${height / 2} Q 38 5 15 5 Z`;
      }
    } else {
      pathD = `M 10 5 H 55 V ${height - 5} H 10 Z`;
    }

    let extraSvg = '';
    if (isAnsi && (gateType === 'XOR' || gateType === 'XNOR')) {
      extraSvg += `<path d="M 8 5 Q 20 ${height / 2} 8 ${height - 5}" fill="none" stroke="#64748b" stroke-width="2.5" />`;
    }

    let outLeadLine = '';
    if (hasInversion) {
      // Inversion bubble touches gate apex at 55 (cx=59, r=4, spans [55, 63])
      extraSvg += `<circle cx="59" cy="${height / 2}" r="4" fill="#182234" stroke="#64748b" stroke-width="2" />`;
      // Clean visible lead wire stub from bubble edge (63) to output jack (76)
      outLeadLine = `<line x1="63" y1="${height / 2}" x2="${outX}" y2="${height / 2}" stroke="#64748b" stroke-width="2" />`;
    } else {
      // Direct lead wire from gate apex (55) to output jack (68)
      outLeadLine = `<line x1="${bodyRight}" y1="${height / 2}" x2="${outX}" y2="${height / 2}" stroke="#64748b" stroke-width="2" />`;
    }

    let leadLines = '';
    for (const j of jacks.filter((j) => j.isInput)) {
      leadLines += `<line x1="0" y1="${j.y}" x2="10" y2="${j.y}" stroke="#64748b" stroke-width="2" />`;
    }

    const svgContent = `
      <g class="gate-symbol">
        ${leadLines}
        ${outLeadLine}
        <path d="${pathD}" fill="#182234" stroke="#64748b" stroke-width="2" />
        ${extraSvg}
        ${!isAnsi ? `<text x="32" y="${height / 2 + 5}" text-anchor="middle" fill="#9ca3af" font-size="14" font-weight="bold">${gateType.includes('AND') ? '&amp;' : gateType.includes('OR') ? '≥1' : '=1'}</text>` : ''}
      </g>
    `;

    return { width: outX + 6, height, svgContent, jacks };
  }

  private static renderNotGate(circuit: any): RenderResult {
    const height = 40;
    const outX = 68;
    const jacks: JackPosition[] = [
      { x: 0, y: 20, isInput: true, index: 0 },
      { x: outX, y: 20, isInput: false, index: 0 }
    ];

    const svgContent = `
      <g class="gate-symbol">
        <line x1="0" y1="20" x2="10" y2="20" stroke="#64748b" stroke-width="2" />
        <polygon points="10,5 45,20 10,35" fill="#182234" stroke="#64748b" stroke-width="2" />
        <circle cx="49" cy="20" r="4" fill="#182234" stroke="#64748b" stroke-width="2" />
        <line x1="53" y1="20" x2="${outX}" y2="20" stroke="#64748b" stroke-width="2" />
      </g>
    `;
    return { width: outX + 6, height, svgContent, jacks };
  }

  private static renderBufferGate(circuit: any): RenderResult {
    const height = 40;
    const outX = 60;
    const jacks: JackPosition[] = [
      { x: 0, y: 20, isInput: true, index: 0 },
      { x: outX, y: 20, isInput: false, index: 0 }
    ];

    const svgContent = `
      <g class="gate-symbol">
        <line x1="0" y1="20" x2="10" y2="20" stroke="#64748b" stroke-width="2" />
        <polygon points="10,5 45,20 10,35" fill="#182234" stroke="#64748b" stroke-width="2" />
        <line x1="45" y1="20" x2="${outX}" y2="20" stroke="#64748b" stroke-width="2" />
      </g>
    `;
    return { width: outX + 6, height, svgContent, jacks };
  }

  private static renderTriStateGate(circuit: any): RenderResult {
    const height = 50;
    const outX = 60;
    const jacks: JackPosition[] = [
      { x: 0, y: 20, isInput: true, index: 0 },
      { x: 25, y: 50, isInput: true, index: 1 },
      { x: outX, y: 20, isInput: false, index: 0 }
    ];

    const svgContent = `
      <g class="gate-symbol">
        <line x1="0" y1="20" x2="10" y2="20" stroke="#64748b" stroke-width="2" />
        <line x1="25" y1="50" x2="25" y2="28" stroke="#64748b" stroke-width="2" />
        <polygon points="10,5 45,20 10,35" fill="#182234" stroke="#64748b" stroke-width="2" />
        <line x1="45" y1="20" x2="${outX}" y2="20" stroke="#64748b" stroke-width="2" />
      </g>
    `;
    return { width: outX + 6, height, svgContent, jacks };
  }

  public static renderSwitch(circuit: SwitchCircuit): RenderResult {
    const width = 50;
    const height = 40;
    const isOn = circuit.state;
    const jacks: JackPosition[] = [
      { x: width, y: 20, isInput: false, index: 0 }
    ];

    const toggleX = isOn ? 32 : 18;

    const svgContent = `
      <g class="switch-component ${isOn ? 'switch-on' : 'switch-off'}" style="cursor: pointer;">
        <rect class="switch-track" x="5" y="10" width="36" height="20" rx="10" stroke-width="2" />
        <circle class="switch-knob" cx="${toggleX}" cy="20" r="7" />
        <line class="switch-lead" x1="41" y1="20" x2="${width}" y2="20" stroke-width="2" />
      </g>
    `;
    return { width, height, svgContent, jacks };
  }

  public static renderPushButton(circuit: PushButtonCircuit): RenderResult {
    const width = 45;
    const height = 45;
    const isPressed = circuit.isPressed;
    const jacks: JackPosition[] = [
      { x: width, y: 22.5, isInput: false, index: 0 }
    ];

    const svgContent = `
      <g class="pushbutton-component ${isPressed ? 'btn-pressed' : 'btn-released'}" style="cursor: pointer;">
        <rect class="button-box" x="5" y="5" width="35" height="35" rx="6" stroke-width="2" />
        <circle class="button-knob" cx="22.5" cy="22.5" r="${isPressed ? 10 : 12}" />
        <line class="button-lead" x1="40" y1="22.5" x2="${width}" y2="22.5" stroke-width="2" />
      </g>
    `;
    return { width, height, svgContent, jacks };
  }

  public static renderClock(circuit: ClockCircuit): RenderResult {
    const width = 50;
    const height = 40;
    const isHigh = circuit.getOutputAt(0) === true;
    const jacks: JackPosition[] = [
      { x: width, y: 20, isInput: false, index: 0 }
    ];

    const svgContent = `
      <g class="clock-component ${isHigh ? 'clock-high' : 'clock-low'}">
        <rect class="clock-box" x="5" y="5" width="35" height="30" rx="6" stroke-width="2" />
        <path class="clock-pulse" d="M 12 25 L 18 25 L 18 15 L 26 15 L 26 25 L 32 25" fill="none" stroke-width="2" />
        <line class="clock-lead" x1="40" y1="20" x2="${width}" y2="20" stroke-width="2" />
      </g>
    `;
    return { width, height, svgContent, jacks };
  }

  private static renderConstant(isHigh: boolean): RenderResult {
    const width = 45;
    const height = 35;
    const jacks: JackPosition[] = [
      { x: width, y: 17.5, isInput: false, index: 0 }
    ];

    const text = isHigh ? 'VCC' : 'GND';

    const svgContent = `
      <g class="constant-component ${isHigh ? 'constant-vcc' : 'constant-gnd'}">
        <rect class="constant-box" x="5" y="5" width="30" height="25" rx="4" stroke-width="1.5" />
        <text class="constant-text" x="20" y="22" text-anchor="middle" font-size="10" font-weight="bold">${text}</text>
        <line class="constant-lead" x1="35" y1="17.5" x2="${width}" y2="17.5" stroke-width="2" />
      </g>
    `;
    return { width, height, svgContent, jacks };
  }

  public static renderLightBulb(circuit: LightBulbCircuit): RenderResult {
    const width = 50;
    const height = 50;
    const isOn = circuit.isOn;
    const jacks: JackPosition[] = [
      { x: 0, y: 25, isInput: true, index: 0 }
    ];

    const svgContent = `
      <g class="lightbulb-component ${isOn ? 'bulb-on' : 'bulb-off'}">
        <line class="bulb-lead" x1="0" y1="25" x2="15" y2="25" stroke-width="2" />
        <circle class="bulb-circle" cx="28" cy="25" r="14" stroke-width="2" />
        <path class="bulb-filament" d="M 23 23 Q 28 17 33 23" fill="none" stroke-width="1.5" />
      </g>
    `;
    return { width, height, svgContent, jacks };
  }

  public static renderDigitDisplay(circuit: DigitDisplayCircuit): RenderResult {
    const width = 50;
    const height = 75;
    const hex = circuit.hexChar;
    const jacks: JackPosition[] = [];

    const spacing = height / 5;
    for (let i = 0; i < 4; i++) {
      jacks.push({ x: 0, y: (i + 1) * spacing, isInput: true, index: i });
    }

    const svgContent = `
      <g class="digit-component">
        ${jacks.map((j) => `<line class="digit-lead" x1="0" y1="${j.y}" x2="10" y2="${j.y}" stroke="#64748b" stroke-width="2" />`).join('')}
        <rect class="digit-box" x="10" y="5" width="35" height="65" rx="6" fill="#0b0f19" stroke="#374b6b" stroke-width="2" />
        <text class="digit-char" x="27.5" y="47" text-anchor="middle" fill="#00f5d4" font-family="'Courier New', monospace" font-size="34" font-weight="900" filter="drop-shadow(0 0 6px rgba(0,245,212,0.8))">${hex}</text>
      </g>
    `;
    return { width, height, svgContent, jacks };
  }

  private static renderBus(circuit: any): RenderResult {
    const inputCount = circuit.inputsCount || 4;
    const height = Math.max(50, inputCount * 22);
    const width = 60;
    const jacks: JackPosition[] = [];

    const spacing = height / (inputCount + 1);
    for (let i = 0; i < inputCount; i++) {
      jacks.push({ x: 0, y: (i + 1) * spacing, isInput: true, index: i });
    }

    // Right-side output jack (index 0)
    jacks.push({ x: width, y: height / 2, isInput: false, index: 0 });

    let leadLines = '';
    for (const j of jacks.filter((j) => j.isInput)) {
      leadLines += `<line x1="0" y1="${j.y}" x2="10" y2="${j.y}" stroke="#64748b" stroke-width="2" />`;
    }
    leadLines += `<line x1="${width - 10}" y1="${height / 2}" x2="${width}" y2="${height / 2}" stroke="#64748b" stroke-width="2" />`;

    const label = circuit.label || 'BUS';

    const svgContent = `
      <g class="bus-symbol">
        ${leadLines}
        <rect x="10" y="5" width="${width - 20}" height="${height - 10}" rx="4" fill="#182234" stroke="#64748b" stroke-width="2" />
        <text x="${width / 2}" y="${height / 2 + 5}" text-anchor="middle" fill="#00f5d4" font-size="12" font-weight="bold" font-family="sans-serif">${label}</text>
      </g>
    `;

    return { width, height, svgContent, jacks };
  }

  private static renderComplexIC(circuit: any): RenderResult {
    const inputCount = circuit.inputsCount || 4;
    const outputCount = circuit.outputsCount || 2;
    const height = Math.max(70, Math.max(inputCount, outputCount) * 22 + 20);
    let labelText = circuit.label || circuit.type.replace('@logic.ly', '').replace(/_/g, ' ').toUpperCase();
    if (
      labelText === 'RS FLIP FLOP' ||
      circuit.type === 'rs_flip_flop@logic.ly' ||
      circuit.type === 'sr_flip_flop@logic.ly'
    ) {
      if (!circuit.label || circuit.label === 'RS FLIP FLOP' || circuit.label === 'RS Flip-Flop' || circuit.label === 'rs_flip_flop') {
        labelText = 'SR FLIP FLOP';
      }
    }
    const width = Math.max(80, Math.min(140, Math.max(labelText.length * 9 + 20, 80)));
    const jacks: JackPosition[] = [];

    const inSpacing = height / (inputCount + 1);
    for (let i = 0; i < inputCount; i++) {
      jacks.push({ x: 0, y: (i + 1) * inSpacing, isInput: true, index: i });
    }

    const outSpacing = height / (outputCount + 1);
    for (let i = 0; i < outputCount; i++) {
      jacks.push({ x: width, y: (i + 1) * outSpacing, isInput: false, index: i });
    }

    let pinLabelsSvg = '';
    if (circuit instanceof ComplexCircuit) {
      for (let i = 0; i < inputCount; i++) {
        const name = circuit.getInputExportNameAt(i);
        if (name) {
          const y = (i + 1) * inSpacing;
          pinLabelsSvg += `<text x="14" y="${y + 3}" fill="#94a3b8" font-size="9" font-family="sans-serif">${name}</text>`;
        }
      }
      for (let i = 0; i < outputCount; i++) {
        const name = circuit.getOutputExportNameAt(i);
        if (name) {
          const y = (i + 1) * outSpacing;
          pinLabelsSvg += `<text x="${width - 14}" y="${y + 3}" text-anchor="end" fill="#94a3b8" font-size="9" font-family="sans-serif">${name}</text>`;
        }
      }
    }

    const svgContent = `
      <g class="complex-ic">
        ${jacks.map((j) => `<line x1="${j.isInput ? 0 : width - 10}" y1="${j.y}" x2="${j.isInput ? 10 : width}" y2="${j.y}" stroke="#64748b" stroke-width="2" />`).join('')}
        <rect x="10" y="5" width="${width - 20}" height="${height - 10}" rx="4" fill="#182234" stroke="#374b6b" stroke-width="2" />
        <text x="${width / 2}" y="18" text-anchor="middle" fill="#00f5d4" font-size="10" font-weight="bold">${labelText}</text>
        ${pinLabelsSvg}
      </g>
    `;

    return { width, height, svgContent, jacks };
  }

  private static escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private static renderLabel(circuit: LabelCircuit): RenderResult {
    const text = circuit.text !== undefined && circuit.text !== null ? circuit.text : 'Label';
    const lines = text.length === 0 ? [''] : text.split('\n');
    const fontSize = circuit.fontSize || 13;
    const isBold = !!circuit.bold;
    const isItalic = !!circuit.italic;
    const alignment = circuit.alignment || 'left';
    const color = circuit.color;

    const charWidth = fontSize * (isBold ? 0.65 : 0.6);
    const maxLineLength = Math.max(1, ...lines.map((l) => l.length));
    const isBlank = text.trim().length === 0;
    const width = isBlank ? 80 : Math.max(16, Math.round(maxLineLength * charWidth + 14));
    const lineHeight = Math.round(fontSize * 1.35);
    const height = isBlank ? 25 : Math.max(20, Math.round(lines.length * lineHeight + 8));

    const textAnchor = alignment === 'center' ? 'middle' : alignment === 'right' ? 'end' : 'start';
    const anchorX = alignment === 'center' ? width / 2 : alignment === 'right' ? width - 8 : 8;
    const firstLineY = Math.round(fontSize * 1.05) + 2;

    const fontWeight = isBold ? '700' : '500';
    const fontStyle = isItalic ? 'italic' : 'normal';
    const fillAttr = color ? `fill="${color}"` : 'fill="currentColor"';
    const colorStyle = color ? ` fill: ${color};` : '';

    const svgContent = `
      <g class="label-component" style="cursor: pointer;">
        <text class="canvas-label-text" x="${anchorX}" y="${firstLineY}" ${fillAttr} font-family="sans-serif" font-size="${fontSize}px" font-weight="${fontWeight}" font-style="${fontStyle}" text-anchor="${textAnchor}" style="font-size: ${fontSize}px; font-weight: ${fontWeight}; font-style: ${fontStyle}; text-anchor: ${textAnchor};${colorStyle}">
          ${lines.map((line, i) => `<tspan x="${anchorX}" y="${firstLineY + i * lineHeight}">${line.length > 0 ? SymbolRenderer.escapeXml(line) : '&#160;'}</tspan>`).join('')}
        </text>
      </g>
    `;
    return { width, height, svgContent, jacks: [] };
  }

  private static renderGenericBox(circuit: ICircuit): RenderResult {
    return {
      width: 60,
      height: 40,
      svgContent: `<rect x="0" y="0" width="60" height="40" rx="4" fill="#182234" stroke="#374b6b" stroke-width="2" />`,
      jacks: []
    };
  }
}
