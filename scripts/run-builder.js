"use strict";

const { spawn } = require("node:child_process");

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_KILL_GRACE_MS = 5000;
const MAX_OUTPUT_BYTES = 64 * 1024;

function timeoutLabel(timeoutMs) {
  if (timeoutMs >= 60 * 1000 && timeoutMs % (60 * 1000) === 0) return `${timeoutMs / (60 * 1000)} 分钟`;
  return `${Math.ceil(timeoutMs / 1000)} 秒`;
}

function runBuilderProcess(options = {}) {
  const spawnImpl = options.spawnImpl || spawn;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const killGraceMs = Math.max(1, Number(options.killGraceMs) || DEFAULT_KILL_GRACE_MS);
  const failureLabel = options.failureLabel || "本地索引构建";

  return new Promise((resolve, reject) => {
    const child = spawnImpl(process.execPath, [options.builderFile], {
      cwd: options.rootDir,
      env: { ...process.env, ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    let settled = false;
    let timedOut = false;
    let killTimer = null;
    const append = (chunk) => {
      output = `${output}${chunk}`.slice(-MAX_OUTPUT_BYTES);
    };
    const timeoutError = () => new Error(`${failureLabel}超时（超过 ${timeoutLabel(timeoutMs)}），已终止`);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimer(timeoutTimer);
      if (killTimer) clearTimer(killTimer);
      if (error) reject(error);
      else resolve(value);
    };

    if (child.stdout) child.stdout.on("data", append);
    if (child.stderr) child.stderr.on("data", append);
    child.once("error", (error) => finish(timedOut ? timeoutError() : error));
    child.once("close", (code) => {
      if (timedOut) return finish(timeoutError());
      if (code === 0) finish(null, output);
      else finish(new Error(output.trim() || `${failureLabel}失败 (${code})`));
    });

    const timeoutTimer = setTimer(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimer(() => child.kill("SIGKILL"), killGraceMs);
      if (killTimer && typeof killTimer.unref === "function") killTimer.unref();
    }, timeoutMs);
    if (timeoutTimer && typeof timeoutTimer.unref === "function") timeoutTimer.unref();
  });
}

module.exports = { DEFAULT_TIMEOUT_MS, runBuilderProcess, timeoutLabel };
