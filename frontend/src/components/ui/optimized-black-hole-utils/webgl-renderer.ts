type RendererHandle = {
  ready: Promise<void>;
  dispose: () => void;
};

type WebGLRendererOptions = {
  canvas: HTMLCanvasElement;
  intensity: number;
  interactive: boolean;
};

const VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 out_color;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_pointer;
uniform float u_intensity;

const float PI = 3.141592653589793;

mat2 rotate2d(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c);
}

float hash21(vec2 point) {
  point = fract(point * vec2(123.34, 456.21));
  point += dot(point, point + 45.32);
  return fract(point.x * point.y);
}

float value_noise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}

float fbm(vec2 point) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 transform = mat2(1.62, -1.18, 1.18, 1.62);
  for (int index = 0; index < 3; index += 1) {
    value += value_noise(point) * amplitude;
    point = transform * point;
    amplitude *= 0.5;
  }
  return value;
}

float line_streak(vec2 local, float length_value, float width_value) {
  float body = 1.0 - smoothstep(width_value, width_value * 2.4, abs(local.y));
  float ends = 1.0 - smoothstep(length_value * 0.55, length_value, abs(local.x));
  return body * ends;
}

void main() {
  vec2 resolution = max(u_resolution, vec2(1.0));
  vec2 point = (v_uv * resolution - 0.5 * resolution) / min(resolution.x, resolution.y);
  point -= vec2(0.018 + u_pointer.x * 0.012, u_pointer.y * 0.01);
  point = rotate2d(-0.13 + u_pointer.x * 0.022) * point;

  float radius = length(point);
  vec2 direction = point / max(radius, 0.0001);
  float lens_strength = 0.028 / (radius + 0.052);
  vec2 lensed_point = direction * (radius + lens_strength);

  vec3 color = vec3(0.0);
  float alpha = 0.0;

  float ambient = exp(-pow((radius - 0.24) / 0.31, 2.0));
  color += vec3(0.09, 0.075, 0.24) * ambient * 0.16;
  alpha += ambient * 0.042;

  vec2 star_grid = lensed_point * 23.0;
  vec2 star_cell = floor(star_grid);
  vec2 star_local = fract(star_grid) - 0.5;
  float star_random = hash21(star_cell);
  float star_exists = step(0.968, star_random);
  float star_angle = hash21(star_cell + 17.27) * PI;
  vec2 rotated_star = rotate2d(star_angle) * star_local;
  float streak = line_streak(rotated_star, 0.28, 0.018 + hash21(star_cell + 9.1) * 0.012);
  float twinkle = 0.92 + 0.08 * sin(u_time * 0.24 + star_random * 18.0);
  float horizon_visibility = smoothstep(0.14, 0.22, radius);
  float star = star_exists * streak * twinkle * horizon_visibility;
  vec3 star_color = mix(vec3(0.73, 0.69, 1.0), vec3(0.98, 0.97, 1.0), hash21(star_cell + 4.7));
  color += star_color * star * 0.66;
  alpha += star * 0.68;

  vec2 disk_point = rotate2d(-0.18 + u_pointer.x * 0.018) * point;
  disk_point.y /= 0.29 + abs(u_pointer.y) * 0.012;
  float disk_radius = length(disk_point);
  float disk_angle = atan(disk_point.y, disk_point.x);

  float inner_edge = smoothstep(0.185, 0.218, disk_radius);
  float outer_edge = 1.0 - smoothstep(0.56, 0.69, disk_radius);
  float disk_band = inner_edge * outer_edge;

  float spiral = sin(disk_angle * 8.0 - log(max(disk_radius, 0.001)) * 14.0 - u_time * 0.62) * 0.5 + 0.5;
  float turbulent = fbm(vec2(disk_angle * 1.6 + u_time * 0.075, disk_radius * 24.0 - u_time * 0.11));
  float filaments = smoothstep(0.16, 0.92, spiral * 0.48 + turbulent * 0.78);
  float radial_heat = 1.0 - smoothstep(0.19, 0.60, disk_radius);
  float doppler = clamp(0.62 + disk_point.x * 1.25, 0.3, 1.2);
  float front_side = smoothstep(-0.12, 0.2, disk_point.y);
  float disk_energy = disk_band * (0.25 + filaments * 1.08) * (0.76 + radial_heat * 0.88) * doppler;
  disk_energy *= mix(0.48, 1.0, front_side);

  vec3 deep_indigo = vec3(0.045, 0.035, 0.18);
  vec3 violet = vec3(0.34, 0.20, 0.88);
  vec3 white_hot = vec3(0.96, 0.95, 1.0);
  vec3 blue_white = vec3(0.31, 0.34, 0.92);
  float receding_side = smoothstep(-0.42, 0.38, disk_point.x);
  float approaching_side = smoothstep(0.04, 0.52, -disk_point.x);
  vec3 disk_color = mix(deep_indigo, violet, receding_side);
  disk_color = mix(disk_color, white_hot, clamp(radial_heat * 0.72 + filaments * 0.19, 0.0, 0.86));
  disk_color = mix(disk_color, blue_white, approaching_side * radial_heat * 0.42);
  color += disk_color * disk_energy * 1.02;
  alpha += disk_energy * 0.72;

  vec2 arc_point = vec2(point.x, point.y * 1.72);
  float arc_radius = length(arc_point);
  float lens_arc = exp(-abs(arc_radius - 0.202) * 102.0);
  float arc_break = smoothstep(-0.54, -0.02, point.y) * (1.0 - smoothstep(0.28, 0.62, point.y));
  float lower_arc = lens_arc * (0.28 + 0.72 * arc_break);
  vec3 lens_color = mix(white_hot, blue_white, smoothstep(0.06, 0.44, -point.x) * 0.42);
  color += lens_color * lower_arc * 0.44;
  alpha += lower_arc * 0.34;

  float photon_ring = exp(-abs(radius - 0.165) * 152.0);
  float ring_variation = 0.68 + 0.32 * sin(atan(point.y, point.x) * 5.0 - u_time * 0.18);
  color += vec3(0.91, 0.90, 1.0) * photon_ring * ring_variation * 0.6;
  alpha += photon_ring * ring_variation * 0.48;

  float core = 1.0 - smoothstep(0.145, 0.177, radius);
  color = mix(color, vec3(0.0), core);
  alpha = max(alpha, core * 0.99);

  float outer_fade = 1.0 - smoothstep(0.82, 1.04, radius);
  color *= u_intensity * outer_fade;
  alpha = clamp(alpha * outer_fade * u_intensity, 0.0, 1.0);

  color = color / (color + vec3(1.0));
  color = pow(color, vec3(0.82));
  out_color = vec4(color * alpha, alpha);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("[Schematic black hole] Shader compilation failed", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("[Schematic black hole] Program link failed", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

export function createWebGLRenderer({
  canvas,
  intensity,
  interactive,
}: WebGLRendererOptions): RendererHandle | null {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
  if (!gl) return null;

  const program = createProgram(gl);
  if (!program) return null;

  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  if (!vao || !buffer) {
    if (vao) gl.deleteVertexArray(vao);
    if (buffer) gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    return null;
  }

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  const resolutionUniform = gl.getUniformLocation(program, "u_resolution");
  const timeUniform = gl.getUniformLocation(program, "u_time");
  const pointerUniform = gl.getUniformLocation(program, "u_pointer");
  const intensityUniform = gl.getUniformLocation(program, "u_intensity");

  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  const targetFrameDuration = 1000 / 30;
  let reducedMotion = media.matches;
  let disposed = false;
  let visible = true;
  let documentVisible = document.visibilityState !== "hidden";
  let frame = 0;
  let startTime = performance.now();
  let lastRenderedAt = 0;
  let width = 1;
  let height = 1;
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
    const dpr = Math.min(1.25, Math.max(1, window.devicePixelRatio || 1));
    width = Math.max(1, Math.round(rect.width * dpr));
    height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
  };

  const render = (now: number) => {
    if (disposed) return;
    if (!reducedMotion && now - lastRenderedAt < targetFrameDuration) {
      if (visible && documentVisible) frame = window.requestAnimationFrame(render);
      return;
    }
    lastRenderedAt = now;
    pointerX += (targetPointerX - pointerX) * 0.055;
    pointerY += (targetPointerY - pointerY) * 0.055;

    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(resolutionUniform, width, height);
    gl.uniform1f(timeUniform, reducedMotion ? 0 : (now - startTime) / 1000);
    gl.uniform2f(pointerUniform, pointerX, pointerY);
    gl.uniform1f(intensityUniform, Math.max(0.2, Math.min(1.5, intensity)));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    if (!readyResolved) {
      const firstFrameError = gl.getError();
      if (firstFrameError === gl.NO_ERROR) {
        readyResolved = true;
        resolveReady();
      } else {
        console.warn("[Schematic black hole] First frame failed", firstFrameError);
        disposed = true;
        return;
      }
    }

    if (!reducedMotion && visible && documentVisible) {
      frame = window.requestAnimationFrame(render);
    }
  };

  const requestRender = () => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(render);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!interactive || reducedMotion) return;
    const rect = canvas.getBoundingClientRect();
    const padding = Math.max(rect.width, rect.height) * 0.18;
    const within = event.clientX >= rect.left - padding
      && event.clientX <= rect.right + padding
      && event.clientY >= rect.top - padding
      && event.clientY <= rect.bottom + padding;
    if (!within) {
      targetPointerX = 0;
      targetPointerY = 0;
      return;
    }
    targetPointerX = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2));
    targetPointerY = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 2));
  };

  const onVisibilityChange = () => {
    documentVisible = document.visibilityState !== "hidden";
    if (documentVisible && visible) requestRender();
    else window.cancelAnimationFrame(frame);
  };

  const onMotionPreference = (event: MediaQueryListEvent) => {
    reducedMotion = event.matches;
    startTime = performance.now();
    requestRender();
  };

  const onWindowResize = () => {
    resize();
    requestRender();
  };

  const onContextLost = (event: Event) => {
    event.preventDefault();
    window.cancelAnimationFrame(frame);
  };

  const resizeObserver = typeof ResizeObserver !== "undefined"
    ? new ResizeObserver(() => {
        resize();
        requestRender();
      })
    : null;
  resizeObserver?.observe(canvas);

  const intersectionObserver = typeof IntersectionObserver !== "undefined"
    ? new IntersectionObserver(([entry]) => {
        visible = entry?.isIntersecting ?? true;
        if (visible && documentVisible) requestRender();
        else window.cancelAnimationFrame(frame);
      }, { rootMargin: "140px" })
    : null;
  intersectionObserver?.observe(canvas);

  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("resize", onWindowResize, { passive: true });
  document.addEventListener("visibilitychange", onVisibilityChange);
  canvas.addEventListener("webglcontextlost", onContextLost);
  media.addEventListener?.("change", onMotionPreference);

  resize();
  requestRender();

  return {
    ready,
    dispose() {
      disposed = true;
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", onWindowResize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      media.removeEventListener?.("change", onMotionPreference);
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    },
  };
}
