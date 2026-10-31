import { LogicConnection, LogicValue } from '../../simulation/types';

export interface Point {
  x: number;
  y: number;
}

export class WireRenderer {
  /**
   * Checks if two points are parallel along either the X (horizontal) or Y (vertical) axis
   * within a small floating-point tolerance (default 1.0px).
   */
  public static isParallel(a: Point, b: Point, tol: number = 1.0): boolean {
    return Math.abs(a.x - b.x) <= tol || Math.abs(a.y - b.y) <= tol;
  }

  /**
   * Generates wire paths between start and end jacks.
   * - If unedited (!waypoints || waypoints.length === 0): ALWAYS renders a smooth
   *   natural Bezier curve (singleBezier). Unedited wires are never orthogonal.
   * - If waypoints are present:
   *   - If snapOrthogonal is true: Renders segments that are parallel along the X or Y
   *     axis as straight lines (L x y), and segments that are not parallel as smooth
   *     natural cubic Bezier curves (C ...). When waypoints align orthogonally, they form
   *     sharp 90° corners exclusively at the user's waypoints (Logicly style).
   *   - If snapOrthogonal is false: Generates a smooth natural cubic Bezier spline
   *     passing cleanly through all waypoints.
   */
  public static generateBezierPath(
    start: Point,
    end: Point,
    waypoints: Point[] = [],
    snapOrthogonal: boolean = false
  ): string {
    if (!waypoints || waypoints.length === 0) {
      return this.singleBezier(start, end);
    }

    return this.generateWireSpline(start, end, waypoints, snapOrthogonal);
  }

  /**
   * Generates orthogonal wire paths passing through waypoints.
   */
  public static generateOrthogonalPath(start: Point, end: Point, waypoints: Point[]): string {
    return this.generateWireSpline(start, end, waypoints, true);
  }

  /**
   * Generates a hybrid wire spline passing cleanly through start jack,
   * all intermediate waypoints (bend points), and end jack.
   * - Segments parallel to an axis (when snapOrthogonal is true) render as straight lines (L).
   * - Segments not parallel render as smooth natural cubic Bezier curves (C).
   * - Waypoints placed by the user are the ONLY bend points (zero synthetic intermediate elbows).
   */
  private static generateWireSpline(
    start: Point,
    end: Point,
    waypoints: Point[],
    snapOrthogonal: boolean
  ): string {
    const pts = [start, ...waypoints, end];
    const n = pts.length - 1;
    if (n === 1) {
      if (snapOrthogonal && this.isParallel(start, end)) {
        return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
      }
      return this.singleBezier(start, end);
    }

    const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

    const cpIncoming: Point[] = new Array(n + 1);
    const cpOutgoing: Point[] = new Array(n + 1);

    // 1. Start pin (leaves horizontally to the right)
    const d0 = dist(pts[0], pts[1]);
    const dx0 = pts[1].x > pts[0].x
      ? Math.min(100, Math.max(25, (pts[1].x - pts[0].x) * 0.45))
      : Math.min(60, Math.max(25, d0 * 0.35));
    cpOutgoing[0] = { x: pts[0].x + dx0, y: pts[0].y };

    // 2. End pin (enters horizontally from the left)
    const dn = dist(pts[n - 1], pts[n]);
    const dxn = pts[n].x > pts[n - 1].x
      ? Math.min(100, Math.max(25, (pts[n].x - pts[n - 1].x) * 0.45))
      : Math.min(60, Math.max(25, dn * 0.35));
    cpIncoming[n] = { x: pts[n].x - dxn, y: pts[n].y };

    // 3. Internal waypoints: compute tangents
    for (let i = 1; i < n; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const next = pts[i + 1];

      const prevPar = snapOrthogonal && this.isParallel(prev, curr);
      const nextPar = snapOrthogonal && this.isParallel(curr, next);

      const dIn = dist(prev, curr);
      const dOut = dist(curr, next);
      const hIn = Math.min(dIn * 0.35, 120);
      const hOut = Math.min(dOut * 0.35, 120);

      if (prevPar && nextPar) {
        // Both adjacent segments are straight orthogonal lines
        cpIncoming[i] = { x: curr.x, y: curr.y };
        cpOutgoing[i] = { x: curr.x, y: curr.y };
      } else if (prevPar && !nextPar) {
        // Incoming is straight, outgoing is curved
        const vx = next.x - curr.x;
        const vy = next.y - curr.y;
        const len = Math.hypot(vx, vy) || 1;
        cpIncoming[i] = { x: curr.x, y: curr.y };
        cpOutgoing[i] = { x: curr.x + (vx / len) * hOut, y: curr.y + (vy / len) * hOut };
      } else if (!prevPar && nextPar) {
        // Incoming is curved, outgoing is straight
        const vx = curr.x - prev.x;
        const vy = curr.y - prev.y;
        const len = Math.hypot(vx, vy) || 1;
        cpIncoming[i] = { x: curr.x - (vx / len) * hIn, y: curr.y - (vy / len) * hIn };
        cpOutgoing[i] = { x: curr.x, y: curr.y };
      } else {
        // Both adjacent segments are curved: continuous smooth tangent
        const vx = next.x - prev.x;
        const vy = next.y - prev.y;
        const len = Math.hypot(vx, vy) || 1;
        const ux = vx / len;
        const uy = vy / len;

        cpIncoming[i] = { x: curr.x - ux * hIn, y: curr.y - uy * hIn };
        cpOutgoing[i] = { x: curr.x + ux * hOut, y: curr.y + uy * hOut };
      }
    }

    // 4. Assemble hybrid path
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[i + 1];

      if (snapOrthogonal && this.isParallel(a, b)) {
        d += ` L ${b.x} ${b.y}`;
      } else {
        const p1 = cpOutgoing[i];
        const p2 = cpIncoming[i + 1];
        d += ` C ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
      }
    }
    return d;
  }

  private static singleBezier(start: Point, end: Point): string {
    const dx = Math.max(30, Math.abs(end.x - start.x) * 0.5);
    return `M ${start.x} ${start.y} C ${start.x + dx} ${start.y}, ${end.x - dx} ${end.y}, ${end.x} ${end.y}`;
  }

  /**
   * Finds the closest wire segment index to a given point.
   * Returns index `i` indicating the point should be inserted at index `i` of waypoints.
   */
  public static findClosestSegment(point: Point, start: Point, end: Point, waypoints: Point[] = []): number {
    const pts = [start, ...waypoints, end];
    let bestIdx = 0;
    let minDist = Infinity;

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      let d: number;
      if (l2 === 0) {
        d = Math.hypot(point.x - a.x, point.y - a.y);
      } else {
        let t = ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        d = Math.hypot(point.x - (a.x + t * (b.x - a.x)), point.y - (a.y + t * (b.y - a.y)));
      }
      if (d < minDist) {
        minDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  public static getWireCssClass(value: LogicValue, isSelected: boolean = false): string {
    let cls = 'wire-path';
    if (value === true) {
      cls += ' wire-high';
    } else if (value === false) {
      cls += ' wire-low';
    } else {
      cls += ' wire-hiz';
    }
    if (isSelected) {
      cls += ' wire-selected';
    }
    return cls;
  }
}
