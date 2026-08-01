import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

test("standalone server exposes a credential-safe snapshot endpoint", async () => {
  const port = 31991;
  const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const cleanEnvironment = { ...process.env };
  delete cleanEnvironment.RUVIEW_API_TOKEN;
  const server = spawn(process.execPath, [path.join(dashboardRoot, "dist/standalone/server.js")], {
    cwd: dashboardRoot,
    env: {
      ...cleanEnvironment,
      PORT: String(port),
      RUVIEW_BASE_URL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  server.stdout.on("data", (chunk) => { diagnostics += chunk.toString(); });
  server.stderr.on("data", (chunk) => { diagnostics += chunk.toString(); });

  try {
    let response;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (server.exitCode !== null) break;
      try {
        response = await fetch(`http://127.0.0.1:${port}/api/ruview/snapshot`);
        if (response.ok) break;
      } catch {
        // The standalone server may still be starting.
      }
      await delay(250);
    }

    assert.ok(response?.ok, `standalone request failed\n${diagnostics}`);
    const snapshot = await response.json();
    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.mode, "preview");
    assert.equal(snapshot.connection, "unconfigured");
  } finally {
    if (server.exitCode === null) server.kill();
    await Promise.race([once(server, "exit"), delay(3_000)]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
});
