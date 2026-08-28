# Browser AVR toolchain feasibility

Status: **technically feasible, not release-approved** (2026-08-28)

This package deliberately does not vendor compiler binaries, generated Arduino
objects, or a static asset manifest. The current repository has no approved
toolchain provenance and no package dependency for a browser compiler. Adding a
binary before that review would make it too easy to imply that Schematic can
compile firmware when the release has not accepted the toolchain's license and
reproducibility obligations.

## Candidate evaluated

The primary candidate is `@horang-corp/avr-gcc-wasm@0.2.0`:

- Repository: <https://github.com/horang-corp/avr-gcc-wasm>
- Published package integrity: `sha512-N7evT4c8E/9sIKVk0VbC8V+i9UTubHgY5Frxh6LB+OR8BytXmU1cE20poIY0ndj7FwqUPzy1SQfBOAWUDNyU4A==`
- Published repository revision: `e3a563f765b041623734991125d5640c7e56053e`
- Package tarball observed during this feasibility check: 11,238,447 bytes
- Unpacked package observed during this feasibility check: 55,237,795 bytes
- Unpacked tool assets: approximately 16 MB
- Unpacked Arduino/sysroot/object assets: approximately 37 MB

The candidate provides real WebAssembly builds of `cc1plus`, `avr-as`,
`avr-ld`, and `avr-objcopy`. Its documented pipeline produces Intel HEX for an
ATmega328P/Arduino Uno and runs the build in a module Worker. This is the
correct technical shape for the browser-first vertical slice.

The candidate README also says that the browser path does not use the GCC
driver. It invokes the compiler frontend, assembler, linker, and `objcopy`
directly because the normal driver depends on process behavior such as
`vfork`. That means Schematic should integrate it through a narrow adapter, not
assume it behaves like `arduino-cli`.

## License and provenance findings

The candidate's `THIRD_PARTY_NOTICES.md` identifies:

- GCC AVR compiler components, including `cc1plus.wasm`, as GPLv3-or-later.
- GNU binutils components as GPLv3-or-later.
- `avr-libc` objects as avr-libc licensed, generally BSD-style with project
  specific notices.
- Generated Arduino core and library objects as controlled by each upstream
  project's license.

The same notice says that a public/product distribution should provide the
corresponding source, local patches, and build scripts for the checked-in
WebAssembly artifacts. The candidate repository exposes the browser build
artifacts and asset-preparation script, but Schematic has not independently
reproduced the toolchain or assembled the complete corresponding-source and
notice bundle required for its own distribution.

Arduino's licensing guidance separately confirms that a distributed Arduino
software product must account for the selected board core, every library, and
third-party code in the final artifact. The final distribution also needs the
applicable notices and source/relocation obligations. This is a legal review
item, not something this implementation can approve.

`avr8js@0.21.0` is a separate MIT-licensed AVR simulator dependency. It is
technically suitable for the Uno CPU boundary, but it is not installed in this
workspace and has not been added because package manifests and lockfiles are
out of scope for this track.

## Reproducibility findings

The candidate's asset-preparation documentation is encouraging: it describes
pinned upstream Arduino archives, SHA-256 verification, and locally compiled
core/library objects. It currently expects a native Linux AVR toolchain to
prepare those assets. The published package also contains a fixed manifest and
the resulting WebAssembly tools.

Schematic still needs all of the following before committing the assets:

1. An approved source revision and build recipe for every compiler/binary
   artifact.
2. A complete, reviewable license and notice inventory for the compiler,
   binutils, avr-libc, Arduino core, and selected libraries.
3. Reproduction of the Uno Blink and button/LED HEX outputs from a clean build.
4. A static asset size budget and a browser acceptance run on the published
   ChatGPT Site.
5. A decision about whether GPLv3 toolchain binaries and any linked objects fit
   the distribution model of the product.

## Local verification

The package was downloaded into a temporary probe directory only. No package
manifest, lockfile, compiler binary, or generated asset was added to Schematic.
The package contents and integrity metadata were inspectable. A direct Node
probe could not complete the candidate's large manifest/header fetch sequence
in this environment, so it is not treated as Schematic's end-to-end compiler
acceptance. The candidate's own Chrome measurements are upstream evidence, not
our release verification.

The local repository also has no `arduino-cli`, `avr-gcc`, `avr-g++`,
`avr-objcopy`, or installed `avr8js` dependency available to this package.

## Release decision

The compiler boundary is implemented below, but it intentionally requires a
caller-injected bridge. Without an explicitly reviewed bridge, the manager
returns `blocked`, not a preflight success and never a fake artifact. The
real-Uno acceptance test remains a visible TODO until the approved WASM
toolchain and `avr8js` runtime are provisioned.

This document is an engineering feasibility record, not legal advice.
