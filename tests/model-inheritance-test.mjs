import assert from "node:assert/strict";
import { createStore } from "../src/client/store.js";
import { createSessionModelReader } from "../src/adapters/dsh-client.js";
globalThis.window = { __sidequestTransport: { url: "http://test/" } };
let selected = {
  next: { provider: "google", model: "hydrogen" },
  lastUsed: { provider: "google", model: "argon" },
};
const read = createSessionModelReader({
  sessions: {
    binding: (id) =>
      id === "missing"
        ? undefined
        : {
            session: {
              projections: {
                faceOf: (name) => {
                  assert.equal(name, "modelSelection");
                  return { getSnapshot: () => selected };
                },
              },
            },
          },
  },
});
const route = (p, m) => JSON.stringify([p, m]);
const store = createStore(() => [], read);
store.open("a", null, "first");
let pane = store.paths.get("a")[0];
assert.equal(pane.model, route("google", "hydrogen"));
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({
    models: [{ id: route("google", "argon"), name: "Argon" }],
    errors: [],
  }),
});
await store.loadModels();
assert.equal(pane.model, route("google", "hydrogen")); // catalog must not silently change inherited model
pane.model = route("openai-codex", "gpt");
store.open("a", pane, "child");
assert.equal(store.paths.get("a")[1].model, route("openai-codex", "gpt"));
store.open("a", null, "reuse");
assert.equal(pane.model, route("openai-codex", "gpt")); // preserve manually selected model of an existing conversation
store.close("a", 0);
selected = { next: { provider: "other-provider", model: "hydrogen" } };
store.open("a", null, "reopen");
assert.equal(
  store.paths.get("a")[0].model,
  route("other-provider", "hydrogen"),
);
selected = { lastUsed: { provider: "google", model: "argon" } };
assert.equal(read("a"), route("google", "argon"));
assert.equal(read("missing"), "");
store.open("missing", null, "fallback");
assert.equal(store.paths.get("missing")[0].model, route("google", "argon"));
console.log(
  "PASS active composer model beats last reply, exact provider route, nested inheritance, catalog refresh, manual selection and reopen",
);
