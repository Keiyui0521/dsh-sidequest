import assert from "node:assert/strict";
import { createDshAdapter } from "../src/adapters/dsh-llm.js";
import { startEphemeralServer } from "../src/server/transport.js";
let received;
const llm = {
  listProviders: () => [
    { id: "deepseek", name: "DeepSeek" },
    { id: "google", name: "Google" },
    { id: "broken", name: "Unavailable" },
  ],
  listModels: async (provider) => {
    if (provider === "broken") throw Error("offline");
    return [{ id: "same-model-id", name: "Model" }];
  },
  prepareCall: async (config, signal) => ({
    config: { ...config, maxTokens: 4096 },
    async *stream(options) {
      received = options;
      assert.equal(options.signal, signal);
      assert.equal(options.messages[1].source.kind, "model");
      assert.ok(options.messages.every((m) => m.id));
      yield { type: "text-delta", index: 0, text: "原生回答" };
      yield { type: "finish", reason: { kind: "stop" } };
    },
  }),
};
const adapter = createDshAdapter(llm);
const catalog = await adapter.listModels();
assert.equal(catalog.models.length, 2);
assert.notEqual(catalog.models[0].id, catalog.models[1].id);
assert.match(catalog.errors[0], /offline/);
const server = await startEphemeralServer(adapter);
try {
  const r = await fetch(server.url + "chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      route: catalog.models[1].id,
      messages: [
        { role: "system", content: [{ type: "text", text: "do not inherit" }] },
        { role: "user", content: [{ type: "text", text: "parent" }] },
        {
          role: "assistant",
          content: [
            { type: "text", text: "context" },
            { type: "tool-call", name: "shell" },
          ],
        },
        { role: "user", content: [{ type: "text", text: "question" }] },
      ],
    }),
  });
  assert.match(await r.text(), /原生回答/);
  assert.equal(received.provider, "google");
  assert.equal(received.maxTokens, 4096);
  assert.equal(received.messages.length, 3);
  assert.equal(received.messages[1].content.length, 1);
  assert.deepEqual(
    received.tools.map((t) => t.name),
    ["request_branch_approval"],
  );
  assert.match(received.system, /html/);
  await assert.rejects(async () => {
    for await (const c of adapter.stream({ route: "bad", messages: [] })) {
    }
  }, /请选择/);
  const failure = createDshAdapter({
    ...llm,
    prepareCall: async () => ({
      config: {},
      async *stream() {
        yield {
          type: "finish",
          reason: { kind: "error", failure: { message: "provider failed" } },
        };
      },
    }),
  });
  await assert.rejects(async () => {
    for await (const c of failure.stream({
      route: catalog.models[0].id,
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })) {
    }
  }, /provider failed/);
  const controller = new AbortController();
  controller.abort();
  const cancelled = createDshAdapter({
    ...llm,
    prepareCall: async (_config, signal) => {
      signal.throwIfAborted();
    },
  });
  await assert.rejects(async () => {
    for await (const c of cancelled.stream({
      route: catalog.models[0].id,
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      signal: controller.signal,
    })) {
    }
  }, /abort/i);
  console.log(
    "PASS native provider routing, defaults, message schema, error and cancellation propagation",
  );
} finally {
  server.close();
}
