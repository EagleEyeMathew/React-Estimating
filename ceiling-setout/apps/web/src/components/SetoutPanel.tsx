import { activePack, activeZone, activeZoneResult, useStore } from '../state/store.js';

/**
 * The setout controls.
 *
 * Every control here re-runs the whole engine on change. That is deliberate: the
 * point of the app is that the setout is a consequence of the rules and the room,
 * so changing a rule or the room should show the consequence immediately rather
 * than after a "generate" step that invites the two to drift apart.
 */
export function SetoutPanel() {
  const zone = useStore(activeZone);
  const result = useStore(activeZoneResult);
  const pack = useStore(activePack);
  const packs = useStore((s) => s.packs);
  const lastRunMs = useStore((s) => s.lastRunMs);
  const { setDirection, setOrigin, setAvoidPenetrations, setLoadCase, setSystem, toggleZoneLayer } = useStore();

  if (!zone || !result) return <div className="panel-empty">This zone did not generate. See the issues.</div>;

  const dirKind = zone.setout.direction.kind;
  const originKind = zone.setout.origin.kind;
  const systems = [...new Set(packs.map((p) => p.system))];
  const versions = packs.filter((p) => p.system === zone.system.pack);

  return (
    <div className="panel">
      <section>
        <h3>System</h3>
        <label>
          <span>Ceiling system</span>
          <select
            value={zone.system.pack}
            onChange={(e) => {
              const next = packs.find((p) => p.system === e.target.value);
              if (next) setSystem(zone.id, next.system, next.version);
            }}
          >
            {systems.map((s) => (
              <option key={s} value={s}>
                {packs.find((p) => p.system === s)?.name ?? s}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Rule pack version</span>
          <select value={zone.system.version} onChange={(e) => setSystem(zone.id, zone.system.pack, e.target.value)}>
            {versions.map((p) => (
              <option key={p.version} value={p.version}>
                {p.version} ({p.status})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Load case</span>
          <select value={zone.system.loadCase ?? ''} onChange={(e) => setLoadCase(zone.id, e.target.value || null)}>
            <option value="">(none selected)</option>
            {pack?.loadCases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.description}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section>
        <h3>Setout direction</h3>
        <div className="segmented">
          {(['longest-edge', 'principal-axis', 'angle'] as const).map((k) => (
            <button
              key={k}
              className={dirKind === k ? 'active' : ''}
              onClick={() =>
                setDirection(
                  zone.id,
                  k === 'angle'
                    ? { kind: 'angle', degrees: result.setout.directionDegrees }
                    : { kind: k },
                )
              }
            >
              {k === 'longest-edge' ? 'Longest wall' : k === 'principal-axis' ? 'Principal axis' : 'Angle'}
            </button>
          ))}
        </div>
        {dirKind === 'angle' && (
          <label>
            <span>Degrees</span>
            <input
              type="range"
              min={0}
              max={180}
              step={0.5}
              value={zone.setout.direction.kind === 'angle' ? zone.setout.direction.degrees : 0}
              onChange={(e) => setDirection(zone.id, { kind: 'angle', degrees: Number(e.target.value) })}
            />
            <input
              type="number"
              value={zone.setout.direction.kind === 'angle' ? zone.setout.direction.degrees : 0}
              step={0.5}
              onChange={(e) => setDirection(zone.id, { kind: 'angle', degrees: Number(e.target.value) })}
            />
          </label>
        )}
        <p className="note">{result.setout.directionReason}</p>
      </section>

      <section>
        <h3>Setout origin</h3>
        <div className="segmented">
          {(['balanced', 'datum-corner', 'point'] as const).map((k) => (
            <button
              key={k}
              className={originKind === k ? 'active' : ''}
              onClick={() =>
                setOrigin(zone.id, k === 'point' ? { kind: 'point', point: result.setout.origin } : { kind: k })
              }
            >
              {k === 'balanced' ? 'Balanced' : k === 'datum-corner' ? 'Datum corner' : 'Point'}
            </button>
          ))}
        </div>
        {originKind === 'point' && zone.setout.origin.kind === 'point' && (
          <div className="row">
            <label>
              <span>X</span>
              <input
                type="number"
                value={zone.setout.origin.point.x}
                step={10}
                onChange={(e) =>
                  setOrigin(zone.id, {
                    kind: 'point',
                    point: { x: Number(e.target.value), y: (zone.setout.origin as { point: { y: number } }).point.y },
                  })
                }
              />
            </label>
            <label>
              <span>Y</span>
              <input
                type="number"
                value={zone.setout.origin.point.y}
                step={10}
                onChange={(e) =>
                  setOrigin(zone.id, {
                    kind: 'point',
                    point: { x: (zone.setout.origin as { point: { x: number } }).point.x, y: Number(e.target.value) },
                  })
                }
              />
            </label>
          </div>
        )}
        <p className="note">{result.setout.originReason}</p>
        <label className="check">
          <input
            type="checkbox"
            checked={zone.setout.avoidPenetrations}
            onChange={(e) => setAvoidPenetrations(zone.id, e.target.checked)}
          />
          <span>Move the setout to keep openings clear of members</span>
        </label>
      </section>

      <section>
        <h3>Spacings used</h3>
        <table className="mini">
          <tbody>
            {Object.entries(result.spacings).map(([layer, s]) => (
              <tr key={layer}>
                <td>{layer}</td>
                <td className="num">{s.spacing === null ? 'not resolved' : `${s.spacing}mm`}</td>
                <td className="rule">{s.governedBy ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Layers in this zone</h3>
        {pack?.layers.map((l) => (
          <label className="check" key={l.id}>
            <input
              type="checkbox"
              checked={!zone.disabledLayers.includes(l.id)}
              onChange={() => toggleZoneLayer(zone.id, l.id)}
            />
            <span>
              {l.id} <em>{l.description}</em>
            </span>
          </label>
        ))}
      </section>

      <p className="note">Regenerated in {lastRunMs}ms.</p>
    </div>
  );
}
