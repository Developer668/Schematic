import type { HardwarePort } from "@schematic/hardware-graph";
import metadata from "../../public/components-metadata.json";

export type CatalogCategory =
  | "board"
  | "sensor"
  | "actuator"
  | "display"
  | "power"
  | "logic"
  | "communication"
  | "mechanical"
  | "rf"
  | "custom"
  | "analog"
  | "passive";

export interface CatalogComponent {
  id: string;
  title: string;
  manufacturer?: string;
  partNumber?: string;
  category: CatalogCategory;
  description?: string;
  ports: HardwarePort[];
  models: Record<string, { engine: string; file: string; fidelity: string; verified: boolean }>;
  thumbnail?: string;
  tags?: string[];
}

type RawComponent = {
  id: string;
  name?: string;
  category?: string;
  description?: string;
  thumbnail?: string;
  tags?: string[];
  pinCount?: number;
};

function port(id: string, domain: HardwarePort["domain"], direction: HardwarePort["direction"] = "bidirectional"): HardwarePort {
  return { id, name: id, domain, direction };
}

const POWER = [port("VCC", "power", "power"), port("GND", "ground", "power")];
const I2C = [...POWER, port("SDA", "i2c"), port("SCL", "i2c")];
const GPIO_IN = [...POWER, port("OUT", "gpio", "output")];
const GPIO_ACT = [...POWER, port("IN", "gpio", "input")];
const PASSIVE_2 = [port("A", "gpio", "bidirectional"), port("B", "gpio", "bidirectional")];

const BOARD_ESP32: HardwarePort[] = [
  port("3V3", "power", "power"),
  port("5V", "power", "power"),
  port("GND", "ground", "power"),
  port("SDA", "i2c"),
  port("SCL", "i2c"),
  port("GPIO2", "gpio"),
  port("GPIO13", "gpio"),
  port("GPIO18", "gpio"),
  port("GPIO19", "gpio"),
  port("GPIO21", "gpio"),
  port("GPIO22", "gpio"),
  port("TX", "uart"),
  port("RX", "uart"),
];

const BOARD_UNO: HardwarePort[] = [
  port("5V", "power", "power"),
  port("3V3", "power", "power"),
  port("GND", "ground", "power"),
  port("SDA", "i2c"),
  port("SCL", "i2c"),
  port("D13", "gpio"),
  port("A0", "adc", "input"),
];

const BOARD_PI: HardwarePort[] = [
  port("3V3", "power", "power"),
  port("5V", "power", "power"),
  port("GND", "ground", "power"),
  port("SDA", "i2c"),
  port("SCL", "i2c"),
  port("GPIO2", "gpio"),
  port("GPIO3", "gpio"),
  port("GPIO4", "gpio"),
  port("GPIO17", "gpio"),
  port("GPIO27", "gpio"),
  port("GPIO22", "gpio"),
  port("MISO", "spi"),
  port("MOSI", "spi"),
  port("SCLK", "spi"),
  port("CE0", "spi"),
  port("TX", "uart"),
  port("RX", "uart"),
];

const PORTS_BY_ID: Record<string, HardwarePort[]> = {
  "esp32-s3": BOARD_ESP32,
  "esp32-devkit-v1": BOARD_ESP32,
  "esp32-c3-devkit": BOARD_ESP32,
  "esp8266-nodemcu": BOARD_ESP32,
  "stm32-bluepill": BOARD_ESP32,
  "esp32-cam": BOARD_ESP32,
  esp32: BOARD_ESP32,
  "arduino-uno": BOARD_UNO,
  "arduino-uno-r3": BOARD_UNO,
  "arduino-nano": BOARD_UNO,
  "arduino-nano-every": BOARD_UNO,
  "arduino-mega": BOARD_UNO,
  "teensy-4-1": BOARD_ESP32,
  "bbc-microbit-v2": BOARD_ESP32,
  "nano-rp2040-connect": BOARD_ESP32,
  "raspberry-pi-pico": BOARD_ESP32,
  "raspberry-pi-pico-w": BOARD_ESP32,
  "raspberry-pi-4b": BOARD_PI,
  "raspberry-pi-zero-2w": BOARD_PI,
  bmp280: I2C,
  bme280: I2C,
  mpu6050: I2C,
  ds1307: I2C,
  ds3231: I2C,
  ssd1306: I2C,
  "sh1106-oled-1-3": I2C,
  "oled-0-91": I2C,
  "ssd1306-i2c-4pin": I2C,
  "lcd1602-i2c": I2C,
  "lcd2004-i2c": I2C,
  "sgp30-air-quality": I2C,
  "tcs34725-color": I2C,
  "max30102-pulse-oximeter": I2C,
  "ads1115-adc": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SDA", "i2c"), port("SCL", "i2c"), port("A0", "adc", "input"), port("A1", "adc", "input"), port("A2", "adc", "input"), port("A3", "adc", "input")],
  "vl53l0x-tof": I2C,
  "pca9685-16pwm": I2C,
  buzzer: GPIO_ACT,
  "active-buzzer": GPIO_ACT,
  led: GPIO_ACT,
  "rgb-led": [...POWER, port("R", "gpio", "input"), port("G", "gpio", "input"), port("B", "gpio", "input")],
  "ws2812b-strip-8": [...POWER, port("DIN", "gpio", "input")],
  servo: [...POWER, port("SIG", "pwm", "input")],
  "l298n-motor-driver": [...POWER, port("IN1", "gpio", "input"), port("IN2", "gpio", "input"), port("IN3", "gpio", "input"), port("IN4", "gpio", "input"), port("ENA", "pwm", "input"), port("ENB", "pwm", "input")],
  "relay-2ch-5v": [...POWER, port("IN1", "gpio", "input"), port("IN2", "gpio", "input")],
  "drv8825-stepper-driver": [...POWER, port("STEP", "gpio", "input"), port("DIR", "gpio", "input"), port("ENABLE", "gpio", "input"), port("M0", "gpio", "input"), port("M1", "gpio", "input"), port("M2", "gpio", "input")],
  "buck-lm2596": [port("VIN", "power", "power"), port("GND", "ground", "power"), port("VOUT", "power", "power"), port("GND2", "ground", "power")],
  dht22: GPIO_IN,
  ds18b20: [port("VCC", "power", "power"), port("GND", "ground", "power"), port("DQ", "gpio", "bidirectional")],
  "hc-sr04": [...POWER, port("TRIG", "gpio", "input"), port("ECHO", "gpio", "output")],
  "pir-motion-sensor": GPIO_IN,
  "photoresistor-sensor": GPIO_IN,
  "ntc-temperature-sensor": GPIO_IN,
  "sound-ky038": [...POWER, port("AO", "adc", "output"), port("DO", "gpio", "output")],
  "soil-moisture-capacitive": [...POWER, port("AO", "adc", "output")],
  "joystick-ps2": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("VRx", "adc", "output"), port("VRy", "adc", "output"), port("SW", "gpio", "input")],
  pushbutton: PASSIVE_2,
  "pushbutton-6mm": PASSIVE_2,
  resistor: PASSIVE_2,
  potentiometer: [port("VCC", "power", "power"), port("GND", "ground", "power"), port("OUT", "adc", "output")],
  "nrf24l01-module": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("CE", "gpio", "input"), port("CSN", "spi"), port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("IRQ", "gpio", "output")],
  "hc05-bluetooth": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("TXD", "uart", "output"), port("RXD", "uart", "input"), port("EN", "gpio", "input"), port("STATE", "gpio", "output")],
  "rc522-rfid": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("SDA", "spi"), port("RST", "gpio", "input")],
  "lora-sx1278": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("NSS", "spi"), port("DIO0", "gpio", "output"), port("RST", "gpio", "input")],
  "st7735-tft-1-8": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCL", "spi"), port("SDA", "spi"), port("CS", "spi"), port("DC", "gpio", "input"), port("RST", "gpio", "input")],
  // ── 65 new high-value parts ──
  "esp32-s2-devkit": BOARD_ESP32,
  "esp32-c6-devkit": BOARD_ESP32,
  "arduino-pro-mini": BOARD_UNO,
  "arduino-leonardo": BOARD_UNO,
  "stm32-nucleo-f401re": BOARD_ESP32,
  "stm32-nucleo-g071rb": BOARD_ESP32,
  "raspberry-pi-5-8gb": BOARD_PI,
  "raspberry-pi-pico-2": BOARD_ESP32,
  "beaglebone-black": BOARD_PI,
  "adafruit-feather-m4": BOARD_ESP32,
  "particle-photon": BOARD_ESP32,
  "onion-omega2": BOARD_ESP32,
  "jetson-nano-devkit": BOARD_PI,
  "esp-01s": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("TX", "uart", "output"), port("RX", "uart", "input"), port("CH_PD", "gpio", "input"), port("GPIO0", "gpio"), port("GPIO2", "gpio"), port("RST", "gpio", "input")],
  "hc-06-bluetooth": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("TXD", "uart", "output"), port("RXD", "uart", "input")],
  "adxl345-accel": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SDA", "i2c"), port("SCL", "i2c"), port("SDO", "spi"), port("CS", "spi"), port("INT1", "gpio", "output"), port("INT2", "gpio", "output")],
  "hmc5883l-magnet": I2C,
  "l3g4200d-gyro": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SDA", "i2c"), port("SCL", "i2c"), port("SDO", "spi"), port("CS", "spi"), port("INT1", "gpio", "output"), port("DRDY", "gpio", "output")],
  "bmp388-pressure": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SDA", "i2c"), port("SCL", "i2c"), port("SDO", "spi"), port("CS", "spi")],
  "sht30-temp-hum": I2C,
  "sht40-temp-hum": I2C,
  "bme680-gas": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SDA", "i2c"), port("SCL", "i2c"), port("SDO", "spi"), port("CS", "spi")],
  "ccs811-air-quality": I2C,
  "mh-z19b-co2": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("TX", "uart", "output"), port("RX", "uart", "input"), port("HD", "gpio", "input"), port("PWM", "pwm", "output")],
  "pms5003-dust": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("TX", "uart", "output"), port("RX", "uart", "input"), port("SET", "gpio", "input"), port("RESET", "gpio", "input")],
  "tsl2561-lux": I2C,
  "veml7700-lux": I2C,
  "mlx90614-ir-temp": I2C,
  "max6675-thermocouple": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("CS", "spi"), port("SO", "spi")],
  "ina219-current": I2C,
  "acs712-30a": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("OUT", "adc", "output")],
  "qtr-8rc-reflectance": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("OUT1", "adc", "output"), port("OUT2", "adc", "output"), port("OUT3", "adc", "output"), port("OUT4", "adc", "output"), port("OUT5", "adc", "output"), port("OUT6", "adc", "output"), port("OUT7", "adc", "output"), port("OUT8", "adc", "output")],
  "tcrt5000-line": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("OUT", "adc", "output")],
  "sharp-gp2y0a-distance": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("OUT", "adc", "output")],
  "dht11-temp-hum": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("DATA", "gpio", "bidirectional")],
  "ssd1351-1-5-oled": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCL", "spi"), port("SDA", "spi"), port("CS", "spi"), port("DC", "gpio", "input"), port("RST", "gpio", "input")],
  "tm1637-4digit": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("CLK", "gpio", "input"), port("DIO", "gpio", "bidirectional")],
  "max7219-8x8-matrix": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("DIN", "spi"), port("CS", "spi"), port("CLK", "spi")],
  "ht16k33-14seg": I2C,
  "ili9341-2-4-tft": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCL", "spi"), port("SDA", "spi"), port("CS", "spi"), port("DC", "gpio", "input"), port("RST", "gpio", "input"), port("TOUCH_CS", "spi")],
  "nextion-3-2-hmi": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("TX", "uart", "output"), port("RX", "uart", "input")],
  "tft-1-14-st7789": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCL", "spi"), port("SDA", "spi"), port("CS", "spi"), port("DC", "gpio", "input"), port("RST", "gpio", "input")],
  "oled-0-96-128x64-spi": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCL", "spi"), port("SDA", "spi"), port("CS", "spi"), port("DC", "gpio", "input"), port("RST", "gpio", "input")],
  "char-lcd-16x1": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("RS", "gpio", "input"), port("EN", "gpio", "input"), port("D4", "gpio", "input"), port("D5", "gpio", "input"), port("D6", "gpio", "input"), port("D7", "gpio", "input")],
  "e-ink-2-13-v2": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("MOSI", "spi"), port("CS", "spi"), port("DC", "gpio", "input"), port("RST", "gpio", "input"), port("BUSY", "gpio", "output")],
  "sim800l-gsm": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("TX", "uart", "output"), port("RX", "uart", "input"), port("RST", "gpio", "input"), port("RI", "gpio", "output")],
  "zigbee-cc2530": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("TX", "uart", "output"), port("RX", "uart", "input"), port("RST", "gpio", "input"), port("P0_1", "gpio")],
  "ble-hm10": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("TX", "uart", "output"), port("RX", "uart", "input")],
  "can-mcp2515": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("CS", "spi"), port("INT", "gpio", "output")],
  "rs485-max485": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("RO", "uart", "output"), port("DI", "uart", "input"), port("DE", "gpio", "input"), port("RE", "gpio", "input")],
  "ethernet-w5500": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("CS", "spi"), port("INT", "gpio", "output"), port("RST", "gpio", "input")],
  "tp4056-charger": [port("IN+", "power", "power"), port("IN-", "ground", "power"), port("BAT+", "power", "power"), port("BAT-", "ground", "power")],
  "mt3608-boost": [port("VIN", "power", "power"), port("GND", "ground", "power"), port("VOUT", "power", "power"), port("GND2", "ground", "power")],
  "ams1117-3v3": [port("VIN", "power", "power"), port("GND", "ground", "power"), port("VOUT", "power", "power")],
  "mcp23017-io-expander": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SDA", "i2c"), port("SCL", "i2c"), port("A0", "gpio", "input"), port("A1", "gpio", "input"), port("A2", "gpio", "input"), port("INTA", "gpio", "output")],
  "pcf8574-io-expander": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SDA", "i2c"), port("SCL", "i2c"), port("A0", "gpio", "input"), port("A1", "gpio", "input")],
  "tb6612-motor-driver": [port("VM", "power", "power"), port("VCC", "power", "power"), port("GND", "ground", "power"), port("AIN1", "gpio", "input"), port("AIN2", "gpio", "input"), port("PWMA", "pwm", "input"), port("BIN1", "gpio", "input"), port("BIN2", "gpio", "input")],
  "uln2003-stepper-driver": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("IN1", "gpio", "input"), port("IN2", "gpio", "input"), port("IN3", "gpio", "input"), port("IN4", "gpio", "input"), port("COM", "power", "power")],
  "mg996r-servo": [...POWER, port("SIG", "pwm", "input")],
  "nema17-stepper": [port("A+", "gpio", "bidirectional"), port("A-", "gpio", "bidirectional"), port("B+", "gpio", "bidirectional"), port("B-", "gpio", "bidirectional")],
  "solenoid-5v": PASSIVE_2,
  "vibration-motor-1027": PASSIVE_2,
  "mosfet-module-irl520": [...POWER, port("SIG", "gpio", "input")],
  "ssr-40da": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("CH1", "gpio", "input"), port("CH2", "gpio", "input")],
  "buzzer-5v-active": PASSIVE_2,
};

function mapCategory(raw: string | undefined, id: string, tags: string[]): CatalogCategory {
  const c = (raw ?? "").toLowerCase();
  if (c === "boards" || c === "board") return "board";
  if (c === "sensors" || c === "sensor") return "sensor";
  if (c === "displays" || c === "display") return "display";
  if (c === "actuators" || c === "actuator") return "actuator";
  if (c === "communication") return "communication";
  if (c === "power") return "power";
  if (c === "logic") return "logic";
  if (c === "analog") return "analog";
  if (c === "mechanical") return "mechanical";
  if (c === "rf") return "rf";
  if (c.includes("passiv") || id.startsWith("resistor") || id.startsWith("cap") || id.startsWith("ind")) return "passive";
  if (tags.some((t) => /sensor|bmp|dht|mpu|pir|gps|soil|color|vl53|sgp|max30102|bme/.test(t))) return "sensor";
  if (tags.some((t) => /arduino|esp32|esp8266|stm32|teensy|microbit|pico|board|raspberry|jetson/.test(t))) return "board";
  if (tags.some((t) => /oled|lcd|epaper|display|tft|sh1106|st7735/.test(t))) return "display";
  if (tags.some((t) => /servo|motor|buzzer|relay|pca9685|ws2812|actuator|driver|buck/.test(t))) return "actuator";
  if (tags.some((t) => /nrf|hc05|rc522|lora|rf|bluetooth|wireless|communication|uart|spi/.test(t))) return "communication";
  return "custom";
}

function inferManufacturer(id: string, title: string, tags: string[]): string | undefined {
  const blob = `${id} ${title} ${tags.join(" ")}`.toLowerCase();
  if (blob.includes("arduino")) return "Arduino";
  if (blob.includes("esp32") || blob.includes("espressif") || blob.includes("esp8266") || blob.includes("nodemcu")) return "Espressif";
  if (blob.includes("raspberry") || blob.includes("pico")) return "Raspberry Pi";
  if (blob.includes("stm32") || blob.includes("st ")) return "ST Micro";
  if (blob.includes("teensy")) return "PJRC";
  if (blob.includes("microbit") || blob.includes("bbc")) return "BBC";
  if (blob.includes("bosch") || blob.includes("bmp280") || blob.includes("bme280")) return "Bosch";
  if (blob.includes("ti ") || blob.includes("drv") || blob.includes("ads1115") || blob.includes("pca9685")) return "Texas Instruments";
  if (blob.includes("nordic") || blob.includes("nrf")) return "Nordic Semi";
  if (blob.includes("maxim") || blob.includes("max30102")) return "Maxim";
  if (blob.includes("sensirion") || blob.includes("sgp30")) return "Sensirion";
  if (blob.includes("ams") || blob.includes("tcs34725")) return "AMS";
  if (blob.includes("bosch")) return "Bosch";
  return undefined;
}

function defaultPorts(id: string, pinCount: number | undefined): HardwarePort[] {
  if (PORTS_BY_ID[id]) return PORTS_BY_ID[id];
  if (id.startsWith("resistor") || id.startsWith("cap") || id.startsWith("ind") || id.startsWith("diode") || id.startsWith("zener")) return PASSIVE_2;
  const n = Math.max(pinCount && pinCount > 0 ? pinCount : 2, 2);
  return Array.from({ length: Math.min(n, 12) }, (_, i) => port(`P${i + 1}`, "gpio"));
}

function fromRaw(item: RawComponent): CatalogComponent {
  const tags = item.tags ?? [];
  return {
    id: item.id,
    title: item.name ?? item.id,
    manufacturer: inferManufacturer(item.id, item.name ?? item.id, tags),
    category: mapCategory(item.category, item.id, tags),
    description: item.description,
    ports: defaultPorts(item.id, item.pinCount),
    models: {},
    thumbnail: item.thumbnail,
    tags,
  };
}

const extras: CatalogComponent[] = [
  {
    id: "esp32-s3",
    title: "ESP32-S3",
    manufacturer: "Espressif",
    category: "board",
    description: "ESP32-S3 Wi-Fi + BLE MCU board",
    ports: BOARD_ESP32,
    models: { wasmtime: { engine: "wasmtime", file: "esp32.wasm", fidelity: "wasm_behavioral", verified: false } },
    tags: ["esp32", "board", "wifi"],
  },
  {
    id: "arduino-uno-r3",
    title: "Arduino Uno R3",
    manufacturer: "Arduino",
    category: "board",
    description: "ATmega328P Arduino Uno R3",
    ports: BOARD_UNO,
    models: {},
    tags: ["arduino", "uno"],
  },
  {
    id: "raspberry-pi-pico-w",
    title: "Raspberry Pi Pico W",
    manufacturer: "Raspberry Pi",
    category: "board",
    description: "RP2040 + CYW43439 Wi-Fi",
    ports: BOARD_ESP32,
    models: {},
    tags: ["pico", "rp2040"],
  },
  {
    id: "active-buzzer",
    title: "Active buzzer",
    category: "actuator",
    description: "Active piezo buzzer",
    ports: GPIO_ACT,
    models: {},
    tags: ["buzzer", "actuator"],
  },
];

const loaded = (metadata.components as RawComponent[]).map(fromRaw);
const seen = new Set(loaded.map((c) => c.id));
export const catalog: CatalogComponent[] = [...loaded, ...extras.filter((c) => !seen.has(c.id))];

export const categories: CatalogCategory[] = [...new Set(catalog.map((c) => c.category))].sort();

export function searchCatalog(query: string, filters?: { category?: string; domain?: string }): CatalogComponent[] {
  const q = query.trim().toLowerCase();
  return catalog.filter((c) => {
    if (filters?.category && c.category !== filters.category) return false;
    if (filters?.domain && !c.ports.some((p) => p.domain === filters.domain)) return false;
    if (!q) return true;
    const hay = [c.id, c.title, c.manufacturer, c.description, ...(c.tags ?? [])].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });
}
