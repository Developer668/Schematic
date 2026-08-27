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
  // resistor generic fallbacks (value-specific files now exist but keep aliases for legacy ids)
  "resistor-1k": "resistor-1k.svg",
  "resistor-10k": "resistor-10k.svg",
  // board legacy
  franzininho: "franzininho.svg",
};

const directAssets = new Set([
  "7segment", "a4988", "ads1115-adc", "analog-joystick", "arduino-mega", "arduino-mega-board", "arduino-nano", "arduino-nano-board", "arduino-nano-every", "arduino-uno", "arduino-uno-board", "attiny85",
  "battery-9v", "battery-aa", "battery-coin-cell", "bbc-microbit-v2", "biaxial-stepper", "big-sound-sensor", "bjt-2n2222", "bjt-2n3055", "bjt-2n3906", "bjt-bc547", "bjt-bc557", "bme280",
  "bmp280", "breadboard", "breadboard-mini", "buck-lm2596", "buzzer", "cap-1n", "cap-1u", "cap-10n", "cap-10p", "cap-100n", "cap-100p", "cap-22p", "cap-elec-1u", "cap-elec-10u", "cap-elec-100u", "cap-elec-1000u", "cap-elec-47u", "cap-elec-470u",
  "capacitor", "capacitor-electrolytic", "dht22", "diode", "diode-1n4007", "diode-1n4148", "diode-1n5817", "diode-1n5819", "dip-switch-8", "drv8825-stepper-driver", "ds1307", "ds18b20", "ds3231",
  "epaper-1in54-bw", "epaper-2in13-bw", "epaper-2in13-bwr", "epaper-2in9-bw", "epaper-2in9-bwr", "epaper-4in2-bw", "epaper-5in65-7c", "epaper-7in5-bw", "esp32-board", "esp32-c3-devkit", "esp32-cam", "esp32-devkit-v1", "esp8266-nodemcu",
  "flame-sensor", "flip-flop-d", "flip-flop-jk", "flip-flop-t", "franzininho", "gas-sensor", "gps-neo6m", "hc-sr04", "hc05-bluetooth", "heart-beat-sensor", "hx711",
  "ic-74hc00", "ic-74hc02", "ic-74hc04", "ic-74hc08", "ic-74hc14", "ic-74hc32", "ic-74hc86", "ili9341", "ind-100u", "ind-10m", "ind-1m", "inductor", "ir-receiver", "ir-remote", "joystick-ps2", "ks2e-m-dc5", "ky-040",
  "l298n-motor-driver", "lcd1602", "lcd1602-i2c", "lcd2004", "lcd2004-i2c", "led", "led-bar-graph", "led-blue", "led-green", "led-ring", "led-yellow", "logic-gate-and", "logic-gate-and-3", "logic-gate-and-4", "logic-gate-nand", "logic-gate-nand-3", "logic-gate-nand-4", "logic-gate-nor", "logic-gate-nor-3", "logic-gate-nor-4", "logic-gate-not", "logic-gate-or", "logic-gate-or-3", "logic-gate-or-4", "logic-gate-xnor", "logic-gate-xor", "lora-sx1278",
  "max30102-pulse-oximeter", "membrane-keypad", "microsd-card", "mosfet-2n7000", "mosfet-fqp27p06", "mosfet-irf540", "mosfet-irf9540", "motor-driver-l293d", "mpu6050", "nano-rp2040-connect", "neopixel", "neopixel-matrix", "nrf24l01-module", "ntc-temperature-sensor",
  "oled-0-91", "opamp-ideal", "opamp-lm324", "opamp-lm358", "opamp-lm741", "opamp-tl072", "opto-4n25", "opto-pc817", "pca9685-16pwm", "photodiode", "photoresistor-sensor", "pir-motion-sensor", "potentiometer", "power-supply", "pushbutton", "pushbutton-6mm",
  "raspberry-pi-3", "raspberry-pi-4b", "raspberry-pi-pico", "raspberry-pi-pico-w", "raspberry-pi-zero-2w", "reg-7805", "reg-7812", "reg-7905", "reg-lm317", "relay", "relay-2ch-5v", "resistor", "resistor-1k", "resistor-1m", "resistor-10k", "resistor-100k", "resistor-2k2", "resistor-22k", "resistor-220", "resistor-330", "resistor-470", "resistor-47k", "resistor-4k7", "rgb-led", "rotary-dialer", "rc522-rfid", "servo", "sgp30-air-quality", "sh1106-oled-1-3", "signal-generator", "slide-potentiometer", "slide-switch", "small-sound-sensor", "soil-moisture-capacitive", "sound-ky038", "ssd1306", "ssd1306-i2c-4pin", "st7735-tft-1-8", "stm32-bluepill", "stepper-motor", "tcs34725-color", "teensy-4-1", "tilt-switch", "vl53l0x-tof", "ws2812b-strip-8", "zener-1n4733",
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
