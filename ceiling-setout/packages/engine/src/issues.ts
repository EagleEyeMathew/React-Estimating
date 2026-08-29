import type { Vec2, Vec3 } from '@ceiling/geometry';
import type { Issue, IssueSeverity } from './types.js';

/**
 * Collects issues in generation order.
 *
 * Ids are derived from the issue's own content rather than a counter, so the same
 * defect keeps the same id between runs and the issues report can be diffed.
 */
export class IssueLog {
  private readonly items: Issue[] = [];

  add(
    severity: IssueSeverity,
    code: string,
    message: string,
    opts: {
      zoneId?: string | null;
      location?: Vec3 | Vec2 | null;
      memberIds?: readonly string[];
      ruleId?: string | null;
    } = {},
  ): Issue {
    const zoneId = opts.zoneId ?? null;
    const issue: Issue = {
      id: `${zoneId ?? 'project'}:${code}:${hash(`${message}|${(opts.memberIds ?? []).join(',')}|${opts.ruleId ?? ''}`)}`,
      severity,
      code,
      message,
      zoneId,
      location: opts.location ?? null,
      memberIds: opts.memberIds ?? [],
      ruleId: opts.ruleId ?? null,
    };
    this.items.push(issue);
    return issue;
  }

  error(code: string, message: string, opts?: Parameters<IssueLog['add']>[3]): Issue {
    return this.add('error', code, message, opts);
  }
  warn(code: string, message: string, opts?: Parameters<IssueLog['add']>[3]): Issue {
    return this.add('warning', code, message, opts);
  }
  info(code: string, message: string, opts?: Parameters<IssueLog['add']>[3]): Issue {
    return this.add('info', code, message, opts);
  }

  /** Deduplicated, in a stable order: worst first, then by code and id. */
  all(): Issue[] {
    const seen = new Set<string>();
    const rank: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };
    return this.items
      .filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
      .sort((a, b) => rank[a.severity] - rank[b.severity] || a.code.localeCompare(b.code) || a.id.localeCompare(b.id));
  }

  get count(): number {
    return this.items.length;
  }
}

/** FNV-1a. Short, stable, and not required to be cryptographic. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export { hash };
