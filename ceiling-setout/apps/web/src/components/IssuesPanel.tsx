import { useStore } from '../state/store.js';

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

/**
 * Everything the validator flagged, with its location.
 *
 * Errors first, and nothing is hidden behind a "show all" - an issue the reader does
 * not see is the same as an issue that was never raised.
 */
export function IssuesPanel() {
  const result = useStore((s) => s.result);
  const activeZoneId = useStore((s) => s.activeZoneId);
  const select = useStore((s) => s.selectMember);
  const setActiveZone = useStore((s) => s.setActiveZone);

  const issues = [...(result?.issues ?? [])].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.code.localeCompare(b.code),
  );

  const counts = {
    error: issues.filter((i) => i.severity === 'error').length,
    warning: issues.filter((i) => i.severity === 'warning').length,
    info: issues.filter((i) => i.severity === 'info').length,
  };

  return (
    <div className="panel">
      <section>
        <h3>
          Issues <span className="badge error">{counts.error}</span>{' '}
          <span className="badge warning">{counts.warning}</span> <span className="badge info">{counts.info}</span>
        </h3>
        {issues.length === 0 && <p className="note">Nothing flagged against the values entered in the rule pack.</p>}
        <ul className="issues">
          {issues.map((issue) => (
            <li key={issue.id} className={`issue ${issue.severity} ${issue.zoneId === activeZoneId ? 'here' : ''}`}>
              <div className="issue-head">
                <span className={`badge ${issue.severity}`}>{issue.severity}</span>
                <code>{issue.code}</code>
                {issue.zoneId && issue.zoneId !== activeZoneId && (
                  <button className="link" onClick={() => setActiveZone(issue.zoneId!)}>
                    go to zone
                  </button>
                )}
              </div>
              <p>{issue.message}</p>
              <div className="issue-meta">
                {issue.location && (
                  <span>
                    at {Math.round(issue.location.x)}, {Math.round(issue.location.y)}
                  </span>
                )}
                {issue.ruleId && <code>{issue.ruleId}</code>}
                {issue.memberIds.map((id) => (
                  <button key={id} className="link" onClick={() => select(id)}>
                    {id}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Standing of these figures</h3>
        {result?.banners.map((b) => (
          <p key={b} className="banner">
            {b}
          </p>
        ))}
      </section>
    </div>
  );
}
