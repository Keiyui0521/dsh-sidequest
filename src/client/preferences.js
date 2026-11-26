const KEY = "dsh-sidequest.preferences.v1";

// Persist preferences only. Conversation content remains outside browser storage.
export function createPreferences(storage) {
  let keepOriginal = false;
  try {
    keepOriginal =
      JSON.parse(storage?.getItem(KEY) || "{}").keepOriginal === true;
  } catch {}
  const listeners = new Set();
  return {
    snapshot: () => keepOriginal,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setKeepOriginal(value) {
      storage?.setItem(KEY, JSON.stringify({ keepOriginal: value === true }));
      keepOriginal = value === true;
      listeners.forEach((fn) => fn());
    },
  };
}

export function installPreferences(ctx, R, preferences) {
  const h = R.createElement;
  function Settings() {
    const enabled = R.useSyncExternalStore(
      preferences.subscribe,
      preferences.snapshot,
    );
    const [error, setError] = R.useState("");
    return h(
      "section",
      { className: "sidequest-settings" },
      h("h3", null, "主聊天编辑"),
      h(
        "label",
        { className: "sidequest-setting-row" },
        h("span", null, "编辑时保留原对话"),
        h("input", {
          type: "checkbox",
          role: "switch",
          checked: enabled,
          onChange: (e) => {
            try {
              preferences.setKeepOriginal(e.target.checked);
              setError("");
            } catch {
              setError("无法保存设置，请重试。");
            }
          },
        }),
      ),
      h(
        "p",
        null,
        "默认关闭：修改后的对话沿用原标题，旧对话自动归档，可从归档找回。开启后：原对话保留在列表，新回答进入独立分支。",
      ),
      error && h("p", { role: "alert" }, error),
    );
  }
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "sidequest",
        order: 80,
        label: () => "SideQuest",
      },
      Settings,
    ),
  );
}
