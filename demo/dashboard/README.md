# RuView portable demo dashboard

Offline-friendly interface and RuView service adapter for the Raspberry Pi 5
portable demo kit.

## Current scope

- Visitor-facing room activity view
- Three-step guided demonstration
- Plain-language privacy explanation
- Operator readiness and node-health view
- Responsive tablet, laptop, and kiosk layouts
- A typed, read-only adapter for RuView's pinned `/health` and
  `/api/v1/sensing/latest` responses
- Automatic live, waiting, offline, simulation, and unconfigured states
- Honest preview-data labeling until a recent ESP32 update is available

The browser requests only `/api/ruview/snapshot`. The server-side adapter calls
RuView, validates its response, and returns a small stable dashboard contract.
The optional RuView API token never enters client-side code or JSON responses.

## Configure the local adapter

Copy the example runtime file, then edit only the untracked copy:

```powershell
Copy-Item .dev.vars.example .dev.vars
```

- `RUVIEW_BASE_URL` is the local RuView sensing server origin.
- `RUVIEW_API_TOKEN` is optional and is needed only when RuView API
  authentication is enabled.

Do not commit `.dev.vars`, network-specific addresses, or tokens. When the
adapter is missing, unavailable, simulated, waiting for data, or reporting a
stale ESP32 source, the visitor interface stays out of live mode.

## Run locally

```powershell
npm.cmd ci
npm.cmd run dev
```

## Validate

```powershell
npm.cmd test
npm.cmd run lint
```

The test suite type-checks and builds the app, validates server rendering and the
snapshot endpoint, and covers live ESP32, simulation, stale/offline, missing
configuration, and authorization-failure behavior.
