import assert from "node:assert/strict";
import { startEphemeralServer } from "../src/server/transport.js";
let calls = 0;
const s = await startEphemeralServer({
  listModels: async () => [{ id: "test" }],
  async *stream(o) {
    calls++;
    assert.equal(o.messages.at(-1).content[0].text, "question");
    yield { type: "text-delta", text: "answer" };
  },
});
try {
  const denied = await fetch(s.url + "chat", {
    method: "POST",
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(denied.status, 403);
  assert.equal(
    (await fetch(s.url.replace(/\/[a-f0-9]{64}\//, "/wrong/") + "models"))
      .status,
    403,
  );
  const r = await fetch(s.url + "chat", {
    method: "POST",
    headers: { Origin: "dsh-app://app", "Content-Type": "application/json" },
    body: JSON.stringify({
      route: "test",
      messages: [
        { role: "user", content: [{ type: "text", text: "question" }] },
      ],
    }),
  });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /answer/);
  assert.equal(calls, 1);
  console.log(
    "PASS ephemeral authenticated transport, origin restriction, streaming",
  );
} finally {
  s.close();
}
