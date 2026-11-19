import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startEphemeralServer } from "../src/server/transport.js";
import { visualizationParts as parse } from "../src/client/visualization.js";
const code = await fs.readFile(
  new URL("../src/client/render.js", import.meta.url),
  "utf8",
);
const file = "/course/数学/log.html";
assert.equal(
  parse("before visualize" + JSON.stringify({ path: file }) + " after")[1]
    .path,
  file,
);
assert.equal(parse("[图](</course/数学/log.html>)")[0].path, file);
assert.equal(parse("visualize{bad}")[0].text, "visualize{bad}");
assert.equal(parse("[link](https://example.com/x.html)")[0].path, undefined);
assert.match(code, /sandbox:\s*['"]allow-scripts['"]/);
assert.doesNotMatch(code, /sandbox:'allow-scripts allow-same-origin'/);
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-viz-")),
  root = path.join(dir, "course");
await fs.mkdir(root);
await fs.writeFile(path.join(root, "图.html"), "<script>test</script>");
await fs.writeFile(path.join(dir, "outside.html"), "outside");
await fs.symlink(
  path.join(dir, "outside.html"),
  path.join(root, "escape.html"),
);
const s = await startEphemeralServer({ listModels: async () => [] }, { root });
try {
  const get = (p, origin = "dsh-app://app") =>
    fetch(s.url + "visualization?path=" + encodeURIComponent(p), {
      headers: { Origin: origin },
    });
  const ok = await get(path.join(root, "图.html"));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).html, "<script>test</script>");
  assert.equal((await get(path.join(dir, "outside.html"))).status, 403);
  assert.equal((await get(path.join(root, "escape.html"))).status, 403);
  assert.equal(
    (await get(path.join(root, "图.html"), "https://evil.example")).status,
    403,
  );
  assert.equal((await get("/etc/passwd")).status, 400);
  console.log(
    "PASS directive and link parsing, HTML loading, traversal/symlink/origin restrictions, isolated frame",
  );
} finally {
  s.close();
  await fs.rm(dir, { recursive: true, force: true });
}

assert.equal(
  parse("before ```html\n<button>测试</button>\n``` after")[1].html,
  "<button>测试</button>\n",
);
assert.equal(parse("```html\nunfinished")[0].text, "```html\nunfinished");
