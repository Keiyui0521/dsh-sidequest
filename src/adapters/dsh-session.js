// Each pane owns an ordinary DSH session. Only the native host executes tools
// and decides access; this adapter never reads or edits files itself.
export function createNativeSessions(ctx) {
  const binding = (id) => ctx.sessions.binding(id);
  const entries = (session) => session.eventSource.getSnapshot().entries;
  const events = (session) =>
    entries(session)
      .filter((x) => x.type === "event")
      .map((x) => x.event);
  const permission = (session) =>
    session.projections.faceOf("permissions").getSnapshot()?.currentValue;
  const check = (result) => {
    if (!result?.ok) throw Error(result?.error?.message || "DSH 操作失败");
    return result.value;
  };
  async function ensure(p, emit) {
    if (p.native && p.rewindSeq == null) return p.native;
    if (!p.approved) throw Error("请先批准保存分支，未执行操作");
    const sourceId =
      p.rewindSeq != null ? p.sessionId : p.parent?.sessionId || p.root;
    const source = binding(sourceId)?.session;
    if (!source) throw Error("来源聊天尚未加载，请稍后重试");
    if (source.getSnapshot().running)
      throw Error("请先等待来源聊天完成，再开启侧聊");
    const id = await ctx.sessions.fork({
      sessionId: sourceId,
      ...(p.rewindSeq == null ? {} : { atSeq: p.rewindSeq - 1 }),
    });
    const ref = ctx.sessions.retain(id, { source: "sidequest-native" });
    try {
      const b = await ref.ready;
      p.native?.dispose();
      if (p.closed) {
        throw Error("侧聊已关闭");
      }
      const initial = events(b.session);
      p.baseSeq =
        p.rewindSeq == null
          ? Math.max(-1, ...initial.map((e) => e.seq))
          : p.baseSeq;
      p.rewindSeq = null;
      p.sessionId = id;
      p.native = {
        session: b.session,
        ref,
        dispose: () => {
          p.native?.unsub?.forEach((f) => f());
          ref.release();
        },
      };
      check(
        await b.session.rename(
          "侧聊 · " + (p.quote || "继续追问").slice(0, 30),
        ),
      );
      const refresh = () => {
        const es = events(b.session).filter((e) => e.seq > p.baseSeq);
        const rows = es.flatMap((e) => {
          const m =
            e.type === "user/message" && e.data.source?.kind === "user"
              ? e.data
              : e.type === "assistant/message"
                ? e.data.message
                : null;
          return m && m.content.some((b) => b.type === "text" && b.text?.trim())
            ? [
                {
                  role: e.type === "user/message" ? "user" : "assistant",
                  content: m.content,
                  seq: e.seq,
                },
              ]
            : [];
        });
        // Replace transient chunks with the host's committed message on settlement.
        const partial = new Map();
        for (const x of entries(b.session))
          if (x.type === "transient" && x.event.seq > p.baseSeq) {
            const d = x.event.data,
              c = d.chunk;
            if (c?.type === "text-delta")
              partial.set(
                d.attemptId,
                (partial.get(d.attemptId) || "") + c.text,
              );
          }
        for (const text of partial.values())
          rows.push({ role: "assistant", content: [{ type: "text", text }] });
        if (rows.length)
          p.messages = [
            ...(p.frozenHistory || []),
            ...rows.filter(
              (m) =>
                !(
                  m.role === "user" &&
                  m.content.some(
                    (b) => b.type === "text" && b.text === p.migrationText,
                  )
                ),
            ),
          ];
        p.tools = es
          .filter((e) => e.type === "tool/call" || e.type === "tool/result")
          .map((e) => ({ type: e.type, data: e.data }));
        p.pending = ctx.uiSession.sessionStatus
          .getSnapshot()
          .get(id)?.pendingInteraction;
        p.permission = permission(b.session);
        const state = b.session.getSnapshot();
        if (state.lastAgentError) p.error = state.lastAgentError;
        emit();
      };
      p.native.unsub = [
        b.session.eventSource.subscribe(refresh),
        b.session.subscribe(refresh),
        ctx.uiSession.sessionStatus.subscribe(refresh),
      ];
      refresh();
      return p.native;
    } catch (e) {
      p.native?.unsub?.forEach((f) => f());
      p.native = null;
      ref.release();
      throw e;
    }
  }
  return {
    async send(p, user, emit) {
      let n, before;
      let releaseAdmission;
      p.admission = new Promise((resolve) => {
        releaseAdmission = resolve;
      });
      try {
        n = await ensure(p, emit);
        if (p.closed) throw Error("侧聊已关闭");
        // Follow the root's CURRENT permission before each turn, never the global default.
        const source = binding(p.root)?.session;
        const preset = source && permission(source);
        if (!preset || preset === "custom")
          throw Error(
            "当前自定义权限尚不能可靠同步，侧聊未执行；请在主聊天选择标准访问模式",
          );
        if (permission(n.session) !== preset) {
          const result = check(
            await n.session.command("/permission " + preset),
          );
          if (!result.matched) throw Error("DSH 未提供权限切换接口");
        }
        if (permission(n.session) !== preset)
          throw Error("权限同步尚未完成，侧聊未执行，请重试");
        const [provider, model] = JSON.parse(p.model);
        check(
          await ctx.remote.session.selectModel({
            sessionId: p.sessionId,
            provider,
            model,
          }),
        );
        const content = await Promise.all(
          user.content.map(async (part) => {
            if (part.type !== "image") return part;
            const value = check(
              await n.session.readAttachment(part.attachment),
            );
            return { ...part, encodedBytes: value.data.byteLength };
          }),
        );
        before = Math.max(-1, ...events(n.session).map((e) => e.seq));
        p.controller = {
          abort: () =>
            n.session
              .cancel()
              .then(check)
              .catch((e) => {
                p.error = e.message;
                emit();
              }),
        };
        if (p.closed) throw Error("侧聊已关闭");
        check(
          await n.session.prompt(
            content,
            "queue",
            undefined,
            crypto.randomUUID(),
          ),
        );
      } finally {
        releaseAdmission();
        p.admission = null;
      }
      await new Promise((resolve, reject) => {
        const done = () => {
          const s = n.session.getSnapshot();
          if (s.openError || s.lastAgentError) {
            cleanup();
            reject(Error(s.lastAgentError || s.openError.message));
          } else if (
            events(n.session).some(
              (e) => e.seq > before && e.type === "turn/end",
            )
          ) {
            cleanup();
            resolve();
          }
        };
        const cleanup = () => {
          off1();
          off2();
        };
        const off1 = n.session.eventSource.subscribe(done),
          off2 = n.session.subscribe(done);
        done();
      });
    },
    async close(p) {
      p.closed = true;
      await p.admission;
      if (!p.native) return;
      if (p.busy || p.native.session.getSnapshot().running)
        check(await p.native.session.cancel());
      p.native.dispose();
      p.native = null;
    },
    async answer(p, outcome) {
      const pending = p.pending;
      if (pending?.kind !== "approval" || !pending.answerable)
        throw Error("这项审批已结束");
      await pending.answer(outcome);
    },
  };
}
