# STEEL Runtime Truthfulness and Hardening Workstream

Status: planning baseline created from a read-only inspection of `antonioportfelli-boop/main` at `2cccc8f9230a2dfe2bbb651397ef9058414081e2`.
This document is a work plan, not evidence that runtime behavior has been tested or that hardware drivers are integrated.

## Guardrails

- Work only on a feature branch; preserve `main`, existing branches, history, secrets, and deployed systems.
- Treat code inspection, browser-reported values, modeled values, and hardware measurements as different evidence classes.
- Never claim native ASIO, host-plugin, or device support without a reproducible test on the named platform and device.
- A change is complete only with focused tests, typecheck/build evidence, and a traceable source/commit.

## Confirmed findings from inspected source

1. `src/lib/steel/engine.ts` sets `cpu` to `min(100, peak * 40 + voices * 3)`. This is a heuristic based on audio level and voice count, not CPU utilization.
2. `src/lib/steel/asio.ts` computes `roundTripMs` as `buffer / rate * extraBuffers * 1000`. It is a simplified buffer model, not a measured device round-trip latency.
3. `src/components/steel-console.tsx` labels the modeled value “ASIO RTL” and “Class”, and separately reads `AudioContext.baseLatency` / `outputLatency` through `measuredLatencyMs()`. Browser-reported latency is not proof of an ASIO driver or an acoustic loopback measurement.
4. `src/lib/steel/engine.ts` uses a browser `AudioContext` and `AudioWorkletNode`; the inspected path does not instantiate a native ASIO driver.
5. `tryMic` races microphone permission against a timeout but does not cancel the underlying `getUserMedia` request when the timeout wins. If permission resolves later, the acquired stream may need explicit cleanup.
6. `armKernel` creates resources before assigning the global handle and has no single encompassing rollback path for every failure point. Concurrent arm/disarm requests also need a serialized lifecycle.
7. The UI describes the selected buffer as a “host ASIO figure” while the worklet quantum is fixed at 128. These are distinct parameters and must be named and explained separately.
8. The inspected project declares `typecheck`, `build`, `test`, and `lint` scripts in `package.json`; this inspection did not run them.

## Workstream A — truthful metrics (P0)

### A1. Source-tag every value
- Define a metric envelope with name, value, unit, source, timestamp, validity, and explanatory label.
- Use source values such as `browser-api`, `model`, `worklet-meter`, `native-driver`, and `loopback-measurement`.
- Keep unavailable distinct from zero; do not silently coerce missing measurements to zero.
- Preserve existing persisted settings while migrating meter state.

### A2. CPU and load
- Remove the peak/voices formula from any field named CPU/load.
- Until a supported measurement exists, render “CPU load unavailable”.
- If a heuristic is retained for diagnostics, call it “load estimate”, expose its formula, and never imply OS CPU percentage.
- Future real measurement requires a defined sampling window, source, throttling policy, and platform support matrix.

### A3. Latency
- Rename buffer arithmetic as “modeled buffer latency” and show assumptions (buffer count, sample rate, channels if relevant).
- Label `baseLatency` / `outputLatency` as browser-reported estimates and handle unsupported/zero values as unavailable.
- Reserve “round-trip measured” for calibrated input-to-output loopback with documented device, sample rate, buffer, and measurement method.
- Do not call browser output latency “ASIO RTL”.

### A4. UI semantics
- Add accessible help text for model vs browser-reported vs physically measured values.
- Distinguish selected host buffer from AudioWorklet render quantum.
- Avoid “Tracking/Mixing/Producing” recommendations until thresholds are validated against repeatable measurements.

## Workstream B — lifecycle and resource safety (P0)

### B1. Serialized state machine
- Model `idle → starting → running → stopping → idle`, plus explicit `error`.
- Make arm/disarm idempotent; serialize overlapping calls and ignore stale completions using a generation token.
- Expose stable state transitions to UI and tests.

### B2. Transactional startup
- Register each acquired resource immediately in a temporary owner.
- On any failure, disconnect nodes, stop tracks, close the context, clear handlers, and restore state.
- Publish the active handle only after required initialization succeeds.
- Keep optional microphone failure separate from core engine failure.

### B3. Permission timeout and cancellation
- Use an abortable operation where supported; if the browser API cannot be cancelled, stop tracks if permission resolves after timeout or cancellation.
- Clear timers on resolve/reject and ensure late results cannot mutate current state.
- Do not log raw device identifiers or permission-sensitive details.

### B4. Runtime events
- Handle `AudioContext.statechange`, worklet processor errors, message-port closure, and unexpected context suspension.
- Provide bounded retry behavior only for recoverable failures; never auto-loop retries.
- Panic must silence voices promptly and remain available during partial failure.

## Workstream C — audio/worklet contracts (P1)

- Define versioned discriminated message unions for params, noteOn, noteOff, panic, meter, ready, and error.
- Validate inbound message type, numeric ranges, finite values, note range, and velocity before applying.
- Add a ready handshake before sending initial state; reject unsupported protocol versions clearly.
- Specify worklet quantum behavior and avoid claiming that UI buffer settings change the browser worklet quantum.
- Verify DSP behavior with deterministic fixtures: silence, impulse, sine, clipping, parameter boundaries, voice allocation, panic, and repeated note-on/off.
- Keep audio-thread work allocation bounded; no unbounded arrays, blocking calls, or synchronous logging in the render loop.

## Workstream D — MIDI correctness (P1)

- Test permission denial, unsupported Web MIDI, device disconnect/reconnect, port selection, malformed messages, velocity-zero note-off, and channel filtering.
- Track held notes by source/channel/note so keyboard and external MIDI do not release each other’s notes.
- On blur, panic, disarm, disconnect, and visibility transitions, release notes owned by that input source.
- Bound MIDI event queues and ensure repeated note-on cannot leak voices.
- Keep MIDI output and input capabilities separately described.

## Workstream E — platform and driver claims (P1)

- Maintain a capability matrix with OS, browser, audio backend, device, driver, tested version, test date, evidence link, and status.
- Use statuses: unverified, source-reviewed, browser-tested, device-tested, loopback-measured.
- Treat OS matrix prose and version constants as claims requiring authoritative source references and test evidence.
- Separate web audio support from native ASIO/WASAPI/CoreAudio/ALSA/PipeWire/JACK support.
- Do not present platform-specific host compatibility as verified until the exact app/host/device combination passes.

## Workstream F — security, privacy, and observability (P1)

- Request microphone access only after explicit user action; explain why it is needed and provide a clear off state.
- Ensure every acquired media track is stopped on teardown and failed startup.
- Avoid recording or transmitting microphone audio by default; make Web tap/output routing visible and reversible.
- Emit structured, privacy-safe lifecycle diagnostics with correlation IDs and bounded retention.
- Never include raw audio, device serials, access tokens, or personal identifiers in diagnostics.
- Add a security review for remote worklet/module URLs and update manifests before enabling dynamic updates.

## Workstream G — validation and release evidence (P0/P1)

- Add focused unit tests for metric labeling/math, state transitions, cancellation, cleanup, and protocol validation.
- Add browser integration tests for arm/disarm, permission denied, context suspension, and no-device behavior.
- Add deterministic DSP tests and MIDI lifecycle tests.
- Run `npm run typecheck`, `npm test`, `npm run lint`, and `npm run build` on Node 22; record exact command, exit code, and commit.
- Require a manual test record for each claimed OS/browser/device combination.
- No release or production deployment is part of this workstream.

## Tenfold expansion ladder

For each issue area A–G, execute ten evidence-backed layers in order:

1. **Inventory:** identify every relevant file, caller, UI label, persisted field, and external dependency.
2. **Contract:** define terminology, types, invariants, source of truth, and failure semantics.
3. **Baseline tests:** capture current behavior and create regression tests before refactoring.
4. **Correctness fix:** implement the smallest change that removes the demonstrated defect.
5. **Boundary hardening:** validate inputs, unsupported capabilities, and partial failures.
6. **Lifecycle hardening:** address cancellation, retries, resource ownership, and repeated operations.
7. **Observability:** add source-tagged, privacy-safe diagnostics and actionable user errors.
8. **Compatibility:** test supported browser/OS/device combinations and document exclusions.
9. **Performance:** profile representative workloads and set evidence-based budgets; do not invent targets.
10. **Acceptance gate:** run all relevant tests, review diff, document limitations, and obtain human review before merge.

## Immediate implementation order

1. Correct the misleading CPU and latency labels and expose source/availability in the UI.
2. Add metric-contract tests and a focused lifecycle test harness.
3. Fix startup rollback, late microphone permission cleanup, and concurrent arm/disarm behavior.
4. Version and validate the worklet message protocol.
5. Add MIDI source-aware note ownership and panic/disconnect coverage.
6. Build the platform evidence matrix and replace unsupported claims with qualified wording.
7. Run CI locally/on branch and prepare a draft PR only after review.

## Acceptance criteria

- No field presented as measured unless its source is a measurement API or documented physical test.
- No false claim of native ASIO integration from browser Web Audio code.
- Every failure path releases resources and returns the UI to a coherent state.
- All new behavior has tests; typecheck, tests, lint, and build results are attached to the exact commit.
- Changes are isolated on a feature branch and are not merged or deployed without explicit approval.
