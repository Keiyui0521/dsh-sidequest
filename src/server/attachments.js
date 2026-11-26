const MAX_BYTES = 10 * 1024 * 1024;
const MAX_TEXT = 200000;
const imageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const textExtensions =
  /\.(txt|md|csv|tsv|json|jsonl|js|jsx|ts|tsx|py|html|css|xml|yml|yaml|log|tex|sh|sql|r|c|cpp|h|java)$/i;
export async function prepareAttachment(file, attachments) {
  if (
    !file ||
    typeof file.name !== "string" ||
    typeof file.data !== "string" ||
    file.name.length > 255
  )
    throw Error("无效附件");
  const bytes = Buffer.from(file.data, "base64");
  if (bytes.length > MAX_BYTES || bytes.toString("base64") !== file.data)
    throw Error("附件须小于 10 MB，且数据完整");
  const name = file.name.replace(/[\r\n]/g, " ");
  if (imageTypes.has(file.mediaType)) {
    if (!attachments?.saveImages) throw Error("此 DSH 版本未提供图片附件服务");
    const [ref] = await attachments.saveImages([
      { data: bytes, mediaType: file.mediaType, name },
    ]);
    return {
      name,
      kind: "image",
      blocks: [{ type: "image", attachment: ref }],
    };
  }
  let text;
  if (/\.pdf$/i.test(name)) {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: true,
      stopAtErrors: true,
    });
    try {
      const doc = await task.promise;
      if (doc.numPages > 100) throw Error("PDF 超过 100 页，请拆分后上传");
      const pages = [];
      let length = 0;
      for (let i = 1; i <= doc.numPages; i++) {
        const content = await (await doc.getPage(i)).getTextContent();
        const line = content.items.map((x) => x.str || "").join(" ");
        length += line.length;
        if (length > MAX_TEXT)
          throw Error("文件文字超过 20 万字，请拆分后上传");
        pages.push(`[第 ${i} 页]\n${line}`);
      }
      if (!pages.some((x) => x.replace(/\[第 \d+ 页\]/g, "").trim()))
        throw Error("此 PDF 没有可提取的文字；请粘贴页面截图供模型看图");
      text = pages.join("\n\n");
    } finally {
      await task.destroy();
    }
  } else if (/\.docx$/i.test(name)) {
    const mammoth = await import("mammoth");
    text = (await mammoth.default.extractRawText({ buffer: bytes })).value;
  } else if (
    textExtensions.test(name) ||
    (file.mediaType || "").startsWith("text/")
  ) {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw Error("文本文件请使用 UTF-8 编码");
    }
    if (text.includes("\0")) throw Error("该文件不是可读取的文本");
  } else throw Error("暂不支持此格式。支持图片、PDF、DOCX、文本和代码文件");
  if (!text.trim()) throw Error("文件没有可读取的文字");
  if (text.length > MAX_TEXT) throw Error("文件文字超过 20 万字，请拆分后上传");
  return {
    name,
    kind: "file",
    blocks: [
      {
        type: "text",
        text: `附件：${name}\n（以下为附件文字内容）\n${text}\n（附件结束）`,
      },
    ],
  };
}
