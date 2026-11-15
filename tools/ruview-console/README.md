# Local RuView activity console

A loopback HTTP/WebSocket bridge for the native RuView UI. The existing Pi API
token is read over SSH into memory and never returned to the browser. Firmware
and Pi services are independently managed; starting this console does not restart
the Pi or flash a radio.

## Inference modes

- **Temporal CSI motion only:** the current local default. A two-second window
  measures normalized channel-shape changes over a half-second lag. It reports
  movement/no movement with occupancy unknown. It does not infer people counts,
  body pose, heart rate, or breathing. Those unvalidated fields are suppressed;
  upstream values remain separately available for diagnosis.
- **Experimental temporal occupancy:** compares stationary channel shapes with
  recorded references. This mode can fail after an entry/exit cycle even when
  its capture holdout passes. It is not the default.
- **Calibrated presence / experimental v2 learned motion:** legacy paths. A fresh
  calibration-status snapshot, matching model/session/boot/room binding, active
  grid, and zero sequence faults are required before using calibrated evidence.
  The server's status string alone is insufficient. Node resets can invalidate
  the baseline while the server still calls it fresh.

The temporal path keeps raw spatial power separate from temporal movement. It
normalizes gain, conservatively excludes the first two complex samples because
this wire format lacks the S3 invalid-first-word flag, rejects changed grids and
stale/incomplete data, and warms a new window after interruptions. Duplicate
HTTP/WS ticks do not advance a window. Identical samples on distinct single-node
ticks remain valid stationary data. Additional nodes are marked untrained; the
trained link is not silently applied to them.

A version-3 temporal reference is loaded from `RUVIEW_TEMPORAL_MODEL`, or from
`<configured-model-path>.temporal.local.json`. It remains separate from the
version-2 exported model. References and all captures stay private. Recorded
capture holdout is distinct from independent live validation. Motion-only checks
do not establish static occupancy accuracy or general person detection.

## Web UI and setup

For separate motion decisions from multiple receivers, set the private launcher
setting `motionReferencePath` (environment: `RUVIEW_MOTION_REFERENCE`) to a
per-node motion reference. This overrides only `temporal_motion_only`; the legacy
model and occupancy modes remain separate. Each radio has its own threshold and
grid binding. Never copy a reference between radios or placements.
Set a radio reference's `enabled` field to `false` while repositioning it; it
remains unavailable until a fresh reference replaces it. Any calibrated presence
bound to that radio is also withheld during this placement transition.

`capture-motion.mjs stationary|moving PRIVATE_OUTPUT SECONDS` records paired raw
snapshots and live decisions through the localhost console. Keep captures and
references outside Git. `fitMotionReference` in `motion-reference.mjs` requires
separate known stationary and moving captures, at least eight complete two-second
windows for each radio and condition, and no overlap between those windows.
That separation is a fitting condition, not an accuracy claim. New independent
trials must report per-node wrong decisions and unavailable time separately.

The sparse motion path requires at least twelve changed raw snapshots spanning
1.8 seconds of a two-second window, six half-second comparisons, and no gap over
half a second. It does not invent samples when the upstream stream omits raw
arrays. Identical arrays cannot prove a fresh per-node raw sample, even if an
aggregate tick or transport counter advances. Cached decisions expire after
half a second; grid changes, stale data and simulation invalidate evidence.
Room movement can be reported from either live radio; room no-movement requires
live decisions from every configured radio. Missing coverage stays explicit.

Requires Node.js 22.13+, the existing SSH key, private deployment settings, and
model files. Run `npm.cmd ci` and `npm.cmd test` in this directory. Copy the example
settings to ignored `console-settings.local.json`; keep SSH targets, model paths,
radio bindings, API configuration and network details outside Git. Start
`Open-NativeRuView.ps1` to open the native Sensing page.

Training shows loaded state, selected mode, the live temporal measurement and
threshold, calibration faults, and independent room checks. Legacy v2 softmax
captures/training/activation remain explicitly experimental. Activation backs
up the previous model and atomically replaces its file. It is not evidence that
motion or presence works. Changes to source filtering, placement, or radio
hardware require new references and validation.

The upstream adaptive result is not consistently copied into the state used by
room fusion in the inspected server revision. Original values remain under
`upstream_classification`, `upstream_room_inference`, and node provenance fields.
Unavailable local decisions display unavailable rather than reusing a heuristic
label as though it were a local model prediction.

The local network-only service worker prevents old offline HTML/modules/API
responses being replayed. Existing browsers may need two reloads on first
upgrade. Host/Origin checks and an explicit path allowlist reject cross-origin
access and unrelated mutations; API tokens stay server-side.

## Calibration and validation

Sensing and the local Observatory use the same measured per-radio motion view.
The former 3D body/signal illustration is replaced by actual motion traces and
radio-specific thresholds. Unknown presence stays unknown in both views; no
person silhouettes, room coordinates or counts are invented. Observatory is a
local console view, not a replacement for an upstream pose model.

`presence-reference.mjs` provides an offline experimental comparison of paired
empty-room and seated channel shapes. It requires complete windows from every
bound radio and abstains outside its references. Its output remains experimental
even on perfectly separated fitting data. Save independent captures separately;
do not activate a failing comparison or repeatedly refit validation examples.
This diagnostic does not reset or restore the Pi's stale baseline.

Fresh Pi calibrated-presence evidence is inspected independently of the legacy
single-node learned classifier. A baseline bound to one radio does not become a
second radio's presence model. Healthy grid, sequence, freshness and exact
model/session/boot/binding checks are required. Presence stays experimental until
new known-empty and seated trials pass. `check-calibrated-presence.mjs` collects
private verification reports without changing models or the Pi. It counts unique
bound-link evidence ticks and reports missing/duplicate reads separately.

A private `<modelPath>.calibrated-validation.local.json` receipt (or
`RUVIEW_PRESENCE_VALIDATION`) can authorize only the exact current baseline after
both independent conditions last at least twenty seconds with at least twenty
unique frames, 95% matching decisions and 80% availability. Each report must
carry the same baseline identity; changed identities, faults and receipts older
than one day cannot authorize presence. Passing short trials is limited evidence,
not general accuracy, safety validation or a guarantee after moving hardware.

The Pi empty-room capture has its own identity and duration/frame requirements.
The UI offers explicit replacement confirmation, a 20-second departure delay,
progress, finalization only after both targets, and cancellation of its own
capture. Keep that page open through capture. Pi baseline persistence across
server restart remains unresolved. A local temporal reference is a separate
measurement model and does not grant calibration authority to vitals or pose.

Run new known-condition checks after changing the sensing setup. Count unique
source ticks; report unavailable reads separately. Keep deployment-specific
measurements and model files outside Git. Neither training accuracy nor a
same-capture temporal holdout substitutes for an independent live test.
