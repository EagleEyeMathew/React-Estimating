import { useState } from 'react';
import { Viewer3D } from './components/Viewer3D.js';
import { PlanView } from './components/PlanView.js';
import { LayerPanel } from './components/LayerPanel.js';
import { SetoutPanel } from './components/SetoutPanel.js';
import { InspectorPanel } from './components/InspectorPanel.js';
import { IssuesPanel } from './components/IssuesPanel.js';
import { RulePackEditor } from './components/RulePackEditor.js';
import { SchedulePanel } from './components/SchedulePanel.js';
import { ExportPanel } from './components/ExportPanel.js';
import { useStore } from './state/store.js';

type Tab = 'setout' | 'member' | 'issues' | 'rules' | 'schedules' | 'issue';
type Stage = 'model' | 'plan';

const TABS: { id: Tab; label: string }[] = [
  { id: 'setout', label: 'Setout' },
  { id: 'member', label: 'Member' },
  { id: 'issues', label: 'Issues' },
  { id: 'rules', label: 'Rule pack' },
  { id: 'schedules', label: 'Schedules' },
  { id: 'issue', label: 'Issue' },
];

export function App() {
  const [tab, setTab] = useState<Tab>('setout');
  const [stage, setStage] = useState<Stage>('model');
  const project = useStore((s) => s.project);
  const result = useStore((s) => s.result);
  const activeZoneId = useStore((s) => s.activeZoneId);
  const setActiveZone = useStore((s) => s.setActiveZone);
  const overrides = project.overrides.length;

  const errors = result?.issues.filter((i) => i.severity === 'error').length ?? 0;
  const warnings = result?.issues.filter((i) => i.severity === 'warning').length ?? 0;

  return (
    <div className="app">
      <header>
        <div className="brand">
          <strong>Ceiling setout</strong>
          <span className="muted">{project.name}</span>
        </div>
        <nav className="zones">
          {project.zones.map((z) => {
            const zoneErrors = result?.issues.filter((i) => i.zoneId === z.id && i.severity === 'error').length ?? 0;
            return (
              <button key={z.id} className={z.id === activeZoneId ? 'active' : ''} onClick={() => setActiveZone(z.id)}>
                {z.name}
                {zoneErrors > 0 && <span className="badge error">{zoneErrors}</span>}
              </button>
            );
          })}
        </nav>
        <div className="status">
          {overrides > 0 && <span className="badge info">{overrides} manual edit(s)</span>}
          <span className={`badge ${errors > 0 ? 'error' : 'ok'}`}>{errors} errors</span>
          <span className="badge warning">{warnings} warnings</span>
        </div>
      </header>

      <main>
        <div className="stage">
          <div className="segmented stage-switch">
            <button className={stage === 'model' ? 'active' : ''} onClick={() => setStage('model')}>
              3D model
            </button>
            <button className={stage === 'plan' ? 'active' : ''} onClick={() => setStage('plan')}>
              Ceiling plan
            </button>
          </div>
          <LayerPanel />
          <div className="canvas">{stage === 'model' ? <Viewer3D /> : <PlanView />}</div>
        </div>

        <aside>
          <div className="segmented wrap tabs">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="aside-body">
            {tab === 'setout' && <SetoutPanel />}
            {tab === 'member' && <InspectorPanel />}
            {tab === 'issues' && <IssuesPanel />}
            {tab === 'rules' && <RulePackEditor />}
            {tab === 'schedules' && <SchedulePanel />}
            {tab === 'issue' && <ExportPanel />}
          </div>
        </aside>
      </main>

      <footer>
        {result?.banners.map((b) => (
          <span key={b}>{b}</span>
        ))}
      </footer>
    </div>
  );
}
