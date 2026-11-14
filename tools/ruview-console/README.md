# Local RuView activity console

This localhost bridge opens the native RuView sensing UI using an existing SSH
connection. The Pi API token is read into memory over SSH and stays server-side.
It can apply a separately exported, trained version-2 adaptive activity model to
live CSI frames. It provides presence and motion classification, not body pose.

## Status at checkpoint

Five unit/regression tests pass. Feature extraction and learned softmax output
were checked against an independent calculation on a live frame. The new bridge
has **not yet been activated or validated in the user-facing console**. The
running viewer remains the earlier native pass-through bridge. Resume with local
installation, fresh live validation, and browser verification before merge.

## Why the bridge applies the model

The inspected server revision computes the adaptive classification after
`smooth_and_classify_node`, but does not copy the adaptive label back into the
node state used by room fusion. A trained-model status flag therefore does not
prove the published room label comes from that model. This bridge evaluates the
exported learned weights itself. Original classifications are retained as
`upstream_classification`, `upstream_room_inference`, and
`upstream_node_inference`; `local_activity` identifies the trained result.

The feature contract is seven per-node measurements plus eight statistics over
the first 56 amplitudes. Only model version 2 is accepted. Predictions abstain on
stale/simulated data, missing features, a different bound node, or multiple nodes.
Models must be retrained/rebound when the hardware arrangement changes.

## Setup

Requires Node.js 22.13+, SSH key access to the Pi, its existing API configuration,
and an exported trained `adaptive_model.json`. Keep model files and all network
configuration outside Git.

```powershell
npm.cmd ci
npm.cmd test
```

Copy `console-settings.example.json` to the ignored
`console-settings.local.json` and fill in the deployment paths, model path, and
trained node binding. `Open-NativeRuView.ps1` opens a loopback SSH tunnel and then
the native Sensing page through the bridge. It does not change Pi services.

The bridge serves only on loopback, checks Host/Origin, rejects cross-site
requests and unrelated mutations, and forwards only sensing WebSocket paths.
The browser's banner labels the local activity model. A body-pose model, person
count, or vital-sign accuracy is not established by this classifier.

## Validation before activation

Check HTTP and WebSocket predictions on separate empty, seated, and walking
samples. Training-set accuracy is not independent validation. Verify that source
data is live ESP32, that the local model banner reflects availability, and that
upstream fields remain available. Recheck cross-origin and write restrictions.
