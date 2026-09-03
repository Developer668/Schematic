"use client";

import { useEffect, useMemo, useState } from "react";

type LoadingVariant = "Drive" | "Orbit" | "Still";

const driveDelays = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3);
  const column = index % 3;
  return (column + Math.abs(row - 1)) * 90;
});

const orbitOrder = [0, 1, 2, 5, 8, 7, 6, 3];
const orbitDelays = Array.from({ length: 9 }, (_, index) => {
  const order = orbitOrder.indexOf(index);
  return order === -1 ? null : order * 110;
});

function useElapsed(enabled: boolean) {
  const [deciseconds, setDeciseconds] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => setDeciseconds((value) => value + 1), 100);
    return () => window.clearInterval(timer);
  }, [enabled]);

  const seconds = deciseconds / 10;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`;
}

export interface LoadingStateProps {
  label?: string;
  variant?: LoadingVariant;
  showElapsed?: boolean;
  compact?: boolean;
  className?: string;
}

export default function LoadingState({
  label = "Loading",
  variant = "Drive",
  showElapsed = true,
  compact = false,
  className = "",
}: LoadingStateProps) {
  const elapsed = useElapsed(showElapsed);
  const pattern = useMemo(() => {
    if (variant === "Orbit") return { delays: orbitDelays, duration: 950 };
    if (variant === "Still") return { delays: Array(9).fill(null) as null[], duration: 0 };
    return { delays: driveDelays, duration: 650 };
  }, [variant]);

  return (
    <div
      className={`schematic-loading-state ${compact ? "is-compact" : ""} ${className}`.trim()}
      role="status"
      aria-live="polite"
    >
      <span className="schematic-loading-grid" aria-hidden="true">
        {pattern.delays.map((delay, index) => (
          <span
            key={index}
            style={{
              opacity: delay === null ? 0.08 : 0.16,
              animation: delay === null
                ? "none"
                : `schematic-pixel-on ${pattern.duration}ms ease-in-out ${delay}ms infinite`,
            }}
          />
        ))}
      </span>
      <span className="schematic-loading-label">{label}</span>
      {showElapsed && <span className="schematic-loading-elapsed">{elapsed}</span>}
    </div>
  );
}
