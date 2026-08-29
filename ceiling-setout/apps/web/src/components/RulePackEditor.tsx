import { useMemo, useState } from 'react';
import { readiness, valueSlots } from '@ceiling/rules';
import { activePack, useStore } from '../state/store.js';

/**
 * The rule pack editor.
 *
 * Values ship blank on purpose, and this is where they are entered from the
 * manufacturer literature. Every figure shows what cites it: a value with no source
 * recorded is usable and undefensible, and the editor says so rather than letting the
 * distinction disappear once the number is typed in.
 */
export function RulePackEditor() {
  const pack = useStore(activePack);
  const { editPackValue, publishPackVersion } = useStore();
  const [filter, setFilter] = useState('');
  const [newVersion, setNewVersion] = useState('');

  const slots = useMemo(() => (pack ? valueSlots(pack) : []), [pack]);
  const report = useMemo(() => (pack ? readiness(pack) : null), [pack]);
  if (!pack || !report) return <div className="panel-empty">No rule pack is loaded for this zone.</div>;

  const packKey = `${pack.system}@${pack.version}`;
  const shown = slots.filter(
    (s) =>
      filter === '' ||
      s.path.toLowerCase().includes(filter.toLowerCase()) ||
      s.label.toLowerCase().includes(filter.toLowerCase()) ||
      s.group.toLowerCase().includes(filter.toLowerCase()),
  );
  const groups = [...new Set(shown.map((s) => s.group))];

  return (
    <div className="panel">
      <section>
        <h3>{pack.name}</h3>
        <p className="note">
          {packKey} &middot; <strong>{pack.status}</strong> &middot; {pack.source.source}
        </p>
        {pack.notes && <p className="banner">{pack.notes}</p>}
        <div className="progress">
          <div
            className="progress-bar"
            style={{ width: `${report.requiredTotal === 0 ? 100 : (report.requiredEntered / report.requiredTotal) * 100}%` }}
          />
        </div>
        <p className="note">
          {report.requiredEntered} of {report.requiredTotal} required figures entered; {report.entered} of{' '}
          {report.total} in total. {report.uncited.length > 0 && `${report.uncited.length} entered with no citation.`}
        </p>
        {!report.generatable && (
          <p className="note warn">
            This pack will not generate until the required figures are entered. The engine reports the gaps rather
            than substituting a default.
          </p>
        )}
      </section>

      <section>
        <h3>Publish a new version</h3>
        <p className="note">
          Editing forks rather than overwrites, so a project saved against {pack.version} keeps regenerating against{' '}
          {pack.version}.
        </p>
        <div className="row">
          <input
            placeholder="e.g. 2026.2"
            value={newVersion}
            onChange={(e) => setNewVersion(e.target.value)}
          />
          <button
            disabled={newVersion.trim() === ''}
            onClick={() => {
              publishPackVersion(packKey, newVersion.trim());
              setNewVersion('');
            }}
          >
            Publish
          </button>
        </div>
      </section>

      <section>
        <h3>Values</h3>
        <input className="filter" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {groups.map((group) => (
          <div key={group} className="group">
            <h4>{group}</h4>
            <table className="values">
              <tbody>
                {shown
                  .filter((s) => s.group === group)
                  .map((slot) => (
                    <tr key={slot.path} className={slot.required && slot.value === null ? 'missing' : ''}>
                      <td>
                        <span className="label">{slot.label}</span>
                        {slot.required && <span className="req">required</span>}
                        {!slot.active && <span className="off">layer off</span>}
                        <code className="path">{slot.path}</code>
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          value={slot.value ?? ''}
                          placeholder="blank"
                          onChange={(e) =>
                            editPackValue(packKey, slot.path, e.target.value === '' ? null : Number(e.target.value))
                          }
                        />
                        <span className="units">{slot.units}</span>
                      </td>
                      <td className="cite">
                        {slot.value === null ? (
                          ''
                        ) : slot.citation ? (
                          <span title={`${slot.citation.source} ${slot.citation.reference ?? ''}`}>
                            {slot.citation.source.slice(0, 40)}
                          </span>
                        ) : (
                          <span className="uncited">no source recorded</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>
    </div>
  );
}
