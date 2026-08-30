import { activeZoneResult, useStore, type ViewMode } from '../state/store.js';

const VIEWS: { id: ViewMode; label: string; hint: string }[] = [
  { id: 'rcp', label: 'RCP', hint: 'Reflected ceiling plan - looking up' },
  { id: 'plan', label: 'Plan', hint: 'Looking down' },
  { id: 'iso', label: 'Iso', hint: 'Isometric' },
  { id: 'section', label: 'Section', hint: 'Eye level, looking across the void' },
];

/** Layer visibility, view presets and the clip plane. */
export function LayerPanel() {
  const result = useStore(activeZoneResult);
  const hidden = useStore((s) => s.hiddenLayers);
  const toggle = useStore((s) => s.toggleLayer);
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const showDimensions = useStore((s) => s.showDimensions);
  const showServiceDims = useStore((s) => s.showServiceDims);
  const showStructure = useStore((s) => s.showStructure);
  const showLining = useStore((s) => s.showLining);
  const setFlag = useStore((s) => s.setFlag);
  const clipLevel = useStore((s) => s.clipLevel);
  const setClipLevel = useStore((s) => s.setClipLevel);

  const layers = [...new Set(result?.members.map((m) => m.layerId) ?? [])].sort();
  const counts = new Map(layers.map((l) => [l, result?.members.filter((m) => m.layerId === l).length ?? 0]));
  // Colour by member type, not by layer id. A layer someone added themselves has an id
  // no stylesheet has heard of, and would show a grey chip against a blue member.
  const typeOf = new Map(layers.map((l) => [l, result?.members.find((m) => m.layerId === l)?.type ?? 'trim']));

  return (
    <div className="layer-bar">
      <div className="segmented">
        {VIEWS.map((v) => (
          <button key={v.id} title={v.hint} className={viewMode === v.id ? 'active' : ''} onClick={() => setViewMode(v.id)}>
            {v.label}
          </button>
        ))}
      </div>

      <div className="chips">
        {layers.map((l) => (
          <button key={l} className={`chip ${hidden.has(l) ? 'off' : ''}`} onClick={() => toggle(l)}>
            <span className={`swatch type-${typeOf.get(l)}`} />
            {l} <span className="count">{counts.get(l)}</span>
          </button>
        ))}
        <button className={`chip ${showStructure ? '' : 'off'}`} onClick={() => setFlag('showStructure', !showStructure)}>
          structure above
        </button>
        <button className={`chip ${showLining ? '' : 'off'}`} onClick={() => setFlag('showLining', !showLining)}>
          lining
        </button>
        <button className={`chip ${showDimensions ? '' : 'off'}`} onClick={() => setFlag('showDimensions', !showDimensions)}>
          setout dims
        </button>
        <button
          className={`chip ${showServiceDims ? '' : 'off'}`}
          onClick={() => setFlag('showServiceDims', !showServiceDims)}
        >
          services dims
        </button>
      </div>

      <label className="clip-control">
        <span>Clip above</span>
        <input
          type="range"
          min={2500}
          max={4200}
          step={25}
          value={clipLevel ?? 4200}
          onChange={(e) => setClipLevel(Number(e.target.value) >= 4200 ? null : Number(e.target.value))}
        />
        <span className="num">{clipLevel === null ? 'off' : `${clipLevel}mm`}</span>
      </label>
    </div>
  );
}
