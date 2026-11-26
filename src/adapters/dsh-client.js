export function createSessionReader(ctx) {
  function events(id) {
    return (
      ctx.sessions
        .binding(id)
        ?.eventSource.getSnapshot()
        .entries.filter((x) => x.type === "event")
        .map((x) => x.event) || []
    );
  }
  function messages(id) {
    return events(id).flatMap((e) => {
      const m =
        e.type === "assistant/message"
          ? e.data.message
          : e.type === "user/message"
            ? e.data
            : null;
      return m ? [{ role: m.role || "assistant", content: m.content }] : [];
    });
  }

  return messages;
}

// Read the same projection as DSH's native composer, including a model switched
// after the last reply. Do not infer the active model from message history.
export function createSessionModelReader(ctx) {
  return (id) => {
    const projection = ctx.sessions.binding(id)?.session?.projections;
    const state = projection?.faceOf("modelSelection").getSnapshot();
    const selected = state?.next ?? state?.lastUsed;
    return typeof selected?.provider === "string" &&
      selected.provider &&
      typeof selected?.model === "string" &&
      selected.model
      ? JSON.stringify([selected.provider, selected.model])
      : "";
  };
}
