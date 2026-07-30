import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

function Cubes({ count = 28 }: { count?: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const data = useMemo(() => {
    return Array.from({ length: count }, () => ({
      pos: [
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 10 - 2,
      ] as [number, number, number],
      rot: [Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI] as [number, number, number],
      speed: 0.1 + Math.random() * 0.3,
      scale: 0.4 + Math.random() * 0.9,
    }));
  }, [count]);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    if (!mesh.current) return;
    const t = state.clock.getElapsedTime();
    data.forEach((d, i) => {
      dummy.position.set(
        d.pos[0] + Math.sin(t * d.speed + i) * 0.4,
        d.pos[1] + Math.cos(t * d.speed * 0.8 + i) * 0.5,
        d.pos[2],
      );
      dummy.rotation.set(
        d.rot[0] + t * d.speed * 0.3,
        d.rot[1] + t * d.speed * 0.2,
        d.rot[2],
      );
      dummy.scale.setScalar(d.scale);
      dummy.updateMatrix();
      mesh.current!.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#D4AF37" metalness={0.6} roughness={0.25} />
    </instancedMesh>
  );
}

interface CubeFieldProps {
  className?: string;
  /** Background tint behind the blur, defaults to dark. */
  variant?: "dark" | "light";
  /** Blur intensity class, override if needed. */
  blurClass?: string;
}

export function CubeField({ className = "", variant = "dark", blurClass = "backdrop-blur-2xl" }: CubeFieldProps) {
  const prefersReducedMotion =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  return (
    <div className={`fixed inset-0 -z-10 pointer-events-none overflow-hidden ${className}`} aria-hidden>
      <div className={variant === "dark" ? "absolute inset-0 bg-[#0a0a0a]" : "absolute inset-0 bg-background"} />
      {!prefersReducedMotion && (
        <Canvas
          camera={{ position: [0, 0, 10], fov: 50 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: true }}
        >
          <ambientLight intensity={0.4} />
          <directionalLight position={[5, 5, 5]} intensity={1.1} />
          <pointLight position={[-5, -5, 4]} intensity={0.6} color="#D4AF37" />
          <Cubes />
        </Canvas>
      )}
      <div className={`absolute inset-0 ${blurClass} ${variant === "dark" ? "bg-black/40" : "bg-background/70"}`} />
    </div>
  );
}
