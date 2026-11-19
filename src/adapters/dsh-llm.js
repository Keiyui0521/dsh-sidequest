import { randomUUID } from "node:crypto";
const SYSTEM = `你正在 DSH 的 SideQuest 侧聊中回答用户。结合祖先聊天内容回答最后一个问题，使用用户的语言。
这里只提供文字对话，没有文件、命令或联网工具。不要声称已经读取或修改文件。
需要交互图表时，直接返回一个完整的 html 围栏代码块，使用内联 CSS 和 JavaScript；界面会将它显示为交互预览。
图表不能联网、访问父窗口或打开新窗口，不要依赖外部库。`;

export function createDshAdapter(llm) {
  if (!llm?.listProviders || !llm?.listModels || !llm?.prepareCall) {
    throw Error(
      "当前 DSH 缺少 SideQuest 所需的模型接口，请使用支持这些接口的 DSH 版本",
    );
  }
  return {
    async listModels() {
      const providers = await llm.listProviders();
      const results = await Promise.allSettled(
        providers.map((p) => llm.listModels(p.id)),
      );
      const models = [],
        errors = [];
      results.forEach((result, i) => {
        const provider = providers[i];
        if (result.status === "rejected") {
          errors.push(
            `${provider.name}: ${result.reason?.message || "模型列表加载失败"}`,
          );
          return;
        }
        for (const model of result.value) {
          models.push({
            id: JSON.stringify([provider.id, model.id]),
            name: `${provider.name} · ${model.name || model.id}`,
          });
        }
      });
      return { models, errors };
    },
    async *stream({ route, messages, signal }) {
      let selected;
      try {
        selected = JSON.parse(route);
      } catch {
        throw Error("请选择 DSH 中已配置的模型");
      }
      if (
        !Array.isArray(selected) ||
        selected.length !== 2 ||
        selected.some((s) => typeof s !== "string" || !s)
      ) {
        throw Error("无效的模型选择");
      }
      const [provider, model] = selected;
      // Pass only conversational text; tool calls and provider replay state from
      // the parent must not leak into an independent, tool-free conversation.
      const context = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .flatMap((m) => {
          const content = (Array.isArray(m.content) ? m.content : [])
            .filter((b) => b.type === "text" && typeof b.text === "string")
            .map((b) => ({ type: "text", text: b.text }));
          return content.length
            ? [
                {
                  id: randomUUID(),
                  role: m.role,
                  content,
                  source:
                    m.role === "assistant"
                      ? { kind: "model", provider, model }
                      : { kind: "user" },
                },
              ]
            : [];
        });
      if (!context.length || context.at(-1).role !== "user")
        throw Error("侧聊缺少用户提问");
      const call = await llm.prepareCall({ provider, model }, signal);
      for await (const chunk of call.stream({
        ...call.config,
        messages: context,
        system: SYSTEM,
        signal,
      })) {
        if (
          chunk.type === "finish" &&
          ["error", "aborted"].includes(chunk.reason?.kind)
        ) {
          throw Error(chunk.reason.failure?.message || "模型请求失败");
        }
        yield chunk;
      }
    },
  };
}
