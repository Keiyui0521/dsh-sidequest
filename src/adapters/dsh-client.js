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
