# AVR8js integration status

`avr8js@0.21.0` is a technically appropriate ATmega328P/Uno simulator and is
MIT-licensed upstream. The dependency is not installed in this workspace and
was not added because package manifests and lockfiles are explicitly out of
scope. The adapter therefore uses a narrow structural module interface and
requires the real `avr8js` exports to be injected at integration time.

The adapter is complete at the tested CPU/GPIO boundary. It does not claim a
compiled simulation until an approved browser compiler returns a real Intel
HEX artifact and the caller supplies the actual `avr8js` module.
