import assert from "node:assert/strict";
import { createNativeSessions } from "../src/adapters/dsh-session.js";
function fixture() {
  const listeners = new Set(),
    statusListeners = new Set(),
    stateListeners = new Set();
  const log = [
    { type: "event", event: { seq: 0, type: "session/end-seed", data: {} } },
  ];
  let rootPreset = "read-only",
    childPreset = "workspace-write",
    running = false,
    prompted = 0,
    cancelled = 0,
    released = 0;
  const source = {
    getSnapshot: () => ({ running: false }),
    projections: {
      faceOf: () => ({ getSnapshot: () => ({ currentValue: rootPreset }) }),
    },
  };
  const session = {
    eventSource: {
      getSnapshot: () => ({ entries: log }),
      subscribe: (f) => {
        listeners.add(f);
        return () => listeners.delete(f);
      },
    },
    projections: {
      faceOf: () => ({ getSnapshot: () => ({ currentValue: childPreset }) }),
    },
    subscribe: (f) => {
      stateListeners.add(f);
      return () => stateListeners.delete(f);
    },
    getSnapshot: () => ({ running }),
    rename: async () => ({ ok: true }),
    command: async (line) => {
      childPreset = line.split(" ")[1];
      return { ok: true, value: { matched: true } };
    },
    prompt: async (content) => {
      assert.equal(childPreset, rootPreset);
      prompted++;
      running = true;
      log.push({
        type: "event",
        event: { seq: 1, type: "user/message", data: { content } },
      });
      for (const f of listeners) f();
      return { ok: true };
    },
    cancel: async () => {
      cancelled++;
      finish();
      return { ok: true };
    },
  };
  function finish() {
    running = false;
    log.push({
      type: "event",
      event: { seq: log.length, type: "turn/end", data: {} },
    });
    for (const f of listeners) f();
  }
  const pending = {
    kind: "approval",
    answerable: true,
    answer: async (value) => {
      pending.answerable = false;
      assert.equal(value, "rejected");
    },
  };
  const ctx = {
    sessions: {
      binding: (id) => ({ session: id === "root" ? source : session }),
      fork: async () => "child",
      retain: () => ({
        ready: Promise.resolve({ session }),
        release: () => released++,
      }),
    },
    remote: { session: { selectModel: async () => ({ ok: true }) } },
    uiSession: {
      sessionStatus: {
        getSnapshot: () =>
          new Map([["child", { pendingInteraction: pending }]]),
        subscribe: (f) => {
          statusListeners.add(f);
          return () => statusListeners.delete(f);
        },
      },
    },
  };
  return {
    ctx,
    finish,
    session,
    setRoot: (v) => (rootPreset = v),
    get: () => ({ prompted, cancelled, released, listeners: listeners.size }),
    p: {
      approved: true,
      root: "root",
      model: '["test","model"]',
      messages: [],
      quote: "test",
    },
  };
}
const f = fixture(),
  a = createNativeSessions(f.ctx),
  user = { content: [{ type: "text", text: "test" }] };
const turn = a.send(f.p, user, () => {});
await new Promise((r) => setImmediate(r));
assert.equal(f.get().prompted, 1);
assert.equal(f.p.permission, "read-only");
await a.answer(f.p, "rejected");
await assert.rejects(a.answer(f.p, "allowed-once"));
f.finish();
await turn;
f.setRoot("custom");
await assert.rejects(
  a.send(f.p, user, () => {}),
  /自定义权限/,
);
assert.equal(f.get().prompted, 1);
await a.close(f.p);
assert.equal(f.get().released, 1);
assert.equal(f.get().listeners, 0);
const g = fixture(),
  b = createNativeSessions(g.ctx);
const t = b.send(g.p, user, () => {});
await new Promise((r) => setImmediate(r));
g.p.busy = true;
await b.close(g.p);
await t;
assert.equal(g.get().cancelled, 1);
console.log(
  "PASS native permission synchronization before tools, custom fail-closed, scoped approvals, cancellation and subscription cleanup",
);

const slow = fixture();
let releaseFork;
slow.ctx.sessions.fork = () =>
  new Promise((resolve) => {
    releaseFork = resolve;
  });
const slowAdapter = createNativeSessions(slow.ctx);
const sending = slowAdapter.send(slow.p, user, () => {});
const stopped = slowAdapter.close(slow.p);
releaseFork("child");
await assert.rejects(sending, /已关闭/);
await stopped;
assert.equal(slow.get().prompted, 0);
assert.equal(slow.get().released, 1);
console.log("PASS close during admission cannot start a hidden task");

const unapproved = fixture();
unapproved.p.approved = false;
await assert.rejects(
  createNativeSessions(unapproved.ctx).send(unapproved.p, user, () => {}),
  /批准/,
);
assert.equal(unapproved.get().prompted, 0);
