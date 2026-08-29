import { normalise, quantise, sub, type Vec2 } from '@ceiling/geometry';
import type { Override } from './project.js';
import type { Member } from './types.js';

export interface OverrideResult {
  readonly members: readonly Member[];
  /** Ids of overrides whose member no longer exists. */
  readonly orphaned: readonly string[];
}

/**
 * Apply manual edits on top of a freshly generated setout.
 *
 * The engine regenerates every member from scratch, so edits cannot live on the
 * members themselves. They live here as a diff keyed on member identity, which is
 * derived from the setout lattice - so moving a wall at one end of a room does not
 * throw away an edit at the other end.
 *
 * An override whose member has genuinely gone is reported, never dropped in silence.
 * The user needs to see that their edit no longer applies, because the alternative is
 * a drawing that quietly reverts a decision they made on purpose.
 */
export function applyOverrides(members: readonly Member[], overrides: readonly Override[]): OverrideResult {
  if (overrides.length === 0) return { members, orphaned: [] };

  const byId = new Map(members.map((m) => [m.id, m]));
  const deleted = new Set<string>();
  const patched = new Map<string, Member>();
  const orphaned: string[] = [];

  for (const o of overrides) {
    const current = patched.get(o.memberId) ?? byId.get(o.memberId);
    if (!current) {
      orphaned.push(o.memberId);
      continue;
    }
    switch (o.kind) {
      case 'delete':
        deleted.add(o.memberId);
        break;
      case 'move':
        patched.set(o.memberId, move(current, o.delta));
        break;
      case 'retrim':
        patched.set(o.memberId, retrim(current, o.trimStart, o.trimEnd));
        break;
      case 'product':
        patched.set(o.memberId, { ...current, productCode: o.productCode, overridden: 'product' });
        break;
    }
  }

  const out = members
    .filter((m) => !deleted.has(m.id))
    .map((m) => patched.get(m.id) ?? m);
  return { members: out, orphaned };
}

function move(m: Member, delta: Vec2): Member {
  return {
    ...m,
    start: { x: quantise(m.start.x + delta.x), y: quantise(m.start.y + delta.y), z: m.start.z },
    end: { x: quantise(m.end.x + delta.x), y: quantise(m.end.y + delta.y), z: m.end.z },
    fixings: m.fixings.map((f) => ({ ...f, at: { x: quantise(f.at.x + delta.x), y: quantise(f.at.y + delta.y), z: f.at.z } })),
    overridden: 'moved',
    provenance: {
      ...m.provenance,
      reason: `${m.provenance.reason}; moved ${Math.round(Math.hypot(delta.x, delta.y))}mm by hand`,
    },
  };
}

function retrim(m: Member, trimStart: number, trimEnd: number): Member {
  const planLength = m.planLength;
  if (planLength <= 0) return m;
  const d = sub({ x: m.end.x, y: m.end.y }, { x: m.start.x, y: m.start.y });
  const u = normalise(d);
  const s = Math.max(0, trimStart);
  const e = Math.max(0, trimEnd);
  const remaining = planLength - s - e;
  if (remaining <= 0) return m;
  const scaleZ = (t: number): number => m.start.z + ((m.end.z - m.start.z) * t) / planLength;
  return {
    ...m,
    start: { x: quantise(m.start.x + u.x * s), y: quantise(m.start.y + u.y * s), z: quantise(scaleZ(s)) },
    end: { x: quantise(m.end.x - u.x * e), y: quantise(m.end.y - u.y * e), z: quantise(scaleZ(planLength - e)) },
    planLength: quantise(remaining),
    length: quantise((m.length * remaining) / planLength),
    overridden: 'retrimmed',
    provenance: {
      ...m.provenance,
      reason: `${m.provenance.reason}; trimmed ${Math.round(s)}mm and ${Math.round(e)}mm by hand`,
    },
  };
}

/** Overrides that would target a member that is not in the current setout. */
export function orphanedOverrides(members: readonly Member[], overrides: readonly Override[]): Override[] {
  const ids = new Set(members.map((m) => m.id));
  return overrides.filter((o) => !ids.has(o.memberId));
}
