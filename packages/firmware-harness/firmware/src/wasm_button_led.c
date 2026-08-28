#include "firmware_harness.h"

/* A small WASM-facing adapter around the same portable C contract.  The
 * browser controls inputs and reads outputs through these explicit exports;
 * the firmware logic itself remains fh_button_led_init/step. */
static fh_digital_level_t button_level = 1u;
static fh_digital_level_t led_level = 0u;
static fh_button_led_config_t config = {4u, 2u, 1u};

static fh_digital_level_t read_digital(void *user_data, unsigned int pin) {
  (void)user_data;
  return pin == config.button_pin ? button_level : (pin == config.led_pin ? led_level : 0u);
}

static void write_digital(void *user_data, unsigned int pin, fh_digital_level_t value) {
  (void)user_data;
  if (pin == config.led_pin) {
    led_level = value ? 1u : 0u;
  }
}

static const fh_io_t io = {0, read_digital, write_digital};

unsigned int wasm_button_led_abi_version(void) {
  return 2u;
}

unsigned int wasm_button_led_configure(unsigned int button_pin, unsigned int led_pin, unsigned int active_low) {
  if (button_pin == led_pin) {
    return 0u;
  }
  config.button_pin = button_pin;
  config.led_pin = led_pin;
  config.active_low = active_low ? 1u : 0u;
  return 1u;
}

void wasm_button_led_init(void) {
  button_level = 1u;
  led_level = 0u;
  fh_button_led_init(&io, &config);
}

void wasm_button_led_set_button(unsigned int level) {
  button_level = level ? 1u : 0u;
}

void wasm_button_led_step(void) {
  fh_button_led_step(&io, &config);
}

unsigned int wasm_button_led_read_led(void) {
  return led_level;
}
