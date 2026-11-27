export function createStore(messages, currentModel = () => "", native = null) {
  const paths = new Map(),
    listeners = new Set();
  let revision = 0,
    models = [],
    modelError = "",
    modelRequest = 0;
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
  async function close(root, i) {
    const a = paths.get(root) || [];
    for (const p of a.slice(i)) {
      if (p.native || p.admission) {
        try {
          await native.close(p);
        } catch (e) {
          p.closed = false;
          p.error = e.message;
          emit();
          return;
        }
      } else {
        p.closed = true;
        p.controller?.abort();
        p.proposal = null;
      }
    }
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
      root,
      parent,
      context: structuredClone(inherited),
      quote,
      messages: [],
      draft: "",
      attachments: [],
      uploading: 0,
      model: parent?.model || currentModel(root) || models[0]?.id || "",
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
    if (
      p.busy ||
      p.proposal ||
      p.uploading ||
      (!p.draft.trim() && !p.attachments?.length)
    )
      return;
    const question = p.draft || "请分析附件内容";
    const attached = p.attachments || [];
    const selectedModel = models.find((m) => m.id === p.model);
    if (
      attached.some((a) => a.kind === "image") &&
      selectedModel?.inputModalities &&
      !selectedModel.inputModalities.includes("image")
    ) {
      p.error = "当前模型不支持图片，请选择支持看图的模型";
      emit();
      return;
    }
    p.attachments = [];
    p.draft = "";
    const quote = p.quote;
    p.quote = "";
    const user = textMsg(
      "user",
      (quote ? "引用：\n" + quote + "\n\n" : "") + question,
    );
    user.content.push(...attached.flatMap((a) => a.blocks));
    user.attachments = attached;
    user.question = user.content[0].text;
    p.messages.push(user);
    if (!p.native) p.messages.push(textMsg("assistant", ""));
    p.busy = true;
    p.error = "";
    p.controller = new AbortController();
    emit();
    try {
      if (p.native) {
        await native.send(p, user, emit);
        return;
      }
      const response = await fetch(api() + "chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          route: p.model,
          messages: [...p.context, ...p.messages.slice(0, -1)].map(
            ({ role, content }) => ({ role, content }),
          ),
        }),
        signal: p.controller.signal,
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw Error(detail.error || "侧聊请求失败 " + response.status);
      }
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
          if (e.type === "branch-approval" && !p.closed) {
            p.proposal = { ...e.proposal, id: crypto.randomUUID() };
            emit();
          }
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

  async function decidePromotion(p, approved) {
    if (!p.proposal || p.busy || p.closed) return;
    const proposal = p.proposal;
    p.proposal = null;
    if (!approved) {
      p.messages.push(textMsg("assistant", "已拒绝：未保存分支，未执行操作。"));
      emit();
      return;
    }
    p.approved = true;
    p.busy = true;
    p.error = "";
    p.frozenHistory = structuredClone(
      p.messages.filter((m) =>
        m.content.some((b) => b.type !== "text" || b.text.trim()),
      ),
    );
    const transcript = [...p.context, ...p.frozenHistory]
      .map(
        (m) =>
          `${m.role === "user" ? "用户" : "助手"}：\n${m.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("\n")}`,
      )
      .join("\n\n");
    p.migrationText =
      "以下是临时侧聊的上下文记录，仅供理解，不要重新执行历史请求：\n" +
      transcript +
      "\n\n用户刚刚批准保存为分支并处理以下任务（仍须遵循 DSH 的权限审批）：\n" +
      proposal.task;
    const user = textMsg("user", p.migrationText);
    user.content.push(
      ...[...p.context, ...p.frozenHistory].flatMap((m) =>
        m.content.filter((b) => b.type === "image"),
      ),
    );
    emit();
    try {
      if (!native) throw Error("当前 DSH 不支持创建分支，未执行操作");
      await native.send(p, user, emit);
    } catch (e) {
      p.error = e.message;
      // Never automatically retry a task: prompt admission may already have occurred.
    } finally {
      p.busy = false;
      p.controller = null;
      emit();
    }
  }

  async function addFiles(p, files) {
    const accepted = Array.from(files);
    if (p.busy) return;
    if ((p.attachments?.length || 0) + p.uploading + accepted.length > 4) {
      p.error = "每条消息最多 4 个附件";
      emit();
      return;
    }
    p.uploading = (p.uploading || 0) + accepted.length;
    p.error = "";
    emit();
    for (const file of accepted) {
      try {
        if (file.size > 10 * 1024 * 1024) throw Error("单个附件不能超过 10 MB");
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(Error("文件读取失败"));
          reader.readAsDataURL(file);
        });
        const r = await fetch(api() + "attachment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, mediaType: file.type, data }),
        });
        const result = await r.json();
        if (!r.ok) throw Error(result.error || "附件处理失败");
        (p.attachments ||= []).push({
          ...result,
          preview:
            result.kind === "image"
              ? `data:${file.type};base64,${data}`
              : undefined,
        });
      } catch (e) {
        p.error = `${file.name}：${e.message}`;
      } finally {
        p.uploading--;
        emit();
      }
    }
  }

  async function loadModels() {
    const request = ++modelRequest;
    try {
      const r = await fetch(api() + "models");
      const result = await r.json();
      if (request !== modelRequest) return;
      if (!r.ok) throw Error(result.error || "模型列表加载失败");
      models = result.models;
      modelError = result.errors.join("；");
      if (!models.length)
        modelError = modelError || "请先在 DSH 设置中配置可用模型";
      for (const list of paths.values())
        for (const p of list) if (!p.model) p.model = models[0]?.id || "";
    } catch (e) {
      if (request !== modelRequest) return;
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
    decidePromotion,
    lastUser,
    emit,
    loadModels,
    addFiles,
    native,
    get models() {
      return models;
    },
    get modelError() {
      return modelError;
    },
  };
}
