import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";

async function request(pathname = "/", envOverrides = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
      ...envOverrides,
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

async function render() {
  return request();
}

test("server-renders the portable demo shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>RuView Portable Demo<\/title>/i);
  assert.match(html, /One-node preview/);
  assert.match(html, /1 of 1/);
  assert.doesNotMatch(html, /2 of 2/);
  assert.match(html, /Start guided demo/);
  assert.match(html, /No camera\. No microphone\./);
  assert.match(html, /Preview data/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("keeps the preview scoped to one sensor node", async () => {
  const pageSource = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(pageSource, /id: "node-01"/);
  assert.match(pageSource, /"1 node expected"/);
  assert.match(pageSource, /snapshot\.nodes\.map/);
  assert.doesNotMatch(pageSource, /node-02|2 nodes expected|2 of 2/);
});

test("serves a credential-safe dashboard snapshot endpoint", async () => {
  const response = await request("/api/ruview/snapshot");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);

  const snapshot = await response.json();
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.mode, "preview");
  assert.equal(snapshot.connection, "unconfigured");
  assert.doesNotMatch(JSON.stringify(snapshot), /RUVIEW_API_TOKEN/);
});

test("connects the worker endpoint to a local RuView-compatible service", async () => {
  const expectedToken = "local-integration-token";
  const server = createServer((incoming, outgoing) => {
    assert.equal(incoming.headers.authorization, `Bearer ${expectedToken}`);
    outgoing.setHeader("content-type", "application/json");
    if (incoming.url === "/health") {
      outgoing.end(JSON.stringify({ status: "ok", source: "esp32", tick: 9 }));
      return;
    }
    if (incoming.url === "/api/v1/sensing/latest") {
      outgoing.end(
        JSON.stringify({
          type: "sensing_update",
          source: "esp32",
          tick: 9,
          nodes: [{ node_id: 1, rssi_dbm: -54, subcarrier_count: 56 }],
          classification: {
            presence: true,
            confidence: 0.88,
            motion_level: "active",
          },
        }),
      );
      return;
    }
    outgoing.statusCode = 404;
    outgoing.end(JSON.stringify({ error: "not found" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, "object");
    const response = await request("/api/ruview/snapshot", {
      RUVIEW_BASE_URL: `http://127.0.0.1:${address.port}`,
      RUVIEW_API_TOKEN: expectedToken,
    });
    const snapshot = await response.json();
    assert.equal(snapshot.mode, "live");
    assert.equal(snapshot.connection, "connected");
    assert.equal(snapshot.reading.confidencePercent, 88);
    assert.deepEqual(snapshot.nodes, [
      { id: "node-01", rssiDbm: -54, subcarrierCount: 56 },
    ]);
    assert.doesNotMatch(JSON.stringify(snapshot), /local-integration-token/);
  } finally {
    server.close();
    await once(server, "close");
  }
});
