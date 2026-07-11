const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const styleSource = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");

test("application shell loads dependencies before app.js", () => {
  const migrations = html.indexOf('src="migrations.js"');
  const core = html.indexOf('src="core.js"');
  const priceHistory = html.indexOf('src="priceHistory.js"');
  const changeLog = html.indexOf('src="changeLog.js"');
  const health = html.indexOf('src="health.js"');
  const storage = html.indexOf('src="storage.js"');
  const workspace = html.indexOf('src="workspace.js"');
  const persistence = html.indexOf('src="persistence.js"');
  const scryfall = html.indexOf('src="scryfall.js"');
  const catalog = html.indexOf('src="catalog.js"');
  const imageCache = html.indexOf('src="imageCache.js"');
  const selectors = html.indexOf('src="selectors.js"');
  const renderScheduler = html.indexOf('src="renderScheduler.js"');
  const app = html.indexOf('src="app.js"');
  assert.ok(migrations >= 0 && migrations < core && core < priceHistory && priceHistory < changeLog && changeLog < health && health < storage && storage < workspace && workspace < persistence && persistence < scryfall && scryfall < catalog && catalog < imageCache && imageCache < selectors && selectors < renderScheduler && renderScheduler < app);
});

test("card image failures use one delegated listener", () => {
  assert.match(appSource, /cardGrid\.addEventListener\("error"/);
  assert.doesNotMatch(appSource, /image\.addEventListener\("error"/);
});

test("grid cards use compact metadata while list cards retain cost and type", () => {
  assert.match(appSource, /class="card-type"/);
  assert.match(appSource, /class="card-printing"/);
  assert.match(styleSource, /\.card-info\s*\{[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto;[^}]*grid-template-rows:\s*auto auto;/s);
  assert.match(styleSource, /\.card-cost,\s*\.card-type\s*\{\s*display:\s*none;/);
  assert.match(styleSource, /\.card-printing\s*\{[^}]*grid-column:\s*1\s*\/\s*3;[^}]*grid-row:\s*2;/s);
  assert.match(styleSource, /\.list-mode \.card-cost,\s*\.list-mode \.card-type\s*\{\s*display:\s*block;/);
});

test("printing selector filters Foil-capable versions and forces Foil on selection", () => {
  assert.match(appSource, /printingFinishFilter:\s*"all"/);
  assert.match(appSource, /data-toggle-printing-finish-filter/);
  assert.match(appSource, /<span>版本<\/span>/);
  assert.match(appSource, /state\.printingFinishFilter === "foil" \? "仅 Foil" : "全部"/);
  assert.match(appSource, /filterPrintings\(state\.printings, elements\.printingSearchInput\.value, state\.printingFinishFilter\)/);
  assert.match(appSource, /replacePrinting\(current, printing, state\.printingFinishFilter === "foil" \? "foil" : current\.finish\)/);
  assert.match(html, /筛选支持 Foil 的实体版本/);
});

test("image preview renders and enriches a read-only card archive", () => {
  assert.match(appSource, /class="card-archive-preview"/);
  assert.match(appSource, /class="card-archive-images/);
  assert.match(appSource, /class="card-archive-details"/);
  assert.match(appSource, /规则文字/);
  assert.match(appSource, /系列与编号/);
  assert.match(appSource, /catalog\.lookupById\(card\.scryfallId/);
  assert.match(appSource, /mergeArchiveMetadata\(current, printing\)/);
  assert.match(appSource, /event\.target\.closest\("\.card-archive-images img"\)/);
  assert.match(styleSource, /\.card-archive-preview\s*\{[^}]*grid-template-columns:/s);
  assert.match(styleSource, /\.card-archive-details\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(styleSource, /\.card-archive-images\.two-sided/);
  assert.match(appSource, /data-close-image-preview/);
  assert.match(appSource, /aria-label="关闭卡图预览"/);
  assert.match(appSource, /closest\("\[data-close-image-preview\]"\)/);
  assert.match(styleSource, /\.card-archive-close\s*\{[^}]*position:\s*absolute/s);
});

test("key interactive regions expose accessible state", () => {
  assert.match(html, /id="sidebar"/);
  assert.match(html, /id="resultCount"[^>]+aria-live="polite"/);
  assert.match(html, /data-color="all"[^>]+aria-pressed="true"/);
  assert.match(html, /data-mode="grid"[^>]+aria-pressed="true"/);
  assert.match(html, /id="connectFolderBtn"/);
  assert.match(html, /id="syncFolderBtn"/);
  assert.match(html, /id="storageStatusLabel"/);
  assert.match(html, /class="storage-note"[^>]+aria-live="polite"/);
  assert.match(html, /id="priceHistoryDialog"/);
  assert.match(html, /id="changeLogDialog"/);
  assert.match(html, /id="healthCheckBtn"/);
  assert.match(html, /id="healthCheckDialog"/);
  assert.match(html, /id="manaCurveScope"/);
  assert.match(html, /id="manaChart"[^>]+data-color-bucket="all"/);
  assert.match(html, /id="analyticsAllColor"/);
  assert.match(appSource, /data-card-type=/);
  assert.match(appSource, /data-show-today-price-changes/);
});
