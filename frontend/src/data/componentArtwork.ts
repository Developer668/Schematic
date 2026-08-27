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
  "raspberry-pi-3", "raspberry-pi-4b", "raspberry-pi-5-8gb", "raspberry-pi-pico", "raspberry-pi-pico-2", "raspberry-pi-pico-w", "raspberry-pi-zero-2w", "reg-7805", "reg-7812", "reg-7905", "reg-lm317", "relay", "relay-2ch-5v", "resistor", "resistor-1k", "resistor-1m", "resistor-10k", "resistor-100k", "resistor-2k2", "resistor-22k", "resistor-220", "resistor-330", "resistor-470", "resistor-47k", "resistor-4k7", "rgb-led", "rotary-dialer", "rc522-rfid", "servo", "sgp30-air-quality", "sh1106-oled-1-3", "signal-generator", "slide-potentiometer", "slide-switch", "small-sound-sensor", "soil-moisture-capacitive", "sound-ky038", "ssd1306", "ssd1306-i2c-4pin", "st7735-tft-1-8", "stm32-bluepill", "stepper-motor", "tcs34725-color", "teensy-4-1", "tilt-switch", "vl53l0x-tof", "ws2812b-strip-8", "zener-1n4733",
  "esp32-s2-devkit", "esp32-c6-devkit", "arduino-pro-mini", "arduino-leonardo", "stm32-nucleo-f401re", "stm32-nucleo-g071rb", "beaglebone-black", "adafruit-feather-m4", "particle-photon", "onion-omega2", "jetson-nano-devkit", "esp-01s", "hc-06-bluetooth", "adxl345-accel", "hmc5883l-magnet", "l3g4200d-gyro", "bmp388-pressure", "sht30-temp-hum", "sht40-temp-hum", "bme680-gas", "ccs811-air-quality", "mh-z19b-co2", "pms5003-dust", "tsl2561-lux", "veml7700-lux", "mlx90614-ir-temp", "max6675-thermocouple", "ina219-current", "acs712-30a", "qtr-8rc-reflectance", "tcrt5000-line", "sharp-gp2y0a-distance", "dht11-temp-hum", "ssd1351-1-5-oled", "tm1637-4digit", "max7219-8x8-matrix", "ht16k33-14seg", "ili9341-2-4-tft", "nextion-3-2-hmi", "tft-1-14-st7789", "oled-0-96-128x64-spi", "char-lcd-16x1", "e-ink-2-13-v2", "sim800l-gsm", "zigbee-cc2530", "ble-hm10", "can-mcp2515", "rs485-max485", "ethernet-w5500", "tp4056-charger", "mt3608-boost", "ams1117-3v3", "mcp23017-io-expander", "pcf8574-io-expander", "tb6612-motor-driver", "uln2003-stepper-driver", "mg996r-servo", "nema17-stepper", "solenoid-5v", "vibration-motor-1027", "mosfet-module-irl520", "ssr-40da", "buzzer-5v-active",
, "4n35-opto", "6n137-opto", "74hc165-shift-in", "74hc595-shift", "7809-reg", "7909-reg", "7seg-1-digit", "7seg-4-digit-clk", "7seg-common-anode", "a9g-gprs-gps", "acs758-50a", "ad620-inamp", "ads1115-2", "ads1220-adc", "aht10-temp-hum", "aht20-temp-hum", "air-quality-ens210-2", "am312-pir", "apds9960-gesture", "arduino-due", "arduino-giga-r1", "arduino-mkr-zero", "arduino-nano-33-ble", "arduino-nano-33-iot", "arduino-portenta-h7", "as5600-encoder-2", "as5600-magnetic-encoder", "battery-holder-18650", "battery-lipo-3s", "bh1750-2", "bh1750-lux", "bl602-wifi-ble", "bme280-2", "bme280-3", "bmp180-pressure", "bmp280-2", "bmp280-3", "bno055-imu", "bno085-imu", "boost-mt3608-2", "boost-xl6009-2", "breadboard-power-supply", "buck-mp1584", "buck-xl4015", "buzzer-active-3v", "buzzer-passive", "can-2", "capacitor-100n-2", "cd4051-mux", "cd74hc4067-mux", "char-lcd-20x4", "char-lcd-40x2", "charger-mcp73831", "charger-tp4056-2", "crystal-16mhz", "crystal-32-768k", "crystal-8mhz", "driver-a4988-2", "drv8833-motor-driver", "ds1307-2", "ds18b20-2", "ds18b20-3", "ds3231-2", "ds3231-3", "ens160-2", "ens160-voc", "epaper-1-54-v2", "epaper-2-7-tri", "epaper-4-2-tri", "epaper-7-5-v2", "esp32-c3-mini", "esp32-c5-devkit", "esp32-ethernet-kit", "esp32-pico-v3", "esp32-s3-devkitc-1", "esp32-wroom-32u", "fan-5v-30mm", "gy-273-hmc5883l", "gy-521-mpu6050", "gy-68-bmp280", "hc-12-433", "hc-sr501-pir", "hcsr04-2", "header-40pin", "header-female-40", "heater-cartridge-12v", "ht16k33-7seg-4", "ht16k33-8x8-bicolor", "htu21d-temp-hum", "hx711-2", "hx711-3", "icm20948-imu", "ili9488-3-5-tft", "ina219-2", "ina219-3", "ina226-current", "ina3221-triple", "jst-ph-2p", "jst-xh-2p", "ks0108-12864-lcd", "ky-003-hall", "ky-024-hall-linear", "l9110-motor-driver", "lcd-128x64-oled", "lcd-1602-blue", "lcd-2004-blue", "led-10mm-red", "led-matrix-8x32", "led-rgb-10mm", "led-ring-16", "led-strip-5050-30", "lilygo-t-display", "lilygo-t-watch", "lis2dh-accel", "lm317-2", "lm35-2", "lm35-temp", "lm386-audio-amp", "lm393-comparator", "logic-level-shifter-4ch", "logic-level-shifter-8ch", "lsm303-acc-mag", "lsm9ds1-imu", "ltr303-lux", "ltr390-uv", "m5stack-core2", "m5stick-c-plus", "max31855-thermo", "max7219-2", "max7219-4-digit", "mcp3008-adc", "mcp3424-adc", "mcp6002-opamp", "mfrc522-2", "micro-sd-module", "mlx90393-magnet", "mosfet-ao3400", "mosfet-irf520-module", "mpu9250-imu", "mq135-air", "mq7-co", "mq8-hydrogen", "ms5611-pressure", "ms8607-temp-press-hum", "ne555-timer", "neopixel-stick-8", "nextion-2-4-basic", "nextion-2-8-enhanced", "nextion-5-0-enhanced", "nrf52840-dk", "nrf5340-dk", "odroid-c4", "oled-1-3-sh1106-2", "oled-1-54-128x64", "oled-2", "oled-buzzer", "opamp-lm358-2", "opto-pc817-2", "osc-25mhz", "pc817-opto-2", "pca9685-2", "pcf8523-rtc", "pcf8591-2", "pcf8591-adc-dac", "peliter-tec1-12706", "pn532-nfc", "power-jack-5-5-2-1", "pump-dc-12v", "pump-peristaltic-5v", "rcwl-0516-microwave", "rcwl-1601-ultrasonic", "reg-7806", "reg-7815", "reg-7915", "relay-1ch", "relay-4ch-5v", "relay-8ch-5v", "relay-solid-5v-2ch", "resonator-4mhz", "rfm95-lora", "rock-pi-4", "rp2040-pro-micro", "rp2040-zero", "rs485-2", "rv3028-rtc", "scd30-co2", "scd40-co2", "scd41-co2", "screw-terminal-2p", "screw-terminal-3p", "sct013-30a-clamp", "sen55-env", "sensebox-mcu", "servo-9g-sg90", "servo-ds3218", "servo-jx6221", "servo-mg90s", "sgp40-voc", "sh1106-1-3-blue", "sh1107-oled", "sharp-gp2y0a02-150", "sht31-2", "sht31-temp-hum", "sht85-temp-hum", "si7021-temp-hum", "sim7600-4g", "speaker-0-5w-8ohm", "speaker-2w-4ohm", "sps30-dust", "ssd1306-0-96-blue", "ssd1306-1-3-spi-2", "ssd1306-128x32", "ssd1309-2-42-oled", "ssd1327-oled", "st7796-4-tft", "st7920-12864-lcd", "stepper-28byj-48-5v", "stepper-tb6600", "stm32-blackpill-f401", "stm32-blackpill-f411", "stm32-f411-blackpill", "teensy-3-2", "tft-1-3-st7796", "tft-1-8-st7735-2", "tft-2-0-st7789", "tft-2-8-ili9341-touch", "tft-3-5-hx8357", "tl431-shunt", "tm1637-6digit", "tm1638-8keys", "tmp36-temp", "tof10120-laser", "traic-bta16", "triac-bt136", "us-015-ultrasonic", "us-100-ultrasonic", "uv-sensor-guva-s12sd", "valve-solenoid-12v", "veml6030-lux", "veml6075-uv", "vl53l0x-2", "vl53l1x-tof", "ws2812-8x8-matrix", "ws2812b-1-led", "wz-s-gy906-mlx", "xl6009-boost", "zmpt101b-ac-voltage"]);

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
