import type { RulePack } from './schema.js';
import { loadRulePack, packKey, hasErrors, type PackProblem } from './loader.js';

/**
 * Packs available to a project, keyed by `system@version`.
 *
 * Version is part of the key rather than a mutable property, so a project saved
 * against 2026.1 keeps regenerating against 2026.1 after 2026.2 is added. Changing a
 * figure means publishing a new version, not editing history.
 */
export class RulePackRegistry {
  private readonly packs = new Map<string, RulePack>();

  register(pack: RulePack): void {
    this.packs.set(packKey(pack), pack);
  }

  /** Validate then register. Returns any problems; a pack with errors is not registered. */
  load(input: unknown): { key: string | null; problems: readonly PackProblem[] } {
    const { pack, problems } = loadRulePack(input);
    if (!pack || hasErrors(problems)) return { key: null, problems };
    this.register(pack);
    return { key: packKey(pack), problems };
  }

  get(system: string, version: string): RulePack | null {
    return this.packs.get(`${system}@${version}`) ?? null;
  }

  getByKey(key: string): RulePack | null {
    return this.packs.get(key) ?? null;
  }

  has(system: string, version: string): boolean {
    return this.packs.has(`${system}@${version}`);
  }

  list(): RulePack[] {
    return [...this.packs.values()].sort((a, b) => packKey(a).localeCompare(packKey(b)));
  }

  versionsOf(system: string): string[] {
    return this.list()
      .filter((p) => p.system === system)
      .map((p) => p.version)
      .sort();
  }

  /**
   * Highest version of a system, by natural ordering of its dotted parts. Only for
   * picking a default in the UI - generation always names an explicit version.
   */
  latest(system: string): RulePack | null {
    const packs = this.list().filter((p) => p.system === system);
    if (packs.length === 0) return null;
    return packs.reduce((best, p) => (compareVersions(p.version, best.version) > 0 ? p : best));
  }

  systems(): string[] {
    return [...new Set(this.list().map((p) => p.system))].sort();
  }
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number(pa[i] ?? 0);
    const nb = Number(pb[i] ?? 0);
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      const cmp = (pa[i] ?? '').localeCompare(pb[i] ?? '');
      if (cmp !== 0) return cmp;
    } else if (na !== nb) {
      return na - nb;
    }
  }
  return 0;
}
