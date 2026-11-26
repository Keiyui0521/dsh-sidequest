import assert from "node:assert/strict";
import {
  editedContent,
  questionText,
  regenerateQuestion,
} from "../src/client/main-edit.js";
const original = [
  { type: "text", text: "old" },
  { type: "file", attachment: { id: "file-1" } },
  { type: "text", text: "question" },
  { type: "image", attachment: { id: "image-1" } },
];
const copy = structuredClone(original);
const content = await editedContent(
  original,
  "revised question",
  async () => "data:image/png;base64,AQID",
);
assert.deepEqual(original, copy);
assert.equal(questionText(original), "old\nquestion");
assert.deepEqual(content, [
  { type: "text", text: "revised question" },
  original[1],
  { ...original[3], encodedBytes: 3 },
]);
await assert.rejects(
  () => editedContent([{ type: "unknown" }], "new"),
  /不支持/,
);
const calls = [];
let running = false,
  reject = true;
const ctx = {
  sessions: {
    list: {
      getSnapshot: () => ({ byId: { parent: { title: "Original title" } } }),
    },
    binding: () => ({ session: { getSnapshot: () => ({ running }) } }),
    fork: async (opts) => {
      calls.push(["fork", opts]);
      return "child";
    },
    retain: (id) => ({
      ready: Promise.resolve({
        session: {
          rename: async (title) => {
            calls.push(["rename", title]);
            return { ok: true };
          },
          prompt: async (...args) => {
            calls.push(["prompt", ...args]);
            return reject
              ? { ok: false, error: { message: "offline" } }
              : { ok: true };
          },
        },
      }),
      release() {
        calls.push(["release"]);
      },
    }),
  },
  uiWorkspace: {
    openSession: async (id) => calls.push(["open", id]),
    archiveSession: async (id) => calls.push(["archive", id]),
  },
};
const attempt = {};
await assert.rejects(
  () =>
    regenerateQuestion(ctx, { sessionId: "parent", seq: 12, content, attempt }),
  /offline/,
);
assert.equal(calls.filter((x) => x[0] === "archive").length, 0);
reject = false;
await regenerateQuestion(ctx, {
  sessionId: "parent",
  seq: 12,
  content,
  attempt,
});
assert.deepEqual(
  calls.filter((x) => x[0] === "fork"),
  [["fork", { sessionId: "parent", atSeq: 11, increaseTitle: false }]],
);
assert.equal(
  calls.filter((x) => x[0] === "prompt")[0][4],
  calls.filter((x) => x[0] === "prompt")[1][4],
);
assert.equal(calls.filter((x) => x[0] === "release").length, 2);
assert.deepEqual(calls.at(-2), ["open", "child"]);
assert.deepEqual(
  calls.find((x) => x[0] === "rename"),
  ["rename", "Original title"],
);
assert.deepEqual(
  calls.find((x) => x[0] === "archive"),
  ["archive", "parent"],
);
calls.length = 0;
await regenerateQuestion(ctx, {
  sessionId: "parent",
  seq: 12,
  content,
  attempt: {},
  keepOriginal: true,
});
assert.equal(calls[0][1].increaseTitle, true);
assert.equal(
  calls.some((x) => x[0] === "archive" || x[0] === "rename"),
  false,
);
ctx.uiWorkspace.archiveSession = async () => {
  throw Error("archive failed");
};
await assert.rejects(
  () =>
    regenerateQuestion(ctx, {
      sessionId: "parent",
      seq: 12,
      content,
      attempt: {},
    }),
  /归档失败/,
);
running = true;
await assert.rejects(
  () =>
    regenerateQuestion(ctx, {
      sessionId: "parent",
      seq: 12,
      content,
      attempt: {},
    }),
  /等待/,
);
await assert.rejects(
  () =>
    regenerateQuestion(ctx, {
      sessionId: "parent",
      seq: 0,
      content,
      attempt: {},
    }),
  /无法/,
);
console.log(
  "PASS edit preserves attachments, forks before target, retries idempotently, releases references and refuses unsafe boundaries/busy sessions",
);
