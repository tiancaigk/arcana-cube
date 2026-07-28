const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const startPath = path.join(__dirname, "启动 Cube.command");
const stopPath = path.join(__dirname, "停止 Cube.command");
const startSource = fs.readFileSync(startPath, "utf8");
const stopSource = fs.readFileSync(stopPath, "utf8");

test("macOS launchers resolve the project directory and manage one local server", () => {
  assert.match(startSource, /PROJECT_DIR="\$\{0:A:h\}"/);
  assert.match(startSource, /node scripts\/local-server\.js/);
  assert.match(startSource, /local-server-\$\{PORT\}\.pid/);
  assert.match(startSource, /open -a "Google Chrome"/);
  assert.match(stopSource, /scripts\/local-server\.js/);
  assert.match(stopSource, /kill "\$\{pid\}"/);
});

test("macOS launchers are executable", () => {
  assert.ok(fs.statSync(startPath).mode & 0o111);
  assert.ok(fs.statSync(stopPath).mode & 0o111);
});
