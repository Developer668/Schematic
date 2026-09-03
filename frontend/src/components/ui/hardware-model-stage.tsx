"use client";

import {
  createElement,
  useEffect,
  useState,
  type CSSProperties,
} from "react";
import { Box, ChevronLeft, ChevronRight } from "lucide-react";
import LoadingState from "./loading-state.tsx";
import esp32ModelUrl from "../../../../LandingPage3dHardware/esp32.glb?url";
import arduinoNanoModelUrl from "../../../../LandingPage3dHardware/arduino_nano_v3_mini_usb_download_free.glb?url";
import piCameraModelUrl from "../../../../LandingPage3dHardware/camera_module.glb?url";
import pi3ModelUrl from "../../../../LandingPage3dHardware/raspberry_pi_3.glb?url";
import hc05ModelUrl from "../../../../LandingPage3dHardware/hc-05_bluetooth_module.glb?url";
import lcdModelUrl from "../../../../LandingPage3dHardware/162__lcd_display.glb?url";

const MODEL_VIEWER_SOURCE = "https://unpkg.com/@google/model-viewer@4.3.1/dist/model-viewer.min.js";

type CuratedHardwareModel = {
  id: string;
  file: string;
  name: string;
  role: string;
  orbit: string;
  fieldOfView: string;
};

const curatedModels: CuratedHardwareModel[] = [
  {
    id: "esp32",
    file: "esp32.glb",
    name: "ESP32 dev board",
    role: "Controller",
    orbit: "26deg 67deg 124%",
    fieldOfView: "27deg",
  },
  {
    id: "pi-cam",
    file: "camera_module.glb",
    name: "Pi camera module",
    role: "Vision sensor",
    orbit: "-28deg 72deg 130%",
    fieldOfView: "29deg",
  },
  {
    id: "arduino-nano",
    file: "arduino_nano_v3_mini_usb_download_free.glb",
    name: "Arduino Nano v3",
    role: "Microcontroller",
    orbit: "22deg 64deg 128%",
    fieldOfView: "27deg",
  },
  {
    id: "pi-3",
    file: "raspberry_pi_3.glb",
    name: "Raspberry Pi 3",
    role: "Single-board computer",
    orbit: "-24deg 66deg 126%",
    fieldOfView: "27deg",
  },
  {
    id: "hc-05",
    file: "hc-05_bluetooth_module.glb",
    name: "HC-05 radio",
    role: "Bluetooth module",
    orbit: "30deg 70deg 132%",
    fieldOfView: "29deg",
  },
  {
    id: "lcd-1602",
    file: "162__lcd_display.glb",
    name: "1602 character display",
    role: "Display",
    orbit: "-30deg 70deg 132%",
    fieldOfView: "29deg",
  },
];

// Shuffle once per page load so the showcase feels different on every visit.
const shuffledModels = [...curatedModels];
for (let i = shuffledModels.length - 1; i > 0; i -= 1) {
  const j = Math.floor(Math.random() * (i + 1));
  [shuffledModels[i], shuffledModels[j]] = [shuffledModels[j], shuffledModels[i]];
}

const modelUrls = new Map<string, string>([
  ["esp32.glb", esp32ModelUrl],
  ["arduino_nano_v3_mini_usb_download_free.glb", arduinoNanoModelUrl],
  ["camera_module.glb", piCameraModelUrl],
  ["raspberry_pi_3.glb", pi3ModelUrl],
  ["hc-05_bluetooth_module.glb", hc05ModelUrl],
  ["162__lcd_display.glb", lcdModelUrl],
]);
let modelViewerPromise: Promise<void> | null = null;

function ensureModelViewer() {
  if (typeof window === "undefined") return Promise.resolve();
  if (customElements.get("model-viewer")) return Promise.resolve();
  if (modelViewerPromise) return modelViewerPromise;

  modelViewerPromise = new Promise<void>((resolve, reject) => {
    const finish = () => {
      void customElements.whenDefined("model-viewer").then(() => resolve(), reject);
    };
    const existing = document.querySelector<HTMLScriptElement>("script[data-schematic-model-viewer]");
    if (existing) {
      if (customElements.get("model-viewer")) resolve();
      else {
        existing.addEventListener("load", finish, { once: true });
        existing.addEventListener("error", () => reject(new Error("The 3D viewer could not be loaded.")), { once: true });
      }
      return;
    }

    const script = document.createElement("script");
    script.type = "module";
    script.src = MODEL_VIEWER_SOURCE;
    script.dataset.schematicModelViewer = "true";
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => reject(new Error("The 3D viewer could not be loaded.")), { once: true });
    document.head.appendChild(script);
  });

  return modelViewerPromise;
}

function resolveModelUrl(file: string) {
  const url = modelUrls.get(file);
  return url
    ? Promise.resolve(url)
    : Promise.reject(new Error(`No GLB asset is configured for ${file}.`));
}

type ModelViewerElement = HTMLElement & { loaded?: boolean };

function ActualModelViewer({ model, revision }: { model: CuratedHardwareModel; revision: number }) {
  const [viewer, setViewer] = useState<ModelViewerElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setUrl(null);
    setReady(false);
    setError("");

    void Promise.all([ensureModelViewer(), resolveModelUrl(model.file)])
      .then(([, resolvedUrl]) => {
        if (active) setUrl(resolvedUrl);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "The model could not be loaded.");
      });

    return () => {
      active = false;
    };
  }, [model.file, revision]);

  useEffect(() => {
    if (!viewer || !url) return;
    const onLoad = () => setReady(true);
    const onError = () => setError(`${model.name} could not be rendered.`);
    viewer.addEventListener("load", onLoad);
    viewer.addEventListener("error", onError);
    if (viewer.loaded) setReady(true);
    return () => {
      viewer.removeEventListener("load", onLoad);
      viewer.removeEventListener("error", onError);
    };
  }, [model.name, url, viewer]);

  if (error) {
    return (
      <div className="curated-model-fallback is-error" role="status">
        <Box size={23} strokeWidth={1.25} />
        <span>{error}</span>
      </div>
    );
  }

  if (!url) {
    return (
      <div className="curated-model-fallback" aria-busy="true">
        <LoadingState label={`Loading ${model.role.toLowerCase()}`} variant="Drive" />
      </div>
    );
  }

  return createElement("model-viewer", {
    ref: setViewer,
    src: url,
    alt: model.name,
    className: `curated-hardware-model ${ready ? "is-ready" : ""}`,
    "camera-controls": "",
    "camera-orbit": model.orbit,
    "field-of-view": model.fieldOfView,
    "auto-rotate": "",
    "auto-rotate-delay": "2600",
    "rotation-per-turn": "72deg",
    "interaction-prompt": "none",
    "shadow-intensity": "0.7",
    "shadow-softness": "0.92",
    "environment-image": "neutral",
    exposure: "1.05",
    loading: "eager",
    reveal: "auto",
    style: {
      width: "100%",
      height: "100%",
      background: "transparent",
      opacity: ready ? 1 : 0,
    } as CSSProperties,
  });
}

export default function HardwareModelStage() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [revision, setRevision] = useState(0);
  const activeModel = shuffledModels[activeIndex];

  const selectModel = (index: number) => {
    setActiveIndex(index);
    setRevision(0);
  };

  const move = (direction: -1 | 1) => {
    const next = (activeIndex + direction + shuffledModels.length) % shuffledModels.length;
    selectModel(next);
  };

  return (
    <div className="curated-hardware-stage" aria-label="Interactive 3D hardware preview">
      <div className="curated-hardware-viewer" key={`${activeModel.id}-${revision}`}>
        <ActualModelViewer model={activeModel} revision={revision} />
      </div>

      <div className="curated-hardware-float" key={activeModel.id} aria-live="polite">
        <span className="curated-hardware-role">{activeModel.role}</span>
        <h2 className="curated-hardware-name">{activeModel.name}</h2>
      </div>

      <div className="curated-hardware-nav">
        <button
          type="button"
          className="curated-hardware-arrow"
          onClick={() => move(-1)}
          aria-label="Show previous hardware model"
        >
          <ChevronLeft size={14} />
        </button>
        <div className="curated-hardware-dots" role="tablist" aria-label="Choose a hardware model">
          {shuffledModels.map((model, index) => (
            <button
              key={model.id}
              type="button"
              role="tab"
              aria-selected={index === activeIndex}
              aria-label={`${model.role} — ${model.name}`}
              title={`${model.role} · ${model.name}`}
              className={index === activeIndex ? "is-active" : ""}
              onClick={() => selectModel(index)}
            />
          ))}
        </div>
        <button
          type="button"
          className="curated-hardware-arrow"
          onClick={() => move(1)}
          aria-label="Show next hardware model"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      <span className="curated-hardware-hint">
        <Box size={12} />
        Drag to spin &middot; scroll to zoom
      </span>
    </div>
  );
}
