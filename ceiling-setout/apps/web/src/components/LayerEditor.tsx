import { useState } from 'react';
import { isAlongMember, isLineArray, layerReferences, layersRemovedWith, productReferences } from '@ceiling/rules';
import type { Layer, MemberType, RulePack } from '@ceiling/rules';
import { activePack, blankLayer, blankProduct, useStore } from '../state/store.js';

const MEMBER_TYPES: MemberType[] = [
  'furring',
  'tsr',
  'main_tee',
  'cross_tee',
  'rail',
  'batten',
  'hanger',
  'bracket',
  'trim',
  'brace',
  'bridging',
];

const GENERATORS = [
  { id: 'line-array', label: 'Line array', hint: 'A family of parallel members clipped to the zone - rails, channels, battens, tees.' },
  { id: 'along-member', label: 'Points along a member', hint: 'Hangers, clips and brackets placed along another layer.' },
  { id: 'perimeter', label: 'Perimeter', hint: 'Trim following the walls and structural voids.' },
  { id: 'brace', label: 'Bracing', hint: 'Restraint on a grid. Off by default.' },
] as const;

const slug = (v: string): string => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/**
 * The layer and catalogue editor.
 *
 * A pack's shape is data as much as its figures are, so adding a rail, a second stage
 * of suspension, or a product nobody has catalogued has to be doable here. Otherwise
 * "adding a system is a data task" holds only for whoever will hand-edit JSON.
 *
 * Every new layer starts blank, so it behaves exactly like one in a shipped skeleton:
 * the engine reports what it needs rather than generating on a default nobody entered.
 */
export function LayerEditor() {
  const pack = useStore(activePack);
  const error = useStore((s) => s.lastEditError);
  const clearError = useStore((s) => s.clearEditError);
  const {
    addPackLayer,
    removePackLayer,
    renamePackLayer,
    duplicatePackLayer,
    updatePackLayer,
    movePackLayer,
    addPackProduct,
    removePackProduct,
    addPackLoadCase,
    removePackLoadCase,
  } = useStore();

  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', generator: 'line-array' as Layer['generator'], memberType: 'rail' as MemberType, along: '' });
  const [productDraft, setProductDraft] = useState({ code: '', description: '', role: 'rail' as MemberType });
  const [loadCaseDraft, setLoadCaseDraft] = useState('');

  if (!pack) return <div className="panel-empty">No rule pack is loaded for this zone.</div>;
  const packKey = `${pack.system}@${pack.version}`;
  const hosts = pack.layers.filter((l) => isLineArray(l) || l.generator === 'perimeter');

  const addLayerFromDraft = (): void => {
    const id = slug(draft.name);
    if (!id) return;
    const layer = blankLayer(draft.generator, id, draft.name.trim(), draft.memberType, {
      along: draft.along || hosts[0]?.id,
    });
    addPackLayer(packKey, layer);
    setDraft({ ...draft, name: '' });
    setOpen(id);
  };

  return (
    <div className="panel">
      {error && (
        <section>
          <p className="banner error-banner">
            {error} <button className="link" onClick={clearError}>dismiss</button>
          </p>
        </section>
      )}

      <section>
        <h3>Layers</h3>
        <p className="note">
          Top of the list is generated first. A new layer starts with every figure blank, so it reports what it
          needs rather than generating on a guess.
        </p>
        {pack.layers.map((layer, i) => (
          <LayerRow
            key={layer.id}
            pack={pack}
            packKey={packKey}
            layer={layer}
            index={i}
            expanded={open === layer.id}
            onToggle={() => setOpen(open === layer.id ? null : layer.id)}
            onRemove={removePackLayer}
            onRename={renamePackLayer}
            onDuplicate={duplicatePackLayer}
            onUpdate={updatePackLayer}
            onMove={movePackLayer}
          />
        ))}
      </section>

      <section>
        <h3>Add a layer</h3>
        <label>
          <span>Name</span>
          <input
            placeholder="e.g. Secondary rail"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label>
          <span>Generated as</span>
          <select
            value={draft.generator}
            onChange={(e) => setDraft({ ...draft, generator: e.target.value as Layer['generator'] })}
          >
            {GENERATORS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <p className="note">{GENERATORS.find((g) => g.id === draft.generator)?.hint}</p>
        <label>
          <span>Member type</span>
          <select value={draft.memberType} onChange={(e) => setDraft({ ...draft, memberType: e.target.value as MemberType })}>
            {MEMBER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {draft.generator === 'along-member' && (
          <label>
            <span>Runs along</span>
            <select value={draft.along} onChange={(e) => setDraft({ ...draft, along: e.target.value })}>
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.id}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="primary" disabled={slug(draft.name) === ''} onClick={addLayerFromDraft}>
          Add layer
        </button>
        <p className="note">
          The member type decides how it behaves, not what it is called: a hanger is suspended and gets a drop, a
          bracket and a clip are points, everything else is a run. Call it whatever you like in the name.
        </p>
      </section>

      <section>
        <h3>Catalogue</h3>
        {pack.catalogue.map((product) => {
          const used = productReferences(pack, product.code);
          return (
            <div className="catalogue-row" key={product.code}>
              <div>
                <code>{product.code}</code>
                <span className="muted"> {product.description}</span>
                <span className="note">
                  {product.roles.join(', ')}
                  {used.length > 0 ? ` · used by ${used.length}` : ' · unused'}
                </span>
              </div>
              <button
                onClick={() => {
                  if (used.length === 0) removePackProduct(packKey, product.code, false);
                  else if (
                    confirm(`${product.code} is used by:\n\n${used.map((r) => `· ${r.description}`).join('\n')}\n\nRemove it and clear those?`)
                  ) {
                    removePackProduct(packKey, product.code, true);
                  }
                }}
              >
                Remove
              </button>
            </div>
          );
        })}
        <div className="row">
          <input
            placeholder="Code"
            value={productDraft.code}
            onChange={(e) => setProductDraft({ ...productDraft, code: e.target.value })}
          />
          <input
            placeholder="Description"
            value={productDraft.description}
            onChange={(e) => setProductDraft({ ...productDraft, description: e.target.value })}
          />
          <select
            value={productDraft.role}
            onChange={(e) => setProductDraft({ ...productDraft, role: e.target.value as MemberType })}
          >
            {MEMBER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button
            disabled={productDraft.code.trim() === '' || productDraft.description.trim() === ''}
            onClick={() => {
              addPackProduct(
                packKey,
                blankProduct(productDraft.code.trim(), productDraft.description.trim(), [productDraft.role]),
              );
              setProductDraft({ ...productDraft, code: '', description: '' });
            }}
          >
            Add
          </button>
        </div>
        <p className="note">
          Its section and sizes are entered on the Values tab. Until a section is drawn a member is shown at its
          overall size as a plain rectangle, and the inspector says so.
        </p>
      </section>

      <section>
        <h3>Load cases</h3>
        {pack.loadCases.map((c) => (
          <div className="catalogue-row" key={c.id}>
            <div>
              <code>{c.id}</code>
              <span className="muted"> {c.description}</span>
            </div>
            <button onClick={() => removePackLoadCase(packKey, c.id)}>Remove</button>
          </div>
        ))}
        <div className="row">
          <input
            placeholder="e.g. Acoustic lining"
            value={loadCaseDraft}
            onChange={(e) => setLoadCaseDraft(e.target.value)}
          />
          <button
            disabled={slug(loadCaseDraft) === ''}
            onClick={() => {
              addPackLoadCase(packKey, slug(loadCaseDraft), loadCaseDraft.trim());
              setLoadCaseDraft('');
            }}
          >
            Add
          </button>
        </div>
        <p className="note">A new load case gets a blank spacing and span row for every layer, on the Values tab.</p>
      </section>
    </div>
  );
}

function LayerRow({
  pack,
  packKey,
  layer,
  index,
  expanded,
  onToggle,
  onRemove,
  onRename,
  onDuplicate,
  onUpdate,
  onMove,
}: {
  pack: RulePack;
  packKey: string;
  layer: Layer;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onRemove: (packKey: string, id: string, detach: boolean) => void;
  onRename: (packKey: string, from: string, to: string) => void;
  onDuplicate: (packKey: string, id: string, newId: string) => void;
  onUpdate: (packKey: string, id: string, patch: Record<string, unknown>) => void;
  onMove: (packKey: string, id: string, delta: number) => void;
}) {
  const [rename, setRename] = useState(layer.id);
  const references = layerReferences(pack, layer.id);
  const cascade = layersRemovedWith(pack, layer.id);
  const others = pack.layers.filter((l) => l.id !== layer.id);
  const lineLayers = others.filter(isLineArray);

  const wiring = (label: string, field: string, value: string | null, options: Layer[], allowNone: boolean) => (
    <label key={field}>
      <span>{label}</span>
      <select value={value ?? ''} onChange={(e) => onUpdate(packKey, layer.id, { [field]: e.target.value || null })}>
        {allowNone && <option value="">(none)</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.id}
          </option>
        ))}
      </select>
    </label>
  );

  const remove = (): void => {
    if (references.length === 0 && cascade.length === 0) {
      onRemove(packKey, layer.id, false);
      return;
    }
    const lines = [
      ...references.map((r) => `· ${r.description}`),
      ...cascade.map((c) => `· "${c}" runs along it and would be removed too`),
    ];
    if (confirm(`Removing "${layer.id}" affects:\n\n${lines.join('\n')}\n\nGo ahead?`)) {
      onRemove(packKey, layer.id, true);
    }
  };

  return (
    <div className={`layer-row ${expanded ? 'open' : ''}`}>
      <div className="layer-head">
        <input
          type="checkbox"
          checked={layer.enabled}
          title="Generate this layer"
          onChange={(e) => onUpdate(packKey, layer.id, { enabled: e.target.checked })}
        />
        <button className="link layer-name" onClick={onToggle}>
          <code>{layer.id}</code> <span className="muted">{layer.memberType}</span>
        </button>
        <span className="note">{layer.generator}</span>
        <button title="Move up" disabled={index === 0} onClick={() => onMove(packKey, layer.id, -1)}>
          &uarr;
        </button>
        <button title="Move down" onClick={() => onMove(packKey, layer.id, 1)}>
          &darr;
        </button>
      </div>

      {expanded && (
        <div className="layer-body">
          <label>
            <span>Description</span>
            <input
              value={layer.description}
              onChange={(e) => onUpdate(packKey, layer.id, { description: e.target.value })}
            />
          </label>
          <label>
            <span>Product</span>
            <select
              value={layer.product ?? ''}
              onChange={(e) => onUpdate(packKey, layer.id, { product: e.target.value || null })}
            >
              <option value="">(not selected)</option>
              {pack.catalogue.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.code} - {p.description.slice(0, 40)}
                </option>
              ))}
            </select>
          </label>

          {isLineArray(layer) && (
            <>
              <label>
                <span>Runs</span>
                <select
                  value={layer.orientation}
                  onChange={(e) => onUpdate(packKey, layer.id, { orientation: e.target.value })}
                >
                  <option value="primary">along the setout</option>
                  <option value="secondary">across the setout</option>
                </select>
              </label>
              {wiring('Bears on', 'supportedBy', layer.supportedBy, lineLayers, true)}
              {wiring('Cut at crossings with', 'splitAtCrossingsWith', layer.splitAtCrossingsWith, lineLayers, true)}
            </>
          )}

          {isAlongMember(layer) && (
            <>
              {wiring('Runs along', 'along', layer.along, others.filter((l) => isLineArray(l) || l.generator === 'perimeter'), false)}
              {wiring('Hangs from', 'hangsFrom', layer.hangsFrom, lineLayers, true)}
              {wiring('At crossings with', 'atCrossingsWith', layer.atCrossingsWith, lineLayers, true)}
              <p className="note">
                Leave "hangs from" as none for a hanger that reaches the structure above. Name a layer for a second
                stage - a rod down to a strut, then another from the strut to the rails.
              </p>
            </>
          )}

          <label>
            <span>Fixing substrate</span>
            <input
              value={layer.fixings.substrate ?? ''}
              placeholder="what it fixes to"
              onChange={(e) =>
                onUpdate(packKey, layer.id, { fixings: { ...layer.fixings, substrate: e.target.value || null } })
              }
            />
          </label>

          <div className="row">
            <input value={rename} onChange={(e) => setRename(e.target.value)} />
            <button disabled={rename === layer.id || rename.trim() === ''} onClick={() => onRename(packKey, layer.id, slug(rename))}>
              Rename
            </button>
            <button onClick={() => onDuplicate(packKey, layer.id, `${layer.id}_2`)}>Duplicate</button>
            <button onClick={remove}>Remove</button>
          </div>
          {references.length > 0 && (
            <p className="note">
              Named by: {references.map((r) => r.description).join('; ')}.
              {cascade.length > 0 && ` Removing it would also remove ${cascade.join(', ')}.`}
            </p>
          )}
          <p className="note">
            The id is part of every member identity, so renaming it orphans manual edits made against those members.
            They are reported, not dropped.
          </p>
        </div>
      )}
    </div>
  );
}
