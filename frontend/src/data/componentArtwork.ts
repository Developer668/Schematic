import type { CatalogComponent } from "./catalog.ts";

const artworkAliases: Record<string, string> = {
  "esp32-s3": "esp32-devkit-v1.svg",
  "active-buzzer": "buzzer.svg",
  esp32: "esp32-board.svg",
  "raspberry-pi-pico-w": "raspberry-pi-pico-w.svg",
  "raspberry-pi-pico": "raspberry-pi-pico.svg",
  "raspberry-pi-3": "raspberry-pi-3.svg",
  "arduino-uno-r3": "arduino-uno-board.svg",
  "arduino-uno": "arduino-uno-board.svg",
  "arduino-mega": "arduino-mega-board.svg",
  "arduino-nano": "arduino-nano-board.svg",
  neopixel: "neopixel.svg",
  "neopixel-ring": "led-ring.svg",
  "neopixel-matrix": "neopixel-matrix.svg",
  button: "pushbutton.svg",
  "push-button": "pushbutton.svg",
  joystick: "analog-joystick.svg",
  ultrasonic: "hc-sr04.svg",
  oled: "ssd1306.svg",
};

const directAssets = new Set([
  "7segment", "analog-joystick", "attiny85", "bmp280", "buzzer", "dht22", "ds1307",
  "hc-sr04", "ili9341", "lcd2004", "led", "led-blue", "led-green", "led-ring", "led-yellow",
  "mpu6050", "nano-rp2040-connect", "neopixel", "neopixel-matrix", "ntc-temperature-sensor",
  "photoresistor-sensor", "pir-motion-sensor", "potentiometer", "pushbutton", "pushbutton-6mm",
  "resistor", "rgb-led", "servo", "ssd1306",
]);

export function componentArtworkPath(definitionId: string) {
  const normalized = definitionId.toLowerCase().replace(/_/g, "-");
  const file = artworkAliases[normalized] ?? (directAssets.has(normalized) ? `${normalized}.svg` : null);
  return file ? `/component-svgs/${file}` : null;
}

export function presentationSvg(svg: string) {
  return svg
    .replace(/<rect\s+width="64"\s+height="64"[^>]*\/>/i, "")
    .replace(/<text\b[^>]*\by="(?:5[2-9]|6[0-4])"[^>]*>[\s\S]*?<\/text>/gi, "")
    .replace(/<svg\s+width="64"\s+height="64"/, '<svg viewBox="0 0 64 64" preserveAspectRatio="xMidYMid meet"');
}

export function componentArtworkHref(definition?: CatalogComponent | null) {
  if (!definition) return null;
  const path = componentArtworkPath(definition.id);
  if (path) return path;
  return definition.thumbnail ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(presentationSvg(definition.thumbnail))}` : null;
}
