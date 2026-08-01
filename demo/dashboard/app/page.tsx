"use client";

import { useMemo, useState } from "react";
import { useDashboardSnapshot } from "@/lib/use-dashboard-snapshot";

type DashboardView = "demo" | "maintenance";

const previewNodes = [
  { id: "node-01", label: "Desktop test node", signal: "Preview", packets: "42/s" },
];

const guideSteps = [
  {
    eyebrow: "Step 1 of 3",
    title: "Walk into the sensing area",
    copy: "Move naturally toward the center of the room. The display should respond without using a camera.",
    action: "I’m in position",
  },
  {
    eyebrow: "Step 2 of 3",
    title: "Stand still for a moment",
    copy: "Notice how the room remains occupied even when movement becomes subtle.",
    action: "Next experiment",
  },
  {
    eyebrow: "Step 3 of 3",
    title: "Walk across the room",
    copy: "The activity marker follows the strongest change in Wi-Fi reflections.",
    action: "Finish demo",
  },
];

export default function Home() {
  const [view, setView] = useState<DashboardView>("demo");
  const [guidedStep, setGuidedStep] = useState<number | null>(null);
  const [checksComplete, setChecksComplete] = useState(false);
  const { snapshot, endpointAvailable: adapterEndpointAvailable } =
    useDashboardSnapshot();

  const isLive =
    adapterEndpointAvailable &&
    snapshot?.mode === "live" &&
    snapshot.connection === "connected";
  const hasConfiguredAdapter = snapshot?.connection !== "unconfigured" && snapshot !== null;
  const serviceConnected =
    snapshot?.connection === "connected" ||
    snapshot?.connection === "simulated" ||
    snapshot?.connection === "waiting" ||
    snapshot?.connection === "offline";

  const statusLabel = isLive
    ? "Live ESP32 data"
    : snapshot?.connection === "simulated"
      ? "Simulation data"
      : hasConfiguredAdapter
        ? "Live data unavailable"
        : "Preview data";

  const displayNodes = isLive
    ? snapshot.nodes.map((node) => ({
        ...node,
        label: "Live RuView node",
        signal: node.rssiDbm === null ? "Not reported" : `${Math.round(node.rssiDbm)} dBm`,
        packets:
          node.subcarrierCount === null ? "Not reported" : String(node.subcarrierCount),
      }))
    : hasConfiguredAdapter
      ? []
      : previewNodes;

  const scene = useMemo(() => {
    if (isLive && snapshot) {
      const { presence, confidencePercent, motion } = snapshot.reading;
      if (presence === false) {
        return {
          title: "Room appears clear",
          detail: "No current presence is reported by RuView",
          confidence: confidencePercent,
          marker: "center",
          motion: motion ?? "Still",
          visible: false,
        };
      }
      return {
        title: presence === true ? "Presence detected" : "Reading live signals",
        detail:
          presence === true
            ? "Wi-Fi signal changes indicate someone is in the sensing area"
            : "RuView has not reported a presence decision yet",
        confidence: confidencePercent,
        marker: "center",
        motion: motion ?? "Activity detected",
        visible: presence === true,
      };
    }
    if (hasConfiguredAdapter && snapshot?.connection !== "simulated") {
      return {
        title: "Waiting for live data",
        detail: snapshot?.message ?? "The local RuView service is not available yet",
        confidence: null,
        marker: "center",
        motion: "No live reading",
        visible: false,
      };
    }
    if (guidedStep === 1) {
      return {
        title: "Someone is standing still",
        detail: "Presence remains near the center",
        confidence: 86,
        marker: "center",
        motion: "Low movement",
        visible: true,
      };
    }
    if (guidedStep === 2) {
      return {
        title: "Movement across the room",
        detail: "Activity is moving toward the door",
        confidence: 94,
        marker: "right",
        motion: "Active",
        visible: true,
      };
    }
    return {
      title: "Someone is moving",
      detail: "Activity is strongest near the center",
      confidence: 92,
      marker: "left",
      motion: "Active",
      visible: true,
    };
  }, [guidedStep, hasConfiguredAdapter, isLive, snapshot]);

  function advanceGuide() {
    if (guidedStep === null) {
      setGuidedStep(0);
      return;
    }
    if (guidedStep >= guideSteps.length - 1) {
      setGuidedStep(null);
      return;
    }
    setGuidedStep(guidedStep + 1);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="RuView portable demo home">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span>
            <strong>RuView</strong>
            <small>Portable room demo</small>
          </span>
        </a>

        <div className="topbar-actions">
          <span className="network-pill">
            <span className="status-dot" aria-hidden="true" />
            Private local network
          </span>
          <button
            className="quiet-button"
            type="button"
            onClick={() => setView(view === "demo" ? "maintenance" : "demo")}
          >
            {view === "demo" ? "Maintenance" : "Back to demo"}
          </button>
        </div>
      </header>

      {view === "demo" ? (
        <div className="page-content" id="top">
          <section className="ready-banner" aria-label="System status">
            <div className="ready-copy">
              <span className="ready-icon" aria-hidden="true">
                ✓
              </span>
              <span>
                <small>System status</small>
                <strong>
                  {isLive
                    ? `${snapshot.nodes.length} live ${snapshot.nodes.length === 1 ? "node" : "nodes"}`
                    : hasConfiguredAdapter
                      ? "Live connection pending"
                      : "One-node preview"}
                </strong>
              </span>
            </div>
            <div className="ready-stats">
              <span>
                <strong>{isLive ? snapshot.nodes.length : hasConfiguredAdapter ? 0 : "1 of 1"}</strong>
                {isLive ? " nodes reporting" : hasConfiguredAdapter ? " live nodes" : " node in preview"}
              </span>
              <span>
                <strong>Local only</strong>
                no internet needed
              </span>
              <button className="primary-button" type="button" onClick={advanceGuide}>
                <span aria-hidden="true">▶</span>
                Start guided demo
              </button>
            </div>
          </section>

          <section className="dashboard-grid" aria-label="Live sensing dashboard">
            <article className="room-card">
              <div className="card-heading">
                <div>
                  <p className="eyebrow">Live room view</p>
                  <h1>Living room</h1>
                </div>
                <span className={`preview-pill ${isLive ? "live-pill" : ""}`}>
                  {statusLabel}
                </span>
              </div>

              <div className="room-map" aria-label={`Room activity: ${scene.detail}`}>
                <div className="room-label room-label-window">Window</div>
                <div className="room-label room-label-door">Door</div>

                <div className="sensor sensor-one">
                  <span className="sensor-core" />
                  <span className="sensor-wave sensor-wave-one" />
                  <span className="sensor-wave sensor-wave-two" />
                  <strong>01</strong>
                </div>
                {scene.visible && (
                  <div className={`activity-zone activity-zone-${scene.marker}`}>
                    <span className="activity-halo" />
                    <span className="person-marker" aria-hidden="true">
                      <span className="person-head" />
                      <span className="person-body" />
                    </span>
                    <span className="activity-caption">{scene.motion}</span>
                  </div>
                )}

                <div className="room-scale">
                  <span />
                  <small>Sensing area</small>
                  <span />
                </div>
              </div>

              <div className="room-legend">
                <span>
                  <i className="legend-sensor" /> Sensor node
                </span>
                <span>
                  <i className="legend-activity" /> Detected activity
                </span>
                <span className="last-update">
                  {isLive ? "Updated from local RuView" : "Preview state"}
                </span>
              </div>
            </article>

            <aside className="insight-column">
              <article className="presence-card" aria-live="polite">
                <p className="eyebrow">Current reading</p>
                <div className="presence-symbol" aria-hidden="true">
                  <span />
                </div>
                <h2>{scene.title}</h2>
                <p>{scene.detail}</p>

                {scene.confidence !== null && (
                  <div className="confidence">
                    <div>
                      <span>Signal confidence</span>
                      <strong>{scene.confidence}%</strong>
                    </div>
                    <div className="confidence-track">
                      <span style={{ width: `${scene.confidence}%` }} />
                    </div>
                  </div>
                )}
              </article>

              <article className="privacy-card">
                <span className="privacy-icon" aria-hidden="true">
                  ◎
                </span>
                <div>
                  <p className="eyebrow">Privacy by design</p>
                  <h3>No camera. No microphone.</h3>
                  <p>
                    This display uses changes in Wi-Fi reflections—not pictures
                    or recordings.
                  </p>
                </div>
              </article>
            </aside>
          </section>

          <section className="explain-strip">
            <div>
              <p className="eyebrow">What’s happening?</p>
              <h2>Wi-Fi becomes a quiet room sensor.</h2>
            </div>
            <ol>
              <li>
                <span>1</span>
                <p>
                  <strong>One node listens</strong>
                  to ordinary Wi-Fi reflections
                </p>
              </li>
              <li>
                <span>2</span>
                <p>
                  <strong>{isLive ? "The Raspberry Pi compares" : "The desktop compares"}</strong>
                  tiny signal changes
                </p>
              </li>
              <li>
                <span>3</span>
                <p>
                  <strong>This screen explains</strong>
                  the activity in plain language
                </p>
              </li>
            </ol>
          </section>
        </div>
      ) : (
        <section className="maintenance-page">
          <div className="maintenance-heading">
            <div>
              <p className="eyebrow">Operator view</p>
              <h1>Demo readiness</h1>
              <p>
                A calm preflight check for the person setting up the portable kit.
              </p>
            </div>
            <button
              className="primary-button"
              type="button"
              onClick={() => setChecksComplete(true)}
            >
              {checksComplete
                ? isLive
                  ? "Live checks passed"
                  : "Preview checks passed"
                : "Run readiness check"}
            </button>
          </div>

          <div className="maintenance-grid">
            <article className="health-card health-overall">
              <span className="health-check" aria-hidden="true">
                ✓
              </span>
              <div>
                <p className="eyebrow">Overall status</p>
                <h2>
                  {isLive
                    ? "Live demo ready"
                    : hasConfiguredAdapter
                      ? "Live connection needs attention"
                      : checksComplete
                        ? "Preview ready to review"
                        : "Preview is healthy"}
                </h2>
                <p>
                  {!adapterEndpointAvailable
                    ? "The dashboard adapter endpoint is unavailable."
                    : snapshot?.message ??
                      "All preview checks are clear. The live node connection comes next."}
                </p>
              </div>
            </article>

            <article className="health-card data-source-card">
              <p className="eyebrow">Data source</p>
              <h2>{isLive ? "Raspberry Pi RuView adapter" : "Local preview adapter"}</h2>
              <p>
                {isLive
                  ? "The dashboard is reading a normalized snapshot from the local RuView sensing service."
                  : "The interface stays clearly labeled until a complete ESP32 sensing update is available."}
              </p>
              <span className={`adapter-status ${isLive ? "adapter-live" : ""}`}>
                {isLive
                  ? "Live RuView connection"
                  : snapshot?.connection === "simulated"
                    ? "RuView simulation connected"
                    : serviceConnected
                      ? "Waiting for ESP32 data"
                      : "RuView connection pending"}
              </span>
            </article>

            <article className="nodes-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Sensor node</p>
                  <h2>
                    {isLive
                      ? `${displayNodes.length} live node${displayNodes.length === 1 ? "" : "s"}`
                      : "1 node expected"}
                  </h2>
                </div>
                <span className="online-label">
                  {isLive ? `${displayNodes.length} reporting now` : "One node online in preview"}
                </span>
              </div>
              <div className="node-table">
                {displayNodes.map((node) => (
                  <div className="node-row" key={node.id}>
                    <span className="node-number">{node.id.slice(-2)}</span>
                    <span>
                      <strong>{node.id}</strong>
                      <small>{node.label}</small>
                    </span>
                    <span>
                      <strong>{node.signal}</strong>
                      <small>signal</small>
                    </span>
                    <span>
                      <strong>{node.packets}</strong>
                      <small>{isLive ? "subcarriers" : "sample rate"}</small>
                    </span>
                    <span className="node-state">{isLive ? "Live" : "Preview"}</span>
                  </div>
                ))}
                {displayNodes.length === 0 && (
                  <p className="empty-node-state">No live ESP32 node is reporting yet.</p>
                )}
              </div>
            </article>

            <article className="checklist-card">
              <p className="eyebrow">First-node checklist</p>
              <h2>Connect, flash, stream, verify.</h2>
              <ul>
                <li className={serviceConnected ? "complete" : "pending"}>
                  <span>{serviceConnected ? "✓" : "•"}</span> Raspberry Pi sensing service started
                </li>
                <li className={isLive ? "complete" : "pending"}>
                  <span>{isLive ? "✓" : "•"}</span> Node joined to the demo Wi-Fi network
                </li>
                <li className={isLive ? "complete" : "pending"}>
                  <span>{isLive ? "✓" : "•"}</span> Node sending CSI to the Raspberry Pi
                </li>
                <li className={isLive ? "complete" : "pending"}>
                  <span>{isLive ? "✓" : "•"}</span> Dashboard receiving normalized live updates
                </li>
              </ul>
            </article>
          </div>
        </section>
      )}

      <footer className="footer">
        <span>
          <span className="status-dot" aria-hidden="true" />
          {isLive ? "Portable demo live" : "Portable demo preview"}
        </span>
        <span>Designed to work without cloud access</span>
      </footer>

      {guidedStep !== null && (
        <div className="guide-backdrop" role="presentation">
          <section
            className="guide-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-title"
          >
            <button
              className="guide-close"
              type="button"
              aria-label="Close guided demo"
              onClick={() => setGuidedStep(null)}
            >
              ×
            </button>
            <div className="guide-progress" aria-label={`${guidedStep + 1} of 3 steps`}>
              {guideSteps.map((_, index) => (
                <span className={index <= guidedStep ? "complete" : ""} key={index} />
              ))}
            </div>
            <p className="eyebrow">{guideSteps[guidedStep].eyebrow}</p>
            <h2 id="guide-title">{guideSteps[guidedStep].title}</h2>
            <p>{guideSteps[guidedStep].copy}</p>
            <button className="primary-button guide-action" type="button" onClick={advanceGuide}>
              {guideSteps[guidedStep].action}
              <span aria-hidden="true">→</span>
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
