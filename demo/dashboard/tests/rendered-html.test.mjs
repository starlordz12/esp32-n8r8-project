import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
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
  assert.match(pageSource, />1 node expected</);
  assert.doesNotMatch(pageSource, /node-02|2 nodes expected|2 of 2/);
});
