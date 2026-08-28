#ifndef SCHEMATIC_FIRMWARE_HARNESS_H
#define SCHEMATIC_FIRMWARE_HARNESS_H

#ifdef __cplusplus
extern "C" {
#endif

typedef unsigned char fh_digital_level_t;

typedef fh_digital_level_t (*fh_read_digital_fn)(void *user_data, unsigned int pin);
typedef void (*fh_write_digital_fn)(void *user_data, unsigned int pin, fh_digital_level_t value);

typedef struct {
  void *user_data;
  fh_read_digital_fn read_digital;
  fh_write_digital_fn write_digital;
} fh_io_t;

typedef struct {
  unsigned int button_pin;
  unsigned int led_pin;
  fh_digital_level_t active_low;
} fh_button_led_config_t;

void fh_button_led_init(const fh_io_t *io, const fh_button_led_config_t *config);
void fh_button_led_step(const fh_io_t *io, const fh_button_led_config_t *config);

#ifdef __cplusplus
}
#endif

#endif
