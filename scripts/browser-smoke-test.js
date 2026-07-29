#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
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
    await client.send("Browser.setDownloadBehavior", { behavior: "deny" });
    await client.send("Page.navigate", { url: `http://127.0.0.1:${appPort}/` });

    async function evaluate(expression, awaitPromise = true) {
      const result = await client.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "页面脚本执行失败");
      return result.result.value;
    }

    const readyStarted = Date.now();
    while (Date.now() - readyStarted < 20000) {
      if (await evaluate("document.readyState === 'complete' && document.querySelectorAll('.card-item').length > 0")) break;
      await delay(100);
    }
    const initialCount = await evaluate("document.querySelectorAll('#cardGrid .card-item').length");
    if (!initialCount) throw new Error("牌表没有渲染卡牌");

    const productSourceState = await evaluate(`(async () => {
      document.querySelector('#cardGrid [data-preview-image]').click();
      const started = Date.now();
      while (document.querySelector('.product-source-status.loading') && Date.now() - started < 5000) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const dialog = document.querySelector('#imagePreviewDialog');
      const panel = document.querySelector('.card-product-sources');
      const result = {
        opened: dialog.open,
        hasPanel: Boolean(panel),
        rowCount: document.querySelectorAll('.product-source-row').length,
        status: document.querySelector('.product-source-status')?.textContent.trim() || '',
        source: document.querySelector('.product-source-heading a')?.textContent.trim() || ''
      };
      document.querySelector('[data-close-image-preview]').click();
      result.closed = !dialog.open;
      return result;
    })()`);
    if (!productSourceState.opened || !productSourceState.hasPanel || !productSourceState.closed) {
      throw new Error("卡牌详情或产品来源面板开关失败");
    }
    if (!productSourceState.rowCount && !productSourceState.status.includes("尚未收录")) {
      throw new Error(`产品来源没有完成加载：${productSourceState.status || "无内容"}`);
    }
    if (!productSourceState.source.startsWith("MTGJSON")) throw new Error("产品来源没有标明数据出处");

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
    const sheetJsSource = await evaluate(`(async () => {
      document.querySelector('#exportBtn').click();
      const started = Date.now();
      while (!window.XLSX && Date.now() - started < 10000) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const script = [...document.scripts].find((item) => item.src.endsWith('/vendor/xlsx.full.min.js'));
      return window.XLSX && script ? script.src : '';
    })()`);
    if (!sheetJsSource.startsWith(`http://127.0.0.1:${appPort}/vendor/`)) throw new Error("Excel 组件没有从本地 vendor 目录加载");

    const workspacePayload = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "cube-data.json"), "utf8"));
    const publishedCube = workspacePayload.data || workspacePayload;
    const sourceCard = (publishedCube.cards || []).find((card) => card.scryfallId && (card.remoteImage || card.image));
    if (!sourceCard) throw new Error("没有可用于本地文件测试的卡牌");
    const fileCube = {
      meta: { id: "browser-file-smoke", name: "本地文件测试", description: "" },
      notes: "",
      cards: [{
        ...sourceCard,
        image: sourceCard.remoteImage || sourceCard.image,
        localImage: "",
        localThumbnail: "",
        backImage: sourceCard.remoteBackImage || sourceCard.backImage || "",
        localBackImage: "",
        localBackThumbnail: ""
      }],
      basicLands: []
    };
    const fileUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
    await client.send("Page.navigate", { url: fileUrl });
    const fileReadyStarted = Date.now();
    while (Date.now() - fileReadyStarted < 20000) {
      if (await evaluate("document.readyState === 'complete'")) break;
      await delay(100);
    }
    await evaluate(`(() => {
      localStorage.setItem(${JSON.stringify("arcana-cube-v1")}, ${JSON.stringify(JSON.stringify(fileCube))});
      localStorage.removeItem("arcana-cube-price-history-v1");
      localStorage.removeItem("arcana-cube-change-log-v1");
    })()`);
    await client.send("Page.reload", { ignoreCache: true });
    const fileCardStarted = Date.now();
    while (Date.now() - fileCardStarted < 20000) {
      if (await evaluate("document.readyState === 'complete' && document.querySelectorAll('#cardGrid .card-item').length === 1")) break;
      await delay(100);
    }
    const filePageState = await evaluate(`({
      readyState: document.readyState,
      cardCount: document.querySelectorAll('#cardGrid .card-item').length,
      previewButtonCount: document.querySelectorAll('#cardGrid [data-preview-image]').length,
      cardGridText: document.querySelector('#cardGrid')?.textContent.trim().slice(0, 200) || '',
      appScriptLoaded: Boolean(window.CubeProductSources && window.CubeCore),
      savedCubeName: (() => {
        try {
          const saved = JSON.parse(localStorage.getItem('arcana-cube-v1'));
          return saved?.data?.meta?.name || saved?.meta?.name || '';
        } catch (error) {
          return '';
        }
      })()
    })`);
    if (filePageState.previewButtonCount !== 1) {
      throw new Error(`本地文件牌表没有正确恢复：${JSON.stringify({ ...filePageState, runtimeErrors })}`);
    }
    const fileProductSourceState = await evaluate(`(async () => {
      document.querySelector('#cardGrid [data-preview-image]').click();
      const started = Date.now();
      while (document.querySelector('.product-source-status.loading') && Date.now() - started < 5000) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return {
        rowCount: document.querySelectorAll('.product-source-row').length,
        status: document.querySelector('.product-source-status')?.textContent.trim() || '',
        scriptSource: [...document.scripts].find((item) => item.src.endsWith('/product-source-index.js'))?.src || ''
      };
    })()`);
    if (!fileProductSourceState.rowCount && !fileProductSourceState.status.includes("尚未收录")) {
      throw new Error(`本地文件产品来源加载失败：${fileProductSourceState.status || "无内容"}`);
    }
    if (!fileProductSourceState.scriptSource.startsWith("file:")) throw new Error("本地文件模式没有使用同目录产品来源索引");
    if (runtimeErrors.length) throw new Error(`页面运行时错误：${runtimeErrors.join("; ")}`);
    process.stdout.write(`Browser smoke test passed: ${initialCount} cards, ${whiteCount} white cards, ${productSourceState.rowCount} HTTP product sources, ${fileProductSourceState.rowCount} file product sources.\n`);
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
