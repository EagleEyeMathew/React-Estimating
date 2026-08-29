import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { Member } from '@ceiling/engine';
import { planeZ } from '@ceiling/geometry';
import { activeZone, activeZoneResult, useStore, visibleMembers, type ViewMode } from '../state/store.js';

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

/** Section depths in mm, used only to give members a believable thickness in 3D. */
const THICKNESS: Record<string, [number, number]> = {
  furring: [35, 16],
  batten: [42, 42],
  tsr: [40, 38],
  main_tee: [24, 38],
  rail: [40, 25],
  cross_tee: [24, 32],
  trim: [25, 25],
  bracket: [40, 40],
  brace: [20, 20],
  bridging: [50, 50],
};

// Model millimetres to scene units. Metres keep the camera and lights well conditioned.
const S = 0.001;

function MemberMesh({ member, selected, onSelect }: { member: Member; selected: boolean; onSelect: (id: string) => void }) {
  const colour = COLOURS[member.type] ?? '#9aa0a6';
  const [w, h] = THICKNESS[member.type] ?? [30, 30];

  const geometry = useMemo(() => {
    if (member.type === 'hanger') {
      // A hanger is drawn as the rod it is: thin, vertical, its true drop.
      return { kind: 'rod' as const, length: Math.max(1, member.length) };
    }
    return { kind: 'bar' as const };
  }, [member]);

  const start = new THREE.Vector3(member.start.x * S, member.start.z * S, -member.start.y * S);
  const end = new THREE.Vector3(member.end.x * S, member.end.z * S, -member.end.y * S);
  const mid = start.clone().add(end).multiplyScalar(0.5);
  const length = start.distanceTo(end);

  const quaternion = useMemo(() => {
    const dir = end.clone().sub(start).normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  }, [member.id, member.start.x, member.start.y, member.start.z, member.end.x, member.end.y, member.end.z]);

  const click = (e: ThreeEvent<MouseEvent>): void => {
    e.stopPropagation();
    onSelect(member.id);
  };

  // A member that follows a curve is drawn as its polyline, not as a straight bar.
  if (member.path && member.path.length > 1) {
    return (
      <Line
        points={member.path.map((p) => [p.x * S, p.z * S, -p.y * S] as [number, number, number])}
        color={selected ? '#ffd166' : colour}
        lineWidth={selected ? 4 : 2}
        onClick={click}
      />
    );
  }

  if (length < 1e-6) return null;

  return (
    <mesh position={mid} quaternion={quaternion} onClick={click} castShadow={false}>
      <boxGeometry
        args={
          geometry.kind === 'rod'
            ? [8 * S, length, 8 * S]
            : [w * S, length, h * S]
        }
      />
      <meshStandardMaterial
        color={selected ? '#ffd166' : colour}
        emissive={selected ? '#664d00' : '#000000'}
        roughness={0.6}
        metalness={0.1}
      />
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
  const members = useMemo(
    () => visibleMembers(result, activeZoneId, hiddenLayers),
    [result, activeZoneId, hiddenLayers],
  );
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
        <MemberMesh key={m.id} member={m} selected={m.id === selected} onSelect={select} />
      ))}
      <ViewController mode={mode} />
    </Canvas>
  );
}
