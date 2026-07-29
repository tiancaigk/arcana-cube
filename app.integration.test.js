const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const basicLandsSource = fs.readFileSync(path.join(__dirname, "basicLands.js"), "utf8");
const productSourcesSource = fs.readFileSync(path.join(__dirname, "productSources.js"), "utf8");
const styleSource = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");

test("application shell loads dependencies before app.js", () => {
  const migrations = html.indexOf('src="migrations.js"');
  const core = html.indexOf('src="core.js"');
  const priceHistory = html.indexOf('src="priceHistory.js"');
  const changeLog = html.indexOf('src="changeLog.js"');
  const health = html.indexOf('src="health.js"');
  const storage = html.indexOf('src="storage.js"');
  const workspace = html.indexOf('src="workspace.js"');
  const workspaceSession = html.indexOf('src="workspaceSession.js"');
  const persistence = html.indexOf('src="persistence.js"');
  const scryfall = html.indexOf('src="scryfall.js"');
  const mtgch = html.indexOf('src="mtgch.js"');
  const catalog = html.indexOf('src="catalog.js"');
  const productSources = html.indexOf('src="productSources.js"');
  const mtgjsonPrices = html.indexOf('src="mtgjsonPrices.js"');
  const priceMaintenance = html.indexOf('src="priceMaintenance.js"');
  const chart = html.indexOf('src="chart.js"');
  const basicLands = html.indexOf('src="basicLands.js"');
  const collectionCommands = html.indexOf('src="collectionCommands.js"');
  const viewPreferences = html.indexOf('src="viewPreferences.js"');
  const imageCache = html.indexOf('src="imageCache.js"');
  const selectors = html.indexOf('src="selectors.js"');
  const renderScheduler = html.indexOf('src="renderScheduler.js"');
  const app = html.indexOf('src="app.js"');
  assert.ok(migrations >= 0 && migrations < core && core < priceHistory && priceHistory < changeLog && changeLog < health && health < storage && storage < workspace && workspace < workspaceSession && workspaceSession < persistence && persistence < scryfall && scryfall < mtgch && mtgch < catalog && catalog < productSources && productSources < mtgjsonPrices && mtgjsonPrices < priceMaintenance && priceMaintenance < chart && chart < basicLands && basicLands < collectionCommands && collectionCommands < viewPreferences && viewPreferences < imageCache && imageCache < selectors && selectors < renderScheduler && renderScheduler < app);
});

test("localized names use Scryfall simplified Chinese before the MTGCH fallback", () => {
  const lookupStart = appSource.indexOf("async function lookupLocalizedName(card)");
  const lookupEnd = appSource.indexOf("async function refreshMissingLocalizedNames", lookupStart);
  const lookupSource = appSource.slice(lookupStart, lookupEnd);
  assert.ok(lookupStart >= 0);
  assert.match(lookupSource, /buildLocalizedNameSearchUrl\(oracleId, "zhs"\)/);
  assert.doesNotMatch(lookupSource, /"zht"/);
  assert.ok(lookupSource.indexOf("scryfallRequest") < lookupSource.indexOf("mtgch.lookupSimplifiedChineseName"));
  assert.match(lookupSource, /return \{ lang: "zhs", name: mtgchName, source: "mtgch" \}/);
  assert.match(appSource, /const incompleteSplitName = isSplitCard\(card\)[^;]+!localizedName\.includes\("\/\/"\)/);
});

test("card image failures use one delegated listener", () => {
  assert.match(appSource, /\[elements\.cardGrid, elements\.basicLandGrid\]\.forEach\(\(grid\) => grid\.addEventListener\("error"/);
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
  assert.match(appSource, /lookupMtgjsonPrintingPrice\(state\.printingPriceIndex, printing, "foil"\)/);
  assert.match(appSource, /applyIndexedPricesToCard\(replaced, state\.printingPriceIndex, lookupMtgjsonPrintingPrice, \{ clearMissing: true \}\)/);
  const summaryStart = appSource.indexOf("function printingPriceSummary(printing)");
  const summaryEnd = appSource.indexOf("function printingPriceTitle(printing)", summaryStart);
  assert.doesNotMatch(appSource.slice(summaryStart, summaryEnd), /usd_foil|printing\.prices/);
  assert.match(html, /筛选支持 Foil 的实体版本/);
});

test("image preview renders and enriches a read-only card archive", () => {
  assert.match(appSource, /class="card-archive-preview" data-finish="\$\{finish\}"/);
  assert.match(appSource, /class="card-archive-images/);
  assert.match(appSource, /class="card-archive-image-frame"/);
  assert.match(appSource, /class="card-archive-details"/);
  assert.match(appSource, /规则文字/);
  assert.match(appSource, /系列与编号/);
  assert.match(appSource, /catalog\.lookupById\(card\.scryfallId/);
  assert.match(appSource, /mergeArchiveMetadata\(current, printing\)/);
  assert.match(appSource, /event\.target\.closest\("\.card-archive-images img"\)/);
  assert.match(styleSource, /\.card-archive-preview\s*\{[^}]*grid-template-columns:/s);
  assert.match(styleSource, /\.card-archive-details\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(styleSource, /\.card-archive-images\.two-sided/);
  assert.match(styleSource, /\.card-archive-preview\[data-finish="foil"\] \.card-archive-image-frame::before/);
  assert.match(styleSource, /\.card-archive-preview\[data-finish="foil"\] \.card-archive-image-frame::after/);
  assert.match(styleSource, /@keyframes archiveFoilSweep/);
  assert.match(styleSource, /@keyframes archiveFoilAura/);
  assert.match(styleSource, /prefers-reduced-motion:[^)]+\)[\s\S]*\.card-archive-preview\[data-finish="foil"\] \.card-archive-image-frame::after/);
  assert.match(appSource, /data-close-image-preview/);
  assert.match(appSource, /aria-label="关闭卡图预览"/);
  assert.match(appSource, /closest\("\[data-close-image-preview\]"\)/);
  assert.match(styleSource, /\.card-archive-close\s*\{[^}]*position:\s*absolute/s);
  assert.match(appSource, /createProductSourceCatalog/);
  assert.match(appSource, /class="card-product-sources"/);
  assert.match(productSourcesSource, /固定收录/);
  assert.match(productSourcesSource, /随机可能开出/);
  assert.match(appSource, /preferFallback:\s*window\.location\.protocol === "file:"/);
  assert.match(appSource, /function loadProductSourceIndexScript\(\)/);
  assert.match(appSource, /void enrichPreviewProductSources\(cardId\)/);
  assert.match(styleSource, /\.product-source-row\[data-product-type="collector"\]/);
});

test("remembered Cube folders reconnect without reopening the picker", () => {
  assert.match(appSource, /rememberedDirectoryHandle:\s*null/);
  assert.match(appSource, /state\.storage\.rememberedDirectoryHandle \? "重新连接文件夹" : "选择 Cube 文件夹"/);
  assert.match(appSource, /async function reconnectRememberedFolder\(\)/);
  assert.match(appSource, /requestDirectoryPermission\(directoryHandle, "readwrite"\)/);
  assert.match(appSource, /async function activateDirectoryHandle\(directoryHandle\)/);
  assert.match(appSource, /function handleConnectFolderClick\(\)/);
  assert.match(appSource, /state\.storage\.rememberedDirectoryHandle \? reconnectRememberedFolder\(\) : connectCubeFolder\(\)/);
  assert.match(appSource, /state\.storage\.mode !== "directory" && !state\.storage\.rememberedDirectoryHandle/);
});

test("folder reload never flushes browser data over the file being loaded", () => {
  const start = appSource.indexOf("async function reloadFromDirectory()");
  const end = appSource.indexOf("async function connectCubeFolder()", start);
  const reloadSource = appSource.slice(start, end);
  assert.match(reloadSource, /persistence\.hasDirty\(\)/);
  assert.doesNotMatch(reloadSource, /flushDirectoryWrites/);
});

test("published Cube data replaces only the untouched starter list", () => {
  assert.match(appSource, /async function loadPublishedCubeData\(\)/);
  assert.match(appSource, /if \(!isStarterCube\(state\.data\)\) return false;/);
  assert.match(appSource, /data\.meta\.name === defaultState\.meta\.name/);
  assert.match(appSource, /data\.cards\.every\(\(card\) => seedIds\.has\(card\.id\)\)/);
  assert.doesNotMatch(appSource, /data\.meta\.id === defaultState\.meta\.id/);
  assert.match(appSource, /fetch\(CUBE_FILE_NAME, \{ cache: "no-cache" \}\)/);
  assert.match(appSource, /window\.CubeStorage\.parseWorkspaceData/);
  assert.match(appSource, /image: images\.remoteImage \|\| ""/);
  assert.match(appSource, /localImage: ""/);
  assert.match(appSource, /await loadPublishedCubeData\(\);[\s\S]*renderAll\(\);/);
});

test("basic lands use a dedicated five-group collection view", () => {
  assert.match(html, /data-view="basicLands"/);
  assert.match(html, /id="basicLandsView"/);
  assert.match(html, /id="basicLandGrid"/);
  assert.match(html, /id="basicLandSummary"/);
  assert.match(appSource, /basicLands:\s*\[\]/);
  assert.match(appSource, /function renderBasicLands\(\)/);
  assert.match(basicLandsSource, /\["Plains", "Island", "Swamp", "Mountain", "Forest"\]/);
  assert.match(appSource, /function findCardLocation\(cardId\)/);
  assert.match(appSource, /isSupportedBasicLand\(card\)/);
  assert.match(appSource, /已经收藏了这个基本地版本/);
  assert.match(appSource, /state\.addTarget === "basic" \? basicName \? \[await catalog\.lookupNamed/);
  assert.match(styleSource, /\.basic-land-summary/);
});

test("basic lands switch between kind and release-ordered set groups", () => {
  assert.match(html, /data-basic-land-grouping="kind"[^>]+aria-pressed="true"/);
  assert.match(html, /data-basic-land-grouping="set"[^>]+aria-pressed="false"/);
  assert.match(appSource, /BASIC_LAND_GROUPING_KEY\s*=\s*"arcana-cube-basic-land-grouping"/);
  assert.match(appSource, /basicLandGrouping:\s*loadBasicLandGrouping\(\)/);
  assert.match(appSource, /groupBasicLands\(cards, state\.basicLandGrouping\)/);
  assert.match(appSource, /viewPreferences\.set\("basicLandGrouping", mode\)/);
  assert.match(styleSource, /\.basic-land-grid \.card-group-grid\s*\{[^}]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/s);
});

test("basic lands support partial-success collector number range additions", () => {
  assert.match(appSource, /parseCollectorNumberRange/);
  assert.match(appSource, /classifyBasicLandBatch\(targets, cardsByPrinting, state\.data\.basicLands\)/);
  assert.match(appSource, /async function addBasicLandRange\(setCode, collectorNumbers\)/);
  assert.match(appSource, /catalog\.lookupPrintingBatch\(targets\)/);
  assert.match(appSource, /缺少卡牌|不是五种基本地|仅有电子版|已经收藏/);
  assert.match(appSource, /collectionCommands\.execute\(\{ changed: counts\.added > 0, changes, render:/);
  assert.match(appSource, /state\.addTarget === "basic" && parsedCollector\.isRange/);
  assert.match(appSource, /基本地区间结果/);
  assert.match(appSource, /普通牌表只能输入单个收藏编号/);
  assert.match(html, /id="printingLookupHint"/);
  assert.match(styleSource, /\.basic-range-result/);
});

test("basic lands contribute to value and export but not draft analytics", () => {
  assert.match(appSource, /function getValuedCards\(\)/);
  assert.match(appSource, /return \[\.\.\.state\.data\.cards, \.\.\.state\.data\.basicLands\]/);
  assert.match(appSource, /recordDailySnapshot\(state\.priceHistory, getValuedCards\(\),/);
  assert.match(appSource, /dailyPriceChanges\(state\.priceHistory, getValuedCards\(\), today\)/);
  assert.match(appSource, /book_append_sheet\(workbook, basicLandWorksheet, "基本地"\)/);
  assert.match(appSource, /selectors\.selectStats\(state\.data\.cards/);
  assert.match(appSource, /selectors\.selectAnalytics\(state\.data\.cards/);
});

test("automatic price maintenance waits for folder restore and records daily history", () => {
  assert.match(appSource, /const PRICE_MAINTENANCE_INTERVAL_MS\s*=\s*60 \* 60 \* 1000/);
  assert.match(appSource, /recordCurrentPriceHistory\(\{ onlyIfMissing: !force,/);
  assert.match(appSource, /await restoreDirectoryMode\(\);[\s\S]*try\s*\{[\s\S]*await refreshStalePrices\(\);[\s\S]*finally\s*\{[\s\S]*schedulePriceMaintenance\(\);/);
  assert.match(appSource, /mtgjsonPriceCatalog\.loadIndex\(\)/);
  assert.match(appSource, /applyIndexedPriceUpdates\(targets, index/);
  assert.doesNotMatch(appSource, /applyScryfallPriceFallbacks/);
  assert.match(appSource, /Cardmarket 换算/);
  assert.match(appSource, /价格部分更新/);
});

test("price history replaces 90 days and requests missing printing history locally", () => {
  assert.match(appSource, /function syncMtgjsonPriceHistory\(\)/);
  assert.match(appSource, /function loadMissingMtgjsonHistory\(index, cards\)/);
  assert.match(appSource, /!hasMtgjsonHistoricalEntry\(index, card\)/);
  assert.match(appSource, /fetch\(endpoint,[\s\S]*scryfallIds: missingIds/);
  assert.match(appSource, /mergeMtgjsonPriceIndexes\(index, payload\)/);
  assert.match(appSource, /syncPriceHistoryWindow\(/);
  assert.match(appSource, /mtgjsonPriceSeries\(index, card, finish\)/);
  assert.match(appSource, /windowDays: 90/);
  assert.match(appSource, /最近 90 天覆盖，之前记录保留/);
  assert.match(appSource, /data-sync-price-history/);
  assert.match(styleSource, /\.price-history-tools/);
});

test("price charts use a smooth area treatment with readable axes and range summary", () => {
  assert.match(appSource, /function monotonePricePath\(points\)/);
  assert.match(appSource, /class="price-area"/);
  assert.match(appSource, /Array\.from\(\{ length: 5 \}/);
  assert.match(appSource, /price-history-change \$\{direction\}/);
  assert.doesNotMatch(appSource, /<polyline class="price-line"/);
  assert.match(styleSource, /\.price-chart-plot/);
  assert.match(styleSource, /@keyframes priceLineReveal/);
  assert.match(styleSource, /prefers-reduced-motion/);
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
  assert.match(appSource, /data-analytics-type=/);
  assert.match(appSource, /analyticsFilters/);
  assert.match(appSource, /curveLabels\.join\(" \+ "\)/);
  assert.match(appSource, /\.\.\.state\.analyticsFilters/);
  assert.match(appSource, /if \(keyA === "Land"\) return 1;/);
  assert.match(appSource, /if \(keyB === "Land"\) return -1;/);
  assert.match(styleSource, /\.mana-chart\[data-card-type="Creature"\]/);
  assert.match(styleSource, /\.type-row\s*\{[^}]*cursor:\s*pointer;/s);
  assert.match(styleSource, /\.type-row\.active \.type-name\s*\{[^}]*color:\s*var\(--bucket-color/);
  assert.match(styleSource, /\.type-row\.active\s*\{[^}]*outline:\s*1px solid var\(--bucket-color/);
  assert.match(appSource, /data-show-today-price-changes/);
});
