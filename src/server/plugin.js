import { readFileSync } from "node:fs";
import { startEphemeralServer } from "./transport.js";
import { loadConfig } from "./config.js";
import { createDshAdapter } from "../adapters/dsh-llm.js";

export const name = "sidequest";
export const inject = ["llm"];

export async function apply(ctx) {
  const config = loadConfig();
  const transport = await startEphemeralServer(createDshAdapter(ctx.llm), {
    root: config.workspace,
    attachments: ctx.get?.("attachments"),
  });
  ctx.on("dispose", () => transport.close());
  const vendor = readFileSync(
    new URL("../../dist/vendor.js", import.meta.url),
    "utf8",
  );
  ctx.on("webserver/index-inject", (table) => {
    table.push({
      kind: "global",
      name: "__sidequestTransport",
      value: { url: transport.url },
    });
    table.push({ kind: "script", placement: "head", text: vendor });
    table.push({
      kind: "html",
      placement: "head",
      html: `<link rel="stylesheet" href="${transport.url}katex.css">`,
    });
  });
}
