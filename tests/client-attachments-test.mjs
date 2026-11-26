import assert from "node:assert/strict";
import { createStore } from "../src/client/store.js";
import { randomUUID } from "node:crypto";
globalThis.crypto ??= { randomUUID };
globalThis.window = { __sidequestTransport: { url: "http://test/" } };
globalThis.FileReader = class {
  readAsDataURL(file) {
    this.result = "data:" + file.type + ";base64,cG5n";
    this.onload();
  }
};
let sent;
globalThis.fetch = async (url, options) => {
  if (url.endsWith("models"))
    return {
      ok: true,
      json: async () => ({
        models: [{ id: "vision", inputModalities: ["text", "image"] }],
        errors: [],
      }),
    };
  if (url.endsWith("attachment"))
    return {
      ok: true,
      json: async () => ({
        name: "test.png",
        kind: "image",
        blocks: [{ type: "image", attachment: { attachmentId: "test" } }],
      }),
    };
  sent = JSON.parse(options.body);
  return {
    ok: true,
    body: new ReadableStream({
      start(c) {
        c.enqueue(
          new TextEncoder().encode('{"type":"text-delta","text":"看到了"}\n'),
        );
        c.close();
      },
    }),
  };
};
const store = createStore(() => []);
await store.loadModels();
store.open("root", null, "");
const p = store.paths.get("root")[0];
await store.addFiles(p, [{ name: "test.png", type: "image/png", size: 3 }]);
assert.equal(p.attachments.length, 1);
assert.equal(p.uploading, 0);
await store.send(p);
assert.equal(sent.messages[0].content[1].type, "image");
assert.equal(sent.messages[0].attachments, undefined);
assert.equal(p.messages[1].content[0].text, "看到了");
store.open("root", p, "nested");
assert.equal(store.paths.get("root")[1].context[0].content[1].type, "image");
await store.addFiles(
  p,
  Array.from({ length: 5 }, () => ({ name: "x", size: 1 })),
);
assert.match(p.error, /4/);
await store.addFiles(p, [{ name: "big", size: 11 * 1024 * 1024 }]);
assert.match(p.error, /10 MB/);
console.log(
  "PASS attachment-only send, preview excluded from wire, nested context preserves image, upload size/count failures",
);
