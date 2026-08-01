import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import yaml from "js-yaml";

const dashboardRoot = process.cwd();
const repoRoot = path.resolve(dashboardRoot, "../..");
const deployRoot = path.join(repoRoot, "deploy/pi");
const expectedServerDigest =
  "sha256:e2186cb9fbb8f52f4e341bc90bef86eba323afbafff134b1eaf498e83a2e5d58";
const expectedNodeDigest =
  "sha256:83fdfa2a4de32d7f8d79829ea259bd6a4821f8b2d123204ac467fbe3966450fc";

async function textFile(...segments) {
  return readFile(path.join(...segments), "utf8");
}

test("Pi compose pins images and keeps the raw RuView API on loopback", async () => {
  const composeText = await textFile(deployRoot, "compose.yaml");
  const compose = yaml.load(composeText);
  const server = compose.services["sensing-server"];
  const dashboard = compose.services.dashboard;

  assert.equal(
    server.image,
    `docker.io/ruvnet/wifi-densepose@${expectedServerDigest}`,
  );
  assert.equal(server.environment.CSI_SOURCE, "esp32");
  assert.match(server.environment.RUVIEW_API_TOKEN, /:\?Set RUVIEW_API_TOKEN/);
  assert.match(dashboard.environment.RUVIEW_API_TOKEN, /:\?Set RUVIEW_API_TOKEN/);
  assert.equal(dashboard.environment.RUVIEW_BASE_URL, "http://sensing-server:3000");
  assert.ok(server.ports.includes("${RUVIEW_HTTP_BIND_ADDRESS:-127.0.0.1}:3000:3000/tcp"));
  assert.ok(server.ports.includes("${RUVIEW_WS_BIND_ADDRESS:-127.0.0.1}:3001:3001/tcp"));
  assert.ok(server.ports.includes("${RUVIEW_UDP_BIND_ADDRESS:-0.0.0.0}:5005:5005/udp"));
  assert.ok(dashboard.ports.includes("${DASHBOARD_BIND_ADDRESS:-0.0.0.0}:8080:3000/tcp"));

  for (const service of [server, dashboard]) {
    assert.deepEqual(service.cap_drop, ["ALL"]);
    assert.ok(service.security_opt.includes("no-new-privileges:true"));
    assert.notEqual(service.privileged, true);
    assert.notEqual(service.network_mode, "host");
  }
  assert.doesNotMatch(composeText, /(?:^|:)latest(?:\s|$)/m);
});

test("server lock records the reviewed multi-architecture image", async () => {
  const lock = JSON.parse(await textFile(deployRoot, "ruview-server.lock.json"));
  const firmwareLock = JSON.parse(await textFile(repoRoot, "ruview.lock.json"));

  assert.equal(lock.schemaVersion, 1);
  assert.equal(lock.image.manifestDigest, expectedServerDigest);
  assert.match(lock.image.platformDigests["linux/arm64"], /^sha256:[a-f0-9]{64}$/);
  assert.match(lock.image.platformDigests["linux/amd64"], /^sha256:[a-f0-9]{64}$/);
  assert.equal(lock.firmwareCompatibility.firmwareCommit, firmwareLock.commit);
});

test("Pi dashboard image uses an immutable Node base and an unprivileged user", async () => {
  const dockerfile = await textFile(dashboardRoot, "Dockerfile.pi");
  const fromLines = dockerfile.match(/^FROM .+$/gm) ?? [];

  assert.equal(fromLines.length, 2);
  assert.ok(fromLines.every((line) => line.includes(`@${expectedNodeDigest}`)));
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /BUILD_STANDALONE=true npm run build/);
  assert.match(dockerfile, /^CMD \["node", "server\.js"\]$/m);
});

test("verification script checks the locked image and explicit live state", async () => {
  const script = await textFile(deployRoot, "verify.sh");

  assert.ok(script.startsWith("#!/usr/bin/env bash\nset -euo pipefail\n"));
  assert.match(script, /ruview-server\.lock\.json/);
  assert.match(script, /\.image\.manifestDigest/);
  assert.match(script, /--expect-live/);
  assert.match(script, /\.mode == "live" and \.connection == "connected"/);
  assert.doesNotMatch(script, /source\s+\.env/);
});
