import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/server/config.js";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "sidequest-config-"));
try {
  const config = path.join(root, "config.json");
  assert.deepEqual(loadConfig({ SIDEQUEST_CONFIG: config }), {});
  fs.writeFileSync(config, JSON.stringify({ workspace: root }));
  assert.equal(
    loadConfig({ SIDEQUEST_CONFIG: config }).workspace,
    fs.realpathSync(root),
  );
  assert.throws(
    () =>
      loadConfig({ SIDEQUEST_CONFIG: config, SIDEQUEST_WORKSPACE: "relative" }),
    /absolute workspace/,
  );
  console.log("PASS explicit workspace configuration and overrides");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
