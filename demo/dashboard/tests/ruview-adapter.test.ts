import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchRuViewSnapshot,
  normalizeRuViewSnapshot,
} from "../lib/ruview-adapter.ts";
import { isDashboardSnapshot } from "../lib/dashboard-contract.ts";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");

function liveUpdate() {
  return {
    type: "sensing_update",
    timestamp: 1_775_304_000,
    source: "esp32",
    tick: 42,
    nodes: [
      {
        node_id: 1,
        rssi_dbm: -57.4,
        position: [0, 0, 0],
        amplitude: [],
        subcarrier_count: 56,
      },
    ],
    classification: {
      motion_level: "active_motion",
      presence: true,
      confidence: 0.923,
    },
  };
}

test("normalizes a complete ESP32 update into the stable dashboard contract", () => {
  const snapshot = normalizeRuViewSnapshot(
    { status: "ok", source: "esp32", tick: 42, clients: 1 },
    liveUpdate(),
    NOW,
  );

  assert.equal(snapshot.mode, "live");
  assert.equal(snapshot.connection, "connected");
  assert.equal(snapshot.generatedAt, "2026-08-01T12:00:00.000Z");
  assert.deepEqual(snapshot.reading, {
    presence: true,
    confidencePercent: 92,
    motion: "Active Motion",
  });
  assert.deepEqual(snapshot.nodes, [
    { id: "node-01", rssiDbm: -57.4, subcarrierCount: 56 },
  ]);
});

test("never labels RuView simulation output as live hardware", () => {
  const update = liveUpdate();
  update.source = "simulated";
  const snapshot = normalizeRuViewSnapshot(
    { status: "ok", source: "simulated", tick: 42 },
    update,
    NOW,
  );

  assert.equal(snapshot.mode, "preview");
  assert.equal(snapshot.connection, "simulated");
  assert.equal(snapshot.reading.presence, null);
  assert.deepEqual(snapshot.nodes, []);
});

test("does not surface a cached update after RuView marks ESP32 offline", () => {
  const snapshot = normalizeRuViewSnapshot(
    { status: "ok", source: "esp32:offline", tick: 42 },
    liveUpdate(),
    NOW,
  );

  assert.equal(snapshot.mode, "preview");
  assert.equal(snapshot.connection, "offline");
  assert.equal(snapshot.reading.presence, null);
  assert.deepEqual(snapshot.nodes, []);
});

test("keeps incomplete ESP32 payloads out of live mode", () => {
  const update = liveUpdate();
  Reflect.deleteProperty(update.classification, "confidence");
  const snapshot = normalizeRuViewSnapshot(
    { status: "ok", source: "esp32", tick: 42 },
    update,
    NOW,
  );

  assert.equal(snapshot.mode, "preview");
  assert.equal(snapshot.connection, "waiting");
});

test("fetches only the pinned RuView health and latest endpoints", async () => {
  const requests: Array<{ pathname: string; authorization: string | null }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const headers = new Headers(init?.headers);
    requests.push({
      pathname: url.pathname,
      authorization: headers.get("authorization"),
    });
    const payload = url.pathname === "/health"
      ? { status: "ok", source: "esp32", tick: 42 }
      : liveUpdate();
    return Response.json(payload);
  };

  const snapshot = await fetchRuViewSnapshot({
    baseUrl: "http://127.0.0.1:3000/some-path",
    apiToken: "local-test-token",
    fetcher,
    now: () => NOW,
  });

  assert.equal(snapshot.mode, "live");
  assert.deepEqual(requests, [
    { pathname: "/health", authorization: "Bearer local-test-token" },
    { pathname: "/api/v1/sensing/latest", authorization: "Bearer local-test-token" },
  ]);
});

test("returns an honest unconfigured snapshot without making a request", async () => {
  let called = false;
  const snapshot = await fetchRuViewSnapshot({
    fetcher: async () => {
      called = true;
      return Response.json({});
    },
    now: () => NOW,
  });

  assert.equal(called, false);
  assert.equal(snapshot.connection, "unconfigured");
  assert.equal(snapshot.mode, "preview");
});

test("turns authorization failures into a credential-safe status", async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return url.pathname === "/health"
      ? Response.json({ status: "ok", source: "esp32", tick: 1 })
      : Response.json({ error: "unauthorized" }, { status: 401 });
  };

  const snapshot = await fetchRuViewSnapshot({
    baseUrl: "http://127.0.0.1:3000",
    apiToken: "never-echo-this",
    fetcher,
    now: () => NOW,
  });

  assert.equal(snapshot.connection, "error");
  assert.match(snapshot.message, /valid local API token/i);
  assert.doesNotMatch(JSON.stringify(snapshot), /never-echo-this/);
});

test("rejects malformed browser snapshot contracts", () => {
  assert.equal(
    isDashboardSnapshot({
      schemaVersion: 1,
      mode: "live",
      connection: "invented-state",
      generatedAt: "now",
      source: "esp32",
      tick: 1,
      reading: { presence: true, confidencePercent: 90, motion: "Active" },
      nodes: [],
      message: "not valid",
    }),
    false,
  );
});
