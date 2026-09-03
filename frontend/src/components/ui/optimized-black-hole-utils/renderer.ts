import { createWebGLRenderer } from "./webgl-renderer.ts";

export interface BlackHoleRendererOptions {
  canvas: HTMLCanvasElement;
  intensity?: number;
  interactive?: boolean;
}

export interface BlackHoleRenderer {
  ready: Promise<void>;
  dispose: () => void;
}

type Star = {
  x: number;
  y: number;
  size: number;
  alpha: number;
  phase: number;
  tint: number;
};

type DiskParticle = {
  angle: number;
  radius: number;
  speed: number;
  size: number;
  alpha: number;
  tint: number;
  eccentricity: number;
};

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function buildStars(count: number): Star[] {
  const random = seededRandom(0x51a7c0de);
  return Array.from({ length: count }, () => ({
    x: random(),
    y: random(),
    size: 0.35 + random() * 1.15,
    alpha: 0.16 + random() * 0.52,
    phase: random() * Math.PI * 2,
    tint: random(),
  }));
}

function buildDiskParticles(count: number): DiskParticle[] {
  const random = seededRandom(0xb1ac401e);
  return Array.from({ length: count }, () => ({
    angle: random() * Math.PI * 2,
    radius: 1.12 + Math.pow(random(), 1.65) * 2.8,
    speed: 0.035 + random() * 0.085,
    size: 0.45 + random() * 1.7,
    alpha: 0.18 + random() * 0.7,
    tint: random(),
    eccentricity: 0.82 + random() * 0.3,
  }));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function createRenderer({
  canvas,
  intensity = 1,
  interactive = true,
}: BlackHoleRendererOptions): BlackHoleRenderer {
  const webglRenderer = createWebGLRenderer({ canvas, intensity, interactive });
  if (webglRenderer) return webglRenderer;

  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    return { ready: Promise.resolve(), dispose: () => undefined };
  }

  const stars = buildStars(88);
  const particles = buildDiskParticles(260);
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = media.matches;
  let disposed = false;
  let visible = true;
  let documentVisible = document.visibilityState !== "hidden";
  let frame = 0;
  let width = 1;
  let height = 1;
  let dpr = 1;
  const minimumFrameDuration = 1000 / 30;
  let elapsed = 0;
  let lastFrame = performance.now();
  let lastRenderedAt = 0;
  let pointerX = 0;
  let pointerY = 0;
  let targetPointerX = 0;
  let targetPointerY = 0;
  let readyResolved = false;
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(1.3, Math.max(1, window.devicePixelRatio || 1));
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
  };

  const drawStars = (time: number, centerX: number, centerY: number, scale: number) => {
    context.save();
    context.globalCompositeOperation = "screen";
    for (const star of stars) {
      const sourceX = star.x * width;
      const sourceY = star.y * height;
      const dx = sourceX - centerX;
      const dy = sourceY - centerY;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const horizon = scale * 0.23;
      const lensBand = scale * 0.58;
      const proximity = clamp(1 - Math.abs(distance - lensBand) / (scale * 0.42), 0, 1);
      const bend = proximity * proximity * 0.22 * Math.sign(dx || 1);
      const angle = Math.atan2(dy, dx) + bend;
      const pushedDistance = Math.max(horizon * 1.1, distance + proximity * scale * 0.045);
      const x = centerX + Math.cos(angle) * pushedDistance;
      const y = centerY + Math.sin(angle) * pushedDistance;
      const twinkle = reducedMotion ? 1 : 0.92 + Math.sin(time * 0.00028 + star.phase) * 0.08;
      const alpha = star.alpha * twinkle * (distance < horizon ? 0.06 : 1);
      const hue = star.tint > 0.72 ? 231 : star.tint > 0.42 ? 270 : 0;
      context.strokeStyle = hue === 0
        ? `rgba(248, 249, 255, ${alpha})`
        : `hsla(${hue}, 64%, 84%, ${alpha * 0.78})`;
      context.lineWidth = Math.max(0.35, star.size * 0.5);
      const streakLength = 1.4 + star.size * (1.9 + proximity * 2.2);
      const streakAngle = angle + Math.PI / 2;
      context.beginPath();
      context.moveTo(
        x - Math.cos(streakAngle) * streakLength * 0.5,
        y - Math.sin(streakAngle) * streakLength * 0.5,
      );
      context.lineTo(
        x + Math.cos(streakAngle) * streakLength * 0.5,
        y + Math.sin(streakAngle) * streakLength * 0.5,
      );
      context.stroke();
    }
    context.restore();
  };

  const diskColor = (particle: DiskParticle, alpha: number, x: number, coreRadius: number) => {
    const side = clamp(x / Math.max(1, coreRadius * 4), -1, 1);
    if (side < -0.12 && particle.tint > 0.24) return `rgba(129, 118, 238, ${alpha * 0.88})`;
    if (particle.tint > 0.78) return `rgba(246, 244, 255, ${alpha})`;
    if (particle.tint > 0.42) return `hsla(258, 86%, 69%, ${alpha})`;
    return `hsla(237, 58%, 47%, ${alpha})`;
  };

  const drawDiskPass = (
    time: number,
    centerX: number,
    centerY: number,
    coreRadius: number,
    front: boolean,
  ) => {
    context.save();
    context.translate(centerX, centerY);
    context.rotate(-0.18 + pointerX * 0.035);
    context.scale(1, 0.31 + Math.abs(pointerY) * 0.012);
    context.globalCompositeOperation = "lighter";

    for (const particle of particles) {
      const angle = particle.angle + time * 0.00055 * particle.speed * 60;
      const frontHalf = Math.sin(angle) > 0;
      if (frontHalf !== front) continue;
      const radius = coreRadius * particle.radius * particle.eccentricity;
      const turbulence = reducedMotion ? 0 : Math.sin(time * 0.0014 + particle.angle * 7) * coreRadius * 0.018;
      const x = Math.cos(angle) * (radius + turbulence);
      const y = Math.sin(angle) * radius;
      const radialFade = clamp(1.18 - (particle.radius - 1.1) / 3.05, 0.08, 1);
      const hotSide = 0.65 + clamp((x / (coreRadius * 4) + 1) * 0.32, 0, 0.5);
      const alpha = particle.alpha * radialFade * hotSide * intensity * (front ? 1 : 0.63);

      context.shadowBlur = particle.size * 5.5;
      context.shadowColor = x < -coreRadius * 0.4
        ? "rgba(107, 95, 226, .62)"
        : particle.tint > 0.46
          ? "rgba(151, 118, 248, .7)"
          : "rgba(63, 55, 171, .66)";
      context.fillStyle = diskColor(particle, alpha, x, coreRadius);
      context.beginPath();
      context.ellipse(
        x,
        y,
        particle.size * (1.2 + radialFade),
        particle.size * 0.72,
        angle,
        0,
        Math.PI * 2,
      );
      context.fill();
    }

    context.restore();
  };

  const drawDiskBands = (centerX: number, centerY: number, coreRadius: number) => {
    context.save();
    context.translate(centerX, centerY);
    context.rotate(-0.18 + pointerX * 0.035);
    context.scale(1, 0.31 + Math.abs(pointerY) * 0.012);
    context.globalCompositeOperation = "screen";
    const gradient = context.createLinearGradient(-coreRadius * 3.8, 0, coreRadius * 3.8, 0);
    gradient.addColorStop(0, "rgba(73, 91, 210, 0.08)");
    gradient.addColorStop(0.26, "rgba(126, 112, 238, 0.44)");
    gradient.addColorStop(0.48, "rgba(246, 244, 255, 0.9)");
    gradient.addColorStop(0.7, "rgba(154, 119, 248, 0.5)");
    gradient.addColorStop(1, "rgba(47, 35, 132, 0.07)");

    for (let index = 0; index < 9; index += 1) {
      const radius = coreRadius * (1.16 + index * 0.29);
      context.strokeStyle = gradient;
      context.globalAlpha = (0.42 - index * 0.035) * intensity;
      context.lineWidth = 0.75 + (9 - index) * 0.11;
      context.beginPath();
      context.ellipse(0, 0, radius, radius, 0, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
  };

  const drawCore = (centerX: number, centerY: number, coreRadius: number) => {
    context.save();
    const halo = context.createRadialGradient(
      centerX,
      centerY,
      coreRadius * 0.9,
      centerX,
      centerY,
      coreRadius * 3.25,
    );
    halo.addColorStop(0, "rgba(122, 94, 232, 0.22)");
    halo.addColorStop(0.26, "rgba(72, 62, 166, 0.11)");
    halo.addColorStop(0.68, "rgba(36, 38, 94, 0.04)");
    halo.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = halo;
    context.beginPath();
    context.arc(centerX, centerY, coreRadius * 3.25, 0, Math.PI * 2);
    context.fill();

    const lens = context.createRadialGradient(
      centerX - coreRadius * 0.16,
      centerY - coreRadius * 0.12,
      coreRadius * 0.08,
      centerX,
      centerY,
      coreRadius * 1.16,
    );
    lens.addColorStop(0, "rgba(0, 0, 0, 1)");
    lens.addColorStop(0.72, "rgba(0, 0, 0, 1)");
    lens.addColorStop(0.91, "rgba(5, 3, 2, 0.99)");
    lens.addColorStop(1, "rgba(38, 15, 9, 0)");
    context.fillStyle = lens;
    context.beginPath();
    context.arc(centerX, centerY, coreRadius * 1.18, 0, Math.PI * 2);
    context.fill();

    context.globalCompositeOperation = "screen";
    context.strokeStyle = "rgba(238, 236, 255, 0.36)";
    context.lineWidth = Math.max(0.7, coreRadius * 0.018);
    context.beginPath();
    context.arc(centerX, centerY, coreRadius * 1.08, Math.PI * 0.09, Math.PI * 1.91);
    context.stroke();
    context.restore();
  };

  const draw = (now: number) => {
    if (disposed) return;
    if (!reducedMotion && now - lastRenderedAt < minimumFrameDuration) {
      if (visible && documentVisible) frame = window.requestAnimationFrame(draw);
      return;
    }
    lastRenderedAt = now;
    const delta = Math.min(42, now - lastFrame);
    lastFrame = now;
    if (!reducedMotion) elapsed += delta;
    pointerX += (targetPointerX - pointerX) * 0.055;
    pointerY += (targetPointerY - pointerY) * 0.055;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    const scale = Math.min(width, height);
    const centerX = width * 0.52 + pointerX * width * 0.022;
    const centerY = height * 0.49 + pointerY * height * 0.018;
    const coreRadius = Math.max(34, scale * 0.112);

    const ambient = context.createRadialGradient(
      centerX,
      centerY,
      0,
      centerX,
      centerY,
      scale * 0.68,
    );
    ambient.addColorStop(0, "rgba(104, 78, 207, 0.09)");
    ambient.addColorStop(0.38, "rgba(46, 50, 126, 0.04)");
    ambient.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = ambient;
    context.fillRect(0, 0, width, height);

    drawStars(elapsed, centerX, centerY, scale);
    drawDiskPass(elapsed, centerX, centerY, coreRadius, false);
    drawDiskBands(centerX, centerY, coreRadius);
    drawCore(centerX, centerY, coreRadius);
    drawDiskPass(elapsed, centerX, centerY, coreRadius, true);

    if (!readyResolved) {
      readyResolved = true;
      resolveReady();
    }

    if (!reducedMotion && visible && documentVisible) {
      frame = window.requestAnimationFrame(draw);
    }
  };

  const requestDraw = () => {
    window.cancelAnimationFrame(frame);
    lastFrame = performance.now();
    frame = window.requestAnimationFrame(draw);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!interactive || reducedMotion) return;
    const rect = canvas.getBoundingClientRect();
    targetPointerX = clamp(((event.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2, -1, 1);
    targetPointerY = clamp(((event.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 2, -1, 1);
  };

  const onPointerLeave = () => {
    targetPointerX = 0;
    targetPointerY = 0;
  };

  const onVisibilityChange = () => {
    documentVisible = document.visibilityState !== "hidden";
    if (documentVisible && visible) requestDraw();
  };

  const onMotionPreference = (event: MediaQueryListEvent) => {
    reducedMotion = event.matches;
    requestDraw();
  };

  const resizeObserver = typeof ResizeObserver !== "undefined"
    ? new ResizeObserver(() => {
        resize();
        requestDraw();
      })
    : null;
  resizeObserver?.observe(canvas);

  const intersectionObserver = typeof IntersectionObserver !== "undefined"
    ? new IntersectionObserver(([entry]) => {
        visible = entry?.isIntersecting ?? true;
        if (visible && documentVisible) requestDraw();
        else window.cancelAnimationFrame(frame);
      }, { rootMargin: "120px" })
    : null;
  intersectionObserver?.observe(canvas);

  const onWindowResize = () => {
    resize();
    requestDraw();
  };

  canvas.addEventListener("pointermove", onPointerMove, { passive: true });
  canvas.addEventListener("pointerleave", onPointerLeave, { passive: true });
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("resize", onWindowResize, { passive: true });
  media.addEventListener?.("change", onMotionPreference);

  resize();
  requestDraw();

  return {
    ready,
    dispose() {
      disposed = true;
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("resize", onWindowResize);
      media.removeEventListener?.("change", onMotionPreference);
    },
  };
}
