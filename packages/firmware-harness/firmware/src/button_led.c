#include "firmware_harness.h"

static void write_led(const fh_io_t *io, const fh_button_led_config_t *config, fh_digital_level_t value) {
  if (io != 0 && config != 0 && io->write_digital != 0) {
    io->write_digital(io->user_data, config->led_pin, value ? 1u : 0u);
  }
}

void fh_button_led_init(const fh_io_t *io, const fh_button_led_config_t *config) {
  write_led(io, config, 0u);
}

void fh_button_led_step(const fh_io_t *io, const fh_button_led_config_t *config) {
  fh_digital_level_t button;
  fh_digital_level_t pressed;
  if (io == 0 || config == 0 || io->read_digital == 0) {
    return;
  }
  button = io->read_digital(io->user_data, config->button_pin) ? 1u : 0u;
  pressed = config->active_low ? (button == 0u) : (button == 1u);
  write_led(io, config, pressed);
}
