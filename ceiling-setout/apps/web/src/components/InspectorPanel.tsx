import { useStore } from '../state/store.js';

/**
 * What a member is and why it is there.
 *
 * This is the panel that makes the output defensible: a builder asking why a TSR is
 * at 900 rather than 1200 gets the value path that decided it, everything else that
 * was weighed, the pack version, and where the figure was said to come from.
 */
export function InspectorPanel() {
  const selectedId = useStore((s) => s.selectedMemberId);
  const result = useStore((s) => s.result);
  const packs = useStore((s) => s.packs);
  const project = useStore((s) => s.project);
  const { addOverride, removeOverride } = useStore();

  const member = result?.members.find((m) => m.id === selectedId);
  if (!member) {
    return <div className="panel-empty">Click a member in the model or the plan to see what put it there.</div>;
  }

  const pack = packs.find((p) => `${p.system}@${p.version}` === member.provenance.rulePackVersion);
  const product = pack?.catalogue.find((c) => c.code === member.productCode);
  const override = project.overrides.find((o) => o.memberId === member.id);

  return (
    <div className="panel">
      <section>
        <h3>{member.layerId}</h3>
        <table className="mini">
          <tbody>
            <tr>
              <td>Type</td>
              <td className="num">{member.type}</td>
            </tr>
            <tr>
              <td>Product</td>
              <td className="num">{member.productCode ?? 'not selected'}</td>
            </tr>
            {product && (
              <tr>
                <td>Description</td>
                <td className="num">{product.description}</td>
              </tr>
            )}
            <tr>
              <td>Section</td>
              <td className="num">
                {product?.profile
                  ? `${product.profile.kind} profile, ${product.width ?? '?'} x ${product.depth ?? '?'}mm`
                  : product?.component
                    ? `${product.component.parts.length}-part component`
                    : product?.width && product?.depth
                      ? `${product.width} x ${product.depth}mm overall - shape not drawn`
                      : 'not entered - shown at a nominal size'}
              </td>
            </tr>
            <tr>
              <td>Cut length</td>
              <td className="num">{Math.round(member.length)}mm</td>
            </tr>
            {Math.abs(member.length - member.planLength) > 0.5 && (
              <tr>
                <td>Plan length</td>
                <td className="num">{Math.round(member.planLength)}mm (on a rake)</td>
              </tr>
            )}
            <tr>
              <td>Start</td>
              <td className="num">
                {Math.round(member.start.x)}, {Math.round(member.start.y)}, {Math.round(member.start.z)}
              </td>
            </tr>
            <tr>
              <td>End</td>
              <td className="num">
                {Math.round(member.end.x)}, {Math.round(member.end.y)}, {Math.round(member.end.z)}
              </td>
            </tr>
            <tr>
              <td>Rotation</td>
              <td className="num">{Math.round(((member.rotation * 180) / Math.PI) * 100) / 100}&deg;</td>
            </tr>
            <tr>
              <td>Identity</td>
              <td className="num mono">{member.id}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {member.fixings.length > 0 && (
        <section>
          <h3>Fixings</h3>
          <table className="mini">
            <tbody>
              <tr>
                <td>Type</td>
                <td className="num">{member.fixings[0]!.type ?? 'not entered'}</td>
              </tr>
              <tr>
                <td>Substrate</td>
                <td className="num">{member.fixings[0]!.substrate ?? 'not entered'}</td>
              </tr>
              <tr>
                <td>Count</td>
                <td className="num">{member.fixings.reduce((s, f) => s + f.count, 0)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h3>Why it is here</h3>
        <p className="reason">{member.provenance.reason}</p>
        <table className="mini">
          <tbody>
            <tr>
              <td>Governed by</td>
              <td className="num mono">{member.provenance.ruleId}</td>
            </tr>
            {member.provenance.spacingUsed !== null && (
              <tr>
                <td>Spacing used</td>
                <td className="num">{member.provenance.spacingUsed}mm</td>
              </tr>
            )}
            {member.provenance.spanUsed !== null && (
              <tr>
                <td>Span used</td>
                <td className="num">{member.provenance.spanUsed}mm</td>
              </tr>
            )}
            <tr>
              <td>Rule pack</td>
              <td className="num mono">{member.provenance.rulePackVersion}</td>
            </tr>
            <tr>
              <td>Source</td>
              <td className="num">{member.provenance.citation ?? 'no citation recorded'}</td>
            </tr>
          </tbody>
        </table>
        {member.provenance.constraints.length > 0 && (
          <>
            <h4>Everything weighed</h4>
            <table className="mini">
              <tbody>
                {member.provenance.constraints.map((c) => (
                  <tr key={c.path} className={c.path === member.provenance.ruleId ? 'binding' : ''}>
                    <td className="mono">{c.path}</td>
                    <td className="num">{c.value}mm</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {member.connectsTo.length > 0 && (
        <section>
          <h3>Connects to</h3>
          <ul className="links">
            {member.connectsTo.map((id) => (
              <li key={id}>
                <button className="link" onClick={() => useStore.getState().selectMember(id)}>
                  {id}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>Manual override</h3>
        {member.overridden && <p className="note">This member has been edited by hand ({member.overridden}).</p>}
        <div className="row">
          <button onClick={() => addOverride({ kind: 'delete', memberId: member.id, note: null })}>Delete</button>
          <button
            onClick={() =>
              addOverride({ kind: 'move', memberId: member.id, delta: { x: 0, y: 50 }, note: null })
            }
          >
            Nudge 50mm
          </button>
          <button
            onClick={() =>
              addOverride({ kind: 'retrim', memberId: member.id, trimStart: 50, trimEnd: 50, note: null })
            }
          >
            Trim 50 both ends
          </button>
          {override && <button onClick={() => removeOverride(member.id)}>Clear</button>}
        </div>
        <p className="note">
          Edits are kept apart from the generated geometry and re-applied after every regeneration, keyed on the
          member identity above.
        </p>
      </section>
    </div>
  );
}
