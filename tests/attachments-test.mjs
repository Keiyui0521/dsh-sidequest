import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { prepareAttachment } from "../src/server/attachments.js";
import { createDshAdapter } from "../src/adapters/dsh-llm.js";
import { startEphemeralServer } from "../src/server/transport.js";
const upload = (name, bytes, mediaType = "") => ({
  name,
  data: Buffer.from(bytes).toString("base64"),
  mediaType,
});
assert.match(
  (await prepareAttachment(upload("notes.txt", "中文附件"))).blocks[0].text,
  /中文附件/,
);
for (const [name, expected] of [
  ["attachment.pdf", "42"],
  ["attachment.docx", "73"],
]) {
  const result = await prepareAttachment(
    upload(
      name,
      await readFile(new URL("./fixtures/" + name, import.meta.url)),
    ),
  );
  assert.match(result.blocks[0].text, new RegExp(expected));
}
await assert.rejects(
  () => prepareAttachment(upload("program.exe", "binary")),
  /不支持/,
);
await assert.rejects(
  () => prepareAttachment(upload("notes.txt", Buffer.from([255]))),
  /UTF-8/,
);
await assert.rejects(
  () =>
    prepareAttachment(upload("big.txt", Buffer.alloc(10 * 1024 * 1024 + 1))),
  /10 MB/,
);
const ref = {
  attachmentId: "test-image",
  width: 10,
  height: 10,
  mediaType: "image/png",
};
const store = {
  saveImages: async (entries) => {
    assert.equal(entries[0].data.length, 3);
    return [ref];
  },
};
const image = await prepareAttachment(
  upload("image.png", "png", "image/png"),
  store,
);
let received;
const adapter = createDshAdapter({
  listProviders: () => [],
  listModels: () => [],
  prepareCall: async () => ({
    config: {},
    async *stream(options) {
      received = options;
      yield { type: "finish", reason: { kind: "stop" } };
    },
  }),
});
for await (const e of adapter.stream({
  route: '["test","vision"]',
  messages: [{ role: "user", content: image.blocks }],
})) {
}
assert.deepEqual(received.messages[0].content[0].attachment, ref);
const server = await startEphemeralServer(adapter, { attachments: store });
try {
  const r = await fetch(server.url + "attachment", {
    method: "POST",
    body: JSON.stringify(upload("note.md", "hello")),
  });
  assert.equal(r.status, 200);
  assert.match((await r.json()).blocks[0].text, /hello/);
  const denied = await fetch(server.url + "attachment", {
    method: "POST",
    headers: { Origin: "https://evil.example" },
    body: "{}",
  });
  assert.equal(denied.status, 403);
} finally {
  server.close();
}
console.log(
  "PASS PDF/DOCX/text extraction, image reference preservation, file limits, upload endpoint/origin",
);
