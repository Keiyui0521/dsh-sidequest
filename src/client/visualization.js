export function visualizationParts(text) {
  const parts = [];
  let at = 0;
  const pattern =
    /```html\s*\n([\s\S]*?)```|\uE200visualize\uE202(\{[^\n]*?\})\uE201|:::visualize\s*(\{[^\n]*?\})|\[[^\]\n]*\]\(<?(\/[^\n<>]*?\.html?)>?\)/g;
  for (const m of text.matchAll(pattern)) {
    if (m[1] !== undefined) {
      if (m.index > at) parts.push({ text: text.slice(at, m.index) });
      parts.push({ html: m[1] });
      at = m.index + m[0].length;
      continue;
    }
    let file;
    try {
      file = m[4] || JSON.parse(m[2] || m[3]).path;
    } catch {
      continue;
    }
    if (
      typeof file !== "string" ||
      !file.startsWith("/") ||
      !/\.html?$/i.test(file)
    )
      continue;
    if (m.index > at) parts.push({ text: text.slice(at, m.index) });
    parts.push({ path: file });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}
