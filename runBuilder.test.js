const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { runBuilderProcess, timeoutLabel } = require("./scripts/run-builder.js");

test("builder runner terminates a child process after its deadline", async (t) => {
  const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), "arcana-builder-timeout-"));
  t.after(() => fsp.rm(rootDir, { recursive: true, force: true }));
  const builderFile = path.join(rootDir, "builder.js");
  await fsp.writeFile(builderFile, "setInterval(() => {}, 1000);\n");

  await assert.rejects(runBuilderProcess({
    rootDir,
    builderFile,
    failureLabel: "测试构建",
    timeoutMs: 50,
    killGraceMs: 50
  }), /测试构建超时.*已终止/);
});

test("builder runner preserves useful failure output", async (t) => {
  const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), "arcana-builder-output-"));
  t.after(() => fsp.rm(rootDir, { recursive: true, force: true }));
  const builderFile = path.join(rootDir, "builder.js");
  await fsp.writeFile(builderFile, "process.stderr.write('specific failure'); process.exitCode = 2;\n");

  await assert.rejects(runBuilderProcess({ rootDir, builderFile, failureLabel: "测试构建" }), /specific failure/);
  assert.equal(timeoutLabel(30 * 60 * 1000), "30 分钟");
});
