import assert from "node:assert/strict";
import { apply } from "../index.js";
const handlers = {};
const previous = process.env.SIDEQUEST_CONFIG;
process.env.SIDEQUEST_CONFIG = "/nonexistent-sidequest-test-config.json";
try {
  await apply({
    llm: {
      listProviders: () => [],
      listModels: async () => [],
      prepareCall: async () => {},
    },
    on: (event, fn) => {
      handlers[event] = fn;
    },
  });
  const table = [];
  handlers["webserver/index-inject"](table);
  const url = table.find((item) => item.name === "__sidequestTransport").value
    .url;
  assert.ok(
    table.some(
      (item) => item.kind === "script" && item.text.includes("DOMPurify"),
    ),
  );
  assert.equal((await fetch(url + "katex.css")).status, 200);
  assert.equal(
    (await fetch(url + "fonts/KaTeX_Main-Regular.woff2")).status,
    200,
  );
  assert.deepEqual(await (await fetch(url + "models")).json(), {
    models: [],
    errors: [],
  });
  console.log(
    "PASS plugin startup, injected assets and native model catalog without configuration",
  );
} finally {
  handlers.dispose?.();
  if (previous === undefined) delete process.env.SIDEQUEST_CONFIG;
  else process.env.SIDEQUEST_CONFIG = previous;
}
