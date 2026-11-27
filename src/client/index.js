import { createNativeSessions } from "../adapters/dsh-session.js";
import css from "./styles.css";
import { createPreferences, installPreferences } from "./preferences.js";
import { installMainEdit } from "./main-edit.js";
import { createStore } from "./store.js";
import { createRenderer } from "./render.js";
import {
  createSessionReader,
  createSessionModelReader,
} from "../adapters/dsh-client.js";
window.__ModuleLoader__.load({
  id: "dsh-sidequest",
  factory: (require) => {
    const R = require("react"),
      h = R.createElement;
    return {
      inject: [
        "slots",
        "sessions",
        "uiConversation",
        "conversation",
        "uiWorkspace",
        "uiSession",
        "remote",
        "remote.session",
      ],
      apply(ctx) {
        const store = createStore(
          createSessionReader(ctx),
          createSessionModelReader(ctx),
          createNativeSessions(ctx),
        );
        const { paths, subscribe, open, close, send, lastUser, emit } = store;
        const { Answer } = createRenderer(R, store.api);
        function Icon({ kind }) {
          return h(
            "svg",
            {
              width: 16,
              height: 16,
              viewBox: "0 0 24 24",
              fill: "none",
              stroke: "currentColor",
              strokeWidth: 1.6,
              "aria-hidden": true,
            },
            kind === "edit"
              ? h("path", { d: "M16 3l5 5M4 20l4-1L21 6a2 2 0 0 0-3-3L5 16z" })
              : h(
                  R.Fragment,
                  null,
                  h("rect", { x: 8, y: 8, width: 12, height: 12, rx: 2 }),
                  h("path", { d: "M16 8V4H4v12h4" }),
                ),
          );
        }
        const preferences = createPreferences(window.localStorage);
        installPreferences(ctx, R, preferences);
        installMainEdit(
          ctx,
          R,
          Icon,
          require("react-dom").createPortal,
          preferences,
        );
        function Copy({ text }) {
          const [done, setDone] = R.useState(false);
          return h(
            "button",
            {
              type: "button",
              title: done ? "已复制" : "复制",
              "aria-label": done ? "已复制" : "复制消息",
              onClick: async () => {
                try {
                  await navigator.clipboard.writeText(text);
                  setDone(true);
                } catch {
                  setDone(false);
                }
              },
            },
            h(Icon, { kind: "copy" }),
          );
        }
        function AttachmentChips({ items, remove }) {
          return h(
            "div",
            { className: "sidequest-attachments" },
            ...items.map((a, i) =>
              h(
                "div",
                { key: i, className: "sidequest-attachment" },
                a.preview && h("img", { src: a.preview, alt: a.name }),
                h("span", null, a.name),
                remove &&
                  h(
                    "button",
                    {
                      type: "button",
                      "aria-label": "移除附件 " + a.name,
                      onClick: () => remove(i),
                    },
                    "×",
                  ),
              ),
            ),
          );
        }
        function Pane({ p, root, index }) {
          R.useSyncExternalStore(subscribe, store.snapshot);
          const [selected, setSelected] = R.useState(null);
          R.useEffect(() => {
            const dismiss = () => setSelected(null);
            const selection = () => {
              if (window.getSelection()?.isCollapsed) dismiss();
            };
            const key = (e) => {
              if (e.key === "Escape") dismiss();
            };
            document.addEventListener("selectionchange", selection);
            document.addEventListener("keydown", key);
            window.addEventListener("resize", dismiss);
            return () => {
              document.removeEventListener("selectionchange", selection);
              document.removeEventListener("keydown", key);
              window.removeEventListener("resize", dismiss);
            };
          }, []);
          return h(
            "section",
            { className: "sidequest-pane" },
            h(
              "header",
              null,
              h("span", null, "侧聊 " + (index + 1)),
              h(
                "button",
                {
                  onClick: () => close(root, index),
                  "aria-label": "关闭侧聊 " + (index + 1),
                },
                "关闭",
              ),
            ),
            h(
              "div",
              {
                className: "sidequest-messages",
                onScroll: () => setSelected(null),
                onMouseUp: (e) => {
                  const s = window.getSelection();
                  if (
                    s &&
                    !s.isCollapsed &&
                    s.rangeCount &&
                    e.currentTarget.contains(s.anchorNode) &&
                    e.currentTarget.contains(s.focusNode)
                  ) {
                    const rect = s.getRangeAt(0).getBoundingClientRect();
                    const text = s.toString();
                    if (text.trim())
                      setSelected({
                        text,
                        left: Math.max(
                          8,
                          Math.min(rect.left, window.innerWidth - 272),
                        ),
                        top: rect.top > 60 ? rect.top - 52 : rect.bottom + 8,
                      });
                  } else setSelected(null);
                },
              },
              p.messages.length === 0 &&
                h(
                  "p",
                  { className: "sidequest-hint" },
                  "已带入父级上下文。普通侧聊不保存；需要访问本地文件、执行命令或申请权限时，先征求你的确认。",
                ),
              ...p.messages.map((m, i) =>
                h(
                  "article",
                  {
                    key: i,
                    className: m.role === "user" ? "sidequest-user-row" : "",
                    tabIndex: m.role === "user" ? 0 : undefined,
                  },
                  h(
                    "div",
                    { className: m.role === "user" ? "sidequest-user" : "" },
                    m.attachments?.length > 0 &&
                      h(AttachmentChips, { items: m.attachments }),
                    h(Answer, {
                      text:
                        m.question ??
                        m.content.map((b) => b.text || "").join("\n"),
                      interactive: m.role === "assistant",
                    }),
                  ),
                  m.role === "user" &&
                    h(
                      "div",
                      { className: "sidequest-message-actions" },
                      h(Copy, {
                        text: m.content.map((b) => b.text || "").join("\n"),
                      }),
                      i === lastUser(p.messages) &&
                        (!p.native || m.seq != null) &&
                        h(
                          "button",
                          {
                            title: "编辑上一条提问",
                            "aria-label": "编辑上一条提问",
                            disabled: p.busy || !!p.proposal,
                            onClick: () => {
                              p.draft =
                                m.question ??
                                m.content.map((b) => b.text || "").join("\n");
                              p.attachments = [...(m.attachments || [])];
                              p.rewindSeq = m.seq;
                              p.messages = p.messages.slice(0, i);
                              p.quote = "";
                              close(root, index + 1);
                              emit();
                            },
                          },
                          h(Icon, { kind: "edit" }),
                        ),
                    ),
                ),
              ),
              p.permission &&
                h(
                  "p",
                  { className: "sidequest-hint" },
                  "访问模式：" + p.permission + " · 发送时同步主聊天",
                ),
              p.tools?.length > 0 &&
                h(
                  "details",
                  { className: "sidequest-tools" },
                  h("summary", null, "工具操作（" + p.tools.length + "）"),
                  ...p.tools.map((t, i) =>
                    h("pre", { key: i }, JSON.stringify(t.data, null, 2)),
                  ),
                ),
              h(
                "p",
                { className: "sidequest-hint" },
                p.sessionId
                  ? "已保存为 DSH 分支 · 关闭侧栏后仍可找回"
                  : "临时侧聊 · 关闭后不保留对话",
              ),
              p.proposal &&
                h(
                  "div",
                  {
                    className: "sidequest-approval",
                    role: "group",
                    "aria-label": "保存分支确认",
                  },
                  h("strong", null, "保存为分支并继续？"),
                  h("p", null, p.proposal.reason),
                  h("pre", null, p.proposal.task),
                  h(
                    "p",
                    null,
                    "批准后会保存当前侧聊内容，并使用主聊天的访问权限。DSH 要求的操作审批仍需单独确认。",
                  ),
                  h(
                    "button",
                    {
                      disabled: p.busy,
                      onClick: () => store.decidePromotion(p, false),
                    },
                    "拒绝并保持临时",
                  ),
                  h(
                    "button",
                    {
                      disabled: p.busy,
                      onClick: () => store.decidePromotion(p, true),
                    },
                    "批准并保存分支",
                  ),
                ),
              p.pending &&
                h(
                  "div",
                  {
                    className: "sidequest-approval",
                    role: "group",
                    "aria-label": "侧聊权限审批",
                  },
                  h("strong", null, "等待你的确认"),
                  h(
                    "p",
                    null,
                    p.pending.reason || p.pending.toolName || "DSH 请求交互",
                  ),
                  h(
                    "pre",
                    null,
                    p.tools?.find(
                      (t) =>
                        t.type === "tool/call" &&
                        t.data.callId === p.pending.callId,
                    )?.data.arguments || "",
                  ),
                  p.pending.kind === "approval"
                    ? h(
                        "div",
                        null,
                        ...[
                          ["拒绝", "rejected"],
                          ["允许一次", "allowed-once"],
                        ].map(([label, outcome]) =>
                          h(
                            "button",
                            {
                              key: outcome,
                              disabled: p.answering,
                              onClick: async () => {
                                p.answering = true;
                                emit();
                                try {
                                  await store.native.answer(p, outcome);
                                } catch (e) {
                                  p.error = e.message;
                                } finally {
                                  p.answering = false;
                                  emit();
                                }
                              },
                            },
                            label,
                          ),
                        ),
                      )
                    : h(
                        "button",
                        {
                          onClick: () =>
                            ctx.uiWorkspace.openSession(p.sessionId),
                        },
                        "在主窗口处理此请求",
                      ),
                ),
              store.modelError && h("p", { role: "alert" }, store.modelError),
              p.busy && h("p", { role: "status" }, "正在思考 / 回答…"),
              p.error && h("p", { role: "alert" }, p.error),
            ),
            selected &&
              h(
                "div",
                {
                  className: "sidequest-selection sidequest-floating",
                  role: "toolbar",
                  "aria-label": "选中文字操作",
                  style: { left: selected.left, top: selected.top },
                },
                h(
                  "button",
                  {
                    onMouseDown: (e) => e.preventDefault(),
                    onClick: () => {
                      p.quote = selected.text;
                      setSelected(null);
                      window.getSelection()?.removeAllRanges();
                      emit();
                    },
                  },
                  "引用文本",
                ),
                h(
                  "button",
                  {
                    onMouseDown: (e) => e.preventDefault(),
                    onClick: () => {
                      open(root, p, selected.text);
                      setSelected(null);
                      window.getSelection()?.removeAllRanges();
                    },
                  },
                  "侧边提问",
                ),
              ),
            h(
              "div",
              {
                className: "sidequest-compose",
                onDragOver: (e) => {
                  e.preventDefault();
                },
                onDrop: (e) => {
                  e.preventDefault();
                  store.addFiles(p, e.dataTransfer.files);
                },
              },
              h(AttachmentChips, {
                items: p.attachments || [],
                remove: (i) => {
                  p.attachments.splice(i, 1);
                  emit();
                },
              }),
              p.attachments?.length > 0 &&
                h(
                  "small",
                  { className: "sidequest-hint" },
                  "每条最多 4 个附件，单个 10 MB；PDF/Word 仅提取文字，图表请另附截图。",
                ),
              p.uploading > 0 && h("p", { role: "status" }, "正在读取附件…"),
              p.quote &&
                h(
                  "blockquote",
                  null,
                  p.quote,
                  h(
                    "button",
                    {
                      "aria-label": "取消引用",
                      onClick: () => {
                        p.quote = "";
                        emit();
                      },
                    },
                    "×",
                  ),
                ),
              h("textarea", {
                "aria-label": "侧聊 " + (index + 1) + " 提问",
                placeholder: "输入问题，可粘贴图片或拖入文件…",
                onPaste: (e) => {
                  const files = Array.from(e.clipboardData.files || []);
                  if (files.length) {
                    e.preventDefault();
                    store.addFiles(p, files);
                  }
                },
                value: p.draft,
                onChange: (e) => {
                  p.draft = e.target.value;
                  emit();
                },
                onKeyDown: (e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    send(p);
                  }
                },
              }),
              h(
                "div",
                { className: "sidequest-tools" },
                h(
                  "label",
                  { className: "sidequest-upload" },
                  "＋ 附件",
                  h("input", {
                    type: "file",
                    multiple: true,
                    disabled: p.busy || p.uploading > 0,
                    "aria-label": "添加图片或文件",
                    accept:
                      "image/png,image/jpeg,image/webp,image/gif,.pdf,.docx,.txt,.md,.csv,.tsv,.json,.js,.ts,.py,.html,.css,.xml,.yml,.yaml,.log,.tex",
                    onChange: (e) => {
                      store.addFiles(p, e.target.files);
                      e.target.value = "";
                    },
                  }),
                ),
                h(
                  "select",
                  {
                    "aria-label": "侧聊模型",
                    onFocus: () => store.loadModels(),
                    value: p.model,
                    onChange: (e) => {
                      p.model = e.target.value;
                      emit();
                    },
                  },
                  p.model &&
                    !store.models.some((m) => m.id === p.model) &&
                    h(
                      "option",
                      { value: p.model },
                      "当前聊天模型 · " +
                        (() => {
                          try {
                            return JSON.parse(p.model).join(" · ");
                          } catch {
                            return p.model;
                          }
                        })(),
                    ),
                  ...store.models.map((m) =>
                    h("option", { key: m.id, value: m.id }, m.name),
                  ),
                ),
                h(
                  "button",
                  {
                    type: "button",
                    "aria-label": "刷新侧聊模型列表",
                    title: "同步 DSH 模型配置",
                    onClick: () => store.loadModels(),
                  },
                  "刷新模型",
                ),
                p.busy
                  ? h(
                      "button",
                      { onClick: () => p.controller?.abort() },
                      "停止",
                    )
                  : h(
                      "button",
                      {
                        disabled:
                          (!p.draft.trim() && !p.attachments?.length) ||
                          !p.model ||
                          p.uploading > 0 ||
                          !!p.proposal,
                        onClick: () => send(p),
                      },
                      "发送",
                    ),
              ),
            ),
          );
        }
        function Content(p) {
          const session = p.useSession((s) => s),
            conversation = p.useConversation((s) => s);
          const active =
            !!session &&
            (conversation?.activeTargets.size > 0 ||
              (!session.blank && !session.awaitingFirstTurn) ||
              session.running);
          const hero = !session || (!active && session.blank);
          return p.renderFactorySlot("conversation.content", {
            variant: "embedded",
            phase: hero ? "hero" : "active",
            hero,
          });
        }
        function Main(p) {
          R.useSyncExternalStore(subscribe, store.snapshot);
          const sides = paths.get(p.sessionId) || [];
          return h(
            "div",
            { className: "sidequest-columns" },
            h(
              "section",
              { className: "sidequest-pane" },
              h(
                "div",
                { className: "sidequest-native" },
                h(Content, { ...p, key: p.sessionId || "new" }),
              ),
            ),
            ...sides.map((s, i) =>
              h(Pane, { key: s.id, p: s, root: p.sessionId, index: i }),
            ),
          );
        }
        function Selection(p) {
          return h(
            "div",
            { className: "sidequest-selection" },
            h(
              "button",
              {
                onPointerDown: (e) => e.preventDefault(),
                onClick: () => {
                  const t = p.readText();
                  if (t && p.inputActions.insertQuote(t)) {
                    p.clearSelection();
                    p.dismiss();
                  }
                },
              },
              "引用文本",
            ),
            h(
              "button",
              {
                onPointerDown: (e) => e.preventDefault(),
                onClick: () => {
                  const t = p.readText();
                  if (t) {
                    open(p.sessionId, null, t);
                    p.clearSelection();
                    p.dismiss();
                  }
                },
              },
              "侧边提问",
            ),
          );
        }
        ctx.slots.inject("main.conversation", () =>
          ctx.slots.register(
            { name: "main.conversation", id: "sidequest-main", priority: -100 },
            Main,
          ),
        );
        // Reuse the built-in quote gesture, replacing only its action surface.
        ctx.slots.inject("conversation.chat.text-interaction", () =>
          ctx.slots.register(
            {
              name: "conversation.chat.text-interaction",
              key: "quote",
              id: "sidequest-quotes",
              priority: -100,
            },
            Selection,
          ),
        );

        const style = document.createElement("style");
        style.textContent = css;
        document.head.append(style);
        store.loadModels();
        ctx.on("dispose", () => {
          for (const root of paths.keys()) close(root, 0);
          style.remove();
        });
      },
    };
  },
});
