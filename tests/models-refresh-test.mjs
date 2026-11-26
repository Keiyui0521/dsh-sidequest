import assert from "node:assert/strict";
import { createStore } from "../src/client/store.js";
import { randomUUID } from "node:crypto";
globalThis.window = { __sidequestTransport: { url: "http://test/" } };
globalThis.crypto ??= { randomUUID };
const store = createStore(() => []);
let pending = [];
globalThis.fetch = () => new Promise((resolve) => pending.push(resolve));
const respond = (resolve, models) =>
  resolve({ ok: true, json: async () => ({ models, errors: [] }) });
const first = store.loadModels();
respond(pending.shift(), [{ id: "google", name: "Google" }]);
await first;
store.open("root", null, "");
const p = store.paths.get("root")[0];
p.draft = "keep draft";
const older = store.loadModels(),
  newer = store.loadModels();
respond(pending[1], [
  { id: "google", name: "Google" },
  { id: "codex", name: "Codex" },
]);
await newer;
respond(pending[0], [{ id: "google", name: "Google" }]);
await older;
assert.equal(store.models.length, 2);
assert.equal(p.model, "google");
assert.equal(p.draft, "keep draft");
console.log(
  "PASS newly configured models refresh, stale responses ignored, selection and draft preserved",
);
