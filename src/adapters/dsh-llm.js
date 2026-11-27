import { randomUUID } from "node:crypto";
const SYSTEM = `你正在 DSH 的 SideQuest 侧聊中回答用户。结合祖先聊天内容回答最后一个问题，使用用户的语言。
你可以读取用户消息中的图片和已提取的附件文字；不能直接执行命令或访问本地文件。不要声称读过未提供的文件，PDF/DOCX 的提取文字不含原始版式或内嵌图片。
需要交互图表时，直接返回一个完整的 html 围栏代码块，使用内联 CSS 和 JavaScript；界面会将它显示为交互预览。
图表不能联网、访问父窗口或打开新窗口，不要依赖外部库。
需要访问未提供的本地文件、修改文件、执行任何命令或申请权限时，必须调用 request_branch_approval，请求用户确认保存成分支后再交给 DSH 执行。此工具只提出申请，不会执行任何操作。普通解释、已提供附件分析和内联图表不调用此工具。不得假装已完成本地操作。`;

const PROMOTION_TOOL = {
  name: "request_branch_approval",
  description:
    "仅申请用户批准：保存本次临时侧聊为 DSH 分支后，使用主聊天权限执行所述任务。不会直接执行操作。",
  parameters: {
    type: "object",
    properties: { reason: { type: "string" }, task: { type: "string" } },
    required: ["reason", "task"],
    additionalProperties: false,
  },
};
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
            inputModalities: model.inputModalities,
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
            .filter(
              (b) =>
                (b.type === "text" && typeof b.text === "string") ||
                (m.role === "user" && b.type === "image" && b.attachment),
            )
            .map((b) =>
              b.type === "text"
                ? { type: "text", text: b.text }
                : { type: "image", attachment: b.attachment },
            );
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
      let proposal;
      for await (const chunk of call.stream({
        ...call.config,
        messages: context,
        system: SYSTEM,
        tools: [PROMOTION_TOOL],
        signal,
      })) {
        if (
          chunk.type === "finish" &&
          ["error", "aborted"].includes(chunk.reason?.kind)
        ) {
          throw Error(chunk.reason.failure?.message || "模型请求失败");
        }
        if (chunk.type === "block-end" && chunk.block?.type === "tool-call") {
          if (chunk.block.name !== PROMOTION_TOOL.name)
            throw Error("模型请求了不可用的工具，未执行任何操作");
          const value = JSON.parse(chunk.block.arguments);
          if (
            !value ||
            [value.reason, value.task].some(
              (x) => typeof x !== "string" || !x.trim() || x.length > 12000,
            )
          )
            throw Error("操作申请格式无效，请重新提问");
          if (proposal) throw Error("一次只能申请一个任务，请重新提问");
          proposal = { reason: value.reason, task: value.task };
        }
        if (chunk.type === "text-delta") yield chunk;
      }
      if (proposal && !signal?.aborted)
        yield { type: "branch-approval", proposal };
    },
  };
}
