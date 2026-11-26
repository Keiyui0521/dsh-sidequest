import vm from "node:vm";
import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const registered = {},
  rows = [
    {
      type: "user/message",
      data: {
        role: "user",
        content: [{ type: "text", text: "PARENT_CONTEXT" }],
      },
    },
  ];
const R = {
  createElement: (type, props, ...children) => ({
    type,
    props: props || {},
    children: children.flat(),
  }),
  useSyncExternalStore() {},
  useEffect() {},
  useState: (x) => [x, () => {}],
};
const binding = {
  eventSource: {
    getSnapshot: () => ({
      entries: rows.map((event) => ({ type: "event", event })),
    }),
  },
};
const ctx = {
  slots: {
    inject: (n, f) => f(),
    register: (o, c) => (registered[o.name] = c),
  },
  sessions: { binding: () => binding },
  on() {},
};
const win = {
  __sidequestTransport: { url: "http://test/" },
  __ModuleLoader__: { load: (o) => o.factory(() => R).apply(ctx) },
};
vm.runInNewContext(
  fs.readFileSync(new URL("../dist/client.js", import.meta.url), "utf8"),
  {
    window: win,
    document: { createElement: () => ({ remove() {} }), head: { append() {} } },
    fetch: async () => ({ json: async () => [] }),
    crypto: { randomUUID },
    structuredClone,
    AbortController,
  },
);
const main = () => registered["main.conversation"]({ sessionId: "root" });
const quote = registered["conversation.chat.text-interaction"];
let cited = "";
const props = {
  sessionId: "root",
  readText: () => "SELECTED_ONLY",
  clearSelection() {},
  dismiss() {},
  inputActions: { insertQuote: (t) => ((cited = t), true) },
};
quote(props).children[0].props.onClick();
assert.equal(cited, "SELECTED_ONLY");
quote(props).children[1].props.onClick();
let view = main(),
  pane = view.children[1];
assert.equal(view.children.length, 2);
assert.equal(pane.props.p.messages.length, 0);
assert.equal(pane.props.p.context[0].content[0].text, "PARENT_CONTEXT");
assert.equal(pane.props.p.quote, "SELECTED_ONLY");
const id = pane.props.p.id;
quote({
  ...props,
  readText: () => "SECOND_SELECTION",
}).children[1].props.onClick();
assert.equal(main().children.length, 2);
assert.equal(main().children[1].props.p.id, id);
assert.equal(main().children[1].props.p.quote, "SECOND_SELECTION");
let aborted = false;
pane.props.p.controller = {
  abort() {
    aborted = true;
  },
};
const rendered = pane.type(pane.props);
rendered.children[0].children[1].props.onClick();
assert.equal(main().children.length, 1);
assert.equal(aborted, true);
assert.equal(rows[0].data.content[0].text, "PARENT_CONTEXT");
assert.ok(
  !fs
    .readFileSync(new URL("../src/client/store.js", import.meta.url), "utf8")
    .includes("localStorage."),
);
console.log(
  "PASS native quote preservation, selected excerpt, hidden ancestor context, pane reuse, close abort/discard, no conversation persistence",
);
