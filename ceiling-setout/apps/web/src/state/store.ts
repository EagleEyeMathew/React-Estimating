import { create } from 'zustand';
import type { RulePack } from '@ceiling/rules';
import {
  RulePackRegistry,
  addLayer,
  addLoadCase,
  addProduct,
  blankLayer,
  blankProduct,
  builtinPacks,
  duplicateLayer,
  forkVersion,
  moveLayer,
  removeLayer,
  removeLoadCase,
  removeProduct,
  renameLayer,
  setValueAt,
  updateLayer,
  updateProduct,
  type Layer,
  type MemberType,
  type Product,
} from '@ceiling/rules';
import {
  generate,
  type DirectionSpec,
  type GenerationResult,
  type Member,
  type Nesting,
  type OriginSpec,
  type Override,
  type Project,
  type Zone,
} from '@ceiling/engine';
import { dimensionZone, type Dimension } from '@ceiling/drawing';
import { demoProject } from './demo.js';

export type ViewMode = 'rcp' | 'plan' | 'iso' | 'section';

export interface AppState {
  project: Project;
  packs: RulePack[];
  result: (GenerationResult & { nesting: Record<string, Nesting> }) | null;
  dimensions: Dimension[];
  /** How long the last regeneration took, so a slow setout is visible rather than felt. */
  lastRunMs: number;

  activeZoneId: string;
  selectedMemberId: string | null;
  hiddenLayers: Set<string>;
  viewMode: ViewMode;
  showDimensions: boolean;
  /** Penetration centre dimensions. Off by default: they belong on the services sheet. */
  showServiceDims: boolean;
  showStructure: boolean;
  showLining: boolean;
  /** Clip everything above this level, for looking into the void. mm, null = off. */
  clipLevel: number | null;

  setActiveZone: (id: string) => void;
  selectMember: (id: string | null) => void;
  toggleLayer: (layerId: string) => void;
  setViewMode: (mode: ViewMode) => void;
  setFlag: (key: 'showDimensions' | 'showServiceDims' | 'showStructure' | 'showLining', value: boolean) => void;
  setClipLevel: (level: number | null) => void;

  setDirection: (zoneId: string, direction: DirectionSpec) => void;
  setOrigin: (zoneId: string, origin: OriginSpec) => void;
  setAvoidPenetrations: (zoneId: string, value: boolean) => void;
  setLoadCase: (zoneId: string, loadCase: string | null) => void;
  setSystem: (zoneId: string, pack: string, version: string) => void;
  toggleZoneLayer: (zoneId: string, layerId: string) => void;

  addOverride: (override: Override) => void;
  removeOverride: (memberId: string) => void;
  clearOverrides: () => void;

  editPackValue: (packKey: string, path: string, value: number | null) => void;
  publishPackVersion: (packKey: string, version: string) => void;

  /**
   * Structural edits. Each takes the same shape: change the pack, regenerate, and let
   * whatever it broke show up in the issues rather than being validated away silently.
   */
  addPackLayer: (packKey: string, layer: Layer, insertAfter?: string) => void;
  removePackLayer: (packKey: string, layerId: string, detach: boolean) => void;
  renamePackLayer: (packKey: string, from: string, to: string) => void;
  duplicatePackLayer: (packKey: string, layerId: string, newId: string) => void;
  updatePackLayer: (packKey: string, layerId: string, patch: Record<string, unknown>) => void;
  movePackLayer: (packKey: string, layerId: string, delta: number) => void;
  addPackProduct: (packKey: string, product: Product) => void;
  updatePackProduct: (packKey: string, code: string, patch: Record<string, unknown>) => void;
  removePackProduct: (packKey: string, code: string, detach: boolean) => void;
  addPackLoadCase: (packKey: string, id: string, description: string) => void;
  removePackLoadCase: (packKey: string, id: string) => void;
  /** The last structural edit that was refused, so the panel can say why. */
  lastEditError: string | null;
  clearEditError: () => void;

  loadProject: (project: Project) => void;
  regenerate: () => void;
}

function run(project: Project, packs: RulePack[]) {
  const registry = new RulePackRegistry();
  for (const p of packs) registry.register(p);
  const started = performance.now();
  const result = generate({ project, registry });
  const lastRunMs = Math.round((performance.now() - started) * 10) / 10;

  const dimensions: Dimension[] = [];
  for (const zoneResult of result.zones) {
    const zone = project.zones.find((z) => z.id === zoneResult.zoneId);
    if (zone) dimensions.push(...dimensionZone(zone, zoneResult));
  }
  return { result, dimensions, lastRunMs };
}

const updateZone = (project: Project, zoneId: string, patch: (zone: Zone) => Zone): Project => ({
  ...project,
  zones: project.zones.map((z) => (z.id === zoneId ? patch(z) : z)),
});

export const useStore = create<AppState>((set, get) => {
  const project = demoProject();
  const packs = builtinPacks();
  const first = run(project, packs);

  /** Regeneration is synchronous and fast enough to run on every edit. */
  const apply = (next: { project?: Project; packs?: RulePack[] }): void => {
    const state = get();
    const p = next.project ?? state.project;
    const k = next.packs ?? state.packs;
    set({ project: p, packs: k, ...run(p, k) });
  };

  return {
    project,
    packs,
    ...first,

    activeZoneId: project.zones[0]?.id ?? '',
    selectedMemberId: null,
    hiddenLayers: new Set<string>(),
    viewMode: 'iso',
    showDimensions: true,
    showServiceDims: false,
    showStructure: true,
    showLining: false,
    clipLevel: null,

    setActiveZone: (id) => set({ activeZoneId: id, selectedMemberId: null }),
    selectMember: (id) => set({ selectedMemberId: id }),
    toggleLayer: (layerId) =>
      set((s) => {
        const next = new Set(s.hiddenLayers);
        if (next.has(layerId)) next.delete(layerId);
        else next.add(layerId);
        return { hiddenLayers: next };
      }),
    setViewMode: (viewMode) => set({ viewMode }),
    setFlag: (key, value) => set({ [key]: value } as Partial<AppState>),
    setClipLevel: (clipLevel) => set({ clipLevel }),

    setDirection: (zoneId, direction) =>
      apply({ project: updateZone(get().project, zoneId, (z) => ({ ...z, setout: { ...z.setout, direction } })) }),
    setOrigin: (zoneId, origin) =>
      apply({ project: updateZone(get().project, zoneId, (z) => ({ ...z, setout: { ...z.setout, origin } })) }),
    setAvoidPenetrations: (zoneId, avoidPenetrations) =>
      apply({
        project: updateZone(get().project, zoneId, (z) => ({ ...z, setout: { ...z.setout, avoidPenetrations } })),
      }),
    setLoadCase: (zoneId, loadCase) =>
      apply({ project: updateZone(get().project, zoneId, (z) => ({ ...z, system: { ...z.system, loadCase } })) }),
    setSystem: (zoneId, pack, version) =>
      apply({
        project: updateZone(get().project, zoneId, (z) => {
          const target = get().packs.find((p) => p.system === pack && p.version === version);
          const loadCase = target?.loadCases.some((c) => c.id === z.system.loadCase)
            ? z.system.loadCase
            : (target?.loadCases[0]?.id ?? null);
          return { ...z, system: { pack, version, loadCase } };
        }),
      }),
    toggleZoneLayer: (zoneId, layerId) =>
      apply({
        project: updateZone(get().project, zoneId, (z) => ({
          ...z,
          disabledLayers: z.disabledLayers.includes(layerId)
            ? z.disabledLayers.filter((l) => l !== layerId)
            : [...z.disabledLayers, layerId],
        })),
      }),

    addOverride: (override) =>
      apply({
        project: {
          ...get().project,
          // One override of each kind per member; a later edit replaces the earlier one.
          overrides: [
            ...get().project.overrides.filter((o) => !(o.memberId === override.memberId && o.kind === override.kind)),
            override,
          ],
        },
      }),
    removeOverride: (memberId) =>
      apply({ project: { ...get().project, overrides: get().project.overrides.filter((o) => o.memberId !== memberId) } }),
    clearOverrides: () => apply({ project: { ...get().project, overrides: [] } }),

    editPackValue: (packKey, path, value) =>
      apply({
        packs: get().packs.map((p) => (`${p.system}@${p.version}` === packKey ? setValueAt(p, path, value) : p)),
      }),

    ...structuralEdits(get, apply, set),

    publishPackVersion: (packKey, version) => {
      const source = get().packs.find((p) => `${p.system}@${p.version}` === packKey);
      if (!source) return;
      apply({ packs: [...get().packs, forkVersion(source, version)] });
    },

    loadProject: (next) => apply({ project: next }),
    regenerate: () => apply({}),
    lastEditError: null,
    clearEditError: () => set({ lastEditError: null }),
  };
});

/**
 * The structural edits, all built the same way.
 *
 * The rules package refuses an edit that would leave the pack incoherent - removing a
 * rail three layers still bear on, renaming onto a name already taken - by throwing.
 * That message is worth showing rather than swallowing, so every edit funnels through
 * one place that catches it and puts it on the panel.
 */
function structuralEdits(
  get: () => AppState,
  apply: (next: { packs?: RulePack[] }) => void,
  set: (partial: Partial<AppState>) => void,
) {
  const edit = (packKey: string, change: (pack: RulePack) => RulePack): void => {
    try {
      apply({ packs: get().packs.map((p) => (`${p.system}@${p.version}` === packKey ? change(p) : p)) });
      set({ lastEditError: null });
    } catch (error) {
      set({ lastEditError: error instanceof Error ? error.message : String(error) });
    }
  };

  return {
    addPackLayer: (packKey: string, layer: Layer, insertAfter?: string) =>
      edit(packKey, (p) => addLayer(p, layer, insertAfter)),
    removePackLayer: (packKey: string, layerId: string, detach: boolean) =>
      edit(packKey, (p) => removeLayer(p, layerId, { detach })),
    renamePackLayer: (packKey: string, from: string, to: string) => edit(packKey, (p) => renameLayer(p, from, to)),
    duplicatePackLayer: (packKey: string, layerId: string, newId: string) =>
      edit(packKey, (p) => duplicateLayer(p, layerId, newId)),
    updatePackLayer: (packKey: string, layerId: string, patch: Record<string, unknown>) =>
      edit(packKey, (p) => updateLayer(p, layerId, patch)),
    movePackLayer: (packKey: string, layerId: string, delta: number) => edit(packKey, (p) => moveLayer(p, layerId, delta)),
    addPackProduct: (packKey: string, product: Product) => edit(packKey, (p) => addProduct(p, product)),
    updatePackProduct: (packKey: string, code: string, patch: Record<string, unknown>) =>
      edit(packKey, (p) => updateProduct(p, code, patch)),
    removePackProduct: (packKey: string, code: string, detach: boolean) =>
      edit(packKey, (p) => removeProduct(p, code, { detach })),
    addPackLoadCase: (packKey: string, id: string, description: string) =>
      edit(packKey, (p) => addLoadCase(p, id, description)),
    removePackLoadCase: (packKey: string, id: string) => edit(packKey, (p) => removeLoadCase(p, id)),
  };
}

export { blankLayer, blankProduct };
export type { Layer, MemberType, Product };

/**
 * Members of the active zone that are not on a hidden layer.
 *
 * Deliberately not a store selector. Zustand compares snapshots by reference, and a
 * selector that filters returns a fresh array every render - which reads as a state
 * change every time and spins the component forever. Callers memoise this against the
 * three inputs instead.
 */
export function visibleMembers(
  result: AppState['result'],
  activeZoneId: string,
  hiddenLayers: ReadonlySet<string>,
): Member[] {
  const zone = result?.zones.find((z) => z.zoneId === activeZoneId);
  if (!zone) return [];
  return zone.members.filter((m) => !hiddenLayers.has(m.layerId));
}

export const activeZone = (state: AppState): Zone | undefined =>
  state.project.zones.find((z) => z.id === state.activeZoneId);

export const activeZoneResult = (state: AppState) =>
  state.result?.zones.find((z) => z.zoneId === state.activeZoneId);

export const activePack = (state: AppState): RulePack | undefined => {
  const zone = activeZone(state);
  return zone ? state.packs.find((p) => p.system === zone.system.pack && p.version === zone.system.version) : undefined;
};
