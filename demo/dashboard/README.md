# RuView portable demo dashboard

Offline-friendly interface scaffold for the Raspberry Pi 5 portable demo kit.

## Current scope

- Visitor-facing room activity view
- Three-step guided demonstration
- Plain-language privacy explanation
- Operator readiness and node-health view
- Responsive tablet, laptop, and kiosk layouts
- Honest preview-data labeling until the Pi adapter is connected

## Run locally

```powershell
npm.cmd ci
npm.cmd run dev
```

The next integration step is a small Raspberry Pi service adapter that converts
RuView aggregator output into a stable dashboard snapshot. Network names,
credentials, node identities, and machine-specific addresses remain outside Git.
