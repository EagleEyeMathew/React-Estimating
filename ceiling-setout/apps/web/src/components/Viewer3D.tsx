import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { Member } from '@ceiling/engine';
import type { Product } from '@ceiling/rules';
import { planeZ } from '@ceiling/geometry';
import { activeZone, activeZoneResult, useStore, visibleMembers, type ViewMode } from '../state/store.js';
import { componentGeometry, memberGeometry, orientAlong } from './sections.js';

/**
 * Member colours by type, matched to the plan and the PDF so a member is the same
 * colour wherever it is looked at.
 */
const COLOURS: Record<string, string> = {
  furring: '#4caf7d',
  batten: '#4caf7d',
  tsr: '#5b8dd6',
  main_tee: '#5b8dd6',
  rail: '#5b8dd6',
  cross_tee: '#8fb8e8',
  hanger: '#e2664a',
  bracket: '#a980d0',
  brace: '#a980d0',
  bridging: '#f0a92e',
  trim: '#9aa0a6',
};

// Model millimetres to scene units. Metres keep the camera and lights well conditioned.
const S = 0.001;

function MemberMesh({
  member,
  product,
  selected,
  onSelect,
}: {
  member: Member;
  product: Product | null;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const colour = COLOURS[member.type] ?? '#9aa0a6';

  const click = (e: ThreeEvent<MouseEvent>): void => {
    e.stopPropagation();
    onSelect(member.id);
  };

  const start = new THREE.Vector3(member.start.x * S, member.start.z * S, -member.start.y * S);
  const end = new THREE.Vector3(member.end.x * S, member.end.z * S, -member.end.y * S);

  const material = (
    <meshStandardMaterial
      color={selected ? '#ffd166' : colour}
      emissive={selected ? '#664d00' : '#000000'}
      emissiveIntensity={selected ? 0.6 : 0}
      roughness={0.55}
      metalness={0.35}
    />
  );

  // Point hardware: a clip or bracket drawn as the parts the pack describes, sitting
  // on its host member and turned to line up with it.
  if (member.planLength === 0 && member.type !== 'hanger') {
    const parts = product?.component ? componentGeometry(product.code, product.component) : null;
    if (!parts) {
      return (
        <mesh position={start} onClick={click}>
          <boxGeometry args={[0.03, 0.02, 0.03]} />
          {material}
        </mesh>
      );
    }
    return (
      <group position={start} rotation={[0, -member.rotation, 0]} onClick={click}>
        {parts.map((part, i) => (
          <mesh key={i} geometry={part.geometry} position={part.position} quaternion={part.quaternion}>
            {material}
          </mesh>
        ))}
      </group>
    );
  }

  // A curved run is extruded chord by chord, so a trim following a column reads as the
  // section it is rather than as a line.
  if (member.path && member.path.length > 1) {
    const section = memberGeometry(product, member.type);
    const points = member.path.map((p) => new THREE.Vector3(p.x * S, p.z * S, -p.y * S));
    return (
      <group onClick={click}>
        {points.slice(0, -1).map((a, i) => {
          const b = points[i + 1]!;
          const length = a.distanceTo(b);
          if (length < 1e-6) return null;
          return (
            <mesh key={i} geometry={section.geometry} position={a} quaternion={orientAlong(a, b)} scale={[1, 1, length]}>
              {material}
            </mesh>
          );
        })}
      </group>
    );
  }

  const length = start.distanceTo(end);
  if (length < 1e-6) return null;
  const section = memberGeometry(product, member.type);

  // The geometry is extruded one unit along +Z, so a member is the same geometry
  // turned to its own direction and stretched to its own length.
  return (
    <mesh
      geometry={section.geometry}
      position={start}
      quaternion={orientAlong(start, end)}
      scale={[1, 1, length]}
      onClick={click}
    >
      {material}
    </mesh>
  );
}

function Boundary() {
  const result = useStore(activeZoneResult);
  const zone = useStore(activeZone);
  if (!result || !zone) return null;
  const level = (x: number, y: number): number => planeZ(result.plane, { x, y });
  return (
    <>
      {result.region.map((poly, i) => (
        <group key={i}>
          <Line
            points={[...poly.outer, poly.outer[0]!].map(
              (p) => [p.x * S, level(p.x, p.y) * S, -p.y * S] as [number, number, number],
            )}
            color="#d8d8d8"
            lineWidth={2}
          />
          {poly.holes.map((hole, j) => (
            <Line
              key={j}
              points={[...hole, hole[0]!].map((p) => [p.x * S, level(p.x, p.y) * S, -p.y * S] as [number, number, number])}
              color="#e2664a"
              lineWidth={2}
            />
          ))}
        </group>
      ))}
    </>
  );
}

function StructureAbove() {
  const result = useStore(activeZoneResult);
  const zone = useStore(activeZone);
  const project = useStore((s) => s.project);
  const show = useStore((s) => s.showStructure);
  if (!show || !result || !zone) return null;
  const structure = project.structures.find((s) => s.id === zone.structureId);
  if (!structure) return null;

  const points = result.region.flatMap((p) => [...p.outer]);
  if (points.length === 0) return null;
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const z = planeZ(result.structurePlane, { x: (minX + maxX) / 2, y: (minY + maxY) / 2 });

  if (structure.kind === 'purlins' || structure.kind === 'joists') {
    // Draw the actual members, because where they are is what a hanger depends on.
    const lines: [number, number, number][][] = [];
    const along = Math.abs(structure.direction.x) > Math.abs(structure.direction.y) ? 'x' : 'y';
    const from = along === 'x' ? minY : minX;
    const to = along === 'x' ? maxY : maxX;
    const kMin = Math.ceil((from - structure.offset) / structure.spacing);
    const kMax = Math.floor((to - structure.offset) / structure.spacing);
    for (let k = kMin; k <= kMax; k++) {
      const at = structure.offset + k * structure.spacing;
      lines.push(
        along === 'x'
          ? [
              [minX * S, z * S, -at * S],
              [maxX * S, z * S, -at * S],
            ]
          : [
              [at * S, z * S, -minY * S],
              [at * S, z * S, -maxY * S],
            ],
      );
    }
    return (
      <>
        {lines.map((pts, i) => (
          <Line key={i} points={pts} color="#8a8f98" lineWidth={3} />
        ))}
      </>
    );
  }

  return (
    <mesh position={[((minX + maxX) / 2) * S, z * S, -((minY + maxY) / 2) * S]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[(maxX - minX) * S, (maxY - minY) * S]} />
      <meshStandardMaterial color="#4a4f57" transparent opacity={0.25} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Lining() {
  const result = useStore(activeZoneResult);
  const show = useStore((s) => s.showLining);
  if (!show || !result) return null;
  const points = result.buildableRegion.flatMap((p) => [...p.outer]);
  if (points.length === 0) return null;
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const z = planeZ(result.plane, { x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
  return (
    <mesh position={[((minX + maxX) / 2) * S, z * S, -((minY + maxY) / 2) * S]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[(maxX - minX) * S, (maxY - minY) * S]} />
      <meshStandardMaterial color="#f2efe9" transparent opacity={0.45} side={THREE.DoubleSide} />
    </mesh>
  );
}

function SetoutDatum() {
  const result = useStore(activeZoneResult);
  if (!result) return null;
  const o = result.setout.origin;
  const z = planeZ(result.plane, o) + 200;
  const u = result.setout.direction;
  const n = { x: -u.y, y: u.x };
  const arm = 800;
  return (
    <group>
      <Line
        points={[
          [(o.x - u.x * arm) * S, z * S, -(o.y - u.y * arm) * S],
          [(o.x + u.x * arm) * S, z * S, -(o.y + u.y * arm) * S],
        ]}
        color="#e2664a"
        lineWidth={3}
      />
      <Line
        points={[
          [(o.x - n.x * arm) * S, z * S, -(o.y - n.y * arm) * S],
          [(o.x + n.x * arm) * S, z * S, -(o.y + n.y * arm) * S],
        ]}
        color="#e2664a"
        lineWidth={3}
      />
      {/*
        No 3D label here. Text in the scene needs a font fetched at runtime, which
        fails in an offline viewer and takes the whole canvas down with it. The datum
        coordinates are on the setout panel and on the plan, where they can be read
        properly anyway.
      */}
    </group>
  );
}

/** Move the camera to a named view without losing the model in the process. */
function ViewController({ mode }: { mode: ViewMode }) {
  const { camera } = useThree();
  const result = useStore(activeZoneResult);
  const controls = useRef<never>(null);

  useEffect(() => {
    if (!result) return;
    const pts = result.region.flatMap((p) => [...p.outer]);
    if (pts.length === 0) return;
    const cx = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2;
    const cy = (Math.min(...pts.map((p) => p.y)) + Math.max(...pts.map((p) => p.y))) / 2;
    const span =
      Math.max(
        Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)),
        Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)),
      ) * S;
    const target = new THREE.Vector3(cx * S, 2.7, -cy * S);
    const d = Math.max(4, span * 1.2);
    const place: Record<ViewMode, THREE.Vector3> = {
      // The reflected plan looks up at the ceiling, which is what an RCP is.
      rcp: new THREE.Vector3(target.x, target.y - d, target.z),
      plan: new THREE.Vector3(target.x, target.y + d, target.z + 0.001),
      iso: new THREE.Vector3(target.x + d * 0.7, target.y + d * 0.6, target.z + d * 0.7),
      section: new THREE.Vector3(target.x, target.y + 0.4, target.z + d),
    };
    camera.position.copy(place[mode]);
    camera.up.set(0, mode === 'rcp' ? -1 : 1, 0);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  }, [mode, result?.zoneId, camera, result]);

  return <OrbitControls ref={controls} makeDefault target={targetOf(result)} />;
}

function targetOf(result: ReturnType<typeof activeZoneResult>): [number, number, number] {
  if (!result) return [0, 2.7, 0];
  const pts = result.region.flatMap((p) => [...p.outer]);
  if (pts.length === 0) return [0, 2.7, 0];
  const cx = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2;
  const cy = (Math.min(...pts.map((p) => p.y)) + Math.max(...pts.map((p) => p.y))) / 2;
  return [cx * S, 2.7, -cy * S];
}

function ClipPlane() {
  const clipLevel = useStore((s) => s.clipLevel);
  const { gl } = useThree();
  useEffect(() => {
    gl.localClippingEnabled = true;
    // A single horizontal plane is enough to look into the void, which is the one
    // thing a section box is actually wanted for here.
    THREE.Object3D.DEFAULT_UP.set(0, 1, 0);
  }, [gl]);
  useEffect(() => {
    gl.clippingPlanes =
      clipLevel === null ? [] : [new THREE.Plane(new THREE.Vector3(0, -1, 0), clipLevel * S)];
  }, [clipLevel, gl]);
  return null;
}

export function Viewer3D() {
  const result = useStore((s) => s.result);
  const activeZoneId = useStore((s) => s.activeZoneId);
  const hiddenLayers = useStore((s) => s.hiddenLayers);
  const packs = useStore((s) => s.packs);
  const members = useMemo(
    () => visibleMembers(result, activeZoneId, hiddenLayers),
    [result, activeZoneId, hiddenLayers],
  );
  // Sections come from the pack, so a member has to be able to find its product.
  const products = useMemo(() => {
    const byCode = new Map<string, Product>();
    for (const pack of packs) for (const p of pack.catalogue) byCode.set(p.code, p);
    return byCode;
  }, [packs]);
  const selected = useStore((s) => s.selectedMemberId);
  const select = useStore((s) => s.selectMember);
  const mode = useStore((s) => s.viewMode);

  return (
    <Canvas
      camera={{ position: [8, 8, 8], fov: 45, near: 0.05, far: 500 }}
      onPointerMissed={() => select(null)}
      dpr={[1, 2]}
    >
      <color attach="background" args={['#15171a']} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[8, 12, 6]} intensity={1.1} />
      <directionalLight position={[-6, 6, -8]} intensity={0.4} />
      <Grid
        args={[60, 60]}
        cellSize={1}
        sectionSize={5}
        cellColor="#2a2e34"
        sectionColor="#3a4048"
        fadeDistance={60}
        infiniteGrid
        position={[0, 0, 0]}
      />
      <ClipPlane />
      <Boundary />
      <StructureAbove />
      <Lining />
      <SetoutDatum />
      {members.map((m) => (
        <MemberMesh
          key={m.id}
          member={m}
          product={m.productCode ? (products.get(m.productCode) ?? null) : null}
          selected={m.id === selected}
          onSelect={select}
        />
      ))}
      <ViewController mode={mode} />
    </Canvas>
  );
}
