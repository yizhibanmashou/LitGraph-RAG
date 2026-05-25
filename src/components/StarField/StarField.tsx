import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import type { StarNode } from '../../utils/starNavigation';
import { useStarFieldStore } from '../../stores/starFieldStore';
import { StarNodeCard } from './StarNodeCard';
import './StarField.css';

interface StarFieldProps {
  nodes: StarNode[];
  visible: boolean;
  onEnterNode: (node: StarNode) => void;
  rightReserve?: number;
}

interface NodeMesh extends THREE.Mesh {
  userData: {
    node: StarNode;
    baseScale: number;
    targetScale: number;
    pulse: number;
    ring: THREE.Mesh;
    label: THREE.Sprite;
    labelAnchor: THREE.Object3D;
    hitTarget: THREE.Mesh;
  };
}

interface HitTargetMesh extends THREE.Mesh {
  userData: {
    node: NodeMesh;
  };
}

type ActiveNode = {
  node: StarNode;
  x: number;
  y: number;
};

const NODE_RADIUS = 2.5;
const NODE_VISUAL_RADIUS = 0.045;
const NODE_HIT_RADIUS = 0.34;
const CLICK_DRAG_THRESHOLD = 8;
const DOUBLE_CLICK_WINDOW_MS = 360;
const DOUBLE_CLICK_MISS_THRESHOLD = 28;

export function StarField({ nodes: starNodes, visible, onEnterNode, rightReserve = 0 }: StarFieldProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const asleep = useStarFieldStore((state) => state.asleep);
  const asleepRef = useRef(asleep);
  const visibleRef = useRef(visible);
  const selectedRef = useRef(false);
  const rotationSpeedRef = useRef(1);
  const [activeNode, setActiveNode] = useState<ActiveNode | null>(null);
  const [hoverNode, setHoverNode] = useState<ActiveNode | null>(null);

  useEffect(() => {
    asleepRef.current = asleep;
  }, [asleep]);

  useEffect(() => {
    visibleRef.current = visible;
    if (!visible) setActiveNode(null);
    if (!visible) setHoverNode(null);
  }, [visible]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !starNodes.length) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x030611, 0.085);

    const camera = new THREE.PerspectiveCamera(42, mount.clientWidth / mount.clientHeight, 0.1, 80);
    camera.position.set(0, 0.18, 8.6);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x030611, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.42;
    mount.appendChild(renderer.domElement);

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
    let composer: EffectComposer | null = null;
    let bloomPass: UnrealBloomPass | null = null;
    let bokehPass: BokehPass | null = null;

    if (!isMobile) {
      composer = new EffectComposer(renderer);
      const renderPass = new RenderPass(scene, camera);
      bloomPass = new UnrealBloomPass(new THREE.Vector2(mount.clientWidth, mount.clientHeight), 1.8, 0.56, 0.1);
      bokehPass = new BokehPass(scene, camera, { focus: 8.4, aperture: 0.00018, maxblur: 0.006 });
      composer.addPass(renderPass);
      composer.addPass(bokehPass);
      composer.addPass(bloomPass);
    }

    scene.add(new THREE.AmbientLight(0x87b9ff, 0.55));
    const keyLight = new THREE.PointLight(0xffffff, 2.4, 16);
    keyLight.position.set(-3.4, 2.5, 4.6);
    const rimLight = new THREE.PointLight(0xe5e7eb, 1.2, 18);
    rimLight.position.set(4.2, -2.4, -2.8);
    scene.add(keyLight, rimLight);

    const constellation = new THREE.Group();
    scene.add(constellation);

    const coreGeometry = new THREE.SphereGeometry(2.1, 96, 96);
    const coreMaterial = new THREE.MeshStandardMaterial({
      color: 0x071728,
      roughness: 0.74,
      metalness: 0.08,
      transparent: true,
      opacity: 0.22,
      emissive: 0x071a2d,
      emissiveIntensity: 0.28,
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    constellation.add(core);

    const nodeGeometry = new THREE.SphereGeometry(NODE_VISUAL_RADIUS, 32, 32);
    const haloGeometry = new THREE.SphereGeometry(0.09, 24, 24);
    const hitGeometry = new THREE.SphereGeometry(NODE_HIT_RADIUS, 16, 16);
    const hitMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    const nodeMeshes: NodeMesh[] = [];
    const hitTargets: HitTargetMesh[] = [];
    const nodePoints = fibonacciSphere(starNodes.length, NODE_RADIUS);

    starNodes.forEach((node, index) => {
      const isAppendix = /^appendix/i.test(node.chapterId || node.id);
      const color = node.isBackbone
        ? new THREE.Color(0xc7e7ff)
        : node.kind === 'chapter'
          ? new THREE.Color(isAppendix ? 0xd4c5b9 : 0xffffff)
          : new THREE.Color(0xdbeafe);
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: node.isBackbone ? 0.48 : 0.4,
        roughness: 0.34,
        metalness: 0,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(nodeGeometry, material) as unknown as NodeMesh;
      mesh.position.copy(nodePoints[index]);
      const baseScale = node.isBackbone ? 1.16 : node.kind === 'chapter' ? 1.45 : 1;
      mesh.scale.setScalar(baseScale);

      const ring = new THREE.Mesh(
        haloGeometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: node.isBackbone ? 0.16 : 0.12,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      ring.position.copy(mesh.position);

      const labelFontSize = node.kind === 'chapter' ? 30 : 24;
      const label = makeLabelSprite(node.displayLabel || node.label, labelFontSize);
      const labelAnchor = new THREE.Object3D();
      labelAnchor.position.copy(mesh.position);
      label.position.set(0, 0, NODE_VISUAL_RADIUS * baseScale + 0.004);
      label.scale.setScalar(node.kind === 'chapter' ? 0.16 : 0.13);
      labelAnchor.add(label);

      const hitTarget = new THREE.Mesh(hitGeometry, hitMaterial) as unknown as HitTargetMesh;
      hitTarget.position.copy(mesh.position);
      hitTarget.userData = { node: mesh };

      mesh.userData = {
        node,
        baseScale,
        targetScale: baseScale,
        pulse: 0.75 + Math.random() * 1.4,
        ring,
        label,
        labelAnchor,
        hitTarget,
      };
      nodeMeshes.push(mesh);
      hitTargets.push(hitTarget);
      constellation.add(ring, mesh, labelAnchor, hitTarget);
    });

    const filamentLines = createBiologicalFilaments(nodePoints, starNodes);
    const filamentBaseOpacities = filamentLines.map((line) => (line.material as THREE.LineBasicMaterial).opacity);
    filamentLines.forEach((line) => constellation.add(line));

    const dust = createDust(4200, 0.018, 0.58, 5, 18, -4);
    const fineDust = createDust(3200, 0.009, 0.42, 7, 24, -7);
    scene.add(dust, fineDust);

    const raycaster = new THREE.Raycaster();
    raycaster.params.Mesh.threshold = 0.02;
    const pointer = new THREE.Vector2();
    const lastPointer = { x: 0, y: 0 };
    const dragStart = { x: 0, y: 0 };
    let pressed = false;
    let dragging = false;
    let hoveredMesh: NodeMesh | null = null;
    let pinnedMesh: NodeMesh | null = null;
    let clickTimer: number | null = null;
    let lastClick: { node: StarNode; nodeId: string; time: number; x: number; y: number } | null = null;
    let running = false;

    const clearSelection = () => {
      if (pinnedMesh) pinnedMesh.userData.targetScale = pinnedMesh.userData.baseScale;
      pinnedMesh = null;
      selectedRef.current = false;
      setActiveNode(null);
    };

    const releaseHover = () => {
      if (hoveredMesh && hoveredMesh !== pinnedMesh) hoveredMesh.userData.targetScale = hoveredMesh.userData.baseScale;
      hoveredMesh = null;
      setHoverNode(null);
    };

    const pinNode = (mesh: NodeMesh) => {
      if (pinnedMesh && pinnedMesh !== mesh) pinnedMesh.userData.targetScale = pinnedMesh.userData.baseScale;
      pinnedMesh = mesh;
      hoveredMesh = mesh;
      selectedRef.current = true;
      mesh.userData.targetScale = mesh.userData.baseScale * 1.5;
    };

    const updatePointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
    };

    const pickNode = (event: PointerEvent) => {
      updatePointer(event);
      const hit = raycaster.intersectObjects(hitTargets, false)[0]?.object as HitTargetMesh | undefined;
      return hit?.userData.node;
    };

    const setHoverFromEvent = (event: PointerEvent) => {
      if (asleepRef.current || !visibleRef.current || dragging) return;
      const hit = pickNode(event);
      if (hoveredMesh && hoveredMesh !== hit && hoveredMesh !== pinnedMesh) hoveredMesh.userData.targetScale = hoveredMesh.userData.baseScale;
      hoveredMesh = hit || null;
      renderer.domElement.style.cursor = hoveredMesh ? 'pointer' : 'grab';
      if (hoveredMesh) {
        if (hoveredMesh !== pinnedMesh) hoveredMesh.userData.targetScale = hoveredMesh.userData.baseScale * 1.35;
        setHoverNode({ node: hoveredMesh.userData.node, x: event.clientX, y: event.clientY });
      } else {
        setHoverNode(null);
      }
    };

    const pointerDown = (event: PointerEvent) => {
      if (asleepRef.current || !visibleRef.current) return;
      pressed = true;
      dragging = false;
      dragStart.x = event.clientX;
      dragStart.y = event.clientY;
      lastPointer.x = event.clientX;
      lastPointer.y = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    const pointerMove = (event: PointerEvent) => {
      if (asleepRef.current || !visibleRef.current) return;
      if (pressed) {
        const dx = event.clientX - dragStart.x;
        const dy = event.clientY - dragStart.y;
        if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD) dragging = true;
        if (dragging) {
          constellation.rotation.y += (event.clientX - lastPointer.x) * 0.0032;
          constellation.rotation.x += (event.clientY - lastPointer.y) * 0.0024;
          constellation.rotation.x = THREE.MathUtils.clamp(constellation.rotation.x, -0.62, 0.62);
          renderer.domElement.style.cursor = 'grabbing';
          lastPointer.x = event.clientX;
          lastPointer.y = event.clientY;
          return;
        }
      }
      setHoverFromEvent(event);
    };

    const pointerUp = (event: PointerEvent) => {
      if (!pressed || asleepRef.current || !visibleRef.current) return;
      renderer.domElement.releasePointerCapture(event.pointerId);
      pressed = false;
      renderer.domElement.style.cursor = 'grab';
      if (dragging) {
        dragging = false;
        return;
      }

      const hit = pickNode(event);
      const now = window.performance.now();
      if (!hit) {
        const previousClick = lastClick;
        const isMissedSecondClick =
          previousClick &&
          now - previousClick.time <= DOUBLE_CLICK_WINDOW_MS &&
          Math.hypot(event.clientX - previousClick.x, event.clientY - previousClick.y) <= DOUBLE_CLICK_MISS_THRESHOLD;
        if (isMissedSecondClick) {
          if (clickTimer !== null) window.clearTimeout(clickTimer);
          onEnterNode(previousClick.node);
          lastClick = null;
          return;
        }
        clearSelection();
        return;
      }

      const node = hit.userData.node;
      const isDoubleClick = lastClick?.nodeId === node.id && now - lastClick.time <= DOUBLE_CLICK_WINDOW_MS;
      lastClick = { node, nodeId: node.id, time: now, x: event.clientX, y: event.clientY };

      if (isDoubleClick) {
        if (clickTimer !== null) window.clearTimeout(clickTimer);
        setHoverNode(null);
        onEnterNode(node);
        return;
      }

      if (clickTimer !== null) window.clearTimeout(clickTimer);
      pinNode(hit);
      setHoverNode(null);
      clickTimer = window.setTimeout(() => {
        setActiveNode({ node, x: event.clientX, y: event.clientY });
        clickTimer = null;
      }, DOUBLE_CLICK_WINDOW_MS);
    };

    const resize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      if (composer && bloomPass && bokehPass) {
        composer.setSize(mount.clientWidth, mount.clientHeight);
        bloomPass.setSize(mount.clientWidth, mount.clientHeight);
        bokehPass.setSize(mount.clientWidth, mount.clientHeight);
      }
    };

    const animate = () => {
      if (asleepRef.current || !visibleRef.current) {
        renderer.setAnimationLoop(null);
        running = false;
        return;
      }

      const now = performance.now();
      const targetSpeed = selectedRef.current ? 0 : 1;
      rotationSpeedRef.current = THREE.MathUtils.lerp(rotationSpeedRef.current, targetSpeed, targetSpeed ? 0.025 : 0.045);
      if (!dragging) {
        constellation.rotation.y += 0.00055 * rotationSpeedRef.current;
        constellation.rotation.x += Math.sin(now * 0.0001) * 0.00016 * rotationSpeedRef.current;
      }
      core.rotation.y -= 0.0006;
      dust.rotation.y -= 0.00008;
      dust.rotation.x = Math.sin(now * 0.00006) * 0.015;
      fineDust.rotation.y += 0.000035;
      fineDust.rotation.x = Math.sin(now * 0.000045) * 0.01;

      nodeMeshes.forEach((mesh, index) => {
        const pulse = 1 + Math.sin(now * 0.0015 + mesh.userData.pulse + index * 0.17) * 0.08;
        const currentTargetScale = mesh === pinnedMesh ? mesh.userData.baseScale * 1.5 : mesh.userData.targetScale;
        mesh.scale.setScalar(THREE.MathUtils.lerp(mesh.scale.x, currentTargetScale, 0.12));
        mesh.userData.ring.scale.setScalar((mesh === pinnedMesh ? 2.2 : pulse) * mesh.userData.baseScale);
        mesh.userData.ring.lookAt(camera.position);
        mesh.userData.labelAnchor.lookAt(camera.position);
      });

      filamentLines.forEach((line, index) => {
        const material = line.material as THREE.LineBasicMaterial;
        material.opacity = filamentBaseOpacities[index] * (0.7 + Math.sin(now * 0.0006 + index * 1.3) * 0.3);
      });

      if (composer) {
        composer.render();
      } else {
        renderer.render(scene, camera);
      }
    };

    const wake = () => {
      if (!running && !asleepRef.current && visibleRef.current) {
        running = true;
        renderer.setAnimationLoop(animate);
      }
    };

    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointercancel', releaseHover);
    renderer.domElement.addEventListener('pointerleave', releaseHover);
    window.addEventListener('resize', resize);
    wake();

    const visibilityTimer = window.setInterval(wake, 250);
    const unsubscribe = useStarFieldStore.subscribe((state) => {
      asleepRef.current = state.asleep;
      if (!state.asleep) wake();
      else {
        renderer.setAnimationLoop(null);
        running = false;
      }
    });

    return () => {
      window.clearInterval(visibilityTimer);
      if (clickTimer !== null) window.clearTimeout(clickTimer);
      unsubscribe();
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', releaseHover);
      renderer.domElement.removeEventListener('pointerleave', releaseHover);
      window.removeEventListener('resize', resize);

      if (composer) composer.dispose();
      renderer.dispose();
      coreGeometry.dispose();
      coreMaterial.dispose();
      nodeGeometry.dispose();
      haloGeometry.dispose();
      hitGeometry.dispose();
      hitMaterial.dispose();
      nodeMeshes.forEach((mesh) => {
        (mesh.material as THREE.Material).dispose();
        (mesh.userData.ring.material as THREE.Material).dispose();
        const labelMaterial = mesh.userData.label.material as THREE.SpriteMaterial;
        if (labelMaterial.map) {
          labelMaterial.map.dispose();
        }
        labelMaterial.dispose();
      });
      filamentLines.forEach((line) => {
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      });
      dust.geometry.dispose();
      (dust.material as THREE.Material).dispose();
      fineDust.geometry.dispose();
      (fineDust.material as THREE.Material).dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [onEnterNode, starNodes]);

  const card =
    activeNode && visible
      ? createPortal(
          <StarNodeCard
            node={activeNode.node}
            x={activeNode.x}
            y={activeNode.y}
            onClose={() => {
              selectedRef.current = false;
              setActiveNode(null);
            }}
            onEnter={() => onEnterNode(activeNode.node)}
          />,
          document.body,
        )
      : null;
  const hover =
    hoverNode && visible && !activeNode
      ? createPortal(<StarNodeHoverTooltip node={hoverNode.node} x={hoverNode.x} y={hoverNode.y} />, document.body)
      : null;

  return (
    <>
      <div
        ref={mountRef}
        className={`starfield-root ${rightReserve ? 'starfield-root--reserved-right' : ''} ${visible ? 'starfield-root--visible' : 'starfield-root--hidden'}`}
        style={{ '--starfield-right-reserve': `${rightReserve}px` } as React.CSSProperties}
        aria-hidden={!visible}
      >
        <div className="evolution-overlay" />
      </div>
      {hover}
      {card}
    </>
  );
}

function fibonacciSphere(count: number, radius: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const safeCount = Math.max(1, count);
  for (let i = 0; i < count; i += 1) {
    const y = 1 - ((i + 0.5) / safeCount) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * (i + 0.5);
    points.push(new THREE.Vector3(Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius));
  }
  return points;
}

function createBiologicalFilaments(points: THREE.Vector3[], nodes: StarNode[]): THREE.Line[] {
  const lines: THREE.Line[] = [];
  const sortedIndexes = [...points.keys()].sort((a, b) => (nodes[a]?.chapterRank || 0) - (nodes[b]?.chapterRank || 0));
  sortedIndexes.forEach((pointIndex, sortedPosition) => {
    const next = sortedIndexes[sortedPosition + 1];
    const near = sortedIndexes[sortedPosition + 2];
    const jump = sortedIndexes[sortedPosition + 3];
    const far = sortedIndexes[sortedPosition + 7];
    if (next !== undefined) lines.push(createFilament(points[pointIndex], points[next], 0.16, 0.44));
    if (near !== undefined) lines.push(createFilament(points[pointIndex], points[near], 0.08, 0.32));
    if (jump !== undefined && sortedPosition % 2 === 0) lines.push(createFilament(points[pointIndex], points[jump], 0.07, 0.5));
    if (far !== undefined && sortedPosition % 5 === 0) lines.push(createFilament(points[pointIndex], points[far], 0.045, 0.72));
  });
  points.forEach((point, index) => {
    const distances = points
      .map((candidate, candidateIndex) => ({ candidateIndex, distance: candidate.distanceTo(point) }))
      .filter((item) => item.candidateIndex !== index)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 2);
    distances.forEach(({ candidateIndex }, offset) => {
      if (candidateIndex > index) lines.push(createFilament(point, points[candidateIndex], offset === 0 ? 0.055 : 0.038, 0.2 + offset * 0.16));
    });
  });
  return lines;
}

function createFilament(start: THREE.Vector3, end: THREE.Vector3, opacity: number, curvature: number): THREE.Line {
  const mid = start.clone().add(end).multiplyScalar(0.5);
  const normal = mid.clone().normalize().multiplyScalar(curvature * (0.5 + Math.random() * 0.5));
  const tangent = new THREE.Vector3().crossVectors(start, end).normalize().multiplyScalar(curvature * 0.2 * (Math.random() - 0.5));
  const curve = new THREE.CatmullRomCurve3([
    start.clone(),
    start.clone().lerp(end, 0.25).add(normal.clone().multiplyScalar(0.7)).add(tangent),
    start.clone().lerp(end, 0.5).add(normal),
    start.clone().lerp(end, 0.75).add(normal.clone().multiplyScalar(0.7)).sub(tangent),
    end.clone(),
  ]);
  const curvePoints = curve.getPoints(52);
  const geometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
  const colors = new Float32Array(curvePoints.length * 3);
  const white = new THREE.Color(0xffffff);
  const blue = new THREE.Color(0xa5b4fc);
  for (let i = 0; i < curvePoints.length; i++) {
    const t = i / (curvePoints.length - 1);
    const color = white.clone().lerp(blue, Math.sin(t * Math.PI) * 0.4);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
}

function createDust(count: number, size: number, opacity: number, minRadius: number, radiusRange: number, zOffset: number): THREE.Points {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const colorA = new THREE.Color(0xffffff);
  const colorB = new THREE.Color(0xcbd5e1);
  const colorC = new THREE.Color(0xa5b4fc);
  for (let i = 0; i < count; i += 1) {
    const stride = i * 3;
    const radius = minRadius + Math.random() * radiusRange;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
    positions[stride] = Math.sin(phi) * Math.cos(theta) * radius;
    positions[stride + 1] = Math.cos(phi) * radius * 0.74;
    positions[stride + 2] = Math.sin(phi) * Math.sin(theta) * radius + zOffset;
    const mixed = colorA.clone().lerp(Math.random() < 0.3 ? colorC : colorB, Math.random() * 0.55);
    colors[stride] = mixed.r;
    colors[stride + 1] = mixed.g;
    colors[stride + 2] = mixed.b;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ size, transparent: true, opacity, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }),
  );
}

function makeLabelSprite(text: string, fontSize: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = `850 ${fontSize}px Inter, system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = 'rgba(255, 255, 255, 0.68)';
    context.shadowBlur = 8;
    context.fillStyle = 'rgba(2, 6, 23, 0.92)';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false });
  return new THREE.Sprite(material);
}

function StarNodeHoverTooltip({ node, x, y }: ActiveNode) {
  const width = node.kind === 'chapter' ? 260 : 300;
  const gap = 18;
  const left = x + gap + width < window.innerWidth ? x + gap : Math.max(14, x - width - gap);
  const top = Math.min(Math.max(14, y + gap), Math.max(14, window.innerHeight - 150));

  return (
    <div className="star-node-hover-tooltip fixed z-[65]" style={{ left, top, width }}>
      <p>{node.fullLabel || node.label}</p>
      <strong>{node.title}</strong>
      <span>{node.kind === 'chapter' ? `${node.formulaCount || 0} formulas` : node.section || node.subtitle}</span>
    </div>
  );
}
