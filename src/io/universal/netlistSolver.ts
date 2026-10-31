import { ICircuit, IInputCircuit, IOutputCircuit } from '../../simulation/types';
import { SimulationEngine } from '../../simulation/engine';

export interface Point2D {
  x: number;
  y: number;
}

export interface WireSegment {
  p1: Point2D;
  p2: Point2D;
}

export interface TerminalPort {
  circuit: ICircuit;
  portIndex: number;
  type: 'source' | 'sink';
  x: number;
  y: number;
}

/**
 * High-precision Disjoint Set Union (DSU) coordinate netlist solver.
 * Resolves 2D schematic wire connections, T-junctions, segment collisions,
 * and component terminal pin contacts to produce SimulationEngine connections.
 */
export class CoordinateNetlistSolver {
  private _parent: Map<string, string> = new Map();
  private _points: Map<string, Point2D> = new Map();
  private _wires: WireSegment[] = [];
  private _terminals: TerminalPort[] = [];
  private _tolerance: number;

  constructor(tolerance: number = 3) {
    this._tolerance = tolerance;
  }

  public addWire(p1: Point2D, p2: Point2D): void {
    this._wires.push({ p1, p2 });
    const k1 = this.pointKey(p1);
    const k2 = this.pointKey(p2);
    this.registerPoint(k1, p1);
    this.registerPoint(k2, p2);
    this.union(k1, k2);
  }

  public addTerminal(terminal: TerminalPort): void {
    this._terminals.push(terminal);
  }

  private pointKey(p: Point2D): string {
    return `${Math.round(p.x)},${Math.round(p.y)}`;
  }

  private registerPoint(key: string, p: Point2D): void {
    if (!this._parent.has(key)) {
      this._parent.set(key, key);
      this._points.set(key, { x: Math.round(p.x), y: Math.round(p.y) });
    }
  }

  private find(k: string): string {
    let root = k;
    while (this._parent.has(root) && this._parent.get(root) !== root) {
      root = this._parent.get(root)!;
    }
    // Path compression
    let curr = k;
    while (this._parent.has(curr) && curr !== root) {
      const nxt = this._parent.get(curr)!;
      this._parent.set(curr, root);
      curr = nxt;
    }
    return root;
  }

  private union(k1: string, k2: string): void {
    const root1 = this.find(k1);
    const root2 = this.find(k2);
    if (root1 !== root2) {
      this._parent.set(root1, root2);
    }
  }

  /**
   * Checks if a point lies on a line segment within tolerance.
   */
  private isPointOnSegment(p: Point2D, a: Point2D, b: Point2D, tol: number): boolean {
    const minX = Math.min(a.x, b.x) - tol;
    const maxX = Math.max(a.x, b.x) + tol;
    const minY = Math.min(a.y, b.y) - tol;
    const maxY = Math.max(a.y, b.y) + tol;

    if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) {
      return false;
    }

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;

    if (lenSq === 0) {
      const d = Math.hypot(p.x - a.x, p.y - a.y);
      return d <= tol;
    }

    // Distance from point to line
    const cross = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x);
    const dist = cross / Math.sqrt(lenSq);
    return dist <= tol;
  }

  /**
   * Solves all connections and registers them into the SimulationEngine.
   */
  public solve(engine: SimulationEngine): void {
    // 1. Check all wire intersections and T-junctions
    const allRegisteredKeys = Array.from(this._points.keys());
    for (const wire of this._wires) {
      for (const k of allRegisteredKeys) {
        const pt = this._points.get(k)!;
        if (this.isPointOnSegment(pt, wire.p1, wire.p2, this._tolerance)) {
          const kWire = this.pointKey(wire.p1);
          this.union(k, kWire);
        }
      }
    }

    // 2. Map terminals to nets
    const terminalNetMap: Map<TerminalPort, string> = new Map();

    for (const term of this._terminals) {
      const termPt = { x: term.x, y: term.y };
      const termKey = this.pointKey(termPt);
      this.registerPoint(termKey, termPt);

      let matchedRoot: string | null = null;

      // 2a. Check direct key match in existing DSU points
      for (const [k, pt] of this._points) {
        if (Math.hypot(term.x - pt.x, term.y - pt.y) <= this._tolerance) {
          matchedRoot = this.find(k);
          this.union(termKey, k);
          break;
        }
      }

      // 2b. Check if terminal lies on any wire segment
      if (!matchedRoot) {
        for (const wire of this._wires) {
          if (this.isPointOnSegment(termPt, wire.p1, wire.p2, this._tolerance)) {
            const kWire = this.pointKey(wire.p1);
            this.union(termKey, kWire);
            matchedRoot = this.find(kWire);
            break;
          }
        }
      }

      // 2c. Check if terminal touches another terminal directly (butt-connected without wires)
      for (const other of this._terminals) {
        if (other !== term && Math.hypot(term.x - other.x, term.y - other.y) <= this._tolerance) {
          const otherKey = this.pointKey({ x: other.x, y: other.y });
          this.registerPoint(otherKey, { x: other.x, y: other.y });
          this.union(termKey, otherKey);
          break;
        }
      }
    }

    // 3. Group terminals by resolved net root
    const netGroups: Map<string, { sources: TerminalPort[]; sinks: TerminalPort[] }> = new Map();

    for (const term of this._terminals) {
      const termKey = this.pointKey({ x: term.x, y: term.y });
      const root = this.find(termKey);

      if (!netGroups.has(root)) {
        netGroups.set(root, { sources: [], sinks: [] });
      }

      const grp = netGroups.get(root)!;
      if (term.type === 'source') {
        grp.sources.push(term);
      } else {
        grp.sinks.push(term);
      }
    }

    // 4. Generate connections for each net
    for (const [, grp] of netGroups) {
      if (grp.sources.length === 0 || grp.sinks.length === 0) {
        continue;
      }

      for (const src of grp.sources) {
        for (const snk of grp.sinks) {
          const outCircuit = src.circuit as IOutputCircuit;
          const inCircuit = snk.circuit as IInputCircuit;

          // Compute simple waypoint routing if coordinates differ
          const waypoints: Array<{ x: number; y: number }> = [];
          if (src.x !== snk.x && src.y !== snk.y) {
            // Horizontal-first orthogonal waypoint
            waypoints.push({ x: snk.x, y: src.y });
          }

          engine.connect(outCircuit, src.portIndex, inCircuit, snk.portIndex, waypoints);
        }
      }
    }
  }
}
