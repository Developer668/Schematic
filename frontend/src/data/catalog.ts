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

export interface CatalogProperty {
  name: string;
  type?: string;
  control?: string;
  defaultValue?: unknown;
  options?: string[];
  description?: string;
}

/** Exact, checked-in Behavior Preview binding for one catalog definition. */
export interface CatalogBehaviorBinding {
  profileId: string;
  profileVersion: number;
  variant?: string;
}

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
  tagName?: string;
  properties?: CatalogProperty[];
  defaultValues?: Record<string, unknown>;
  /** Optional by design: absent means the shared registry resolves catalog-only. */
  behavior?: CatalogBehaviorBinding;
}

type RawComponent = {
  id: string;
  name?: string;
  category?: string;
  description?: string;
  thumbnail?: string;
  tags?: string[];
  pinCount?: number;
  tagName?: string;
  properties?: CatalogProperty[];
  defaultValues?: Record<string, unknown>;
};

// Behavior support is opt-in and exact. Do not widen this map from category,
// tags, title, or fuzzy text: those heuristics are suitable for catalog
// discovery, never for granting a component executable preview behavior.
const EXPLICIT_BEHAVIOR_BINDINGS: Readonly<Record<string, CatalogBehaviorBinding>> = {
  pushbutton: { profileId: "momentary-input", profileVersion: 1 },
  led: { profileId: "digital-indicator", profileVersion: 1 },
  lcd1602: { profileId: "text-display", profileVersion: 1 },
  buzzer: { profileId: "buzzer", profileVersion: 1 },
  relay: { profileId: "relay", profileVersion: 1 },
  servo: { profileId: "rotary-actuator", profileVersion: 1 },
  "stepper-motor": { profileId: "motor", profileVersion: 1, variant: "stepper" },
  "ntc-temperature-sensor": { profileId: "numeric-sensor", profileVersion: 1, variant: "temperature" },
};

function port(id: string, domain: HardwarePort["domain"], direction: HardwarePort["direction"] = "bidirectional"): HardwarePort {
  return { id, name: id, domain, direction };
}

const POWER = [port("VCC", "power", "power"), port("GND", "ground", "power")];
const I2C = [...POWER, { ...port("SDA", "i2c"), protocol: { role: "target" as const } }, { ...port("SCL", "i2c"), protocol: { role: "target" as const } }];
const I2C_MPU6050 = [...POWER, { ...port("SDA", "i2c"), protocol: { role: "target" as const, address: 0x68 } }, { ...port("SCL", "i2c"), protocol: { role: "target" as const } }];
const I2C_BMP280 = [...POWER, { ...port("SDA", "i2c"), protocol: { role: "target" as const, address: 0x76 } }, { ...port("SCL", "i2c"), protocol: { role: "target" as const } }];
const I2C_HMC5883L = [...POWER, { ...port("SDA", "i2c"), protocol: { role: "target" as const, address: 0x1e } }, { ...port("SCL", "i2c"), protocol: { role: "target" as const } }];
const DS3231_PORTS = [...POWER, { ...port("SDA", "i2c"), protocol: { role: "target" as const, address: 0x68 } }, { ...port("SCL", "i2c"), protocol: { role: "target" as const } }];
const HC_SR04_PORTS = [...POWER, port("TRIG", "gpio", "input"), port("ECHO", "gpio", "output")];
const HX711_PORTS = [...POWER, port("DOUT", "gpio", "output"), port("SCK", "gpio", "input")];
// Some display modules label their SPI pins SCL/SDA. Preserve those physical
// names while keeping the graph domain truthful.
const SPI_DISPLAY_SCL_SDA = [...POWER, port("SCL", "spi"), port("SDA", "spi"), port("CS", "spi"), port("DC", "gpio", "input"), port("RST", "gpio", "input")];
const GPIO_IN = [...POWER, port("OUT", "gpio", "output")];
const ADC_SOURCE = [...POWER, port("OUT", "adc", "output")];
const GPIO_ACT = [...POWER, port("IN", "gpio", "input")];
const PASSIVE_2 = [port("A", "gpio", "bidirectional"), port("B", "gpio", "bidirectional")];
const PUSHBUTTON_PORTS = [port("A", "gpio", "input"), port("B", "ground", "power")];
const PASSIVE_ELECTRICAL_2 = [port("A", "power", "bidirectional"), port("B", "power", "bidirectional")];
const BATTERY_COIN_CELL_PORTS = [port("P1", "power", "power"), port("P2", "ground", "power")];

const BOARD_ESP32: HardwarePort[] = [
  port("3V3", "power", "power"),
  port("5V", "power", "power"),
  port("GND", "ground", "power"),
  { ...port("SDA", "i2c"), protocol: { role: "controller" as const } },
  { ...port("SCL", "i2c"), protocol: { role: "controller" as const } },
  port("GPIO0", "gpio"),
  port("GPIO2", "gpio"),
  port("GPIO4", "gpio"),
  port("GPIO5", "gpio"),
  port("GPIO12", "gpio"),
  port("GPIO13", "gpio"),
  port("GPIO14", "gpio"),
  port("GPIO15", "gpio"),
  port("GPIO16", "gpio"),
  port("GPIO17", "gpio"),
  port("GPIO18", "gpio"),
  port("GPIO19", "gpio"),
  port("GPIO21", "gpio"),
  port("GPIO22", "gpio"),
  port("GPIO23", "gpio"),
  port("GPIO25", "gpio"),
  port("GPIO26", "gpio"),
  port("GPIO27", "gpio"),
  port("GPIO32", "gpio"),
  port("GPIO33", "gpio"),
  // GPIO34 is input-only and ADC-capable on the ESP32; model its analog
  // capability explicitly so sensor wiring can be validated correctly.
  port("GPIO34", "adc", "input"),
  port("GPIO35", "gpio", "input"),
  port("GPIO36", "gpio", "input"),
  port("GPIO39", "gpio", "input"),
  port("TX", "uart"),
  port("RX", "uart"),
  port("SCK", "spi"),
  port("MOSI", "spi"),
  port("MISO", "spi"),
  port("CS", "spi"),
];

// ESP32-S3 does not share the classic ESP32's GPIO34–39 ADC layout. Keep each
// physical pin as one graph endpoint so firmware pin resolution and analog
// wiring cannot disagree about which pin is connected. GPIO1 is the scoped
// analog endpoint used by the demo; its description documents the ADC alias.
const BOARD_ESP32_S3: HardwarePort[] = [
  port("3V3", "power", "power"),
  port("5V", "power", "power"),
  port("GND", "ground", "power"),
  { ...port("SDA", "i2c"), protocol: { role: "controller" as const } },
  { ...port("SCL", "i2c"), protocol: { role: "controller" as const } },
  ...Array.from({ length: 22 }, (_, index) => index === 1
    ? { ...port("GPIO1", "adc", "input"), description: "ESP32-S3 ADC1 channel 0" }
    : port(`GPIO${index}`, "gpio")),
  port("TX", "uart"),
  port("RX", "uart"),
  port("SCK", "spi"),
  port("MOSI", "spi"),
  port("MISO", "spi"),
  port("CS", "spi"),
];

const BOARD_UNO: HardwarePort[] = [
  port("5V", "power", "power"),
  port("3V3", "power", "power"),
  port("GND", "ground", "power"),
  { ...port("SDA", "i2c"), protocol: { role: "controller" as const } },
  { ...port("SCL", "i2c"), protocol: { role: "controller" as const } },
  ...Array.from({ length: 14 }, (_, i) => port(`D${i}`, "gpio", i === 0 ? "input" : i === 1 ? "output" : "bidirectional")),
  ...Array.from({ length: 6 }, (_, i) => port(`A${i}`, "adc", "input")),
];

const BOARD_ARDUINO_MEGA: HardwarePort[] = [
  ...BOARD_UNO.filter((candidate) => !/^D|^A/.test(candidate.id)),
  ...Array.from({ length: 54 }, (_, i) => port(`D${i}`, "gpio")),
  ...Array.from({ length: 16 }, (_, i) => port(`A${i}`, "adc", "input")),
];

const BOARD_ARDUINO_DUE: HardwarePort[] = [
  ...BOARD_UNO.filter((candidate) => !/^D|^A/.test(candidate.id)),
  ...Array.from({ length: 54 }, (_, i) => port(`D${i}`, "gpio")),
  ...Array.from({ length: 12 }, (_, i) => port(`A${i}`, "adc", "input")),
];

const BOARD_ARDUINO_SAMD: HardwarePort[] = [
  ...POWER,
  { ...port("SDA", "i2c"), protocol: { role: "controller" as const } },
  { ...port("SCL", "i2c"), protocol: { role: "controller" as const } },
  ...Array.from({ length: 22 }, (_, i) => port(`D${i}`, "gpio")),
  ...Array.from({ length: 8 }, (_, i) => port(`A${i}`, "adc", "input")),
  port("SCK", "spi"),
  port("MOSI", "spi"),
  port("MISO", "spi"),
  port("TX", "uart"),
  port("RX", "uart"),
];

const BOARD_NRF: HardwarePort[] = [
  ...POWER,
  ...Array.from({ length: 32 }, (_, i) => port(`P0.${i}`, "gpio")),
  port("SCK", "spi"),
  port("MOSI", "spi"),
  port("MISO", "spi"),
  port("TX", "uart"),
  port("RX", "uart"),
];

const BOARD_RP2040: HardwarePort[] = [
  port("3V3", "power", "power"),
  port("VBUS", "power", "power"),
  port("GND", "ground", "power"),
  { ...port("SDA", "i2c"), protocol: { role: "controller" as const } },
  { ...port("SCL", "i2c"), protocol: { role: "controller" as const } },
  ...Array.from({ length: 30 }, (_, i) => port(`GPIO${i}`, "gpio", "bidirectional")),
  port("ADC0", "adc", "input"),
  port("ADC1", "adc", "input"),
  port("ADC2", "adc", "input"),
  port("ADC3", "adc", "input"),
];

const BOARD_STM32: HardwarePort[] = [
  ...POWER,
  { ...port("SDA", "i2c"), protocol: { role: "controller" as const } },
  { ...port("SCL", "i2c"), protocol: { role: "controller" as const } },
  ...Array.from({ length: 16 }, (_, i) => port(`PA${i}`, "gpio")),
  ...Array.from({ length: 16 }, (_, i) => port(`PB${i}`, "gpio")),
  port("PC13", "gpio"),
  port("SCK", "spi"),
  port("MOSI", "spi"),
  port("MISO", "spi"),
  port("TX", "uart"),
  port("RX", "uart"),
];

const BOARD_TEENSY: HardwarePort[] = [
  ...POWER,
  { ...port("SDA", "i2c"), protocol: { role: "controller" as const } },
  { ...port("SCL", "i2c"), protocol: { role: "controller" as const } },
  ...Array.from({ length: 42 }, (_, i) => port(`D${i}`, "gpio")),
  port("SCK", "spi"),
  port("MOSI", "spi"),
  port("MISO", "spi"),
  port("TX", "uart"),
  port("RX", "uart"),
];

const BOARD_MICROBIT: HardwarePort[] = [
  ...POWER,
  port("P0", "gpio"),
  port("P1", "gpio"),
  port("P2", "gpio"),
  port("P8", "gpio"),
  port("P12", "gpio"),
  port("P13", "gpio"),
  port("P14", "gpio"),
  port("P15", "gpio"),
  port("P16", "gpio"),
  { ...port("P19", "i2c"), protocol: { role: "controller" as const } },
  { ...port("P20", "i2c"), protocol: { role: "controller" as const } },
  port("SCK", "spi"),
  port("MOSI", "spi"),
  port("MISO", "spi"),
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
  "esp32-s3": BOARD_ESP32_S3,
  "esp32-devkit-v1": BOARD_ESP32,
  "esp32-c3-devkit": BOARD_ESP32,
  "esp8266-nodemcu": BOARD_ESP32,
  "stm32-bluepill": BOARD_STM32,
  "esp32-cam": BOARD_ESP32,
  esp32: BOARD_ESP32,
  "arduino-uno": BOARD_UNO,
  "arduino-uno-r3": BOARD_UNO,
  "arduino-nano": BOARD_UNO,
  "arduino-nano-every": BOARD_UNO,
  "arduino-mega": BOARD_ARDUINO_MEGA,
  "teensy-4-1": BOARD_TEENSY,
  "teensy-3-2": BOARD_TEENSY,
  "bbc-microbit-v2": BOARD_MICROBIT,
  "nano-rp2040-connect": BOARD_RP2040,
  "raspberry-pi-pico": BOARD_RP2040,
  "raspberry-pi-pico-w": BOARD_RP2040,
  "raspberry-pi-4b": BOARD_PI,
  "raspberry-pi-zero-2w": BOARD_PI,
  bmp280: I2C_BMP280,
  bme280: I2C_BMP280,
  mpu6050: I2C_MPU6050,
  ds1307: [...POWER, { ...port("SDA", "i2c"), protocol: { role: "target" as const, address: 0x68 } }, { ...port("SCL", "i2c"), protocol: { role: "target" as const } }],
  ds3231: DS3231_PORTS,
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
  "photoresistor-sensor": ADC_SOURCE,
  "ntc-temperature-sensor": GPIO_IN,
  "sound-ky038": [...POWER, port("AO", "adc", "output"), port("DO", "gpio", "output")],
  "soil-moisture-capacitive": [...POWER, port("AO", "adc", "output")],
  "joystick-ps2": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("VRx", "adc", "output"), port("VRy", "adc", "output"), port("SW", "gpio", "input")],
  "small-sound-sensor": [...POWER, port("OUT", "gpio", "output")],
  "big-sound-sensor": [...POWER, port("OUT", "gpio", "output")],
  photodiode: ADC_SOURCE,
  "battery-coin-cell": BATTERY_COIN_CELL_PORTS,
  "microsd-card": [...POWER, port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("CS", "spi")],
  pushbutton: PUSHBUTTON_PORTS,
  "pushbutton-6mm": PUSHBUTTON_PORTS,
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
  "stm32-nucleo-f401re": BOARD_STM32,
  "stm32-nucleo-g071rb": BOARD_STM32,
  "raspberry-pi-5-8gb": BOARD_PI,
  "raspberry-pi-pico-2": BOARD_RP2040,
  "beaglebone-black": BOARD_PI,
  "adafruit-feather-m4": BOARD_ARDUINO_SAMD,
  "particle-photon": BOARD_ARDUINO_SAMD,
  "onion-omega2": BOARD_PI,
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
  "4n35-opto": PASSIVE_2,
  "6n137-opto": PASSIVE_2,
  "74hc165-shift-in": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("IN", "gpio", "input"), port("OUT", "gpio", "output")],
  "74hc595-shift": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("IN", "gpio", "input"), port("OUT", "gpio", "output")],
  "7809-reg": [port("VIN", "power", "power"), port("GND", "ground", "power"), port("VOUT", "power", "power")],
  "7909-reg": [port("VIN", "power", "power"), port("GND", "ground", "power"), port("VOUT", "power", "power")],
  "7seg-1-digit": I2C,
  "7seg-4-digit-clk": I2C,
  "7seg-common-anode": I2C,
  "a9g-gprs-gps": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("TX", "uart", "output"), port("RX", "uart", "input")],
  "acs758-50a": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("OUT", "gpio", "output")],
  "ad620-inamp": PASSIVE_2,
  "ads1115-2": I2C,
  "ads1220-adc": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("CS", "spi"), port("DC", "gpio", "input"), port("RST", "gpio", "input")],
  "aht10-temp-hum": I2C,
  "aht20-temp-hum": I2C,
  "air-quality-ens210-2": I2C,
  "am312-pir": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("OUT", "gpio", "output")],
  "apds9960-gesture": I2C,
  "arduino-due": BOARD_ARDUINO_DUE,
  "arduino-giga-r1": BOARD_ARDUINO_SAMD,
  "arduino-mkr-zero": BOARD_ARDUINO_SAMD,
  "arduino-nano-33-ble": BOARD_ARDUINO_SAMD,
  "arduino-nano-33-iot": BOARD_ARDUINO_SAMD,
  "arduino-portenta-h7": BOARD_ARDUINO_SAMD,
  "as5600-encoder-2": I2C,
  "as5600-magnetic-encoder": I2C,
  "battery-holder-18650": [port("VIN", "power", "power"), port("GND", "ground", "power"), port("VOUT", "power", "power")],
  "battery-lipo-3s": [port("VIN", "power", "power"), port("GND", "ground", "power"), port("VOUT", "power", "power")],
  "bh1750-2": I2C,
  "bh1750-lux": I2C,
  "bl602-wifi-ble": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("TX", "uart", "output"), port("RX", "uart", "input")],
  "bme280-2": I2C_BMP280,
  "bme280-3": I2C_BMP280,
  "bmp180-pressure": I2C,
  "bmp280-2": I2C_BMP280,
  "bmp280-3": I2C_BMP280,
  "bno055-imu": I2C,
  "bno085-imu": I2C,
  "boost-mt3608-2": [port("VIN", "power", "power"), port("GND", "ground", "power"), port("VOUT", "power", "power")],
  "boost-xl6009-2": [port("VIN", "power", "power"), port("GND", "ground", "power"), port("VOUT", "power", "power")],
  "breadboard-power-supply": [port("VIN", "power", "power"), port("GND", "ground", "power"), port("3V3", "power", "power"), port("5V", "power", "power")],
  "buck-mp1584": [port("VIN", "power", "power"), port("GND", "ground", "power"), port("VOUT", "power", "power")],
  "buck-xl4015": [port("VIN", "power", "power"), port("GND", "ground", "power"), port("VOUT", "power", "power")],
  "buzzer-active-3v": PASSIVE_2,
  "buzzer-passive": PASSIVE_2,
  "can-2": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("TX", "uart", "output"), port("RX", "uart", "input")],
  "cd4051-mux": PASSIVE_2,
  "cd74hc4067-mux": PASSIVE_2,
  "char-lcd-20x4": I2C,
  "char-lcd-40x2": I2C,
  "charger-mcp73831": [port("VIN", "power", "power"), port("GND", "ground", "power"), port("VOUT", "power", "power")],
  "charger-tp4056-2": [port("VIN", "power", "power"), port("GND", "ground", "power"), port("VOUT", "power", "power")],
  "driver-a4988-2": [...POWER, port("IN1", "gpio", "input"), port("IN2", "gpio", "input")],
  "drv8833-motor-driver": [...POWER, port("IN1", "gpio", "input"), port("IN2", "gpio", "input")],
  "ds1307-2": I2C,
  "ds18b20-2": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("DATA", "gpio", "bidirectional")],
  "ds18b20-3": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("OUT", "gpio", "output")],
  "ds3231-2": DS3231_PORTS,
  "ds3231-3": DS3231_PORTS,
  "ens160-2": I2C,
  "ens160-voc": I2C,
  "epaper-1-54-v2": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("CS", "spi"), port("DC", "gpio", "input"), port("RST", "gpio", "input")],
  "epaper-2-7-tri": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("CS", "spi"), port("DC", "gpio", "input"), port("RST", "gpio", "input")],
  "epaper-4-2-tri": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("CS", "spi"), port("DC", "gpio", "input"), port("RST", "gpio", "input")],
  "epaper-7-5-v2": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("CS", "spi"), port("DC", "gpio", "input"), port("RST", "gpio", "input")],
  "esp32-c3-mini": BOARD_ESP32,
  "esp32-c5-devkit": BOARD_ESP32,
  "esp32-ethernet-kit": BOARD_ESP32,
  "esp32-pico-v3": BOARD_ESP32,
  "esp32-s3-devkitc-1": BOARD_ESP32_S3,
  "esp32-wroom-32u": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("TX", "uart", "output"), port("RX", "uart", "input")],
  "fan-5v-30mm": PASSIVE_2,
  "gy-273-hmc5883l": I2C_HMC5883L,
  "gy-521-mpu6050": I2C_MPU6050,
  "gy-68-bmp280": I2C_BMP280,
  "hc-12-433": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("TX", "uart", "output"), port("RX", "uart", "input")],
  "hc-sr501-pir": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("OUT", "gpio", "output")],
  "hcsr04-2": HC_SR04_PORTS,
  "header-40pin": Array.from({length: 12}, (_, i) => port(`P${i+1}`, "gpio")),
  "header-female-40": Array.from({length: 12}, (_, i) => port(`P${i+1}`, "gpio")),
  "heater-cartridge-12v": PASSIVE_2,
  "ht16k33-7seg-4": I2C,
  "ht16k33-8x8-bicolor": I2C,
  "htu21d-temp-hum": I2C,
  "hx711-2": HX711_PORTS,
  "hx711-3": HX711_PORTS,
  "icm20948-imu": I2C,
  "ili9488-3-5-tft": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("CS", "spi"), port("DC", "gpio", "input"), port("RST", "gpio", "input")],
  "ina219-2": I2C,
  "ina219-3": I2C,
  "ina226-current": I2C,
  "ina3221-triple": I2C,
  "ks0108-12864-lcd": I2C,
  "ky-003-hall": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("OUT", "gpio", "output")],
  "ky-024-hall-linear": I2C,
  "l9110-motor-driver": [...POWER, port("IN1", "gpio", "input"), port("IN2", "gpio", "input")],
  "lcd-128x64-oled": I2C,
  "lcd-1602-blue": I2C,
  "lcd-2004-blue": I2C,
  "led-10mm-red": PASSIVE_2,
  "led-matrix-8x32": I2C,
  "led-rgb-10mm": GPIO_ACT,
  "led-ring-16": GPIO_ACT,
  "led-strip-5050-30": GPIO_ACT,
  "lilygo-t-display": BOARD_ESP32,
  "lilygo-t-watch": BOARD_ESP32,
  "lis2dh-accel": I2C,
  "lm317-2": [port("VIN", "power", "power"), port("GND", "ground", "power"), port("VOUT", "power", "power")],
  "lm35-2": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("OUT", "adc", "output")],
  "lm35-temp": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("OUT", "adc", "output")],
  "lm386-audio-amp": PASSIVE_2,
  "lm393-comparator": PASSIVE_2,
  "logic-level-shifter-4ch": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("IN", "gpio", "input"), port("OUT", "gpio", "output")],
  "logic-level-shifter-8ch": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("IN", "gpio", "input"), port("OUT", "gpio", "output")],
  "lsm303-acc-mag": I2C,
  "lsm9ds1-imu": I2C,
  "ltr303-lux": I2C,
  "ltr390-uv": I2C,
  "m5stack-core2": BOARD_ESP32,
  "m5stick-c-plus": BOARD_ESP32,
  "max31855-thermo": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("CS", "spi")],
  "max7219-2": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("CS", "spi")],
  "max7219-4-digit": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("CS", "spi")],
  "mcp3008-adc": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("CS", "spi"), port("DC", "gpio", "input"), port("RST", "gpio", "input")],
  "mcp3424-adc": I2C,
  "mcp6002-opamp": PASSIVE_2,
  "mfrc522-2": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("CS", "spi"), port("DC", "gpio", "input"), port("RST", "gpio", "input")],
  "micro-sd-module": [...POWER, port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("CS", "spi")],
  "mlx90393-magnet": I2C,
  "mosfet-ao3400": GPIO_ACT,
  "mosfet-irf520-module": GPIO_ACT,
  "mpu9250-imu": I2C,
  "mq135-air": I2C,
  "mq7-co": I2C,
  "mq8-hydrogen": I2C,
  "ms5611-pressure": I2C,
  "ms8607-temp-press-hum": I2C,
  "ne555-timer": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("IN", "gpio", "input"), port("OUT", "gpio", "output")],
  "neopixel-stick-8": GPIO_ACT,
  "nextion-2-4-basic": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("TX", "uart", "output"), port("RX", "uart", "input")],
  "nextion-2-8-enhanced": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("TX", "uart", "output"), port("RX", "uart", "input")],
  "nextion-5-0-enhanced": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("TX", "uart", "output"), port("RX", "uart", "input")],
  "nrf52840-dk": BOARD_NRF,
  "nrf5340-dk": BOARD_NRF,
  "odroid-c4": BOARD_PI,
  "oled-1-3-sh1106-2": I2C,
  "oled-1-54-128x64": I2C,
  "oled-2": I2C,
  "oled-buzzer": PASSIVE_2,
  "opamp-lm358-2": PASSIVE_2,
  "opto-pc817-2": PASSIVE_2,
  "pc817-opto-2": PASSIVE_2,
  "pca9685-2": GPIO_ACT,
  "pcf8523-rtc": I2C,
  "pcf8591-2": I2C,
  "pcf8591-adc-dac": I2C,
  "peliter-tec1-12706": PASSIVE_2,
  "pn532-nfc": I2C,
  "power-jack-5-5-2-1": [port("VIN", "power", "power"), port("GND", "ground", "power"), port("VOUT", "power", "power")],
  "pump-dc-12v": PASSIVE_2,
  "pump-peristaltic-5v": PASSIVE_2,
  "rcwl-0516-microwave": GPIO_IN,
  "rcwl-1601-ultrasonic": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("TX", "uart", "output"), port("RX", "uart", "input")],
  "reg-7806": [port("VIN", "power", "power"), port("GND", "ground", "power"), port("VOUT", "power", "power")],
  "reg-7815": [port("VIN", "power", "power"), port("GND", "ground", "power"), port("VOUT", "power", "power")],
  "reg-7915": [port("VIN", "power", "power"), port("GND", "ground", "power"), port("VOUT", "power", "power")],
  "relay-1ch": GPIO_ACT,
  "relay-4ch-5v": GPIO_ACT,
  "relay-8ch-5v": GPIO_ACT,
  "relay-solid-5v-2ch": GPIO_ACT,
  "rfm95-lora": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("CS", "spi"), port("DC", "gpio", "input"), port("RST", "gpio", "input")],
  "rock-pi-4": BOARD_PI,
  "rp2040-pro-micro": BOARD_RP2040,
  "rp2040-zero": BOARD_RP2040,
  "rs485-2": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("TX", "uart", "output"), port("RX", "uart", "input")],
  "rv3028-rtc": I2C,
  "scd30-co2": I2C,
  "scd40-co2": I2C,
  "scd41-co2": I2C,
  "sct013-30a-clamp": GPIO_IN,
  "sen55-env": I2C,
  "sensebox-mcu": BOARD_ARDUINO_SAMD,
  "servo-9g-sg90": [...POWER, port("SIG", "pwm", "input")],
  "servo-ds3218": [...POWER, port("SIG", "pwm", "input")],
  "servo-jx6221": [...POWER, port("SIG", "pwm", "input")],
  "servo-mg90s": [...POWER, port("SIG", "pwm", "input")],
  "sgp40-voc": I2C,
  "sh1106-1-3-blue": I2C,
  "sh1107-oled": I2C,
  "sharp-gp2y0a02-150": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("OUT", "gpio", "output")],
  "sht31-2": I2C,
  "sht31-temp-hum": I2C,
  "sht85-temp-hum": I2C,
  "si7021-temp-hum": I2C,
  "sim7600-4g": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("TX", "uart", "output"), port("RX", "uart", "input")],
  "speaker-0-5w-8ohm": PASSIVE_2,
  "speaker-2w-4ohm": PASSIVE_2,
  "sps30-dust": I2C,
  "ssd1306-0-96-blue": I2C,
  "ssd1306-1-3-spi-2": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCL", "spi"), port("SDA", "spi"), port("CS", "spi"), port("DC", "gpio", "input"), port("RST", "gpio", "input")],
  "ssd1306-128x32": I2C,
  "ssd1309-2-42-oled": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("CS", "spi"), port("DC", "gpio", "input"), port("RST", "gpio", "input")],
  "ssd1327-oled": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("CS", "spi"), port("DC", "gpio", "input"), port("RST", "gpio", "input")],
  "st7796-4-tft": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("CS", "spi"), port("DC", "gpio", "input"), port("RST", "gpio", "input")],
  "st7920-12864-lcd": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("CS", "spi"), port("DC", "gpio", "input"), port("RST", "gpio", "input")],
  "stepper-28byj-48-5v": [...POWER, port("IN1", "gpio", "input"), port("IN2", "gpio", "input")],
  "stepper-tb6600": [...POWER, port("IN1", "gpio", "input"), port("IN2", "gpio", "input")],
  "stm32-blackpill-f401": BOARD_STM32,
  "stm32-blackpill-f411": BOARD_STM32,
  "stm32-f411-blackpill": BOARD_STM32,
  "tft-1-3-st7796": SPI_DISPLAY_SCL_SDA,
  "tft-1-8-st7735-2": SPI_DISPLAY_SCL_SDA,
  "tft-2-0-st7789": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("CS", "spi"), port("DC", "gpio", "input"), port("RST", "gpio", "input")],
  "tft-2-8-ili9341-touch": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("CS", "spi"), port("DC", "gpio", "input"), port("RST", "gpio", "input")],
  "tft-3-5-hx8357": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("CS", "spi"), port("DC", "gpio", "input"), port("RST", "gpio", "input")],
  "tl431-shunt": [port("VIN", "power", "power"), port("GND", "ground", "power"), port("VOUT", "power", "power")],
  "tm1637-6digit": I2C,
  "tm1638-8keys": I2C,
  "tmp36-temp": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("OUT", "adc", "output")],
  "tof10120-laser": I2C,
  "traic-bta16": GPIO_ACT,
  "triac-bt136": GPIO_ACT,
  "us-015-ultrasonic": HC_SR04_PORTS,
  "us-100-ultrasonic": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("TX", "uart", "output"), port("RX", "uart", "input")],
  "uv-sensor-guva-s12sd": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("OUT", "adc", "output")],
  "valve-solenoid-12v": PASSIVE_2,
  "veml6030-lux": I2C,
  "veml6075-uv": I2C,
  "vl53l0x-2": I2C,
  "vl53l1x-tof": I2C,
  "ws2812-8x8-matrix": I2C,
  "ws2812b-1-led": GPIO_ACT,
  "wz-s-gy906-mlx": I2C,
  "xl6009-boost": [port("VIN", "power", "power"), port("GND", "ground", "power"), port("VOUT", "power", "power")],
  "zmpt101b-ac-voltage": [port("VCC", "power", "power"), port("GND", "ground", "power"), port("OUT", "gpio", "output")],
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
  if (blob.includes("stm32")) return "ST Micro";
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

function defaultPorts(item: RawComponent): HardwarePort[] {
  const id = item.id.toLowerCase();
  const text = [item.id, item.name, item.description, ...(item.tags ?? []), item.tagName].filter(Boolean).join(" ").toLowerCase();
  if (PORTS_BY_ID[item.id]) return PORTS_BY_ID[item.id];
  if (id.startsWith("resistor") || id.startsWith("cap") || id.startsWith("ind") || id.startsWith("diode") || id.startsWith("zener")) return PASSIVE_ELECTRICAL_2;
  if (/arduino-due/.test(text)) return BOARD_ARDUINO_DUE;
  if (/(arduino-mega|mega)/.test(text)) return BOARD_ARDUINO_MEGA;
  if (/(arduino-giga|arduino-mkr|arduino-nano-33|arduino-portenta|feather-m4)/.test(text)) return BOARD_ARDUINO_SAMD;
  if (/(arduino|uno|nano|leonardo|pro-mini)/.test(text)) return BOARD_UNO;
  if (/(rp2040|pico)/.test(text)) return BOARD_RP2040;
  if (/(raspberry|beaglebone|jetson|odroid|rock pi)/.test(text)) return BOARD_PI;
  if (/stm32/.test(text) && (item.category === "boards" || item.category === "board")) return BOARD_STM32;
  if (/teensy/.test(text) && (item.category === "boards" || item.category === "board")) return BOARD_TEENSY;
  if (/microbit/.test(text) && (item.category === "boards" || item.category === "board")) return BOARD_MICROBIT;
  if (/nrf52/.test(text) && (item.category === "boards" || item.category === "board")) return BOARD_NRF;
  if (/(esp32|esp8266|nodemcu|particle|m5stack)/.test(text) && (item.category === "boards" || item.category === "board")) return BOARD_ESP32;
  if (/(i2c|i²c|sda|scl)/.test(text)) {
    const address = /(ds3231|ds1307)/.test(text) ? 0x68
      : /(ssd1306|sh1106|oled)/.test(text) ? 0x3c
        : /(bmp280|bme280)/.test(text) ? 0x76
          : /(mpu6050|mpu-6050)/.test(text) ? 0x68
            : undefined;
    return [...POWER, { ...port("SDA", "i2c"), protocol: { role: "target" as const, ...(address === undefined ? {} : { address }) } }, { ...port("SCL", "i2c"), protocol: { role: "target" as const } }];
  }
  if (/(spi|mosi|miso|sck|sclk)/.test(text)) return [...POWER, port("SCK", "spi"), port("MOSI", "spi"), port("MISO", "spi"), port("CS", "spi")];
  if (/(uart|serial|txd|rxd|\btx\b|\brx\b)/.test(text)) return [...POWER, port("TX", "uart", "output"), port("RX", "uart", "input")];
  if (/(servo|pwm)/.test(text)) return [...POWER, port("SIG", "pwm", "input")];
  if (/(analog|adc|potentiometer|thermistor|temperature|humidity|light|lux|voltage|current)/.test(text)) return [...POWER, port("OUT", "adc", "output")];
  if (/(button|switch|motion|pir|trigger|sensor|receiver)/.test(text)) return [...POWER, port("OUT", "gpio", "output")];
  if (/(led|buzzer|relay|motor|solenoid|speaker|neopixel)/.test(text)) return [...POWER, port("IN", "gpio", "input")];
  const n = Math.max(item.pinCount && item.pinCount > 0 ? item.pinCount : 2, 2);
  // Unknown parts remain placeable with an explicitly generic pin map. These
  // inferred ports grant no Behavior Preview capability by themselves.
  return Array.from({ length: Math.min(n, 12) }, (_, i) => port(`P${i + 1}`, "gpio"));
}

function fromRaw(item: RawComponent): CatalogComponent {
  const tags = item.tags ?? [];
  const title = item.name ?? item.id;
  const category = mapCategory(item.category, item.id, tags);
  const ports = defaultPorts(item);
  return {
    id: item.id,
    title,
    manufacturer: inferManufacturer(item.id, title, tags),
    category,
    description: item.description,
    ports,
    models: {},
    thumbnail: item.thumbnail,
    tags,
    tagName: item.tagName,
    properties: item.properties,
    defaultValues: item.defaultValues,
    ...(EXPLICIT_BEHAVIOR_BINDINGS[item.id] ? { behavior: EXPLICIT_BEHAVIOR_BINDINGS[item.id] } : {}),
  };
}

const loaded = (metadata.components as RawComponent[]).map(fromRaw);
// The metadata JSON is the single catalog source consumed by both the
// frontend build and the backend package. Ports are derived deterministically;
// typed preview support is granted only by the exact behavior binding above.
export const catalog: CatalogComponent[] = loaded;

/** O(1) definition lookup for graph, editor, inspector, and WebMCP operations. */
export const catalogById = new Map(catalog.map((component) => [component.id, component] as const));

export function getCatalogComponent(id: string | undefined) {
  return id ? catalogById.get(id) : undefined;
}

export const categories: CatalogCategory[] = [...new Set(catalog.map((c) => c.category))].sort();

export function searchCatalog(query: string, filters?: { category?: string; domain?: string }): CatalogComponent[] {
  const q = query.trim().toLowerCase();
  return catalog.filter((c) => {
    if (filters?.category && c.category !== filters.category) return false;
    if (filters?.domain && !c.ports.some((p) => p.domain === filters.domain)) return false;
    if (!q) return true;
    const hay = [c.id, c.title, c.tagName, c.manufacturer, c.description, ...(c.tags ?? [])].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });
}
