import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sidequest-package-"));
const manifest = JSON.parse(fs.readFileSync("package.json", "utf8"));
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: dir,
    encoding: "utf8",
    timeout: 60000,
  });
  if (result.status !== 0)
    throw Error(result.stderr || result.error?.message || result.stdout);
  return result.stdout;
}
try {
  fs.writeFileSync(
    path.join(dir, "package.json"),
    '{"private":true,"type":"module"}',
  );
  run(process.platform === "win32" ? "npm.cmd" : "npm", [
    "install",
    "--prefer-offline",
    "--ignore-scripts",
    "--omit=dev",
    "--no-audit",
    "--fetch-timeout=15000",
    "--fetch-retries=0",
    path.resolve(`${manifest.name}-${manifest.version}.tgz`),
  ]);
  fs.writeFileSync(
    path.join(dir, "smoke.mjs"),
    fs
      .readFileSync("tests/plugin-test.mjs", "utf8")
      .replace('"../index.js"', '"dsh-sidequest"'),
  );
  console.log(run(process.execPath, ["smoke.mjs"]));
  console.log("PASS independent package installation and startup");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
