// Use DSH's session fork/prompt APIs; never rewrite persisted history.
export function questionText(content) {
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

export async function editedContent(content, text, loadImage) {
  if (!text.trim()) throw new Error("请输入修改后的提问。");
  const result = [];
  let replaced = false;
  for (const part of content) {
    if (part.type === "text") {
      if (!replaced) result.push({ type: "text", text });
      replaced = true;
    } else if (part.type === "file") {
      result.push({ type: "file", attachment: part.attachment });
    } else if (part.type === "image" && part.attachment) {
      // Stored history omits the encoded byte count required by prompt admission.
      const url = await loadImage(part.attachment);
      const response = await fetch(url);
      if (!response.ok)
        throw new Error("无法读取原提问中的图片，原对话未修改。");
      const blob = await response.blob();
      result.push({
        type: "image",
        attachment: part.attachment,
        encodedBytes: blob.size,
      });
    } else {
      throw new Error(
        "这条提问包含当前版本尚不支持重新发送的内容，原对话未修改。",
      );
    }
  }
  if (!replaced) result.push({ type: "text", text });
  return result;
}

export async function regenerateQuestion(
  ctx,
  { sessionId, seq, content, attempt, keepOriginal = false },
) {
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new Error("当前 DSH 版本无法在这条消息之前创建分支，原对话未修改。");
  }
  const source = ctx.sessions.binding(sessionId)?.session;
  if (!source || source.getSnapshot().running)
    throw new Error("请等待当前回答结束后再编辑。");
  // Keep the same branch and request ID if a transport failure is retried.
  attempt.keepOriginal ??= keepOriginal;
  attempt.title ??= ctx.sessions.list?.getSnapshot().byId[sessionId]?.title;
  attempt.requestId ||= crypto.randomUUID();
  attempt.childId ||= await ctx.sessions.fork({
    sessionId,
    atSeq: seq - 1,
    increaseTitle: attempt.keepOriginal,
  });
  const ref = ctx.sessions.retain(attempt.childId, {
    source: "sidequest-main-edit",
  });
  try {
    const binding = await ref.ready;
    const result = await binding.session.prompt(
      content,
      "queue",
      undefined,
      attempt.requestId,
    );
    if (!result.ok)
      throw new Error(result.error?.message || "提问发送失败，请重试。");
    if (!attempt.keepOriginal) {
      if (attempt.title) {
        const renamed = await binding.session.rename(attempt.title);
        if (!renamed.ok)
          throw new Error(
            "新回答已开始，但未能保留原标题；旧对话尚未归档，请重试。",
          );
      }
      try {
        await ctx.uiWorkspace.archiveSession(sessionId);
      } catch {
        throw new Error(
          "新回答已开始，但旧对话归档失败，已保留两个版本；请重试。",
        );
      }
    }
    await ctx.uiWorkspace.openSession(attempt.childId);
    return attempt.childId;
  } finally {
    ref.release();
  }
}

export function installMainEdit(ctx, R, Icon, createPortal, preferences) {
  const h = R.createElement;
  if (!ctx.slots.entriesOfSlot) return;
  ctx.slots.inject("conversation.chat.node", () => {
    const original = ctx.slots
      .entriesOfSlot("conversation.chat.node")
      .find((entry) => entry.options.key === "user");
    if (!original) return;
    function EditableQuestion(props) {
      const [editing, setEditing] = R.useState(false);
      const [draft, setDraft] = R.useState("");
      const [busy, setBusy] = R.useState(false);
      const [error, setError] = R.useState("");
      const attempt = R.useRef({});
      const root = R.useRef(null);
      const [actionTarget, setActionTarget] = R.useState(null);
      const keepOriginal = R.useSyncExternalStore(
        preferences.subscribe,
        preferences.snapshot,
      );
      R.useLayoutEffect(() => {
        // Join the native flex toolbar; no fixed offsets or hashed DSH classes.
        setActionTarget(
          root.current?.querySelector('[data-clock="start"]') || null,
        );
      }, [props.node.key]);
      const session = props.useSession((state) => state);
      const data = props.node.data;
      async function save() {
        if (busy) return;
        setBusy(true);
        setError("");
        try {
          const content = await editedContent(
            data.content,
            draft,
            props.loadImage,
          );
          await regenerateQuestion(ctx, {
            sessionId: props.sessionId,
            seq: data.seq,
            content,
            attempt: attempt.current,
            keepOriginal,
          });
          setEditing(false);
        } catch (err) {
          setError(err.message || "未能重新生成，原对话已保留。");
        } finally {
          setBusy(false);
        }
      }
      return h(
        "div",
        { className: "sidequest-main-question", ref: root },
        h(original.component, {
          ...props,
          renderSlotChain: (_name, owner, options) =>
            props.renderSlotChain("sidequest.chat.user.before", owner, options),
        }),
        !editing &&
          actionTarget &&
          createPortal(
            h(
              "div",
              { className: "sidequest-main-edit-action" },
              h(
                "button",
                {
                  type: "button",
                  title: "编辑提问",
                  "aria-label": "编辑提问",
                  disabled: session?.running || busy,
                  onClick: () => {
                    setDraft(questionText(data.content));
                    setError("");
                    attempt.current = {};
                    setEditing(true);
                  },
                },
                h(Icon, { kind: "edit" }),
              ),
            ),
            actionTarget,
          ),
        editing &&
          h(
            "div",
            { className: "sidequest-main-editor" },
            h("textarea", {
              autoFocus: true,
              "aria-label": "修改历史提问",
              value: draft,
              disabled: busy,
              rows: Math.min(12, Math.max(3, draft.split("\n").length)),
              onChange: (e) => {
                setDraft(e.target.value);
                attempt.current = {};
              },
              onKeyDown: (e) => {
                if (e.key === "Escape" && !busy) setEditing(false);
                if (
                  e.key === "Enter" &&
                  (e.metaKey || e.ctrlKey) &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  save();
                }
              },
            }),
            h(
              "small",
              null,
              keepOriginal
                ? "将在新分支中重新回答，原对话保留。"
                : "修改后沿用原标题；旧对话自动归档，可从归档找回。",
            ),
            error && h("p", { role: "alert" }, error),
            h(
              "div",
              { className: "sidequest-main-editor-actions" },
              h(
                "button",
                {
                  type: "button",
                  disabled: busy,
                  onClick: () => setEditing(false),
                },
                "取消",
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "sidequest-main-save",
                  disabled: busy || !draft.trim() || session?.running,
                  onClick: save,
                },
                busy ? "正在重新生成…" : "保存并重新生成",
              ),
            ),
          ),
      );
    }
    const dispose = ctx.slots.register(
      {
        name: "conversation.chat.node",
        key: "user",
        id: "sidequest-edit-user",
        priority: -100,
        locale: original.locale,
        children: {
          "sidequest.chat.user.before": { kind: "chain", scope: "session" },
        },
      },
      EditableQuestion,
    );
    const before = ctx.slots
      .entriesOfSlot("conversation.chat.user.before")
      .map((entry) =>
        ctx.slots.register(
          {
            ...entry,
            ...entry.options,
            name: "sidequest.chat.user.before",
            children: undefined,
          },
          entry.component,
        ),
      );
    return () => {
      before.forEach((stop) => stop());
      dispose();
    };
  });
}
