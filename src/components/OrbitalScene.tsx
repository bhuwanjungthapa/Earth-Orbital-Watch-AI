import { Html, Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useLoader, useThree, type ThreeEvent } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from "react";
import * as THREE from "three";
import { createOrbitTrail } from "../lib/orbitMath";
import type { EarthMapStyle, LocationTarget, PredictionMode, PropagatedOrbitObject, Vector3Tuple } from "../types";

interface OrbitalSceneProps {
  objects: PropagatedOrbitObject[];
  selected: PropagatedOrbitObject | null;
  hoveredId: string | null;
  showLabels: boolean;
  labelLimit: number;
  date: Date;
  prediction: PropagatedOrbitObject | null;
  predictionMode: PredictionMode;
  passLocation: LocationTarget | null;
  mapStyle: EarthMapStyle;
  showClouds: boolean;
  showSky: boolean;
  showGrid: boolean;
  onHover: (id: string | null) => void;
  onSelect: (object: PropagatedOrbitObject) => void;
}

export function OrbitalScene(props: OrbitalSceneProps) {
  return (
    <Canvas
      camera={{ position: [0, 2.35, 4.1], fov: 43 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      raycaster={{
        params: {
          Mesh: {},
          Line: { threshold: 1 },
          LOD: {},
          Points: { threshold: 0.075 },
          Sprite: {}
        }
      }}
    >
      <color attach="background" args={[props.showSky ? "#02030a" : "#05070c"]} />
      <fog attach="fog" args={["#02030a", 7, 28]} />
      <ambientLight intensity={0.18} />
      <directionalLight position={[4.8, 2.8, 3.9]} intensity={3.2} color="#fff6df" />
      <pointLight position={[-3, -2, -5]} intensity={0.26} color="#7cb7ff" />
      {props.showSky ? <GalaxyBackdrop /> : null}
      <Earth passLocation={props.passLocation} mapStyle={props.mapStyle} showClouds={props.showClouds} showGrid={props.showGrid} />
      <VisualObjectLayer
        objects={props.objects}
        selectedId={props.selected?.noradId ?? null}
        hoveredId={props.hoveredId}
        onHover={props.onHover}
        onSelect={props.onSelect}
      />
      {props.selected ? (
        <SelectedOrbit
          object={props.selected}
          date={props.date}
          prediction={props.prediction}
          predictionMode={props.predictionMode}
        />
      ) : null}
      {props.showLabels ? (
        <SmartLabels
          objects={props.objects}
          selected={props.selected}
          hoveredId={props.hoveredId}
          limit={props.labelLimit}
        />
      ) : null}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.075}
        enablePan={false}
        minDistance={1.62}
        maxDistance={7.4}
        rotateSpeed={0.46}
        zoomSpeed={0.42}
      />
    </Canvas>
  );
}

const Earth = memo(function Earth({
  passLocation,
  mapStyle,
  showClouds,
  showGrid
}: {
  passLocation: LocationTarget | null;
  mapStyle: EarthMapStyle;
  showClouds: boolean;
  showGrid: boolean;
}) {
  const earthTexture = useLoader(THREE.TextureLoader, "/textures/earth-day.jpg");
  const normalTexture = useLoader(THREE.TextureLoader, "/textures/earth-normal.jpg");
  const specularTexture = useLoader(THREE.TextureLoader, "/textures/earth-specular.jpg");
  const cloudTexture = useLoader(THREE.TextureLoader, "/textures/earth-clouds.png");
  const groupRef = useRef<THREE.Group>(null);
  const cloudRef = useRef<THREE.Mesh>(null);

  useMemo(() => {
    for (const texture of [earthTexture, normalTexture, specularTexture, cloudTexture]) {
      texture.colorSpace = texture === normalTexture ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
    }
  }, [earthTexture, normalTexture, specularTexture, cloudTexture]);
  const styledTextures = useMemo(() => createEarthStyleTextures(earthTexture), [earthTexture]);
  const surfaceTexture = mapStyle === "terrain" ? styledTextures.terrain : mapStyle === "default" ? styledTextures.defaultMap : earthTexture;

  useEffect(
    () => () => {
      styledTextures.terrain.dispose();
      styledTextures.defaultMap.dispose();
    },
    [styledTextures]
  );

  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.018;
    if (cloudRef.current) cloudRef.current.rotation.y += delta * 0.028;
  });

  const materialStyle = earthMaterialStyle(mapStyle);

  return (
    <group ref={groupRef}>
      <mesh>
        <sphereGeometry args={[1, 128, 96]} />
        <meshPhongMaterial
          key={mapStyle}
          map={surfaceTexture}
          color={materialStyle.color}
          normalMap={mapStyle === "default" ? undefined : normalTexture}
          normalScale={materialStyle.normalScale}
          specularMap={mapStyle === "terrain" ? undefined : specularTexture}
          specular={materialStyle.specular}
          shininess={materialStyle.shininess}
        />
      </mesh>
      {showClouds ? (
        <mesh ref={cloudRef} scale={1.014}>
          <sphereGeometry args={[1, 128, 96]} />
          <meshPhongMaterial map={cloudTexture} transparent opacity={0.38} depthWrite={false} />
        </mesh>
      ) : null}
      <mesh scale={1.038}>
        <sphereGeometry args={[1, 128, 96]} />
        <meshBasicMaterial color="#67c7ff" transparent opacity={0.09} side={THREE.BackSide} />
      </mesh>
      <mesh scale={1.09}>
        <sphereGeometry args={[1, 128, 96]} />
        <meshBasicMaterial color="#4f9cff" transparent opacity={0.035} side={THREE.BackSide} />
      </mesh>
      {showGrid ? <LatitudeLongitudeGrid /> : null}
      {passLocation ? <GroundMarker location={passLocation} /> : null}
    </group>
  );
});

function earthMaterialStyle(mapStyle: EarthMapStyle) {
  if (mapStyle === "terrain") {
    return {
      color: new THREE.Color("#ffffff"),
      normalScale: new THREE.Vector2(0.72, 0.72),
      specular: new THREE.Color("#132118"),
      shininess: 4
    };
  }

  if (mapStyle === "default") {
    return {
      color: new THREE.Color("#ffffff"),
      normalScale: new THREE.Vector2(0.12, 0.12),
      specular: new THREE.Color("#1b3552"),
      shininess: 7
    };
  }

  return {
    color: new THREE.Color("#ffffff"),
    normalScale: new THREE.Vector2(0.42, 0.42),
    specular: new THREE.Color("#223f5f"),
    shininess: 12
  };
}

function createEarthStyleTextures(source: THREE.Texture) {
  const terrain = createStyledEarthTexture(source, "terrain");
  const defaultMap = createStyledEarthTexture(source, "default");
  return { terrain, defaultMap };
}

function createStyledEarthTexture(source: THREE.Texture, style: "terrain" | "default") {
  const image = source.image as CanvasImageSource & { width?: number; height?: number };
  const sourceWidth = Number(image.width) || 2048;
  const sourceHeight = Number(image.height) || 1024;
  const width = Math.min(2048, sourceWidth);
  const height = Math.round(width * (sourceHeight / sourceWidth));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    return source.clone();
  }

  context.drawImage(image, 0, 0, width, height);
  const frame = context.getImageData(0, 0, width, height);
  const data = frame.data;

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const light = red * 0.299 + green * 0.587 + blue * 0.114;
    const water = blue > red * 1.12 && blue > green * 1.04;

    if (style === "terrain") {
      if (water) {
        data[index] = Math.round(14 + light * 0.12);
        data[index + 1] = Math.round(48 + light * 0.2);
        data[index + 2] = Math.round(78 + light * 0.34);
      } else {
        const high = light > 142;
        data[index] = Math.round((high ? 188 : 94) + light * 0.28);
        data[index + 1] = Math.round((high ? 172 : 112) + light * 0.22);
        data[index + 2] = Math.round((high ? 124 : 70) + light * 0.14);
      }
    } else if (water) {
      data[index] = Math.round(21 + light * 0.1);
      data[index + 1] = Math.round(84 + light * 0.15);
      data[index + 2] = Math.round(132 + light * 0.22);
    } else {
      data[index] = Math.round(112 + light * 0.32);
      data[index + 1] = Math.round(150 + light * 0.28);
      data[index + 2] = Math.round(92 + light * 0.12);
    }
  }

  context.putImageData(frame, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function LatitudeLongitudeGrid() {
  const lines = useMemo(() => {
    const items: Vector3Tuple[][] = [];
    for (let latitude = -60; latitude <= 60; latitude += 30) {
      items.push(createLatitudeLine(latitude));
    }

    for (let longitude = -180; longitude < 180; longitude += 30) {
      items.push(createLongitudeLine(longitude));
    }

    return items;
  }, []);

  return (
    <group>
      {lines.map((points, index) => (
        <Line key={index} points={points} color="#d8f3ff" lineWidth={0.7} transparent opacity={0.26} />
      ))}
    </group>
  );
}

function createLatitudeLine(latitude: number) {
  const points: Vector3Tuple[] = [];
  for (let longitude = -180; longitude <= 180; longitude += 4) {
    points.push(latLonToSphere(latitude, longitude, 1.018));
  }
  return points;
}

function createLongitudeLine(longitude: number) {
  const points: Vector3Tuple[] = [];
  for (let latitude = -90; latitude <= 90; latitude += 4) {
    points.push(latLonToSphere(latitude, longitude, 1.018));
  }
  return points;
}

function VisualObjectLayer({
  objects,
  selectedId,
  hoveredId,
  onHover,
  onSelect
}: {
  objects: PropagatedOrbitObject[];
  selectedId: string | null;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (object: PropagatedOrbitObject) => void;
}) {
  return (
    <group>
      <ObjectPointCloud objects={objects} selectedId={selectedId} hoveredId={hoveredId} onHover={onHover} onSelect={onSelect} />
    </group>
  );
}

function ObjectPointCloud({
  objects,
  selectedId,
  hoveredId,
  onHover,
  onSelect
}: {
  objects: PropagatedOrbitObject[];
  selectedId: string | null;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (object: PropagatedOrbitObject) => void;
}) {
  const geometry = useMemo(() => {
    const positions = new Float32Array(objects.length * 3);
    const colors = new Float32Array(objects.length * 3);
    const color = new THREE.Color();

    for (let index = 0; index < objects.length; index += 1) {
      const object = objects[index];
      positions.set(object.scenePosition, index * 3);
      color.copy(pointColorForObject(object, selectedId, hoveredId));
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }

    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    buffer.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    buffer.computeBoundingSphere();
    return buffer;
  }, [objects, selectedId, hoveredId]);
  const material = useMemo(
    () => new THREE.PointsMaterial({ size: 0.018, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.86, depthWrite: false }),
    []
  );

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  if (!objects.length) return null;

  return (
    <points
      geometry={geometry}
      material={material}
      onPointerDown={(event) => {
        event.stopPropagation();
        const object = objectFromPointEvent(event, objects);
        if (object) onSelect(object);
      }}
      onPointerMove={(event) => {
        event.stopPropagation();
        const object = objectFromPointEvent(event, objects);
        onHover(object?.noradId ?? null);
      }}
      onPointerOut={() => onHover(null)}
    />
  );
}

function IconBillboardInstances({
  objects,
  kind,
  selectedId,
  hoveredId,
  onHover,
  onSelect
}: InstanceProps & { kind: VisualKind }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const currentPositions = useSmoothedPositions(objects);
  const elapsedRef = useRef(0);
  const camera = useThree((state) => state.camera);
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const texture = useMemo(() => createObjectIconTexture(kind, "normal"), [kind]);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide
      }),
    [texture]
  );
  const handlers = useInstanceHandlers(objects, onHover, onSelect);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
    [geometry, material, texture]
  );

  useFrame((_, delta) => {
    elapsedRef.current += delta;
    if (elapsedRef.current < 1 / 24) return;
    const step = elapsedRef.current;
    elapsedRef.current = 0;

    const mesh = meshRef.current;
    if (!mesh) return;

    const alpha = 1 - Math.exp(-step * 7.2);
    const baseScale = iconScaleForKind(kind);

    for (let index = 0; index < objects.length; index += 1) {
      const object = objects[index];
      const position = currentPositions.current[index];
      if (!position) continue;

      position.lerp(tempVectorA.fromArray(object.scenePosition), alpha);
      const emphasis = object.noradId === selectedId ? 1.28 : object.noradId === hoveredId ? 1.18 : 1;
      tempScale.set(baseScale * emphasis, baseScale * emphasis, 1);
      tempMatrix.compose(position, camera.quaternion, tempScale);
      mesh.setMatrixAt(index, tempMatrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  });

  if (!objects.length) return null;

  return <instancedMesh ref={meshRef} args={[geometry, material, objects.length]} renderOrder={4} {...handlers} />;
}

function HitTargetInstances({
  objects,
  onHover,
  onSelect
}: {
  objects: PropagatedOrbitObject[];
  onHover: (id: string | null) => void;
  onSelect: (object: PropagatedOrbitObject) => void;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const currentPositions = useSmoothedPositions(objects);
  const elapsedRef = useRef(0);
  const geometry = useMemo(() => new THREE.SphereGeometry(1, 4, 4), []);
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }),
    []
  );
  const handlers = useInstanceHandlers(objects, onHover, onSelect);

  useFrame((_, delta) => {
    elapsedRef.current += delta;
    if (elapsedRef.current < 1 / 20) return;
    const step = elapsedRef.current;
    elapsedRef.current = 0;

    const mesh = meshRef.current;
    if (!mesh) return;

    const alpha = 1 - Math.exp(-step * 7.2);
    for (let index = 0; index < objects.length; index += 1) {
      const object = objects[index];
      const position = currentPositions.current[index];
      if (!position) continue;

      position.lerp(tempVectorA.fromArray(object.scenePosition), alpha);
      tempScale.setScalar(0.065);
      tempMatrix.compose(position, identityQuaternion, tempScale);
      mesh.setMatrixAt(index, tempMatrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  });

  if (!objects.length) return null;

  return <instancedMesh ref={meshRef} args={[geometry, material, objects.length]} {...handlers} />;
}

function SatelliteInstances({
  objects,
  kind,
  selectedId,
  hoveredId,
  onHover,
  onSelect
}: InstanceProps & { kind: "payload" | "station" }) {
  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const leftPanelRef = useRef<THREE.InstancedMesh>(null);
  const rightPanelRef = useRef<THREE.InstancedMesh>(null);
  const currentPositions = useSmoothedPositions(objects);
  const elapsedRef = useRef(0);
  const bodyGeometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const panelGeometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const bodyMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: kind === "station" ? "#d6dde8" : "#92d8ff", metalness: 0.68, roughness: 0.34 }),
    [kind]
  );
  const panelMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: kind === "station" ? "#4d8dff" : "#2459b9", metalness: 0.35, roughness: 0.28 }),
    [kind]
  );
  const handlers = useInstanceHandlers(objects, onHover, onSelect);

  useFrame((_, delta) => {
    elapsedRef.current += delta;
    if (elapsedRef.current < 1 / 12) return;
    const step = elapsedRef.current;
    elapsedRef.current = 0;

    updateSatelliteInstances({
      bodyRef,
      leftPanelRef,
      rightPanelRef,
      objects,
      currentPositions,
      kind,
      selectedId,
      hoveredId,
      delta: step
    });
  });

  if (!objects.length) return null;

  return (
    <>
      <instancedMesh ref={bodyRef} args={[bodyGeometry, bodyMaterial, objects.length]} {...handlers} />
      <instancedMesh ref={leftPanelRef} args={[panelGeometry, panelMaterial, objects.length]} {...handlers} />
      <instancedMesh ref={rightPanelRef} args={[panelGeometry, panelMaterial, objects.length]} {...handlers} />
    </>
  );
}

function SingleObjectInstances({
  objects,
  kind,
  selectedId,
  hoveredId,
  onHover,
  onSelect
}: InstanceProps & { kind: "rocket_body" | "debris" | "unknown" }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const currentPositions = useSmoothedPositions(objects);
  const elapsedRef = useRef(0);
  const geometry = useMemo(() => {
    if (kind === "rocket_body") return new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1);
    if (kind === "debris") return new THREE.TetrahedronGeometry(1, 0);
    return new THREE.OctahedronGeometry(1, 0);
  }, [kind]);
  const material = useMemo(() => {
    const color = kind === "rocket_body" ? "#c89cff" : kind === "debris" ? "#ff9f1c" : "#9ca3af";
    return new THREE.MeshStandardMaterial({ color, metalness: kind === "debris" ? 0.38 : 0.62, roughness: 0.4 });
  }, [kind]);
  const handlers = useInstanceHandlers(objects, onHover, onSelect);

  useFrame((_, delta) => {
    elapsedRef.current += delta;
    if (elapsedRef.current < 1 / 12) return;
    const step = elapsedRef.current;
    elapsedRef.current = 0;

    updateSingleInstances({
      meshRef,
      objects,
      currentPositions,
      kind,
      selectedId,
      hoveredId,
      delta: step
    });
  });

  if (!objects.length) return null;

  return <instancedMesh ref={meshRef} args={[geometry, material, objects.length]} {...handlers} />;
}

function SelectedOrbit({
  object,
  date,
  prediction,
  predictionMode
}: {
  object: PropagatedOrbitObject;
  date: Date;
  prediction: PropagatedOrbitObject | null;
  predictionMode: PredictionMode;
}) {
  const trail = useMemo(() => createOrbitTrail(object, date, 200), [object, date]);

  return (
    <>
      <Line points={trail} color="#78c6ff" lineWidth={2.2} transparent opacity={0.88} />
      <SelectedPointHighlight object={object} tone="selected" />
      {prediction ? (
        <>
          <Line
            points={[object.scenePosition, prediction.scenePosition]}
            color={predictionMode === "location" ? "#8affc1" : "#78c6ff"}
            lineWidth={1.5}
            transparent
            opacity={0.75}
          />
          <SelectedPointHighlight object={prediction} tone="prediction" />
        </>
      ) : null}
    </>
  );
}

function SelectedPointHighlight({ object, tone }: { object: PropagatedOrbitObject; tone: "selected" | "prediction" }) {
  const texture = useMemo(() => createPointHighlightTexture(tone), [tone]);
  const material = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: true
      }),
    [texture]
  );

  useEffect(
    () => () => {
      material.dispose();
      texture.dispose();
    },
    [material, texture]
  );

  return (
    <sprite
      position={object.scenePosition}
      scale={tone === "prediction" ? [0.12, 0.12, 1] : [0.15, 0.15, 1]}
      material={material}
      renderOrder={6}
    />
  );
}

function createPointHighlightTexture(tone: "selected" | "prediction") {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable.");

  const color = tone === "prediction" ? "#8affc1" : "#78c6ff";
  context.clearRect(0, 0, 128, 128);
  context.save();
  context.shadowColor = rgba(color, 0.95);
  context.shadowBlur = 18;
  context.fillStyle = rgba(color, 0.96);
  context.beginPath();
  context.arc(64, 64, 14, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = rgba(color, 0.82);
  context.lineWidth = 5;
  context.beginPath();
  context.arc(64, 64, 35, 0, Math.PI * 2);
  context.stroke();
  context.strokeStyle = rgba("#ffffff", 0.52);
  context.lineWidth = 2;
  context.beginPath();
  context.arc(64, 64, 48, 0, Math.PI * 2);
  context.stroke();
  context.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function SelectionHalo({ tone }: { tone: "selected" | "prediction" }) {
  const color = tone === "prediction" ? "#8affc1" : "#78c6ff";
  const opacity = tone === "prediction" ? 0.55 : 0.78;

  return (
    <>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.086, 0.002, 10, 56]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>
      <mesh rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[0.068, 0.0014, 8, 44]} />
        <meshBasicMaterial color={color} transparent opacity={opacity * 0.72} />
      </mesh>
    </>
  );
}

function ObjectSilhouette({ kind, tone }: { kind: VisualKind; tone: "selected" | "prediction" }) {
  const preview = tone === "prediction";
  const panelColor = preview ? "#6ee7c8" : "#2459b9";
  const metalColor = preview ? "#b8fff0" : "#d6dde8";
  const bodyColor = preview ? "#8affc1" : kind === "payload" ? "#92d8ff" : kind === "rocket_body" ? "#c89cff" : "#d6dde8";
  const debrisColor = preview ? "#8affc1" : "#ff9f1c";
  const opacity = preview ? 0.72 : 1;

  if (kind === "station") {
    return (
      <group>
        <mesh>
          <boxGeometry args={[0.12, 0.01, 0.01]} />
          <meshStandardMaterial color={metalColor} metalness={0.7} roughness={0.28} transparent={preview} opacity={opacity} />
        </mesh>
        <mesh position={[0, 0, 0.018]}>
          <boxGeometry args={[0.045, 0.03, 0.026]} />
          <meshStandardMaterial color={metalColor} metalness={0.66} roughness={0.34} transparent={preview} opacity={opacity} />
        </mesh>
        <mesh position={[0, 0, -0.018]}>
          <boxGeometry args={[0.034, 0.026, 0.022]} />
          <meshStandardMaterial color="#f1f5f9" metalness={0.58} roughness={0.36} transparent={preview} opacity={opacity} />
        </mesh>
        {[-0.094, -0.052, 0.052, 0.094].map((x) => (
          <mesh key={x} position={[x, 0, 0]}>
            <boxGeometry args={[0.034, 0.0038, 0.034]} />
            <meshStandardMaterial color={panelColor} metalness={0.36} roughness={0.22} side={THREE.DoubleSide} transparent={preview} opacity={opacity} />
          </mesh>
        ))}
      </group>
    );
  }

  if (kind === "payload") {
    return (
      <group>
        <mesh>
          <boxGeometry args={[0.036, 0.052, 0.03]} />
          <meshStandardMaterial color={bodyColor} metalness={0.68} roughness={0.32} transparent={preview} opacity={opacity} />
        </mesh>
        <mesh position={[-0.066, 0, 0]}>
          <boxGeometry args={[0.078, 0.004, 0.034]} />
          <meshStandardMaterial color={panelColor} metalness={0.34} roughness={0.2} side={THREE.DoubleSide} transparent={preview} opacity={opacity} />
        </mesh>
        <mesh position={[0.066, 0, 0]}>
          <boxGeometry args={[0.078, 0.004, 0.034]} />
          <meshStandardMaterial color={panelColor} metalness={0.34} roughness={0.2} side={THREE.DoubleSide} transparent={preview} opacity={opacity} />
        </mesh>
        <mesh position={[0, 0.043, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.018, 0.018, 24, 1, true]} />
          <meshStandardMaterial color="#f8fafc" metalness={0.58} roughness={0.26} side={THREE.DoubleSide} transparent={preview} opacity={opacity} />
        </mesh>
      </group>
    );
  }

  if (kind === "rocket_body") {
    return (
      <group>
        <mesh>
          <cylinderGeometry args={[0.018, 0.018, 0.128, 20, 1]} />
          <meshStandardMaterial color={bodyColor} metalness={0.62} roughness={0.3} transparent={preview} opacity={opacity} />
        </mesh>
        <mesh position={[0, 0.079, 0]}>
          <coneGeometry args={[0.0185, 0.032, 20]} />
          <meshStandardMaterial color="#f4e8ff" metalness={0.5} roughness={0.34} transparent={preview} opacity={opacity} />
        </mesh>
        <mesh position={[0, -0.076, 0]}>
          <cylinderGeometry args={[0.022, 0.016, 0.018, 18, 1]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.72} roughness={0.36} transparent={preview} opacity={opacity} />
        </mesh>
        <mesh position={[0.024, -0.048, 0]}>
          <boxGeometry args={[0.018, 0.032, 0.004]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.45} roughness={0.38} transparent={preview} opacity={opacity} />
        </mesh>
        <mesh position={[-0.024, -0.048, 0]}>
          <boxGeometry args={[0.018, 0.032, 0.004]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.45} roughness={0.38} transparent={preview} opacity={opacity} />
        </mesh>
      </group>
    );
  }

  if (kind === "debris") {
    return (
      <group>
        <mesh rotation={[0.4, 0.8, 0.2]}>
          <tetrahedronGeometry args={[0.044, 0]} />
          <meshStandardMaterial color={debrisColor} metalness={0.46} roughness={0.42} transparent={preview} opacity={opacity} />
        </mesh>
        <mesh position={[0.028, -0.012, 0.018]} rotation={[1.1, 0.2, 0.9]}>
          <tetrahedronGeometry args={[0.023, 0]} />
          <meshStandardMaterial color="#f8fafc" metalness={0.62} roughness={0.34} transparent={preview} opacity={opacity} />
        </mesh>
      </group>
    );
  }

  return (
    <group>
      <mesh rotation={[0.35, 0.6, 0.15]}>
        <octahedronGeometry args={[0.043, 0]} />
        <meshStandardMaterial color={preview ? "#8affc1" : "#9ca3af"} metalness={0.58} roughness={0.36} transparent={preview} opacity={opacity} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.052, 0.0016, 8, 38]} />
        <meshBasicMaterial color={preview ? "#8affc1" : "#cbd5e1"} transparent opacity={preview ? 0.48 : 0.62} />
      </mesh>
    </group>
  );
}

function createObjectIconTexture(kind: VisualKind, tone: IconTone) {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 192;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable.");

  drawIconFrame(context, kind, tone);

  if (kind === "station") drawStationIcon(context, tone);
  else if (kind === "payload") drawPayloadIcon(context, tone);
  else if (kind === "rocket_body") drawRocketIcon(context, tone);
  else if (kind === "debris") drawDebrisIcon(context, tone);
  else drawUnknownIcon(context, tone);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function drawIconFrame(context: CanvasRenderingContext2D, kind: VisualKind, tone: IconTone) {
  const accent = iconAccent(kind, tone);
  const alpha = tone === "normal" ? 0.22 : 0.42;

  context.clearRect(0, 0, 192, 192);
  context.save();
  context.shadowColor = rgba(accent, 0.55);
  context.shadowBlur = tone === "normal" ? 12 : 22;
  context.strokeStyle = rgba(accent, alpha);
  context.lineWidth = tone === "normal" ? 3 : 5;
  context.beginPath();
  context.arc(96, 96, tone === "normal" ? 66 : 72, 0, Math.PI * 2);
  context.stroke();
  context.restore();

  if (tone !== "normal") {
    context.save();
    context.strokeStyle = rgba(accent, 0.72);
    context.lineWidth = 3;
    context.setLineDash([8, 8]);
    context.beginPath();
    context.arc(96, 96, 80, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }
}

function drawPayloadIcon(context: CanvasRenderingContext2D, tone: IconTone) {
  const accent = iconAccent("payload", tone);
  drawSolarPanel(context, 23, 75, 50, 34, accent);
  drawSolarPanel(context, 119, 75, 50, 34, accent);

  context.save();
  context.strokeStyle = rgba("#e8f2ff", 0.9);
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(73, 92);
  context.lineTo(83, 92);
  context.moveTo(109, 92);
  context.lineTo(119, 92);
  context.stroke();

  context.fillStyle = rgba("#e8f2ff", 0.94);
  roundedRect(context, 76, 63, 40, 58, 10);
  context.fill();
  context.strokeStyle = rgba(accent, 0.88);
  context.lineWidth = 3;
  context.stroke();

  context.fillStyle = rgba("#0f172a", 0.85);
  roundedRect(context, 86, 75, 20, 17, 5);
  context.fill();

  context.strokeStyle = rgba("#f8fafc", 0.9);
  context.lineWidth = 4;
  context.beginPath();
  context.arc(96, 123, 15, Math.PI * 1.08, Math.PI * 1.92);
  context.stroke();
  context.restore();
}

function drawStationIcon(context: CanvasRenderingContext2D, tone: IconTone) {
  const accent = iconAccent("station", tone);
  drawSolarPanel(context, 20, 70, 34, 44, "#4d8dff");
  drawSolarPanel(context, 56, 70, 34, 44, "#4d8dff");
  drawSolarPanel(context, 102, 70, 34, 44, "#4d8dff");
  drawSolarPanel(context, 138, 70, 34, 44, "#4d8dff");

  context.save();
  context.strokeStyle = rgba("#e8f2ff", 0.95);
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(42, 96);
  context.lineTo(150, 96);
  context.moveTo(96, 56);
  context.lineTo(96, 136);
  context.stroke();

  context.fillStyle = rgba("#e8f2ff", 0.96);
  roundedRect(context, 76, 77, 40, 38, 8);
  context.fill();
  context.strokeStyle = rgba(accent, 0.88);
  context.lineWidth = 3;
  context.stroke();

  context.fillStyle = rgba("#cbd5e1", 0.98);
  roundedRect(context, 116, 84, 22, 24, 5);
  context.fill();
  roundedRect(context, 54, 84, 22, 24, 5);
  context.fill();
  context.restore();
}

function drawRocketIcon(context: CanvasRenderingContext2D, tone: IconTone) {
  const accent = iconAccent("rocket_body", tone);
  context.save();
  context.translate(96, 96);
  context.rotate(-0.32);
  context.translate(-96, -96);

  context.fillStyle = rgba("#f4e8ff", 0.98);
  context.beginPath();
  context.moveTo(96, 31);
  context.bezierCurveTo(113, 50, 118, 64, 118, 79);
  context.lineTo(118, 128);
  context.lineTo(74, 128);
  context.lineTo(74, 79);
  context.bezierCurveTo(74, 64, 79, 50, 96, 31);
  context.closePath();
  context.fill();
  context.strokeStyle = rgba(accent, 0.9);
  context.lineWidth = 4;
  context.stroke();

  context.fillStyle = rgba("#0f172a", 0.9);
  context.beginPath();
  context.arc(96, 77, 10, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = rgba("#e8f2ff", 0.72);
  context.lineWidth = 3;
  context.stroke();

  context.fillStyle = rgba(accent, 0.92);
  context.beginPath();
  context.moveTo(74, 112);
  context.lineTo(48, 145);
  context.lineTo(78, 136);
  context.closePath();
  context.fill();
  context.beginPath();
  context.moveTo(118, 112);
  context.lineTo(144, 145);
  context.lineTo(114, 136);
  context.closePath();
  context.fill();

  context.fillStyle = rgba("#94a3b8", 0.98);
  roundedRect(context, 82, 127, 28, 16, 5);
  context.fill();
  context.restore();
}

function drawDebrisIcon(context: CanvasRenderingContext2D, tone: IconTone) {
  const accent = iconAccent("debris", tone);
  context.save();
  context.fillStyle = rgba(accent, 0.92);
  context.strokeStyle = rgba("#fff7ed", 0.86);
  context.lineWidth = 3;
  drawShard(context, [[71, 55], [121, 79], [92, 111], [62, 95]]);
  context.fill();
  context.stroke();

  context.fillStyle = rgba("#f8fafc", 0.9);
  drawShard(context, [[125, 111], [151, 125], [128, 144]]);
  context.fill();
  context.stroke();

  context.fillStyle = rgba("#ffc46b", 0.88);
  drawShard(context, [[49, 122], [76, 133], [51, 151]]);
  context.fill();
  context.stroke();

  context.strokeStyle = rgba(accent, 0.46);
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(54, 71);
  context.lineTo(40, 59);
  context.moveTo(137, 70);
  context.lineTo(158, 58);
  context.stroke();
  context.restore();
}

function drawUnknownIcon(context: CanvasRenderingContext2D, tone: IconTone) {
  const accent = iconAccent("unknown", tone);
  context.save();
  context.strokeStyle = rgba(accent, 0.9);
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(96, 42);
  context.lineTo(134, 58);
  context.lineTo(150, 96);
  context.lineTo(134, 134);
  context.lineTo(96, 150);
  context.lineTo(58, 134);
  context.lineTo(42, 96);
  context.lineTo(58, 58);
  context.closePath();
  context.stroke();

  context.strokeStyle = rgba("#e8f2ff", 0.72);
  context.lineWidth = 4;
  context.beginPath();
  context.arc(96, 96, 30, -0.4, Math.PI * 1.45);
  context.stroke();
  context.fillStyle = rgba("#e8f2ff", 0.92);
  context.beginPath();
  context.arc(96, 96, 7, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawSolarPanel(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string) {
  context.save();
  context.fillStyle = rgba(color, 0.7);
  context.strokeStyle = rgba("#9bd7ff", 0.9);
  context.lineWidth = 2;
  roundedRect(context, x, y, width, height, 4);
  context.fill();
  context.stroke();

  context.strokeStyle = rgba("#d9f4ff", 0.42);
  context.lineWidth = 1;
  for (let column = 1; column < 3; column += 1) {
    context.beginPath();
    context.moveTo(x + (width / 3) * column, y + 4);
    context.lineTo(x + (width / 3) * column, y + height - 4);
    context.stroke();
  }
  context.beginPath();
  context.moveTo(x + 4, y + height / 2);
  context.lineTo(x + width - 4, y + height / 2);
  context.stroke();
  context.restore();
}

function drawShard(context: CanvasRenderingContext2D, points: number[][]) {
  context.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const right = x + width;
  const bottom = y + height;
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(right - radius, y);
  context.quadraticCurveTo(right, y, right, y + radius);
  context.lineTo(right, bottom - radius);
  context.quadraticCurveTo(right, bottom, right - radius, bottom);
  context.lineTo(x + radius, bottom);
  context.quadraticCurveTo(x, bottom, x, bottom - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function iconAccent(kind: VisualKind, tone: IconTone) {
  if (tone === "prediction") return "#8affc1";
  if (tone === "selected") return "#78c6ff";
  if (kind === "station") return "#f8fafc";
  if (kind === "payload") return "#78c6ff";
  if (kind === "rocket_body") return "#c89cff";
  if (kind === "debris") return "#ff9f1c";
  return "#94a3b8";
}

function rgba(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function GroundMarker({ location }: { location: LocationTarget }) {
  const position = useMemo(() => latLonToSphere(location.latitude, location.longitude, 1.036), [location]);
  const quaternion = useMemo(() => {
    const normal = new THREE.Vector3(...position).normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  }, [position]);

  return (
    <group position={position} quaternion={quaternion}>
      <mesh>
        <torusGeometry args={[0.032, 0.004, 10, 32]} />
        <meshStandardMaterial color="#8affc1" emissive="#2dfd9b" emissiveIntensity={0.55} />
      </mesh>
      <mesh position={[0, 0, 0.028]}>
        <sphereGeometry args={[0.012, 12, 12]} />
        <meshStandardMaterial color="#8affc1" emissive="#2dfd9b" emissiveIntensity={0.8} />
      </mesh>
    </group>
  );
}

function SmartLabels({
  objects,
  selected,
  hoveredId,
  limit
}: {
  objects: PropagatedOrbitObject[];
  selected: PropagatedOrbitObject | null;
  hoveredId: string | null;
  limit: number;
}) {
  const { camera, size } = useThree();
  const elapsedRef = useRef(0);
  const candidates = useMemo(() => selectLabelCandidates(objects, selected, hoveredId, limit), [objects, selected, hoveredId, limit]);
  const [labels, setLabels] = useState<ProjectedLabel[]>([]);

  useFrame((_, delta) => {
    elapsedRef.current += delta;
    if (elapsedRef.current < 0.15) return;
    elapsedRef.current = 0;

    const next: ProjectedLabel[] = [];
    for (const object of candidates) {
      const projected = projectLabel(object, camera, size.width, size.height, selected?.noradId ?? null, hoveredId);
      if (projected) next.push(projected);
    }

    setLabels(next);
  });

  return (
    <Html fullscreen zIndexRange={[4, 0]}>
      <div className="label-layer">
      {labels.map((object) => (
        <div
          key={object.noradId}
          className={`space-label ${object.selected ? "is-selected" : ""} ${object.hovered ? "is-hovered" : ""} ${object.edge ? "is-edge" : ""}`}
          style={{ left: object.x, top: object.y }}
        >
          <span>{object.name}</span>
          <strong>{object.meta}</strong>
        </div>
      ))}
      </div>
    </Html>
  );
}

function selectLabelCandidates(
  objects: PropagatedOrbitObject[],
  selected: PropagatedOrbitObject | null,
  hoveredId: string | null,
  limit: number
) {
  const picked = new Map<string, PropagatedOrbitObject>();
  if (selected) picked.set(selected.noradId, selected);

  const hovered = objects.find((object) => object.noradId === hoveredId);
  if (hovered) picked.set(hovered.noradId, hovered);

  const usedNames = new Set(Array.from(picked.values()).map((object) => labelNameKey(object.name)));

  const priority = objects
    .filter((object) => !picked.has(object.noradId) && !usedNames.has(labelNameKey(object.name)))
    .sort((a, b) => b.riskScore + b.anomalyScore - (a.riskScore + a.anomalyScore));

  for (const object of priority) {
    if (picked.size >= limit) break;
    if (usedNames.has(labelNameKey(object.name))) continue;
    picked.set(object.noradId, object);
    usedNames.add(labelNameKey(object.name));
  }
  return Array.from(picked.values());
}

function labelNameKey(name: string) {
  return name.replace(/\s+\d+$/g, "").toLowerCase();
}

function projectLabel(
  object: PropagatedOrbitObject,
  camera: THREE.Camera,
  width: number,
  height: number,
  selectedId: string | null,
  hoveredId: string | null
): ProjectedLabel | null {
  tempVectorA.fromArray(object.scenePosition).project(camera);
  if (tempVectorA.z < -1 || tempVectorA.z > 1) return null;

  const rawX = (tempVectorA.x * 0.5 + 0.5) * width;
  const rawY = (-tempVectorA.y * 0.5 + 0.5) * height;
  const paddingX = 96;
  const paddingTop = 76;
  const paddingBottom = 48;
  const x = THREE.MathUtils.clamp(rawX, paddingX, width - paddingX);
  const y = THREE.MathUtils.clamp(rawY, paddingTop, height - paddingBottom);
  const edge = Math.abs(x - rawX) > 1 || Math.abs(y - rawY) > 1;

  return {
    noradId: object.noradId,
    name: object.name,
    meta: `${object.objectType.replace("_", " ")} · ${object.orbitClass}`,
    x,
    y,
    edge,
    selected: object.noradId === selectedId,
    hovered: object.noradId === hoveredId
  };
}

function GalaxyBackdrop() {
  const geometry = useMemo(() => {
    const count = 6200;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();

    for (let index = 0; index < count; index += 1) {
      const arm = index % 5;
      const radius = 8 + Math.random() * 65;
      const spin = radius * 0.18;
      const angle = arm * ((Math.PI * 2) / 5) + spin + (Math.random() - 0.5) * 0.7;
      const height = (Math.random() - 0.5) * 15;
      const dust = Math.random() ** 2;

      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = height + Math.sin(radius * 0.08) * 2.5;
      positions[index * 3 + 2] = Math.sin(angle) * radius;

      color.set(dust > 0.72 ? "#ff8fb3" : dust > 0.42 ? "#8ccfff" : "#ffffff");
      color.multiplyScalar(0.45 + Math.random() * 0.55);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }

    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    buffer.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return buffer;
  }, []);

  return (
    <points geometry={geometry}>
      <pointsMaterial size={0.09} sizeAttenuation vertexColors transparent opacity={0.72} depthWrite={false} />
    </points>
  );
}

function updateSatelliteInstances({
  bodyRef,
  leftPanelRef,
  rightPanelRef,
  objects,
  currentPositions,
  kind,
  selectedId,
  hoveredId,
  delta
}: {
  bodyRef: RefObject<THREE.InstancedMesh>;
  leftPanelRef: RefObject<THREE.InstancedMesh>;
  rightPanelRef: RefObject<THREE.InstancedMesh>;
  objects: PropagatedOrbitObject[];
  currentPositions: MutableRefObject<THREE.Vector3[]>;
  kind: "payload" | "station";
  selectedId: string | null;
  hoveredId: string | null;
  delta: number;
}) {
  const body = bodyRef.current;
  const left = leftPanelRef.current;
  const right = rightPanelRef.current;
  if (!body || !left || !right) return;

  const alpha = 1 - Math.exp(-delta * 7.2);
  for (let index = 0; index < objects.length; index += 1) {
    const object = objects[index];
    const position = currentPositions.current[index];
    if (!position) continue;

    position.lerp(tempVectorA.fromArray(object.scenePosition), alpha);
    composeMarkerMatrix(tempMatrix, object, position, kind, "body", selectedId, hoveredId);
    body.setMatrixAt(index, tempMatrix);
    composeMarkerMatrix(tempMatrix, object, position, kind, "left_panel", selectedId, hoveredId);
    left.setMatrixAt(index, tempMatrix);
    composeMarkerMatrix(tempMatrix, object, position, kind, "right_panel", selectedId, hoveredId);
    right.setMatrixAt(index, tempMatrix);
  }

  body.instanceMatrix.needsUpdate = true;
  left.instanceMatrix.needsUpdate = true;
  right.instanceMatrix.needsUpdate = true;
}

function updateSingleInstances({
  meshRef,
  objects,
  currentPositions,
  kind,
  selectedId,
  hoveredId,
  delta
}: {
  meshRef: RefObject<THREE.InstancedMesh>;
  objects: PropagatedOrbitObject[];
  currentPositions: MutableRefObject<THREE.Vector3[]>;
  kind: "rocket_body" | "debris" | "unknown";
  selectedId: string | null;
  hoveredId: string | null;
  delta: number;
}) {
  const mesh = meshRef.current;
  if (!mesh) return;

  const alpha = 1 - Math.exp(-delta * 7.2);
  for (let index = 0; index < objects.length; index += 1) {
    const object = objects[index];
    const position = currentPositions.current[index];
    if (!position) continue;

    position.lerp(tempVectorA.fromArray(object.scenePosition), alpha);
    composeMarkerMatrix(tempMatrix, object, position, kind, "body", selectedId, hoveredId);
    mesh.setMatrixAt(index, tempMatrix);
  }

  mesh.instanceMatrix.needsUpdate = true;
}

function composeMarkerMatrix(
  matrix: THREE.Matrix4,
  object: PropagatedOrbitObject,
  position: THREE.Vector3,
  kind: VisualKind,
  part: MarkerPart,
  selectedId: string | null,
  hoveredId: string | null
) {
  const emphasis = object.noradId === selectedId ? 1.05 : object.noradId === hoveredId ? 1.25 : 1;
  setQuaternionFromOrbitalFrame(tempQuaternionA, position);
  tempVectorC.copy(markerOffset(kind, part)).applyQuaternion(tempQuaternionA);
  tempVectorD.copy(position).add(tempVectorC);
  tempScale.copy(markerScale(kind, part)).multiplyScalar(emphasis);
  matrix.compose(tempVectorD, tempQuaternionA, tempScale);
}

function createOrbitalQuaternion(position: THREE.Vector3) {
  const normal = position.clone().normalize();
  const tangent = new THREE.Vector3(-normal.z, 0, normal.x);
  if (tangent.lengthSq() < 0.0001) tangent.set(1, 0, 0);
  tangent.normalize();

  const bitangent = new THREE.Vector3().crossVectors(tangent, normal).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(tangent, normal, bitangent));
}

function setQuaternionFromOrbitalFrame(target: THREE.Quaternion, position: THREE.Vector3) {
  tempVectorB.copy(position).normalize();
  tempVectorE.set(-tempVectorB.z, 0, tempVectorB.x);
  if (tempVectorE.lengthSq() < 0.0001) tempVectorE.set(1, 0, 0);
  tempVectorE.normalize();
  tempVectorF.crossVectors(tempVectorE, tempVectorB).normalize();
  tempRotationMatrix.makeBasis(tempVectorE, tempVectorB, tempVectorF);
  target.setFromRotationMatrix(tempRotationMatrix);
}

function useSmoothedPositions(objects: PropagatedOrbitObject[]) {
  const positions = useRef<THREE.Vector3[]>([]);
  const signature = objects.map((object) => object.noradId).join(",");

  useEffect(() => {
    positions.current = objects.map((object) => new THREE.Vector3(...object.scenePosition));
  }, [signature]);

  return positions;
}

function useInstanceHandlers(
  objects: PropagatedOrbitObject[],
  onHover: (id: string | null) => void,
  onSelect: (object: PropagatedOrbitObject) => void
) {
  return {
    onPointerDown: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      const object = event.instanceId === undefined ? null : objects[event.instanceId];
      if (object) onSelect(object);
    },
    onPointerMove: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      const object = event.instanceId === undefined ? null : objects[event.instanceId];
      onHover(object?.noradId ?? null);
    },
    onPointerOut: () => onHover(null)
  };
}

function objectFromPointEvent(event: ThreeEvent<PointerEvent>, objects: PropagatedOrbitObject[]) {
  const pointEvent = event as ThreeEvent<PointerEvent> & { index?: number };
  const index =
    typeof pointEvent.index === "number"
      ? pointEvent.index
      : event.intersections.find((intersection) => typeof intersection.index === "number")?.index ?? null;

  return index === null ? null : objects[index] ?? null;
}

function selectIconObjects(objects: PropagatedOrbitObject[], selectedId: string | null, hoveredId: string | null, budget = 2600) {
  if (objects.length <= budget) return objects;

  const selectedIds = new Set([selectedId, hoveredId].filter(Boolean));
  const picked = new Map<string, PropagatedOrbitObject>();

  for (const object of objects) {
    if (selectedIds.has(object.noradId)) picked.set(object.noradId, object);
  }

  const priorityCount = Math.floor(budget * 0.42);
  const priority = objects
    .filter((object) => !picked.has(object.noradId))
    .sort((a, b) => iconPriorityScore(b) - iconPriorityScore(a))
    .slice(0, priorityCount);

  for (const object of priority) picked.set(object.noradId, object);

  const remaining = Math.max(1, budget - picked.size);
  const stride = Math.max(1, Math.ceil(objects.length / remaining));

  for (let index = 0; index < objects.length && picked.size < budget; index += stride) {
    const object = objects[index];
    picked.set(object.noradId, object);
  }

  return Array.from(picked.values());
}

function iconPriorityScore(object: PropagatedOrbitObject) {
  const kind = visualKindForObject(object);
  const kindWeight = kind === "station" ? 6 : kind === "debris" ? 2.4 : kind === "rocket_body" ? 1.8 : kind === "payload" ? 1 : 0.6;
  const orbitWeight = object.orbitClass === "LEO" ? 0.35 : object.orbitClass === "GEO" ? 0.22 : 0;
  return kindWeight + object.riskScore * 5 + object.anomalyScore * 4 + orbitWeight;
}

function pointColorForObject(object: PropagatedOrbitObject, selectedId: string | null, hoveredId: string | null) {
  if (object.noradId === selectedId) return pointSelectedColor;
  if (object.noradId === hoveredId) return pointHoveredColor;

  const kind = visualKindForObject(object);
  if (kind === "station") return pointStationColor;
  if (kind === "payload") return pointPayloadColor;
  if (kind === "rocket_body") return pointRocketColor;
  if (kind === "debris") return pointDebrisColor;
  return pointUnknownColor;
}

function groupVisualObjects(objects: PropagatedOrbitObject[]) {
  const groups: Record<VisualKind, PropagatedOrbitObject[]> = {
    station: [],
    payload: [],
    rocket_body: [],
    debris: [],
    unknown: []
  };

  for (const object of objects) {
    groups[visualKindForObject(object)].push(object);
  }

  return groups;
}

function visualKindForObject(object: PropagatedOrbitObject): VisualKind {
  const value = `${object.name} ${object.groups.join(" ")}`.toLowerCase();
  if (value.includes("station") || value.includes("iss") || value.includes("tiangong")) return "station";
  if (object.objectType === "rocket_body") return "rocket_body";
  if (object.objectType === "debris") return "debris";
  if (object.objectType === "payload") return "payload";
  return "unknown";
}

function iconScaleForKind(kind: VisualKind) {
  if (kind === "station") return 0.07;
  if (kind === "payload") return 0.052;
  if (kind === "rocket_body") return 0.056;
  if (kind === "debris") return 0.048;
  return 0.046;
}

function markerScale(kind: VisualKind, part: MarkerPart) {
  if (kind === "station") {
    if (part === "body") return new THREE.Vector3(0.03, 0.006, 0.008);
    return new THREE.Vector3(0.038, 0.003, 0.014);
  }

  if (kind === "payload") {
    if (part === "body") return new THREE.Vector3(0.009, 0.012, 0.008);
    return new THREE.Vector3(0.022, 0.002, 0.011);
  }

  if (kind === "rocket_body") return new THREE.Vector3(0.008, 0.032, 0.008);
  if (kind === "debris") return new THREE.Vector3(0.012, 0.012, 0.012);
  return new THREE.Vector3(0.01, 0.01, 0.01);
}

function markerOffset(kind: VisualKind, part: MarkerPart) {
  if (part === "left_panel") return new THREE.Vector3(kind === "station" ? -0.035 : -0.021, 0, 0);
  if (part === "right_panel") return new THREE.Vector3(kind === "station" ? 0.035 : 0.021, 0, 0);
  return zeroVector;
}

function latLonToSphere(latitude: number, longitude: number, radius: number): Vector3Tuple {
  const lat = THREE.MathUtils.degToRad(latitude);
  const lon = THREE.MathUtils.degToRad(longitude);
  return [
    radius * Math.cos(lat) * Math.cos(lon),
    radius * Math.sin(lat),
    -radius * Math.cos(lat) * Math.sin(lon)
  ];
}

interface InstanceProps {
  objects: PropagatedOrbitObject[];
  selectedId: string | null;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (object: PropagatedOrbitObject) => void;
}

interface ProjectedLabel {
  noradId: string;
  name: string;
  meta: string;
  x: number;
  y: number;
  edge: boolean;
  selected: boolean;
  hovered: boolean;
}

type VisualKind = "station" | "payload" | "rocket_body" | "debris" | "unknown";
type IconTone = "normal" | "selected" | "prediction";
type MarkerPart = "body" | "left_panel" | "right_panel";

const zeroVector = new THREE.Vector3(0, 0, 0);
const tempVectorA = new THREE.Vector3();
const tempVectorB = new THREE.Vector3();
const tempVectorC = new THREE.Vector3();
const tempVectorD = new THREE.Vector3();
const tempVectorE = new THREE.Vector3();
const tempVectorF = new THREE.Vector3();
const tempScale = new THREE.Vector3();
const tempMatrix = new THREE.Matrix4();
const tempRotationMatrix = new THREE.Matrix4();
const tempQuaternionA = new THREE.Quaternion();
const identityQuaternion = new THREE.Quaternion();
const pointSelectedColor = new THREE.Color("#d8f3ff");
const pointHoveredColor = new THREE.Color("#8affc1");
const pointStationColor = new THREE.Color("#f8fafc");
const pointPayloadColor = new THREE.Color("#78c6ff");
const pointRocketColor = new THREE.Color("#c89cff");
const pointDebrisColor = new THREE.Color("#ff9f1c");
const pointUnknownColor = new THREE.Color("#94a3b8");
