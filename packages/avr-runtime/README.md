# AVR8js runtime boundary

This package owns the small, dependency-injected Uno/Nano GPIO bridge around
`avr8js`. It does not bundle `avr8js` and does not claim that an artifact was
compiled. A reviewed `avr8js` module is supplied by the caller so the package
can be tested without changing the workspace manifests.

The adapter accepts the exact Intel HEX text and integrity bytes returned by a
browser compiler, verifies the SHA-256 digest, translates the HEX records into
the ATmega328P program-word layout, and then exposes Arduino pin numbers:

- D0–D7 → PORTD bits 0–7
- D8–D13 → PORTB bits 0–5
- A0–A5/D14–D19 → PORTC bits 0–5

The current boundary intentionally wires CPU/GPIO only. Timers, USART, SPI,
TWI, ADC, EEPROM, and Arduino library behavior remain separate adapter work;
the existing vendor simulator is not modified by this track.
