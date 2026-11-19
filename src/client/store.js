export function createStore(messages) {
  const paths = new Map(),
    listeners = new Set();
  let revision = 0,
    models = [],
    modelError = "";
  const emit = () => {
    revision++;
    for (const f of listeners) f();
  };
  const subscribe = (f) => {
    listeners.add(f);
    return () => listeners.delete(f);
  };
  const api = () => {
    const u = window.__sidequestTransport?.url;
    if (!u) throw Error("请完整退出并重新打开 Harness 以加载临时侧聊服务");
    return u;
  };
  const textMsg = (role, text) => ({ role, content: [{ type: "text", text }] });
  function close(root, i) {
    const a = paths.get(root) || [];
    for (const p of a.slice(i)) p.controller?.abort();
    paths.set(root, a.slice(0, i));
    emit();
  }
  function open(root, parent, quote) {
    const a = paths.get(root) || [],
      i = parent ? a.indexOf(parent) + 1 : 0;
    if (parent && i === 0) return;
    const inherited = parent
      ? [...parent.context, ...parent.messages]
      : messages(root);
    if (a[i]) {
      a[i].quote = quote;
      a[i].context = structuredClone(inherited);
      emit();
      return;
    }
    a.push({
      id: crypto.randomUUID(),
      context: structuredClone(inherited),
      quote,
      messages: [],
      draft: "",
      model: parent?.model || models[0]?.id || "",
      busy: false,
    });
    paths.set(root, a);
    emit();
  }
  function lastUser(rows) {
    for (let i = rows.length - 1; i >= 0; i--)
      if (rows[i].role === "user") return i;
    return -1;
  }
  async function send(p) {
    if (p.busy || !p.draft.trim()) return;
    const question = p.draft;
    p.draft = "";
    const quote = p.quote;
    p.quote = "";
    p.messages.push(
      textMsg("user", (quote ? "引用：\n" + quote + "\n\n" : "") + question),
    );
    p.messages.push(textMsg("assistant", ""));
    p.busy = true;
    p.error = "";
    p.controller = new AbortController();
    emit();
    try {
      const response = await fetch(api() + "chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          route: p.model,
          messages: [...p.context, ...p.messages.slice(0, -1)],
        }),
        signal: p.controller.signal,
      });
      if (!response.ok) throw Error("侧聊请求失败 " + response.status);
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let k;
        while ((k = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, k);
          buf = buf.slice(k + 1);
          if (!line) continue;
          const e = JSON.parse(line);
          if (e.error) throw Error(e.error);
          if (e.type === "text-delta") {
            p.messages.at(-1).content[0].text += e.text;
            emit();
          }
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") p.error = e.message;
    } finally {
      p.busy = false;
      p.controller = null;
      emit();
    }
  }

  async function loadModels() {
    try {
      const r = await fetch(api() + "models");
      const result = await r.json();
      if (!r.ok) throw Error(result.error || "模型列表加载失败");
      models = result.models;
      modelError = result.errors.join("；");
      if (!models.length)
        modelError = modelError || "请先在 DSH 设置中配置可用模型";
      for (const list of paths.values())
        for (const p of list) if (!p.model) p.model = models[0]?.id || "";
    } catch (e) {
      modelError = e.message;
    }
    emit();
  }
  return {
    paths,
    subscribe,
    snapshot: () => revision,
    api,
    open,
    close,
    send,
    lastUser,
    emit,
    loadModels,
    get models() {
      return models;
    },
    get modelError() {
      return modelError;
    },
  };
}
