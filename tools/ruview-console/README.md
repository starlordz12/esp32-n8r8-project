# Local RuView activity console

This localhost bridge opens the native RuView sensing UI using an existing SSH
connection. The Pi API token is read into memory over SSH and stays server-side.
It can apply a separately exported, trained version-2 adaptive activity model to
live CSI frames. It provides presence and motion classification, not body pose.

## Web UI

With a configured activity model, the native Training tab provides room setup,
empty-room baseline controls, and independent activity checks. The model card
shows trained/loaded state separately from live prediction availability, the
training frame count, classes, and the explicit radio binding. Model confidence
is never labeled as validation accuracy. The activity workflow replaces the
unrelated RVF pose-training panels for this installation.

The Sensing room and node cards use the same trained classification over HTTP
and WebSocket; upstream values remain in separate provenance fields. A local
network-only service worker prevents upstream offline caches replaying old UI
or sensing responses. Existing browsers may need two reloads on first upgrade:
one to install the worker, then one to load the fresh page.

Baseline capture requires explicit replacement/empty-room confirmation, provides
20 seconds to leave, and finalizes only when the server's required duration and
frame count are reached without sequence faults. Keep the page open through
capture. Cancel applies only to the capture started by that panel. The existing
room binding is reused; baseline persistence across Pi restart is not configured.
Recalibrating the baseline does not retrain the exported activity classifier.

Activity checks sample unique live frame ticks for 20 seconds after a preparation
countdown and compare predictions with the selected known condition. Results
are transient and establish only that trial's match rate. Empty, seated, and
walking trials must be performed by the room operator before claiming accuracy.

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
