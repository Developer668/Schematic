#include "firmware_harness.h"
#include <stdio.h>

typedef struct {
  fh_digital_level_t button;
  fh_digital_level_t led;
} state_t;

static fh_digital_level_t read_digital(void *user_data, unsigned int pin) {
  state_t *state = (state_t *)user_data;
  return pin == 4u ? state->button : 0u;
}

static void write_digital(void *user_data, unsigned int pin, fh_digital_level_t value) {
  state_t *state = (state_t *)user_data;
  if (pin == 2u) state->led = value;
}

int main(void) {
  state_t state = {1u, 0u};
  fh_io_t io = {&state, read_digital, write_digital};
  fh_button_led_config_t config = {4u, 2u, 1u};
  fh_button_led_init(&io, &config);
  if (state.led != 0u) return 1;
  state.button = 0u;
  fh_button_led_step(&io, &config);
  if (state.led != 1u) return 2;
  state.button = 1u;
  fh_button_led_step(&io, &config);
  if (state.led != 0u) return 3;
  puts("native button-led contract: ok");
  return 0;
}
