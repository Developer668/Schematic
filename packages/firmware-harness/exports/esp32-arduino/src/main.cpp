#include <Arduino.h>
#include "firmware_harness.h"

// Board adapter for the shared portable C button-led core. The browser path
// executes the same core through the verified C/WASM adapter; this target
// executes the same C ABI implementation on the ESP32 board.
constexpr uint8_t BUTTON_PIN = 4;
constexpr uint8_t LED_PIN = 2;

static fh_digital_level_t read_digital(void *, unsigned int pin) {
  return digitalRead(pin) == HIGH ? 1u : 0u;
}

static void write_digital(void *, unsigned int pin, fh_digital_level_t value) {
  digitalWrite(pin, value ? HIGH : LOW);
}

static fh_io_t io = { nullptr, read_digital, write_digital };
static fh_button_led_config_t config = { BUTTON_PIN, LED_PIN, 1u };

void setup() {
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  fh_button_led_init(&io, &config);
}

void loop() {
  fh_button_led_step(&io, &config);
  delay(1);
}
