#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createLocalServer } = require("./local-server.js");

const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJson(url, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (error) {
      // Chrome may still be starting.
    }
    await delay(100);
  }
  throw new Error(`等待 Chrome 调试端口超时：${url}`);
}

function createCdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const listeners = new Map();
  let sequence = 0;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    (listeners.get(message.method) || []).forEach((listener) => listener(message.params));
  });
  return {
    async open() {
      if (socket.readyState === WebSocket.OPEN) return;
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
      });
    },
    send(method, params = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, listener) {
      const current = listeners.get(method) || [];
      current.push(listener);
      listeners.set(method, current);
    },
    close() {
      socket.close();
    }
  };
}

async function main() {
  if (!fs.existsSync(chromePath)) throw new Error(`没有找到 Chrome：${chromePath}`);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "arcana-cube-browser-"));
  const debugPort = 9300 + Math.floor(Math.random() * 500);
  const server = createLocalServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const appPort = server.address().port;
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    "about:blank"
  ], { stdio: "ignore" });

  let client;
  try {
    const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
    const page = targets.find((target) => target.type === "page");
    if (!page) throw new Error("Chrome 没有可用页面");
    client = createCdpClient(page.webSocketDebuggerUrl);
    await client.open();
    const runtimeErrors = [];
    client.on("Runtime.exceptionThrown", (event) => runtimeErrors.push(event.exceptionDetails && event.exceptionDetails.text || "Runtime exception"));
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await client.send("Page.navigate", { url: `http://127.0.0.1:${appPort}/` });

    async function evaluate(expression, awaitPromise = true) {
      const result = await client.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "页面脚本执行失败");
      return result.result.value;
    }

    const readyStarted = Date.now();
    while (Date.now() - readyStarted < 10000) {
      if (await evaluate("document.readyState === 'complete' && document.querySelectorAll('.card-item').length > 0")) break;
      await delay(100);
    }
    const initialCount = await evaluate("document.querySelectorAll('#cardGrid .card-item').length");
    if (!initialCount) throw new Error("牌表没有渲染卡牌");

    const dialogState = await evaluate(`(async () => {
      document.querySelector('#addCardBtn').click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const opened = document.querySelector('#addCardDialog').open;
      document.querySelector('#addCardDialog [data-close-dialog]').click();
      return { opened, closed: !document.querySelector('#addCardDialog').open };
    })()`);
    if (!dialogState.opened || !dialogState.closed) throw new Error("添加卡牌弹窗开关失败");

    const whiteCount = await evaluate(`(async () => {
      document.querySelector('[data-color="W"]').click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return document.querySelectorAll('#cardGrid .card-item').length;
    })()`);
    if (!(whiteCount > 0 && whiteCount < initialCount)) throw new Error("颜色筛选没有更新牌表");

    const analyticsScope = await evaluate(`(async () => {
      document.querySelector('[data-view="analytics"]').click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      document.querySelector('[data-analytics-color="W"]').click();
      document.querySelector('[data-analytics-type="Creature"]').click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return document.querySelector('#manaCurveScope').textContent;
    })()`);
    if (!analyticsScope.includes("白") || !analyticsScope.includes("生物")) throw new Error("分析组合筛选没有更新法力曲线");
    if (runtimeErrors.length) throw new Error(`页面运行时错误：${runtimeErrors.join("; ")}`);
    process.stdout.write(`Browser smoke test passed: ${initialCount} cards, ${whiteCount} white cards.\n`);
  } finally {
    if (client) client.close();
    chrome.kill("SIGTERM");
    await new Promise((resolve) => chrome.once("exit", resolve)).catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
