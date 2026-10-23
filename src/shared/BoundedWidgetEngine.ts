import {
  GridStackEngine,
  type GridStackNode,
  type GridStackMoveOpts,
} from 'gridstack';
import type { GridStackEngineOptions } from 'gridstack/dist/gridstack-engine';

type Position = { x: number; y: number; w: number; h: number };
type Direction = 'right' | 'down';
const position = (n: GridStackNode): Position => ({
  x: n.x!,
  y: n.y!,
  w: n.w!,
  h: n.h!,
});
const overlaps = (a: Position, b: Position) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Resize collisions follow the expanding edge, including chains of neighbors. */
export class BoundedWidgetEngine extends GridStackEngine {
  private publish: GridStackEngineOptions['onChange'];
  constructor(options: GridStackEngineOptions = {}) {
    super(options);
    this.publish = options.onChange;
  }
  private dragOrigin?: {
    node: GridStackNode;
    positions: Map<GridStackNode, Position>;
  };
  beginDrag(node: GridStackNode) {
    if (this.mode === 'list') return;
    this.dragOrigin = {
      node,
      positions: new Map(this.nodes.map((n) => [n, position(n)])),
    };
  }
  private mergeHover = false;
  setMergeHover(value: boolean) {
    this.mergeHover = value;
    if (value && this.dragOrigin) {
      for (const [node, origin] of this.dragOrigin.positions) {
        Object.assign(node, origin, { _dirty: true });
      }
      this.publish?.(this.getDirtyNodes());
    }
  }
  endDrag() {
    this.mergeHover = false;
    this.dragOrigin = undefined;
  }
  /** Move a selection atomically; never break its relative geometry. */
  moveSelection(
    ids: Set<string>,
    dx: number,
    dy: number,
    commit = true,
    preview?: (plan: ReadonlyMap<GridStackNode, Position>) => void,
  ): boolean {
    const selected = this.nodes.filter((n) => ids.has(n.id!));
    if (!selected.length || selected.some((n) => n.locked)) return false;
    const plan = new Map(this.nodes.map((n) => [n, position(n)]));
    const fits = (p: Position) =>
      p.x >= 0 &&
      p.y >= 0 &&
      p.x + p.w <= this.column &&
      (!this.maxRow || p.y + p.h <= this.maxRow);
    for (const n of selected) {
      const p = { ...position(n), x: n.x! + dx, y: n.y! + dy };
      if (!fits(p)) return false;
      plan.set(n, p);
    }
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const push = (
      n: GridStackNode,
      obstacle: Position,
      path: Set<GridStackNode>,
    ): boolean => {
      const p = plan.get(n)!;
      if (!overlaps(p, obstacle)) return true;
      if (ids.has(n.id!) || n.locked || path.has(n)) return false;
      const next = { ...p };
      const beyond = (block: Position) => {
        if (horizontal) next.x = dx > 0 ? block.x + block.w : block.x - next.w;
        else next.y = dy > 0 ? block.y + block.h : block.y - next.h;
      };
      beyond(obstacle);
      // Selected cards are one rigid group: push past all of them, never push
      // a neighbor into another selected card and reject an otherwise valid move.
      let blocker = selected.find((item) => overlaps(plan.get(item)!, next));
      while (blocker) {
        beyond(plan.get(blocker)!);
        blocker = selected.find((item) => overlaps(plan.get(item)!, next));
      }
      if (!fits(next)) return false;
      plan.set(n, next);
      const visited = new Set(path).add(n);
      return this.nodes.every(
        (other) =>
          other === n ||
          !overlaps(plan.get(other)!, next) ||
          push(other, next, visited),
      );
    };
    const reserved = new Map(plan);
    let pushed = true;
    for (const n of selected) {
      for (const other of this.nodes) {
        if (!ids.has(other.id!) && !push(other, plan.get(n)!, new Set())) {
          pushed = false;
          break;
        }
      }
      if (!pushed) break;
    }
    if (!pushed) {
      // An edge cannot take priority over the drop position. Try nearby slots,
      // including the space vacated by the dragged cards, before rejecting it.
      for (const [n, p] of reserved) plan.set(n, p);
      if (!this.relocateCollisions(plan, selected)) return false;
    }
    preview?.(plan);
    if (commit) {
      for (const [n, p] of plan) {
        if (n.x === p.x && n.y === p.y) continue;
        Object.assign(n, p, { _dirty: true });
      }
      if (!this.batchMode) this.publish?.(this.getDirtyNodes());
    }
    return true;
  }
  /** Reuse nearby empty slots when directional pushing reaches a grid edge. */
  private relocateCollisions(
    plan: Map<GridStackNode, Position>,
    selected: GridStackNode[],
  ): boolean {
    let budget = 2000;
    const relocate = (
      node: GridStackNode,
      protectedNodes: Set<GridStackNode>,
    ): boolean => {
      if (node.locked || protectedNodes.has(node) || --budget < 0) return false;
      const origin = plan.get(node)!;
      const candidates: Position[] = [];
      const rows = this.maxRow || this.getRow() + origin.h;
      for (let y = 0; y <= rows - origin.h; y++)
        for (let x = 0; x <= this.column - origin.w; x++) {
          const candidate = { ...origin, x, y };
          if (
            [...protectedNodes].some((n) => overlaps(plan.get(n)!, candidate))
          )
            continue;
          if (
            this.nodes.some(
              (n) =>
                n !== node && n.locked && overlaps(plan.get(n)!, candidate),
            )
          )
            continue;
          candidates.push(candidate);
        }
      const collisions = (p: Position) =>
        this.nodes.filter((n) => n !== node && overlaps(plan.get(n)!, p));
      candidates.sort(
        (a, b) =>
          Number(collisions(a).length > 0) - Number(collisions(b).length > 0) ||
          Math.abs(a.x - origin.x) +
            Math.abs(a.y - origin.y) -
            (Math.abs(b.x - origin.x) + Math.abs(b.y - origin.y)) ||
          a.y - b.y ||
          a.x - b.x,
      );
      for (const candidate of candidates) {
        if (--budget < 0) return false;
        const snapshot = new Map(plan);
        plan.set(node, candidate);
        const fixed = new Set(protectedNodes).add(node);
        if (collisions(candidate).every((n) => relocate(n, fixed))) return true;
        for (const [n, p] of snapshot) plan.set(n, p);
      }
      return false;
    };
    const fixed = new Set(selected);
    for (const node of this.nodes) {
      if (fixed.has(node)) continue;
      if (
        selected.some((n) => overlaps(plan.get(n)!, plan.get(node)!)) &&
        !relocate(node, fixed)
      )
        return false;
    }
    return true;
  }
  override moveNodeCheck(
    node: GridStackNode,
    options: GridStackMoveOpts,
  ): boolean {
    const drag = this.dragOrigin;
    if (this.mergeHover && drag?.node === node && !options.resizing)
      return false;
    if (!options.resizing && drag?.node === node && node.id) {
      const desired = {
        ...node,
        x: options.x ?? node.x,
        y: options.y ?? node.y,
      };
      this.nodeBoundFix(desired);
      const previous = new Map(this.nodes.map((n) => [n, position(n)]));
      // Each hover is planned against the layout at pickup, not the previous
      // hover's displaced neighbors. Only the final collision plan is saved.
      for (const n of this.nodes) {
        const origin = drag.positions.get(n);
        if (!origin) continue;
        if (n.x !== origin.x || n.y !== origin.y)
          Object.assign(n, { _dirty: true });
        Object.assign(n, origin);
      }
      if (
        this.moveSelection(
          new Set([node.id]),
          desired.x! - node.x!,
          desired.y! - node.y!,
        )
      )
        return true;
      for (const [n, p] of previous) Object.assign(n, p);
      return false;
    }
    if (
      !options.resizing &&
      this.maxRow &&
      this.mode !== 'list' &&
      node.id &&
      this.nodes.includes(node)
    ) {
      const candidate = {
        ...node,
        x: options.x ?? node.x,
        y: options.y ?? node.y,
      };
      this.nodeBoundFix(candidate);
      const dx = candidate.x! - node.x!,
        dy = candidate.y! - node.y!;
      if (!dx && !dy) return false;
      return this.moveSelection(new Set([node.id]), dx, dy);
    }
    if (!options.resizing || !this.maxRow)
      return super.moveNodeCheck(node, options);
    if (node.locked) return false;
    const original = position(node);
    const candidate = {
      ...node,
      x: options.x ?? node.x,
      y: options.y ?? node.y,
      w: options.w ?? node.w,
      h: options.h ?? node.h,
    };
    this.nodeBoundFix(candidate, true);
    const desired = position(candidate);
    if (
      Object.keys(original).every(
        (k) => original[k as keyof Position] === desired[k as keyof Position],
      )
    )
      return false;
    const plan = new Map(this.nodes.map((n) => [n, position(n)]));
    plan.set(node, desired);
    const directionFor = (p: Position): Direction => {
      const growsRight = desired.x + desired.w > original.x + original.w;
      const growsDown = desired.y + desired.h > original.y + original.h;
      if (!growsDown) return 'right';
      if (!growsRight) return 'down';
      if (p.x >= original.x + original.w && p.y < original.y + original.h)
        return 'right';
      if (p.y >= original.y + original.h && p.x < original.x + original.w)
        return 'down';
      return desired.x + desired.w - p.x <= desired.y + desired.h - p.y
        ? 'right'
        : 'down';
    };
    const push = (
      target: GridStackNode,
      obstacle: Position,
      direction: Direction,
    ): boolean => {
      const current = plan.get(target)!;
      if (!overlaps(current, obstacle)) return true;
      if (target === node || target.locked) return false;
      const next = { ...current };
      if (direction === 'right') next.x = obstacle.x + obstacle.w;
      else next.y = obstacle.y + obstacle.h;
      if (next.x + next.w > this.column || next.y + next.h > this.maxRow)
        return false;
      plan.set(target, next);
      for (const other of this.nodes) {
        if (
          other !== target &&
          overlaps(plan.get(other)!, next) &&
          !push(other, next, direction)
        )
          return false;
      }
      return true;
    };
    const reserved = new Map(plan);
    for (const other of this.nodes) {
      if (other === node) continue;
      const p = plan.get(other)!;
      if (overlaps(p, desired) && !push(other, desired, directionFor(p))) {
        // The resized card owns its requested rectangle. A neighbor at the
        // right/bottom boundary can move into another available slot instead.
        for (const [n, saved] of reserved) plan.set(n, saved);
        if (!this.relocateCollisions(plan, [node])) return false;
        break;
      }
    }
    // Commit only a complete plan: a blocked edge never leaves half-moved neighbors.
    for (const [n, p] of plan) {
      if (n.x === p.x && n.y === p.y && n.w === p.w && n.h === p.h) continue;
      Object.assign(n, p, { _dirty: true });
    }
    if (!this.batchMode) this.publish?.(this.getDirtyNodes());
    return true;
  }
}
