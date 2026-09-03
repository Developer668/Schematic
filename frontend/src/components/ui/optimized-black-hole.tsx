"use client";

import { useEffect, useRef, useState } from "react";
import { createRenderer, type BlackHoleRenderer } from "./optimized-black-hole-utils/renderer.ts";

export interface OptimizedBlackHoleProps {
  className?: string;
  intensity?: number;
  interactive?: boolean;
  ariaLabel?: string;
}

type IdleWindow = Window & {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/** Standalone host for the optimized black-hole renderer used by the homepage. */
export function OptimizedBlackHole({
  className = "",
  intensity = 1,
  interactive = true,
  ariaLabel = "A dark indigo black hole with a white, blue, and violet accretion disk",
}: OptimizedBlackHoleProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let renderer: BlackHoleRenderer | null = null;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const startRenderer = () => {
      if (cancelled || renderer) return;
      renderer = createRenderer({ canvas, intensity, interactive });
      void renderer.ready.then(() => {
        if (!cancelled) setIsReady(true);
      });
    };

    const idleWindow = window as IdleWindow;
    const idleHandle = idleWindow.requestIdleCallback?.(startRenderer, { timeout: 900 });
    const timeoutHandle = idleHandle === undefined
      ? window.setTimeout(startRenderer, 320)
      : undefined;

    return () => {
      cancelled = true;
      if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
      renderer?.dispose();
    };
  }, [intensity, interactive]);

  return (
    <div
      className={`optimized-black-hole relative h-full w-full overflow-hidden bg-black ${isReady ? "is-ready" : ""} ${className}`.trim()}
      role="img"
      aria-label={ariaLabel}
    >
      <canvas
        ref={canvasRef}
        className={`optimized-black-hole-canvas block h-full w-full touch-none transition-opacity duration-500 ${isReady ? "opacity-100" : "opacity-0"}`}
      />
      <div className="optimized-black-hole-fallback" aria-hidden="true" />
    </div>
  );
}

export default OptimizedBlackHole;
