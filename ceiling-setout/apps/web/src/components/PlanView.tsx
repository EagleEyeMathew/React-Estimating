import { useMemo, useRef } from 'react';
import { zoneToSvg } from '@ceiling/drawing';
import { activeZone, activeZoneResult, useStore } from '../state/store.js';

/**
 * The reflected ceiling plan, rendered by the same code that writes the PDF and the
 * DXF. Clicking a member selects it, so the plan and the model select the same thing.
 */
export function PlanView() {
  const zone = useStore(activeZone);
  const result = useStore(activeZoneResult);
  const dimensions = useStore((s) => s.dimensions);
  const hidden = useStore((s) => s.hiddenLayers);
  const showDimensions = useStore((s) => s.showDimensions);
  const showServiceDims = useStore((s) => s.showServiceDims);
  const select = useStore((s) => s.selectMember);
  const selected = useStore((s) => s.selectedMemberId);
  const host = useRef<HTMLDivElement>(null);

  const svg = useMemo(() => {
    if (!zone || !result) return '';
    const layers = [...new Set(result.members.map((m) => m.layerId))].filter((l) => !hidden.has(l));
    // Setout dimensions are the working information; the twenty-odd penetration
    // centres are for the services sheet and drown the plan if shown by default.
    const shown = showDimensions
      ? dimensions.filter((d) => d.zoneId === zone.id && (showServiceDims || d.kind !== 'penetration'))
      : [];
    return zoneToSvg(zone, result, shown, {
      width: 1400,
      height: 940,
      dark: true,
      layers,
    });
  }, [zone, result, dimensions, hidden, showDimensions, showServiceDims]);

  if (!zone || !result) return <div className="panel-empty">This zone did not generate.</div>;

  return (
    <div
      className="plan-host"
      ref={host}
      data-selected={selected ?? ''}
      onClick={(e) => {
        const target = (e.target as Element).closest('[data-member]');
        select(target?.getAttribute('data-member') ?? null);
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
