#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");
const { cubeFingerprint } = require("../mtgjsonPrices.js");
const { createLocalServer } = require("./local-server.js");

const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasCompletedProductSourceResult(state) {
  return state.rowCount > 0 || /尚未收录|当前没有这张|已识别当前实体版本|索引与牌表版本不一致/.test(state.status || "");
}

function findHistoryShardFixture(rootDir) {
  const context = {};
  fs.readdirSync(rootDir)
    .filter((fileName) => /^mtgjson-history-[0-9a-f]\.js$/.test(fileName))
    .sort()
    .forEach((fileName) => {
      vm.runInNewContext(fs.readFileSync(path.join(rootDir, fileName), "utf8"), context, { filename: fileName });
    });
  const shards = context.CubeMtgjsonHistoryShardData || {};
  for (const key of Object.keys(shards).sort()) {
    const shard = shards[key];
    for (const [scryfallId, entry] of Object.entries(shard.cards || {}).sort(([a], [b]) => a.localeCompare(b))) {
      if ((entry.foil || []).length === 90 && (entry.nonfoil || []).length === 90) {
        return { key, scryfallId };
      }
    }
  }
  throw new Error("离线 MTGJSON 历史分片中没有可用于浏览器测试的完整版本");
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
  const rootDir = path.join(__dirname, "..");
  const bundledPriceIndex = JSON.parse(fs.readFileSync(path.join(rootDir, "mtgjson-price-index.json"), "utf8"));
  const historyShardFixture = findHistoryShardFixture(rootDir);
  let localPriceIndexReads = 0;
  let localPriceIndexUpdates = 0;
  const server = createLocalServer({
    host: "127.0.0.1",
    port: 0,
    priceIndexService: {
      readIndex: async () => {
        localPriceIndexReads += 1;
        return bundledPriceIndex;
      },
      update: async (cubeData) => {
        localPriceIndexUpdates += 1;
        const cards = [...(cubeData.cards || []), ...(cubeData.basicLands || [])];
        return {
          ...bundledPriceIndex,
          source: { ...(bundledPriceIndex.source || {}), cubeFingerprint: cubeFingerprint(cards) }
        };
      }
    }
  });
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
    const networkFailures = [];
    const networkRequests = new Map();
    client.on("Runtime.exceptionThrown", (event) => runtimeErrors.push(event.exceptionDetails && event.exceptionDetails.text || "Runtime exception"));
    client.on("Network.requestWillBeSent", (event) => networkRequests.set(event.requestId, event.request && event.request.url || ""));
    client.on("Network.loadingFailed", (event) => networkFailures.push(`${event.errorText || "network error"}: ${networkRequests.get(event.requestId) || ""}`));
    await client.send("Runtime.enable");
    await client.send("Network.enable");
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

    async function measureCollectionGrid(width) {
      await client.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false
      });
      await delay(50);
      return evaluate(`(() => {
        const grid = document.querySelector('#cardGrid .card-group-grid');
        const card = grid?.querySelector('.card-item');
        return {
          columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
          cardWidth: card ? card.getBoundingClientRect().width : 0
        };
      })()`);
    }

    const narrowMainGrid = await measureCollectionGrid(1280);
    const wideMainGrid = await measureCollectionGrid(1720);

    async function measureBasicLandGrid(width) {
      await client.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false
      });
      await delay(50);
      return evaluate(`(async () => {
      document.querySelector('[data-view="basicLands"]').click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const grid = document.querySelector('#basicLandGrid .card-group-grid');
      const card = grid?.querySelector('.card-item');
      const result = {
        columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
        cardWidth: card ? card.getBoundingClientRect().width : 0
      };
      document.querySelector('[data-view="collection"]').click();
      return result;
    })()`);
    }

    const narrowBasicLandGrid = await measureBasicLandGrid(1280);
    const wideBasicLandGrid = await measureBasicLandGrid(1720);
    if (narrowMainGrid.columns !== 6 || wideMainGrid.columns !== 6
      || !(wideMainGrid.cardWidth > narrowMainGrid.cardWidth)
      || narrowBasicLandGrid.columns !== 5 || wideBasicLandGrid.columns !== 5
      || !(wideBasicLandGrid.cardWidth > narrowBasicLandGrid.cardWidth)) {
      throw new Error(`牌表列数或弹性尺寸错误：${JSON.stringify({
        narrowMainGrid,
        wideMainGrid,
        narrowBasicLandGrid,
        wideBasicLandGrid
      })}`);
    }

    await evaluate("document.querySelector('[data-refresh-prices]').click()");
    const localUpdateStarted = Date.now();
    while (localPriceIndexUpdates < 1 && Date.now() - localUpdateStarted < 10000) await delay(25);
    const localPriceState = await evaluate(`(async () => {
      const started = Date.now();
      while (document.querySelector('[data-refresh-prices].loading') && Date.now() - started < 10000) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return document.querySelector('.stat-card:last-child .stat-foot')?.textContent.trim() || '';
    })()`);
    if (!localPriceState.includes("本地 MTGJSON") || localPriceIndexUpdates !== 1) {
      throw new Error(`手动价格更新没有优先使用本地索引：${localPriceState || "无状态"}，更新 ${localPriceIndexUpdates} 次`);
    }

    const totalHistoryState = await evaluate(`(() => {
      document.querySelector('[data-show-total-history]').click();
      const dialog = document.querySelector('#priceHistoryDialog');
      const result = {
        title: document.querySelector('#priceHistoryContent .price-history-head strong')?.textContent.trim() || '',
        subtitle: document.querySelector('#priceHistoryContent .price-history-head small')?.textContent.trim() || '',
        syncNote: document.querySelector('#priceHistoryContent .price-history-tools small')?.textContent.trim() || ''
      };
      dialog.querySelector('[data-close-dialog]').click();
      return result;
    })()`);
    if (totalHistoryState.title !== "Cube 总价"
      || !totalHistoryState.subtitle.startsWith("全部历史")
      || !totalHistoryState.syncNote.includes("不限制下方曲线范围")) {
      throw new Error(`Cube 总价没有显示完整历史范围：${JSON.stringify(totalHistoryState)}`);
    }

    const productSourceState = await evaluate(`(async () => {
      document.querySelector('#cardGrid [data-preview-image]').click();
      const started = Date.now();
      while (document.querySelector('.product-source-status.loading') && Date.now() - started < 15000) {
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
    if (!hasCompletedProductSourceResult(productSourceState)) {
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

    const priceChangeTabs = await evaluate(`(() => {
      document.querySelector('[data-show-today-price-changes]').click();
      const dialog = document.querySelector('#priceHistoryDialog');
      const buttons = [...document.querySelectorAll('[data-price-change-period]')];
      const labels = buttons.map((button) => button.textContent.trim());
      buttons.find((button) => button.dataset.priceChangePeriod === 'history')?.click();
      const rankingButtons = [...document.querySelectorAll('[data-price-change-ranking]')];
      const rankingLabels = rankingButtons.map((button) => button.textContent.trim());
      rankingButtons.find((button) => button.dataset.priceChangeRanking === 'absolute')?.click();
      const rows = [...document.querySelectorAll('.price-change-row')];
      const thumbnails = [...document.querySelectorAll('.price-change-thumbnail-wrap')];
      const result = {
        opened: dialog.open,
        labels,
        active: document.querySelector('[data-price-change-period].active')?.dataset.priceChangePeriod || '',
        rankingLabels,
        activeRanking: document.querySelector('[data-price-change-ranking].active')?.dataset.priceChangeRanking || '',
        title: document.querySelector('#priceHistoryContent .price-history-head strong')?.textContent.trim() || '',
        rowCount: rows.length,
        thumbnailCount: thumbnails.length,
        thumbnailSize: thumbnails[0] ? [getComputedStyle(thumbnails[0]).width, getComputedStyle(thumbnails[0]).height] : []
      };
      dialog.querySelector('[data-close-dialog]').click();
      result.closed = !dialog.open;
      return result;
    })()`);
    if (!priceChangeTabs.opened || !priceChangeTabs.closed
      || priceChangeTabs.labels.join("|") !== "今日价格变动|本周价格变动|本月价格变动|历史价格变动"
      || priceChangeTabs.active !== "history" || priceChangeTabs.title !== "历史价格变动"
      || priceChangeTabs.rankingLabels.join("|") !== "涨跌幅|涨跌金额"
      || priceChangeTabs.activeRanking !== "absolute"
      || priceChangeTabs.thumbnailCount !== priceChangeTabs.rowCount
      || (priceChangeTabs.rowCount && priceChangeTabs.thumbnailSize.join("x") !== "27pxx37.5px")) {
      throw new Error(`价格变动时间标签切换失败：${JSON.stringify(priceChangeTabs)}`);
    }

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
      while (!window.XLSX && Date.now() - started < 30000) {
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
      while (document.querySelector('.product-source-status.loading') && Date.now() - started < 15000) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return {
        rowCount: document.querySelectorAll('.product-source-row').length,
        status: document.querySelector('.product-source-status')?.textContent.trim() || '',
        scriptSource: [...document.scripts].find((item) => item.src.endsWith('/product-source-index.js'))?.src || ''
      };
    })()`);
    if (!hasCompletedProductSourceResult(fileProductSourceState)) {
      throw new Error(`本地文件产品来源加载失败：${JSON.stringify({ ...fileProductSourceState, networkFailures, runtimeErrors })}`);
    }
    if (!fileProductSourceState.scriptSource.startsWith("file:")) throw new Error("本地文件模式没有使用同目录产品来源索引");
    const fileHistoryShardState = await evaluate(`(async () => {
      const id = ${JSON.stringify(historyShardFixture.scryfallId)};
      if (!window.CubeMtgjsonPriceIndex) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'mtgjson-price-index.js';
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }
      const catalog = window.CubeMtgjsonHistoryShards.createHistoryShardCatalog();
      const result = await catalog.load(window.CubeMtgjsonPriceIndex, [id]);
      const entry = result.cards[id];
      return {
        foilPoints: entry?.foil?.length || 0,
        nonfoilPoints: entry?.nonfoil?.length || 0,
        sourceVersion: window.CubeMtgjsonHistoryShardData?.[${JSON.stringify(historyShardFixture.key)}]?.sourceVersion || ''
      };
    })()`);
    if (fileHistoryShardState.foilPoints !== 90 || fileHistoryShardState.nonfoilPoints !== 90) {
      throw new Error(`本地文件 MTGJSON 历史分片加载失败：${JSON.stringify({ ...fileHistoryShardState, networkFailures, runtimeErrors })}`);
    }
    if (runtimeErrors.length) throw new Error(`页面运行时错误：${runtimeErrors.join("; ")}`);
    process.stdout.write(`Browser smoke test passed: ${initialCount} cards, ${whiteCount} white cards, ${productSourceState.rowCount} HTTP product sources, ${fileProductSourceState.rowCount} file product sources, ${fileHistoryShardState.foilPoints} file history points.\n`);
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
