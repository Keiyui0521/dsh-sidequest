import assert from "node:assert/strict";
import { marked } from "marked";
import katex from "katex";
import { createRenderer } from "../src/client/render.js";
// Exercise the production Answer renderer, using real Markdown and KaTeX.
globalThis.window = { marked, katex, DOMPurify: { sanitize: (x) => x } };
const R = {
  createElement: (type, props, ...children) => ({ type, props, children }),
};
const { Answer } = createRenderer(R, () => "");
const render = (text) =>
  Answer({ text }).children[0].props.dangerouslySetInnerHTML.__html;
for (const text of [
  "$x=0$",
  "$x \\geqslant 0$",
  "$0$",
  "**$-1$**",
  "$(x)' = 1$",
  "$h \\to 0$",
  "$$x^2$$",
  "\\(x=0\\)",
  "\\[x^2\\]",
]) {
  assert.match(render(text), /class="katex/, text);
  assert.doesNotMatch(render(text), /katex-error/, text);
}
for (const text of [
  "`$x=0$`",
  '```js\nconst x = "$x$";\n```',
  "\\$20 and \\$30",
  "$20 and $30",
  "$x unfinished",
]) {
  assert.doesNotMatch(render(text), /class="katex/, text);
}
assert.equal((render("$x$ 和 $y$").match(/class="katex"/g) || []).length, 2);
console.log(
  "PASS inline/display math, bold text, code, escaped dollars, prices and incomplete streams",
);
