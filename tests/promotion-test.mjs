import assert from "node:assert/strict";
import { createStore } from "../src/client/store.js";
import { createDshAdapter } from "../src/adapters/dsh-llm.js";
globalThis.window = { __sidequestTransport: { url: "http://test/" } };
let calls = 0,
  payload,
  event = { type: "text-delta", text: "普通答案" };
globalThis.fetch = async () => ({
  ok: true,
  body: new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(JSON.stringify(event) + "\n"));
      c.close();
    },
  }),
});
const native = {
  send: async (p, u) => {
    calls++;
    payload = u;
    p.native = {};
    p.sessionId = "saved";
  },
  close: async () => {},
};
const store = createStore(
  () => [],
  () => '["test","model"]',
  native,
);
store.open("root", null, "");
let p = store.paths.get("root")[0];
p.draft = "hello";
await store.send(p);
assert.equal(calls, 0);
assert.equal(p.messages.at(-1).content[0].text, "普通答案");
event = {
  type: "branch-approval",
  proposal: { reason: "需写文件", task: "仅写 test.txt" },
};
p.draft = "write";
await store.send(p);
assert.equal(calls, 0);
assert.ok(p.proposal);
await store.decidePromotion(p, false);
assert.equal(calls, 0);
assert.equal(p.sessionId, undefined);
p.draft = "write again";
await store.send(p);
await Promise.all([
  store.decidePromotion(p, true),
  store.decidePromotion(p, true),
]);
assert.equal(calls, 1);
assert.match(payload.content[0].text, /hello/);
assert.match(payload.content[0].text, /仅写 test.txt/);
store.open("root", p, "child");
let child = store.paths.get("root")[1];
event = { type: "text-delta", text: "child answer" };
child.draft = "explain";
await store.send(child);
assert.equal(calls, 1);
assert.equal(child.sessionId, undefined);
event = {
  type: "branch-approval",
  proposal: { reason: "command", task: "echo test" },
};
child.draft = "cmd";
await store.send(child);
await store.close("root", 1);
await store.decidePromotion(child, true);
assert.equal(calls, 1);
const adapter = createDshAdapter({
  listProviders() {},
  listModels() {},
  prepareCall: async () => ({
    config: {},
    async *stream() {
      yield {
        type: "block-end",
        block: {
          type: "tool-call",
          name: "request_branch_approval",
          arguments: '{"reason":"write","task":"test"}',
        },
      };
      yield {
        type: "finish",
        reason: { kind: "error", failure: { message: "failed" } },
      };
    },
  }),
});
const chunks = [];
await assert.rejects(async () => {
  for await (const x of adapter.stream({
    route: '["x","y"]',
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  }))
    chunks.push(x);
}, /failed/);
assert.equal(chunks.length, 0);
console.log(
  "PASS temporary turns, explicit rejection, duplicate approval, context migration, nested temporary pane, close pending, stream failure withholding approval",
);
