import type { CatalogComponent } from "../data/catalog.ts";

const artworkAliases: Record<string, string> = {
  "esp32-s3": "esp32-devkit-v1.svg",
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

function componentArtworkUrl(definitionId: string) {
  const normalized = definitionId.toLowerCase().replace(/_/g, "-");
  const file = artworkAliases[normalized] ?? (directAssets.has(normalized) ? `${normalized}.svg` : null);
  return file ? `/component-svgs/${file}` : null;
}

export default function ComponentArtwork({ definition, className = "", alt }: { definition?: CatalogComponent | null; className?: string; alt?: string }) {
  if (!definition) return <div className={className} aria-hidden />;
  const src = componentArtworkUrl(definition.id);
  if (src) return <img src={src} alt={alt ?? definition.title} className={`component-artwork ${className}`} draggable={false} />;
  if (definition.thumbnail) {
    return <div role="img" aria-label={alt ?? definition.title} className={`component-artwork component-artwork-inline ${className}`} dangerouslySetInnerHTML={{ __html: definition.thumbnail }} />;
  }
  return <div className={`component-artwork component-artwork-fallback ${className}`} aria-label={alt ?? definition.title}>{definition.id.slice(0, 4).toUpperCase()}</div>;
}
