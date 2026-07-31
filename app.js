(function () {
  "use strict";

  const STORAGE_KEY = "arcana-cube-v1";
  const PRICE_HISTORY_STORAGE_KEY = "arcana-cube-price-history-v1";
  const CHANGE_LOG_STORAGE_KEY = "arcana-cube-change-log-v1";
  const NAME_LANGUAGE_KEY = "arcana-cube-card-name-language";
  const BASIC_LAND_GROUPING_KEY = "arcana-cube-basic-land-grouping";
  const DIRECTORY_HANDLE_KEY = "cube-directory-handle";
  const CUBE_FILE_NAME = "cube-data.json";
  const PRICE_HISTORY_FILE_NAME = "price-history.json";
  const CHANGE_LOG_FILE_NAME = "change-log.json";
  const IMAGE_DIR_NAME = "images";
  const THUMBNAIL_DIR_NAME = "thumbnails";
  const THUMBNAIL_MAX_WIDTH = 360;
  const THUMBNAIL_WEBP_QUALITY = 0.82;
  const IMAGE_FETCH_TIMEOUT_MS = 25000;
  const IMAGE_CACHE_CHECKPOINT = 100;
  const PRICE_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
  const PRICE_HISTORY_SYNC_TIMEOUT_MS = 10 * 60 * 1000;
  const SHEETJS_URL = "vendor/xlsx.full.min.js";
  const PRODUCT_SOURCE_INDEX_SCRIPT_URL = "product-source-index.js";
  const MTGJSON_PRICE_INDEX_SCRIPT_URL = "mtgjson-price-index.js";
  const { assertMainDeckSingleton, buildBackup, buildExcelRows, buildLocalizedNameSearchUrl, buildLocalImageFileName, chooseValidFinish, computeStats, filterCards, filterPrintings, findSingletonCard, sortCards, getAvailableFinishes, getBasicLandKind, getCardBucket, getCardDisplayName, getCardImage, getFrontColors, getFrontDisplayName, getFrontTypeLine, getOracleId, getPreferredLocalizedName, getPriceNumber, getUsdPrice, isPaperPrinting, isSplitCard, isSupportedBasicLand, mergeArchiveMetadata, needsPriceRefresh, normalizeCardName, normalizeFinish, normalizeLocalizedNames, normalizeScryfallCard, parseBackup, parseDecklist, parseExcelRows, prepareTextImportRows, replacePrinting, validateCardRecords } = window.CubeCore;
  const { cardSeries, dateKey, emptyPriceHistory, hasDailySnapshot, normalizePriceHistory, parsePriceHistoryData, priceChangesForPeriod, priceTrend, recordDailySnapshot, syncPriceHistoryWindow, topPriceMovers, totalSeries, wrapPriceHistoryData } = window.CubePriceHistory;
  const { appendChange, emptyChangeLog, latestEntries, normalizeChangeLog, parseChangeLogData, wrapChangeLogData } = window.CubeChangeLog;
  const { analyzeWorkspaceHealth } = window.CubeHealth;
  const { createWorkspaceService } = window.CubeWorkspace;
  const { resolveWorkspaceDomains } = window.CubeWorkspaceSession;
  const { createPersistenceCoordinator } = window.CubePersistence;
  const { requestJson: scryfallRequest } = window.ScryfallClient;
  const { createMtgchClient } = window.MtgchClient;
  const { createCatalog, printingKey } = window.CubeCatalog;
  const { createProductSourceCatalog } = window.CubeProductSources;
  const { createMtgjsonPriceCatalog, cubeFingerprint, hasHistoricalEntry: hasMtgjsonHistoricalEntry, lookupPrice: lookupMtgjsonPrice, lookupPrintingPrice: lookupMtgjsonPrintingPrice, mergePriceIndexes: mergeMtgjsonPriceIndexes, mergeSeries: mergeMtgjsonPriceSeries, overlayPriceIndex: overlayMtgjsonPriceIndex, priceSeries: mtgjsonPriceSeries, providerLabel, validateIndex: validateMtgjsonPriceIndex } = window.CubeMtgjsonPrices;
  const { createHistoryShardCatalog } = window.CubeMtgjsonHistoryShards;
  const { applyIndexedPricesToCard, applyIndexedPriceUpdates } = window.CubePriceMaintenance;
  const { dateLabelIndexes, datePositions, splitDateSeries } = window.CubeChart;
  const { BASIC_LAND_LABELS, BASIC_LAND_ORDER, classifyBasicLandBatch, groupBasicLands, parseCollectorNumberRange } = window.CubeBasicLands;
  const { createCollectionCommandExecutor } = window.CubeCollectionCommands;
  const { createViewPreferenceStore } = window.CubeViewPreferences;
  const { createImageCache, isRemoteImageUrl, preferPngImageUrl } = window.CubeImageCache;
  const { createCubeSelectors } = window.CubeSelectors;
  const { createRenderScheduler } = window.CubeRenderScheduler;
  const cubeStorage = window.CubeStorage.createStorage(localStorage, STORAGE_KEY);
  const cubeHandleStore = window.CubeStorage.createHandleStore(window.indexedDB);
  const viewPreferences = createViewPreferenceStore(localStorage, {
    nameLanguage: { key: NAME_LANGUAGE_KEY, allowedValues: ["en", "zh"], fallback: "en" },
    basicLandGrouping: { key: BASIC_LAND_GROUPING_KEY, allowedValues: ["kind", "set"], fallback: "kind" }
  });
  const workspace = createWorkspaceService({
    cubeFileName: CUBE_FILE_NAME,
    priceHistoryFileName: PRICE_HISTORY_FILE_NAME,
    changeLogFileName: CHANGE_LOG_FILE_NAME,
    imageDirName: IMAGE_DIR_NAME,
    thumbnailDirName: THUMBNAIL_DIR_NAME,
    wrapCube: window.CubeStorage.wrapWorkspaceData,
    parseCube: window.CubeStorage.parseWorkspaceData,
    wrapPriceHistory: wrapPriceHistoryData,
    parsePriceHistory: parsePriceHistoryData,
    emptyPriceHistory,
    wrapChangeLog: wrapChangeLogData,
    parseChangeLog: parseChangeLogData,
    emptyChangeLog
  });
  const catalog = createCatalog({ requestJson: scryfallRequest, core: window.CubeCore });
  const mtgch = createMtgchClient({ fetchImpl: (...args) => fetch(...args) });
  let productSourceIndexLoader;
  let mtgjsonPriceIndexLoader;
  const productSourceCatalog = createProductSourceCatalog({
    fetchImpl: (...args) => fetch(...args),
    indexUrl: "product-source-index.json",
    loadFallback: loadProductSourceIndexScript,
    preferFallback: window.location.protocol === "file:"
  });
  const bundledMtgjsonPriceCatalog = createMtgjsonPriceCatalog({
    fetchImpl: (...args) => fetch(...args),
    indexUrl: "mtgjson-price-index.json",
    loadFallback: loadMtgjsonPriceIndexScript,
    preferFallback: window.location.protocol === "file:"
  });
  const mtgjsonHistoryShardCatalog = createHistoryShardCatalog();
  const selectors = createCubeSelectors(window.CubeCore, window.CubePriceHistory);
  const imageCache = createImageCache({
    workspace,
    getDirectoryHandle: () => state.storage.directoryHandle,
    fetchImpl: (...args) => fetch(...args),
    mapFetchUrl: imageFetchUrl,
    buildFileName: buildLocalImageFileName,
    createThumbnail: createThumbnailBlob,
    imageDirName: IMAGE_DIR_NAME,
    thumbnailDirName: THUMBNAIL_DIR_NAME,
    timeoutMs: IMAGE_FETCH_TIMEOUT_MS
  });
  let sheetJsLoader;
  let printingRequestId = 0;
  let priceChartSequence = 0;
  let preferredProductSourceIndex = { fingerprint: "", promise: null };

  const seedCards = [
    ["Swords to Plowshares", "{W}", 1, ["W"], "Instant", "2XM", "uncommon"],
    ["Stoneforge Mystic", "{1}{W}", 2, ["W"], "Creature — Kor Artificer", "2XM", "rare"],
    ["Palace Jailer", "{2}{W}{W}", 4, ["W"], "Creature — Human Soldier", "CN2", "uncommon"],
    ["Counterspell", "{U}{U}", 2, ["U"], "Instant", "MH2", "uncommon"],
    ["Snapcaster Mage", "{1}{U}", 2, ["U"], "Creature — Human Wizard", "ISD", "mythic"],
    ["Upheaval", "{4}{U}{U}", 6, ["U"], "Sorcery", "ODY", "rare"],
    ["Reanimate", "{B}", 1, ["B"], "Sorcery", "UMA", "uncommon"],
    ["Dark Confidant", "{1}{B}", 2, ["B"], "Creature — Human Wizard", "RAV", "rare"],
    ["Grave Titan", "{4}{B}{B}", 6, ["B"], "Creature — Giant", "M12", "mythic"],
    ["Lightning Bolt", "{R}", 1, ["R"], "Instant", "2X2", "uncommon"],
    ["Goblin Rabblemaster", "{2}{R}", 3, ["R"], "Creature — Goblin Warrior", "M15", "rare"],
    ["Wildfire", "{4}{R}{R}", 6, ["R"], "Sorcery", "USG", "rare"],
    ["Birds of Paradise", "{G}", 1, ["G"], "Creature — Bird", "RAV", "rare"],
    ["Eternal Witness", "{1}{G}{G}", 3, ["G"], "Creature — Human Shaman", "2X2", "uncommon"],
    ["Natural Order", "{2}{G}{G}", 4, ["G"], "Sorcery", "STA", "mythic"],
    ["Baleful Strix", "{U}{B}", 2, ["U", "B"], "Artifact Creature — Bird", "BRC", "uncommon"],
    ["Forth Eorlingas!", "{X}{R}{W}", 2, ["R", "W"], "Sorcery", "LTC", "rare"],
    ["Sol Ring", "{1}", 1, [], "Artifact", "CMM", "uncommon"],
    ["Worn Powerstone", "{3}", 3, [], "Artifact", "CMM", "uncommon"],
    ["Mishra's Factory", "", 0, [], "Land", "A25", "rare"],
    ["Flooded Strand", "", 0, [], "Land", "KTK", "rare"],
    ["Bloodstained Mire", "", 0, [], "Land", "KTK", "rare"],
    ["City of Brass", "", 0, [], "Land", "2X2", "rare"],
    ["Wasteland", "", 0, [], "Land", "EMA", "rare"]
  ].map(([name, manaCost, cmc, colors, typeLine, set, rarity], index) => ({
    id: `seed-${index}`,
    name,
    manaCost,
    cmc,
    colors,
    colorIdentity: colors,
    typeLine,
    set,
    rarity,
    image: `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=normal`,
    addedAt: new Date(2026, 0, index + 1).toISOString()
  }));

  const defaultState = {
    meta: {
      id: "cube-arcana-starter",
      name: "暮色典藏",
      description: "为四至八人轮抽设计的中速环境，强调墓地、神器与多色协同。"
    },
    notes: "设计目标：互动优先，让每种颜色都拥有至少两条清晰的轮抽路径。\n\n下次轮抽观察：红色快攻的一费生物密度；蓝黑墓地套牌是否需要更多弃牌出口。",
    cards: seedCards,
    basicLands: []
  };

  const state = {
    data: (() => {
      const loaded = loadState();
      loaded.cards = normalizeStoredCards(loaded.cards || [], { label: "主牌表", singleton: true });
      loaded.basicLands = normalizeStoredCards(loaded.basicLands || [], { label: "基本地" });
      return loaded;
    })(),
    priceHistory: loadPriceHistoryState(),
    changeLog: loadChangeLogState(),
    dataRevision: 0,
    historyRevision: 0,
    filters: { query: "", color: "all", type: "all", finish: "all", japanPrint: "all" },
    analyticsFilters: { color: "all", type: "all" },
    mode: "grid",
    nameLanguage: loadNameLanguage(),
    basicLandGrouping: loadBasicLandGrouping(),
    nameLocalization: {
      refreshing: false,
      failures: new Map(),
      pending: new Map(),
      retryTimer: 0
    },
    view: "collection",
    importing: false,
    importMode: "text",
    textRows: [],
    textValidated: false,
    excelFile: null,
    excelRows: [],
    excelValidated: false,
    editingCardId: null,
    printings: [],
    printingFinishFilter: "all",
    printingPriceIndex: null,
    printingPriceError: "",
    lookupMode: "name",
    addTarget: "draft",
    nameResults: [],
    addLookupRequestId: 0,
    addLookupController: null,
    printingController: null,
    previewCardId: null,
    previewController: null,
    previewMetadataCompleted: new Set(),
    previewProductSources: {
      cardId: null,
      status: "idle",
      result: null,
      error: ""
    },
    refreshingPrices: false,
    syncingPriceHistory: false,
    priceHistorySyncController: null,
    priceIndexSource: null,
    priceIndexMode: "",
    imageCaching: false,
    folderSync: {
      syncing: false,
      dirty: false,
      lastResult: null
    },
    storage: {
      mode: "browser",
      supported: typeof window.showDirectoryPicker === "function",
      directoryHandle: null,
      directoryName: "",
      rememberedDirectoryName: "",
      rememberedDirectoryHandle: null
    }
  };
  const initialWorkspace = resolveWorkspaceDomains({
    cubeData: state.data,
    priceHistoryData: state.priceHistory,
    changeLogData: state.changeLog,
    emptyPriceHistory,
    emptyChangeLog
  });
  let automaticPriceRefreshTimer = 0;
  state.priceHistory = initialWorkspace.priceHistoryData;
  state.changeLog = initialWorkspace.changeLogData;

  const persistence = createPersistenceCoordinator({
    browserWriters: {
      cube: (snapshot) => cubeStorage.save(snapshot),
      priceHistory: (snapshot) => localStorage.setItem(PRICE_HISTORY_STORAGE_KEY, JSON.stringify(normalizePriceHistory(snapshot))),
      changeLog: (snapshot) => localStorage.setItem(CHANGE_LOG_STORAGE_KEY, JSON.stringify(normalizeChangeLog(snapshot)))
    },
    directoryWriters: {
      cube: (directoryHandle, snapshot) => workspace.writeCube(directoryHandle, snapshot),
      priceHistory: (directoryHandle, snapshot) => workspace.writePriceHistory(directoryHandle, snapshot),
      changeLog: (directoryHandle, snapshot) => workspace.writeChangeLog(directoryHandle, snapshot)
    },
    getDirectoryHandle: () => state.storage.mode === "directory" ? state.storage.directoryHandle : null,
    onBrowserError: () => toast("保存失败", "浏览器存储空间可能不足", true),
    onDirectoryError: async (error, _domain, directoryHandle) => {
      if (state.storage.directoryHandle !== directoryHandle) return;
      state.folderSync = { syncing: false, dirty: true, lastResult: { ok: false, message: error.message || "无法写入 Cube 文件夹" } };
      renderStorageStatus();
      toast("写入失败", error.message || "无法写入 Cube 文件夹", true);
    }
  });

  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

  const elements = {
    statsGrid: $("#statsGrid"), cardGrid: $("#cardGrid"), resultCount: $("#resultCount"),
    emptyState: $("#emptyState"), searchInput: $("#searchInput"), typeFilter: $("#typeFilter"), finishFilter: $("#finishFilter"), japanPrintFilter: $("#japanPrintFilter"),
    collectionView: $("#collectionView"), analyticsView: $("#analyticsView"), basicLandsView: $("#basicLandsView"),
    basicLandSummary: $("#basicLandSummary"), basicLandGrid: $("#basicLandGrid"), basicLandEmpty: $("#basicLandEmpty"), addBasicLandBtn: $("#addBasicLandBtn"),
    addCardDialog: $("#addCardDialog"), importDialog: $("#importDialog"), editCubeDialog: $("#editCubeDialog"),
    toastRegion: $("#toastRegion"), cardNameInput: $("#cardNameInput"), lookupButton: $("#lookupButton"),
    setCodeInput: $("#setCodeInput"), collectorNumberInput: $("#collectorNumberInput"),
    printingDialog: $("#printingDialog"), printingSearchInput: $("#printingSearchInput"),
    printingStatus: $("#printingStatus"), printingGrid: $("#printingGrid"), printingCount: $("#printingCount"), printingFinishToggle: $("#printingFinishToggle"),
    importText: $("#importText"), importStatus: $("#importStatus"), startImportBtn: $("#startImportBtn"),
    textPreview: $("#textPreview"), textSummary: $("#textSummary"), textPreviewBody: $("#textPreviewBody"),
    excelFileInput: $("#excelFileInput"), excelFileName: $("#excelFileName"), excelPreview: $("#excelPreview"),
    excelSummary: $("#excelSummary"), excelPreviewBody: $("#excelPreviewBody"), excelDropZone: $("#excelDropZone"),
    lookupResult: $("#lookupResult"), backupFileInput: $("#backupFileInput"), imagePreviewDialog: $("#imagePreviewDialog"), imagePreview: $("#imagePreview"),
    priceHistoryDialog: $("#priceHistoryDialog"), priceHistoryContent: $("#priceHistoryContent"),
    changeLogBtn: $("#changeLogBtn"), changeLogDialog: $("#changeLogDialog"), changeLogContent: $("#changeLogContent"),
    healthCheckBtn: $("#healthCheckBtn"), healthCheckDialog: $("#healthCheckDialog"), healthCheckContent: $("#healthCheckContent"),
    connectFolderBtn: $("#connectFolderBtn"), cacheImagesBtn: $("#cacheImagesBtn"), syncFolderBtn: $("#syncFolderBtn"), syncFolderLabel: $("#syncFolderLabel"), reloadFolderBtn: $("#reloadFolderBtn"), disconnectFolderBtn: $("#disconnectFolderBtn"),
    storageStatusLabel: $("#storageStatusLabel"), storageStatusDetail: $("#storageStatusDetail"),
    nameLanguageToggle: $("#nameLanguageToggle")
  };

  const renderScheduler = createRenderScheduler({
    meta: renderMeta,
    stats: renderStats,
    nameLanguage: renderNameLanguageToggle,
    cards: renderCards,
    basics: renderBasicLands,
    analytics: () => {
      if (state.view === "analytics") renderAnalytics();
    },
    storage: renderStorageStatus
  }, { order: ["meta", "stats", "nameLanguage", "cards", "basics", "analytics", "storage"] });
  const collectionCommands = createCollectionCommandExecutor({
    recordChange,
    saveState,
    requestRender: requestCollectionCommandRender,
    toast
  });
  let searchRenderFrame = 0;
  let localMtgjsonPriceIndexPromise = null;
  let combinedMtgjsonPriceIndexCache = { bundled: null, local: null, index: null };
  const foilObservers = new Map();

  function loadNameLanguage() {
    return viewPreferences.get("nameLanguage");
  }

  function isLocalImagePath(value) {
    return String(value || "").startsWith(`${IMAGE_DIR_NAME}/`);
  }

  function isLocalThumbnailPath(value) {
    return String(value || "").startsWith(`${IMAGE_DIR_NAME}/${THUMBNAIL_DIR_NAME}/`);
  }

  function isLocalOriginalImagePath(value) {
    return isLocalImagePath(value) && !isLocalThumbnailPath(value);
  }

  function isLocalHttpPage() {
    return location.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname);
  }

  function imageFetchUrl(url) {
    if (!isLocalHttpPage() || !/cards\.scryfall\.io/i.test(String(url || ""))) return url;
    return `/image-proxy?url=${encodeURIComponent(url)}`;
  }

  function normalizeImageFields(card) {
    const localImage = isLocalOriginalImagePath(card.localImage) ? card.localImage : (isLocalOriginalImagePath(card.image) ? card.image : "");
    const localThumbnail = isLocalThumbnailPath(card.localThumbnail) ? card.localThumbnail : (isLocalThumbnailPath(card.image) ? card.image : "");
    const remoteSource = card.remoteImage || (isRemoteImageUrl(card.image) ? card.image : "");
    const remoteImage = preferPngImageUrl(remoteSource) || remoteSource;
    const localBackImage = isLocalOriginalImagePath(card.localBackImage) ? card.localBackImage : (isLocalOriginalImagePath(card.backImage) ? card.backImage : "");
    const localBackThumbnail = isLocalThumbnailPath(card.localBackThumbnail) ? card.localBackThumbnail : (isLocalThumbnailPath(card.backImage) ? card.backImage : "");
    const remoteBackSource = card.remoteBackImage || (isRemoteImageUrl(card.backImage) ? card.backImage : "");
    const remoteBackImage = preferPngImageUrl(remoteBackSource) || remoteBackSource;
    return {
      localImage,
      localThumbnail,
      remoteImage,
      image: localImage || remoteImage || card.image,
      localBackImage,
      localBackThumbnail,
      remoteBackImage,
      backImage: localBackImage || remoteBackImage || card.backImage
    };
  }

  function normalizeStoredCards(cards, options = {}) {
    validateCardRecords(cards, options.label || "牌表");
    const normalized = sortCards(cards.map((card) => ({
      ...card,
      id: String(card.id || ""),
      name: String(card.name || ""),
      ...normalizeImageFields(card),
      oracleId: getOracleId(card),
      localizedNames: normalizeLocalizedNames(card),
      frontColors: getFrontColors(card),
      typeLine: String(card.typeLine || getFrontTypeLine(card) || "Unknown"),
      frontTypeLine: String(getFrontTypeLine(card) || card.typeLine || "Unknown"),
      oracleText: card.oracleText || "",
      backOracleText: card.backOracleText || "",
      artist: card.artist || "",
      backArtist: card.backArtist || "",
      setName: card.setName || "",
      releasedAt: card.releasedAt || "",
      finishes: getAvailableFinishes(card),
      finish: chooseValidFinish(card, card.finish),
      priceSources: card.priceSources && typeof card.priceSources === "object" ? card.priceSources : {},
      priceSource: card.priceSource && typeof card.priceSource === "object" ? card.priceSource : null,
      priceDataDate: typeof card.priceDataDate === "string" ? card.priceDataDate : "",
      JapanPrint: card.JapanPrint === true
    })));
    if (options.singleton) assertMainDeckSingleton(normalized);
    return normalized;
  }

  function loadState() {
    return cubeStorage.load(defaultState);
  }

  function isStarterCube(data) {
    const seedIds = new Set(seedCards.map((card) => card.id));
    return Boolean(
      data
      && data.meta
      && data.meta.name === defaultState.meta.name
      && Array.isArray(data.cards)
      && data.cards.length === seedCards.length
      && data.cards.every((card) => seedIds.has(card.id))
      && (!Array.isArray(data.basicLands) || data.basicLands.length === 0)
    );
  }

  function publishedCardForCurrentPage(card) {
    if (isLocalHttpPage()) return card;
    const images = normalizeImageFields(card);
    return {
      ...card,
      image: images.remoteImage || "",
      localImage: "",
      localThumbnail: "",
      backImage: images.remoteBackImage || "",
      localBackImage: "",
      localBackThumbnail: ""
    };
  }

  async function loadPublishedCubeData() {
    if (!isStarterCube(state.data)) return false;
    try {
      const response = await fetch(CUBE_FILE_NAME, { cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const published = window.CubeStorage.parseWorkspaceData(await response.text());
      const publishedForPage = {
        ...published,
        cards: (published.cards || []).map(publishedCardForCurrentPage),
        basicLands: (published.basicLands || []).map(publishedCardForCurrentPage)
      };
      const resolved = resolveWorkspaceDomains({
        cubeData: publishedForPage,
        priceHistoryData: null,
        changeLogData: null,
        emptyPriceHistory,
        emptyChangeLog
      });
      applyCubeData(resolved.cubeData);
      applyPriceHistoryData(resolved.priceHistoryData);
      applyChangeLogData(resolved.changeLogData);
      return true;
    } catch (error) {
      if (location.protocol === "http:" || location.protocol === "https:") {
        toast("牌表加载失败", `无法读取 ${CUBE_FILE_NAME}（${error.message || "未知错误"}），已保留当前浏览器数据`, true);
      }
      return false;
    }
  }

  function loadPriceHistoryState() {
    try {
      const saved = JSON.parse(localStorage.getItem(PRICE_HISTORY_STORAGE_KEY));
      return normalizePriceHistory(saved);
    } catch (error) {
      return emptyPriceHistory();
    }
  }

  function loadChangeLogState() {
    try {
      const saved = JSON.parse(localStorage.getItem(CHANGE_LOG_STORAGE_KEY));
      return normalizeChangeLog(saved);
    } catch (error) {
      return emptyChangeLog();
    }
  }

  function snapshotCubeData(data) {
    if (typeof structuredClone === "function") return structuredClone(data);
    return JSON.parse(JSON.stringify(data));
  }

  function applyCubeData(data) {
    state.data = {
      meta: { ...(data.meta || defaultState.meta) },
      notes: typeof data.notes === "string" ? data.notes : "",
      cards: normalizeStoredCards(data.cards || [], { label: "主牌表", singleton: true }),
      basicLands: normalizeStoredCards(data.basicLands || [], { label: "基本地" })
    };
    if (!state.data.meta.name) state.data.meta.name = defaultState.meta.name;
    if (typeof state.data.meta.description !== "string") state.data.meta.description = defaultState.meta.description;
    state.dataRevision += 1;
  }

  function applyPriceHistoryData(data) {
    state.priceHistory = normalizePriceHistory(data);
    state.historyRevision += 1;
  }

  function applyChangeLogData(data) {
    state.changeLog = normalizeChangeLog(data);
  }

  function resolveLoadedWorkspace(cubeData, priceHistoryData, changeLogData) {
    return resolveWorkspaceDomains({
      cubeData,
      cubeNeedsWrite: cubeData && cubeData[window.CubeStorage.WORKSPACE_UPGRADE_FLAG] === true,
      priceHistoryData,
      changeLogData,
      emptyPriceHistory,
      emptyChangeLog
    });
  }

  async function persistWorkspaceUpgrades(directoryHandle, resolved, options = {}) {
    if (resolved.needsWrite.cube && options.includeCube !== false) await writeCubeDataFile(directoryHandle, resolved.cubeData);
    if (resolved.needsWrite.priceHistory) await writePriceHistoryFile(directoryHandle, resolved.priceHistoryData);
    if (resolved.needsWrite.changeLog) await writeChangeLogFile(directoryHandle, resolved.changeLogData);
  }

  function localMirrorSave(data = state.data) {
    return persistence.saveBrowser("cube", data);
  }

  function savePriceHistoryLocal(priceHistory = state.priceHistory) {
    return persistence.saveBrowser("priceHistory", priceHistory);
  }

  function saveChangeLogLocal(changeLog = state.changeLog) {
    return persistence.saveBrowser("changeLog", changeLog);
  }

  function cardLogInfo(card) {
    if (!card) return null;
    return {
      id: card.id || "",
      name: card.name || "",
      set: card.set || "",
      collectorNumber: card.collectorNumber || ""
    };
  }

  function recordChange(type, summary, details = {}, options = {}) {
    state.changeLog = appendChange(state.changeLog, {
      type,
      summary,
      card: details.card || null,
      before: details.before || null,
      after: details.after || null,
      meta: details.meta || null
    });
    if (options.persist === false) return;
    saveState("changeLog");
  }

  const queryDirectoryPermission = workspace.queryPermission;
  const requestDirectoryPermission = workspace.requestPermission;

  async function readCubeDataFile(directoryHandle) {
    try {
      return await workspace.readCube(directoryHandle);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("cube-data.json 不是有效的 JSON");
      throw error;
    }
  }

  function writeCubeDataFile(directoryHandle, data) {
    return workspace.writeCube(directoryHandle, data);
  }

  async function readPriceHistoryFile(directoryHandle) {
    try {
      return await workspace.readPriceHistory(directoryHandle);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("price-history.json 不是有效的 JSON");
      throw error;
    }
  }

  function writePriceHistoryFile(directoryHandle, priceHistory) {
    return workspace.writePriceHistory(directoryHandle, priceHistory);
  }

  async function readChangeLogFile(directoryHandle) {
    try {
      return await workspace.readChangeLog(directoryHandle);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("change-log.json 不是有效的 JSON");
      throw error;
    }
  }

  function writeChangeLogFile(directoryHandle, changeLog) {
    return workspace.writeChangeLog(directoryHandle, changeLog);
  }

  function renderStorageStatus() {
    const connectLabel = state.storage.mode === "directory"
      ? "更换 Cube 文件夹"
      : state.storage.rememberedDirectoryHandle ? "重新连接文件夹" : "选择 Cube 文件夹";
    if (elements.connectFolderBtn) {
      elements.connectFolderBtn.textContent = connectLabel;
      elements.connectFolderBtn.disabled = !state.storage.supported;
      elements.connectFolderBtn.title = state.storage.supported ? connectLabel : "当前浏览器不支持文件夹写入";
    }
    if (elements.cacheImagesBtn) {
      const active = state.storage.mode === "directory";
      elements.cacheImagesBtn.classList.toggle("hidden", !active);
      elements.cacheImagesBtn.disabled = state.imageCaching;
      if (!state.imageCaching) elements.cacheImagesBtn.textContent = "补全本地卡图";
    }
    if (elements.healthCheckBtn) elements.healthCheckBtn.classList.toggle("hidden", state.storage.mode !== "directory");
    if (elements.syncFolderBtn) {
      const active = state.storage.mode === "directory";
      elements.syncFolderBtn.classList.toggle("hidden", !active);
      elements.syncFolderBtn.disabled = state.imageCaching || state.folderSync.syncing;
      if (elements.syncFolderLabel) {
        elements.syncFolderLabel.textContent = state.folderSync.syncing ? "正在写入…" : (!state.folderSync.dirty && state.folderSync.lastResult && state.folderSync.lastResult.ok ? "已写入文件夹" : "写入文件夹");
      }
    }
    if (elements.reloadFolderBtn) elements.reloadFolderBtn.classList.toggle("hidden", state.storage.mode !== "directory");
    if (elements.disconnectFolderBtn) elements.disconnectFolderBtn.classList.toggle("hidden", state.storage.mode !== "directory" && !state.storage.rememberedDirectoryHandle);

    if (!elements.storageStatusLabel || !elements.storageStatusDetail) return;
    if (state.storage.mode === "directory") {
      elements.storageStatusLabel.textContent = "已同步到文件夹";
      if (state.folderSync.dirty && state.folderSync.lastResult && state.folderSync.lastResult.ok) {
        elements.storageStatusDetail.textContent = `${state.storage.directoryName}/${CUBE_FILE_NAME} · 有未写入更改`;
        return;
      }
      if (state.folderSync.lastResult) {
        const result = state.folderSync.lastResult;
        elements.storageStatusDetail.textContent = result.ok
          ? `${state.storage.directoryName}/${CUBE_FILE_NAME} · ${result.count} 张 · ${result.time}`
          : `写入失败：${result.message}`;
      } else {
        elements.storageStatusDetail.textContent = `${state.storage.directoryName}/${CUBE_FILE_NAME}`;
      }
      return;
    }
    elements.storageStatusLabel.textContent = "已保存在此浏览器";
    if (!state.storage.supported) {
      elements.storageStatusDetail.textContent = "当前浏览器不支持直接写入文件夹";
    } else if (state.storage.rememberedDirectoryName) {
      elements.storageStatusDetail.textContent = `文件夹 ${state.storage.rememberedDirectoryName} 需要重新连接`;
    } else {
      elements.storageStatusDetail.textContent = "也可以切换到文件夹模式，随项目一起移动";
    }
  }

  async function disconnectDirectoryMode(message = "已切回浏览器本地保存") {
    await persistence.flush();
    state.storage.mode = "browser";
    state.storage.directoryHandle = null;
    state.storage.directoryName = "";
    state.storage.rememberedDirectoryName = "";
    state.storage.rememberedDirectoryHandle = null;
    persistence.clearDirectory();
    try {
      await cubeHandleStore.clear(DIRECTORY_HANDLE_KEY);
    } catch (error) {
      // Best-effort cleanup.
    }
    renderStorageStatus();
    if (message) toast("文件夹已断开", message);
  }

  async function flushDirectoryWrites(directoryHandle) {
    await persistence.flush();
    return state.storage.mode === "directory" && state.storage.directoryHandle === directoryHandle && !persistence.hasDirty();
  }

  function saveState(domains = ["cube", "priceHistory", "changeLog"], options = {}) {
    const selected = Array.isArray(domains) ? domains : [domains];
    if (selected.includes("cube")) state.dataRevision += 1;
    if (selected.includes("priceHistory")) state.historyRevision += 1;
    const snapshots = {
      cube: () => snapshotCubeData(state.data),
      priceHistory: () => normalizePriceHistory(state.priceHistory),
      changeLog: () => normalizeChangeLog(state.changeLog)
    };
    selected.forEach((domain) => {
      if (options.delayMs) persistence.scheduleDirty(domain, snapshots[domain], options.delayMs);
      else persistence.markDirty(domain, snapshots[domain]());
    });
    if (state.storage.mode === "directory" && state.storage.directoryHandle) {
      if (state.folderSync.lastResult && state.folderSync.lastResult.ok) {
        state.folderSync = { ...state.folderSync, dirty: true };
        renderStorageStatus();
      }
    }
  }

  async function syncCurrentDataToDirectory() {
    if (state.storage.mode !== "directory" || !state.storage.directoryHandle) {
      toast("请先连接文件夹", "需要选择 Cube 文件夹后才能写入本地文件", true);
      return;
    }
    const directoryHandle = state.storage.directoryHandle;
    const count = state.data.cards.length;
    if (!window.confirm(`将当前网页中的 ${count} 张牌写入 ${state.storage.directoryName}/${CUBE_FILE_NAME}，覆盖文件夹里的旧数据。是否继续？`)) return;
    state.folderSync = { syncing: true, dirty: false, lastResult: null };
    renderStorageStatus();
    try {
      if (!await flushDirectoryWrites(directoryHandle)) throw new Error("自动保存失败，文件夹连接已断开");
      if (!await requestDirectoryPermission(directoryHandle, "readwrite")) {
        state.folderSync = { syncing: false, dirty: true, lastResult: { ok: false, message: "没有文件夹写入权限" } };
        renderStorageStatus();
        toast("无法写入文件夹", "请重新授权这个 Cube 文件夹", true);
        return;
      }
      const snapshot = snapshotCubeData(state.data);
      await writeCubeDataFile(directoryHandle, snapshot);
      await writePriceHistoryFile(directoryHandle, state.priceHistory);
      recordChange("storage.synced", `写入文件夹：${count} 张牌`, { meta: { count } }, { persist: false });
      await writeChangeLogFile(directoryHandle, state.changeLog);
      localMirrorSave();
      savePriceHistoryLocal();
      saveChangeLogLocal();
      state.folderSync = {
        syncing: false,
        dirty: false,
        lastResult: { ok: true, count, time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }
      };
      renderStorageStatus();
      toast("已写入文件夹", `${state.storage.directoryName}/${CUBE_FILE_NAME}、${PRICE_HISTORY_FILE_NAME} 与 ${CHANGE_LOG_FILE_NAME} 已保存`);
    } catch (error) {
      state.folderSync = { syncing: false, dirty: true, lastResult: { ok: false, message: error.message || "无法写入 Cube 文件夹" } };
      renderStorageStatus();
      toast("写入失败", error.message || "无法写入 Cube 文件夹", true);
    }
  }

  async function createThumbnailBlob(sourceBlob) {
    const bitmap = await createImageBitmap(sourceBlob);
    try {
      const scale = Math.min(1, THUMBNAIL_MAX_WIDTH / bitmap.width);
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器无法创建缩略图画布");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, width, height);
      return await new Promise((resolve, reject) => canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("浏览器无法生成 WebP 缩略图"));
      }, "image/webp", THUMBNAIL_WEBP_QUALITY));
    } finally {
      if (typeof bitmap.close === "function") bitmap.close();
    }
  }

  async function cacheAllImages() {
    if (state.imageCaching) return;
    if (state.storage.mode !== "directory" || !state.storage.directoryHandle) {
      toast("请先连接文件夹", "本地卡图需要写入 Cube 文件夹", true);
      return;
    }
    if (!await requestDirectoryPermission(state.storage.directoryHandle, "readwrite")) {
      toast("无法写入文件夹", "请重新授权这个 Cube 文件夹", true);
      return;
    }
    state.imageCaching = true;
    renderStorageStatus();
    try {
      const summary = await imageCache.cacheAll(getValuedCards(), {
        checkpointEvery: IMAGE_CACHE_CHECKPOINT,
        onProgress: ({ index, total }) => {
          if (elements.cacheImagesBtn) elements.cacheImagesBtn.textContent = `整理卡图 ${index}/${total}`;
        },
        checkpoint: (progress) => {
          if (progress.updated) saveState("cube");
        }
      });
      if (summary.updated || summary.failed) recordChange("images.cached", `下载本地卡图：更新 ${summary.updated}，失败 ${summary.failed}`, { meta: { updated: summary.updated, failed: summary.failed, total: summary.total } }, { persist: false });
      if (summary.updated) {
        saveState(["cube", "changeLog"]);
        renderScheduler.request("cards");
      } else if (summary.failed) {
        saveState("changeLog");
      }
      toast("本地卡图整理完成", `已更新 ${summary.updated} 张，本次失败 ${summary.failed} 张；原图保留，牌表使用 WebP 缩略图${summary.total ? "" : "，没有可处理图片"}`);
    } finally {
      state.imageCaching = false;
      renderStorageStatus();
    }
  }

  async function reloadFromDirectory() {
    if (!state.storage.directoryHandle) return;
    const directoryHandle = state.storage.directoryHandle;
    if (persistence.hasDirty()) {
      toast("暂时无法重载", "仍有网页更改正在写入文件夹，请等待保存完成后再重试", true);
      return;
    }
    if (!window.confirm(`从 ${state.storage.directoryName}/${CUBE_FILE_NAME} 重新载入会覆盖当前 Cube，是否继续？`)) return;
    try {
      if (!await requestDirectoryPermission(directoryHandle, "readwrite")) {
        toast("无法读取文件夹", "请重新授权这个 Cube 文件夹", true);
        return;
      }
      const fileData = await readCubeDataFile(directoryHandle);
      if (!fileData) {
        toast("没有找到数据文件", `${state.storage.directoryName} 里还没有 ${CUBE_FILE_NAME}`, true);
        return;
      }
      const priceHistoryData = await readPriceHistoryFile(directoryHandle);
      const changeLogData = await readChangeLogFile(directoryHandle);
      const resolved = resolveLoadedWorkspace(fileData, priceHistoryData, changeLogData);
      applyCubeData(resolved.cubeData);
      applyPriceHistoryData(resolved.priceHistoryData);
      applyChangeLogData(resolved.changeLogData);
      await persistWorkspaceUpgrades(directoryHandle, resolved, { includeCube: false });
      localMirrorSave();
      savePriceHistoryLocal();
      saveChangeLogLocal();
      renderAll();
      renderStorageStatus();
      recordChange("storage.reloaded", "从文件夹重新载入 Cube", { meta: { count: state.data.cards.length } });
      toast("已从文件夹载入", `${state.storage.directoryName}/${CUBE_FILE_NAME}`);
    } catch (error) {
      toast("载入失败", error.message || "无法读取 Cube 文件夹", true);
    }
  }

  async function connectCubeFolder() {
    if (!state.storage.supported) {
      toast("当前浏览器不支持", "请使用较新的 Chromium 浏览器以启用文件夹保存", true);
      return;
    }
    try {
      await persistence.flush();
      const directoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      if (!await requestDirectoryPermission(directoryHandle, "readwrite")) {
        toast("没有获得权限", "需要允许读写该文件夹才能自动保存", true);
        return;
      }
      const fileData = await readCubeDataFile(directoryHandle);
      const priceHistoryData = await readPriceHistoryFile(directoryHandle);
      const changeLogData = await readChangeLogFile(directoryHandle);
      if (fileData) {
        const shouldLoad = window.confirm(`发现现有的 ${CUBE_FILE_NAME}。\n确定要载入文件里的 Cube 吗？\n选择“取消”会用当前牌表覆盖文件内容。`);
        if (shouldLoad) {
          const resolved = resolveLoadedWorkspace(fileData, priceHistoryData, changeLogData);
          applyCubeData(resolved.cubeData);
          applyPriceHistoryData(resolved.priceHistoryData);
          applyChangeLogData(resolved.changeLogData);
          await persistWorkspaceUpgrades(directoryHandle, resolved);
        } else {
          await writeCubeDataFile(directoryHandle, snapshotCubeData(state.data));
          await writePriceHistoryFile(directoryHandle, state.priceHistory);
          await writeChangeLogFile(directoryHandle, state.changeLog);
        }
      } else {
        await writeCubeDataFile(directoryHandle, snapshotCubeData(state.data));
        await writePriceHistoryFile(directoryHandle, state.priceHistory);
        await writeChangeLogFile(directoryHandle, state.changeLog);
      }
      state.storage.mode = "directory";
      state.storage.directoryHandle = directoryHandle;
      state.storage.directoryName = directoryHandle.name || "";
      state.storage.rememberedDirectoryName = directoryHandle.name || "";
      state.storage.rememberedDirectoryHandle = directoryHandle;
      await cubeHandleStore.save(DIRECTORY_HANDLE_KEY, directoryHandle).catch(() => false);
      localMirrorSave();
      savePriceHistoryLocal();
      saveChangeLogLocal();
      renderAll();
      renderStorageStatus();
      recordChange("storage.connected", `已连接文件夹：${state.storage.directoryName}`, { meta: { directoryName: state.storage.directoryName } });
      toast("已连接文件夹", `后续修改会自动写入 ${state.storage.directoryName}`);
    } catch (error) {
      if (error && error.name === "AbortError") return;
      toast("连接失败", error.message || "无法连接 Cube 文件夹", true);
    }
  }

  async function activateDirectoryHandle(directoryHandle) {
    const fileData = await readCubeDataFile(directoryHandle);
    const priceHistoryData = await readPriceHistoryFile(directoryHandle);
    const changeLogData = await readChangeLogFile(directoryHandle);
    const resolved = resolveLoadedWorkspace(fileData, priceHistoryData, changeLogData);
    state.storage.mode = "directory";
    state.storage.directoryHandle = directoryHandle;
    state.storage.directoryName = directoryHandle.name || "";
    state.storage.rememberedDirectoryName = directoryHandle.name || "";
    state.storage.rememberedDirectoryHandle = directoryHandle;
    applyCubeData(resolved.cubeData);
    applyPriceHistoryData(resolved.priceHistoryData);
    applyChangeLogData(resolved.changeLogData);
    await persistWorkspaceUpgrades(directoryHandle, resolved);
    localMirrorSave();
    savePriceHistoryLocal();
    saveChangeLogLocal();
    renderAll();
    renderStorageStatus();
  }

  async function reconnectRememberedFolder() {
    const directoryHandle = state.storage.rememberedDirectoryHandle;
    if (!directoryHandle) return connectCubeFolder();
    try {
      if (!await requestDirectoryPermission(directoryHandle, "readwrite")) {
        toast("没有获得权限", `请允许读写 ${directoryHandle.name || "之前选择的文件夹"}`, true);
        return;
      }
      await activateDirectoryHandle(directoryHandle);
      toast("文件夹已重新连接", `已恢复自动读写 ${directoryHandle.name || "Cube 文件夹"}`);
    } catch (error) {
      toast("重新连接失败", error.message || "无法读取之前选择的 Cube 文件夹", true);
    }
  }

  function handleConnectFolderClick() {
    return state.storage.mode === "directory"
      ? connectCubeFolder()
      : state.storage.rememberedDirectoryHandle ? reconnectRememberedFolder() : connectCubeFolder();
  }

  async function restoreDirectoryMode() {
    if (!state.storage.supported || !cubeHandleStore.supported) {
      renderStorageStatus();
      return;
    }
    try {
      const directoryHandle = await cubeHandleStore.load(DIRECTORY_HANDLE_KEY);
      if (!directoryHandle) {
        renderStorageStatus();
        return;
      }
      state.storage.rememberedDirectoryName = directoryHandle.name || "";
      state.storage.rememberedDirectoryHandle = directoryHandle;
      if (await queryDirectoryPermission(directoryHandle, "readwrite") !== "granted") {
        renderStorageStatus();
        return;
      }
      await activateDirectoryHandle(directoryHandle);
    } catch (error) {
      // Fallback to local mirror on startup.
    }
    renderStorageStatus();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  function cardDisplayName(card) {
    const name = state.nameLanguage === "zh" ? getPreferredLocalizedName(card) || card.name || "" : card.name || "";
    return getCardDisplayName(card, name);
  }

  function renderNameLanguageToggle() {
    if (!elements.nameLanguageToggle) return;
    $$("[data-name-language]", elements.nameLanguageToggle).forEach((button) => {
      const active = button.dataset.nameLanguage === state.nameLanguage;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    const zhButton = $('[data-name-language="zh"]', elements.nameLanguageToggle);
    if (zhButton) {
      const loading = state.nameLanguage === "zh" && state.nameLocalization.refreshing;
      zhButton.classList.toggle("loading", loading);
      zhButton.title = loading ? "正在补齐中文卡牌名" : "显示中文卡牌名";
    }
  }

  function setNameLanguage(language) {
    const nextLanguage = language === "zh" ? "zh" : "en";
    if (state.nameLanguage === nextLanguage) return;
    state.nameLanguage = nextLanguage;
    viewPreferences.set("nameLanguage", nextLanguage);
    renderScheduler.request("nameLanguage", "cards", "basics");
  }

  function missingLocalizedNameCards(cards) {
    const seen = new Set();
    return cards.filter((card) => {
      const localizedName = getPreferredLocalizedName(card);
      const incompleteSplitName = isSplitCard(card) && String(card.name || "").includes("//") && !localizedName.includes("//");
      if (localizedName && !incompleteSplitName) return false;
      const oracleId = getOracleId(card);
      const failure = state.nameLocalization.failures.get(oracleId);
      if (!oracleId || failure && failure.permanent || seen.has(oracleId)) return false;
      seen.add(oracleId);
      return true;
    });
  }

  function cardItemSelector(cardId) {
    const escapedId = window.CSS && typeof window.CSS.escape === "function" ? window.CSS.escape(cardId) : String(cardId).replace(/["\\]/g, "\\$&");
    return `.card-item[data-id="${escapedId}"]`;
  }

  function updateCardNameNode(card) {
    if (state.nameLanguage !== "zh") return;
    const node = elements.cardGrid.querySelector(cardItemSelector(card.id));
    if (!node) return;
    const displayName = cardDisplayName(card);
    const fallbackName = $(".fallback-name", node);
    const cardName = $(".card-name", node);
    const cardImage = $(".card-image", node);
    const finishButton = $("[data-toggle-finish]", node);
    const printingButton = $("[data-change-printing]", node);
    const japanPrintButton = $("[data-toggle-japan-print]", node);
    const removeButton = $("[data-remove]", node);
    if (fallbackName) fallbackName.textContent = displayName;
    if (cardName) {
      cardName.textContent = displayName;
      cardName.title = displayName;
    }
    if (cardImage) cardImage.alt = displayName;
    if (finishButton && !finishButton.disabled) finishButton.title = `切换 ${displayName} 的 Foil 状态`;
    if (printingButton) printingButton.title = `选择 ${displayName} 的其他版本`;
    if (japanPrintButton) {
      const marked = japanPrintButton.getAttribute("aria-pressed") === "true";
      japanPrintButton.title = marked ? "取消日印标记" : "标记为日印";
      japanPrintButton.setAttribute("aria-label", marked ? `取消 ${displayName} 的日印标记` : `标记 ${displayName} 为日印`);
    }
    if (removeButton) removeButton.setAttribute("aria-label", `移除 ${displayName}`);
  }

  function applyLocalizedName(oracleId, lang, name) {
    let updated = false;
    getValuedCards().forEach((card) => {
      if (getOracleId(card) !== oracleId) return;
      const names = normalizeLocalizedNames(card);
      if (names[lang] === name) return;
      card.localizedNames = { ...names, [lang]: name };
      updateCardNameNode(card);
      updated = true;
    });
    if (updated) renderScheduler.request("basics");
    return updated;
  }

  async function lookupLocalizedName(card) {
    const oracleId = getOracleId(card);
    let scryfallError = null;
    let url = buildLocalizedNameSearchUrl(oracleId, "zhs");
    while (url) {
      let page;
      try {
        page = await scryfallRequest(url);
      } catch (error) {
        if (error.status !== 404) scryfallError = error;
        break;
      }
      const match = (page.data || []).find((printing) => getOracleId(printing) === oracleId && isPaperPrinting(printing) && normalizeLocalizedNames(printing).zhs);
      if (match) return { lang: "zhs", name: normalizeLocalizedNames(match).zhs, source: "scryfall" };
      url = page.has_more ? page.next_page : null;
    }

    const mtgchName = await mtgch.lookupSimplifiedChineseName(card);
    if (mtgchName) return { lang: "zhs", name: mtgchName, source: "mtgch" };
    if (scryfallError) throw scryfallError;
    return null;
  }

  async function refreshMissingLocalizedNames(cards) {
    missingLocalizedNameCards(cards).forEach((card) => {
      state.nameLocalization.pending.set(getOracleId(card), card);
    });
    if (state.nameLanguage !== "zh" || state.nameLocalization.refreshing) return;
    window.clearTimeout(state.nameLocalization.retryTimer);
    state.nameLocalization.retryTimer = 0;
    state.nameLocalization.refreshing = true;
    renderNameLanguageToggle();
    let changedSinceSave = 0;
    try {
      while (state.nameLanguage === "zh") {
        const now = Date.now();
        const pending = [...state.nameLocalization.pending.entries()].find(([oracleId]) => {
          const failure = state.nameLocalization.failures.get(oracleId);
          return !failure || failure.retryAt <= now;
        });
        if (!pending) break;
        const [oracleId, target] = pending;
        state.nameLocalization.pending.delete(oracleId);
        try {
          const localized = await lookupLocalizedName(target);
          if (!localized) {
            state.nameLocalization.failures.set(oracleId, { permanent: true, attempts: 1, retryAt: Infinity });
            continue;
          }
          state.nameLocalization.failures.delete(oracleId);
          if (applyLocalizedName(oracleId, localized.lang, localized.name)) changedSinceSave += 1;
          if (changedSinceSave >= 20) {
            saveState("cube");
            changedSinceSave = 0;
          }
        } catch (_error) {
          const previous = state.nameLocalization.failures.get(oracleId);
          const attempts = Math.min(6, Number(previous && previous.attempts || 0) + 1);
          const retryAt = Date.now() + Math.min(5 * 60 * 1000, 15000 * (2 ** (attempts - 1)));
          state.nameLocalization.failures.set(oracleId, { permanent: false, attempts, retryAt });
          state.nameLocalization.pending.set(oracleId, target);
        }
      }
    } finally {
      if (changedSinceSave) saveState("cube");
      state.nameLocalization.refreshing = false;
      renderNameLanguageToggle();
      const nextRetryAt = [...state.nameLocalization.pending.keys()].reduce((earliest, oracleId) => {
        const failure = state.nameLocalization.failures.get(oracleId);
        return failure && Number.isFinite(failure.retryAt) ? Math.min(earliest, failure.retryAt) : earliest;
      }, Infinity);
      if (state.nameLanguage === "zh" && Number.isFinite(nextRetryAt)) {
        state.nameLocalization.retryTimer = window.setTimeout(
          () => refreshMissingLocalizedNames([]),
          Math.max(0, nextRetryAt - Date.now())
        );
      }
    }
  }

  function renderAll() {
    renderScheduler.request("meta", "stats", "nameLanguage", "cards", "basics", "analytics");
    renderScheduler.flush();
  }

  function requestDataRender() {
    renderScheduler.request("meta", "stats", "cards", "analytics");
  }

  function renderMeta() {
    $("#cubeTitle").textContent = state.data.meta.name;
    $("#sidebarCubeName").textContent = state.data.meta.name;
    $("#cubeDescription").textContent = state.data.meta.description;
    $("#sidebarCubeCount").textContent = state.data.cards.length;
  }

  function renderStats() {
    const stats = selectors.selectStats(state.data.cards, state.dataRevision);
    const priceView = selectors.selectPriceView(getValuedCards(), state.dataRevision, state.priceHistory, state.historyRevision);
    const priceInfo = priceStatus(priceView);
    const totalPriceTrend = priceView.totalTrend;
    const priceAction = `<button type="button" class="stat-action icon-only" data-show-total-history aria-label="查看总价历史" title="查看总价历史">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19h16"/><path d="M6 15l4-5 4 3 4-7"/></svg>
    </button><button type="button" class="stat-action icon-only" data-show-today-price-changes aria-label="查看今日价格变动" title="查看今日价格变动">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10M7 12h10M7 17h6"/><path d="M4 7h.01M4 12h.01M4 17h.01"/></svg>
    </button><button type="button" class="stat-action icon-only${state.refreshingPrices ? " loading" : ""}" data-refresh-prices ${state.refreshingPrices ? "disabled" : ""} aria-label="${state.refreshingPrices ? "正在更新价格" : "手动更新价格"}" title="${state.refreshingPrices ? "正在更新价格" : "手动更新价格"}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 1-2.35-5.65"/><path d="M20 4v7h-7"/></svg>
    </button>`;
    const cards = [
      ["总牌数", stats.total, "张", "当前 Cube 规模", "cards"],
      ["平均费用", stats.averageCmc.toFixed(2), "CMC", "地牌不计入", "curve"],
      ["生物", stats.creatures, "张", `${percent(stats.creatures, stats.total)}% 的牌表`, "creature"],
      ["地牌", stats.lands, "张", `${percent(stats.lands, stats.total)}% 的牌表`, "land"],
      ["总价", `${formatUsd(priceView.currentTotal)}${priceTrendBadge(totalPriceTrend)}`, "USD", priceInfo, "cards", priceAction]
    ];
    const icons = {
      cards: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6"/>',
      curve: '<path d="M3 18h18M5 16c3-1 4-6 7-6s4 4 7 4"/>',
      creature: '<path d="M8 20v-6l-3-3 3-7 4 4 4-4 3 7-3 3v6Z"/>',
      land: '<path d="M12 21V10M7 15c-3-1-4-4-3-7 4 0 7 2 8 5M17 14c3-1 4-4 3-7-4 0-7 2-8 5"/>'
    };
    elements.statsGrid.innerHTML = cards.map(([label, value, unit, foot, icon, action = ""]) => `
      <article class="stat-card">
        <div class="stat-label"><div class="stat-label-main"><span>${label}</span>${action}</div><svg viewBox="0 0 24 24">${icons[icon]}</svg></div>
        <span class="stat-value">${value}<small>${unit}</small></span>
        <div class="stat-foot-row"><div class="stat-foot">${foot}</div></div>
      </article>`).join("");
  }

  function percent(part, total) {
    return total ? Math.round(part / total * 100) : 0;
  }

  function formatUsd(value) {
    if (value === null || value === undefined || value === "") return "—";
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "—";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2, minimumFractionDigits: amount >= 1 ? 2 : 2 }).format(amount);
  }

  function cardPrice(card) {
    return getUsdPrice(card, card.finish);
  }

  function priceTrendBadge(trend) {
    if (!trend) return "";
    const directionLabel = trend.direction === "up" ? "上涨" : "下跌";
    const arrow = trend.direction === "up" ? "▲" : "▼";
    const percent = trend.percent === null ? "" : `，${Math.abs(trend.percent).toFixed(2)}%`;
    const title = `较上次记录${directionLabel} ${formatUsd(Math.abs(trend.delta))}${percent}`;
    return `<span class="price-trend ${trend.direction}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${arrow}</span>`;
  }

  function priceStatus(priceView) {
    const updated = priceView.latestUpdatedAt === null ? "尚未更新" : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(priceView.latestUpdatedAt);
    const sourceName = state.priceIndexMode === "local"
      ? "本地 MTGJSON"
      : state.priceIndexMode === "bundled" && mtgjsonLocalPriceEndpoint() ? "内置 MTGJSON" : "MTGJSON";
    const source = state.priceIndexSource && state.priceIndexSource.date ? ` · ${sourceName} ${state.priceIndexSource.date}` : "";
    return `最近更新 ${updated}${source}${priceView.missingCount ? ` · 缺价 ${priceView.missingCount} 张` : ""}`;
  }

  function formatHistoryDate(date) {
    const parsed = new Date(`${date}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return date;
    return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(parsed);
  }

  function formatChartUsd(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "—";
    const absolute = Math.abs(amount);
    if (absolute >= 1000) {
      return `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(amount)}`;
    }
    return `$${amount.toFixed(absolute >= 100 ? 0 : absolute >= 10 ? 1 : 2)}`;
  }

  function monotonePricePath(points) {
    if (!points.length) return "";
    if (points.length === 1) return `M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    const slopes = points.slice(1).map((point, index) => {
      const previous = points[index];
      return (point.y - previous.y) / Math.max(0.001, point.x - previous.x);
    });
    const tangents = points.map((_point, index) => {
      if (index === 0) return slopes[0];
      if (index === points.length - 1) return slopes[slopes.length - 1];
      const before = slopes[index - 1];
      const after = slopes[index];
      if (before * after <= 0) return 0;
      return 2 / (1 / before + 1 / after);
    });
    slopes.forEach((slope, index) => {
      if (!slope) {
        tangents[index] = 0;
        tangents[index + 1] = 0;
        return;
      }
      const beforeRatio = tangents[index] / slope;
      const afterRatio = tangents[index + 1] / slope;
      const magnitude = Math.hypot(beforeRatio, afterRatio);
      if (magnitude <= 3) return;
      const scale = 3 / magnitude;
      tangents[index] = scale * beforeRatio * slope;
      tangents[index + 1] = scale * afterRatio * slope;
    });
    return points.slice(1).reduce((path, point, index) => {
      const previous = points[index];
      const width = point.x - previous.x;
      const controlOffset = width / 3;
      return `${path} C${(previous.x + controlOffset).toFixed(2)} ${(previous.y + tangents[index] * controlOffset).toFixed(2)},${(point.x - controlOffset).toFixed(2)} ${(point.y - tangents[index + 1] * controlOffset).toFixed(2)},${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    }, `M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`);
  }

  function renderPriceHistoryPanel({ title, subtitle, points, emptyText }) {
    const series = (points || []).filter((point) => Number.isFinite(Number(point.usd))).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!series.length) {
      return `<section class="price-history-panel empty">
        <div class="price-history-head"><div><span>PRICE HISTORY</span><strong>${escapeHtml(title)}</strong></div><small>${escapeHtml(subtitle || "")}</small></div>
        <p>${escapeHtml(emptyText || "暂无价格历史。点击“更新价格”后会记录今天的快照。")}</p>
      </section>`;
    }
    const width = 600;
    const height = 244;
    const padLeft = 62;
    const padRight = 18;
    const padTop = 18;
    const padBottom = 36;
    const values = series.map((point) => Number(point.usd));
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const rawRange = rawMax - rawMin;
    const chartPadding = rawRange ? rawRange * 0.12 : Math.max(1, rawMax * 0.06);
    const min = Math.max(0, rawMin - chartPadding);
    const max = rawMax + chartPadding;
    const range = max - min || 1;
    const plotBottom = height - padBottom;
    const plotRight = width - padRight;
    const xPositions = datePositions(series, padLeft, plotRight);
    const yFor = (value) => plotBottom - ((value - min) / range) * (plotBottom - padTop);
    const coords = series.map((point, index) => ({ ...point, x: xPositions[index], y: yFor(Number(point.usd)) }));
    const chartSegments = splitDateSeries(coords, 7);
    const linePaths = chartSegments.filter((segment) => segment.length > 1).map(monotonePricePath);
    const areaPaths = chartSegments.filter((segment) => segment.length > 1).map((segment) => {
      const linePath = monotonePricePath(segment);
      return `${linePath} L${segment[segment.length - 1].x.toFixed(2)} ${plotBottom} L${segment[0].x.toFixed(2)} ${plotBottom} Z`;
    });
    const ticks = Array.from({ length: 5 }, (_value, index) => {
      const ratio = index / 4;
      return {
        value: max - range * ratio,
        y: padTop + (plotBottom - padTop) * ratio
      };
    });
    const labelIndexes = dateLabelIndexes(xPositions, 90);
    const pointInterval = Math.max(1, Math.ceil(coords.length / 14));
    const chartId = `price-chart-${++priceChartSequence}`;
    const first = series[0];
    const latest = series[series.length - 1];
    const change = Number(latest.usd) - Number(first.usd);
    const changePercent = Number(first.usd) ? change / Number(first.usd) * 100 : null;
    const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
    const changeText = `${change > 0 ? "+" : ""}${formatUsd(change)}${changePercent === null ? "" : ` · ${changePercent > 0 ? "+" : ""}${changePercent.toFixed(2)}%`}`;
    return `<section class="price-history-panel">
      <div class="price-history-head"><div><span>PRICE HISTORY</span><strong>${escapeHtml(title)}</strong></div><small>${escapeHtml(subtitle || `${series.length} 个每日快照`)}</small></div>
      <svg class="price-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)} 价格历史曲线">
        <defs>
          <linearGradient id="${chartId}-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#e8c879" stop-opacity=".30"/>
            <stop offset="58%" stop-color="#d9b56f" stop-opacity=".10"/>
            <stop offset="100%" stop-color="#d9b56f" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="${chartId}-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#a98951"/>
            <stop offset="55%" stop-color="#d9b56f"/>
            <stop offset="100%" stop-color="#f0d78f"/>
          </linearGradient>
        </defs>
        <rect class="price-chart-plot" x="${padLeft}" y="${padTop}" width="${plotRight - padLeft}" height="${plotBottom - padTop}" rx="8"/>
        ${ticks.map((tick) => `<line class="price-grid-line" x1="${padLeft}" y1="${tick.y.toFixed(1)}" x2="${plotRight}" y2="${tick.y.toFixed(1)}"/><text x="${padLeft - 10}" y="${(tick.y + 3).toFixed(1)}" text-anchor="end" class="price-axis">${escapeHtml(formatChartUsd(tick.value))}</text>`).join("")}
        ${labelIndexes.map((index) => {
          const point = coords[index];
          const anchor = index === 0 ? "start" : index === coords.length - 1 ? "end" : "middle";
          return `<text x="${point.x.toFixed(1)}" y="${height - 10}" text-anchor="${anchor}" class="price-axis price-date-axis">${escapeHtml(formatHistoryDate(point.date))}</text>`;
        }).join("")}
        ${areaPaths.map((path) => `<path class="price-area" d="${path}" fill="url(#${chartId}-area)"/>`).join("")}
        ${linePaths.map((path) => `<path class="price-line" d="${path}" stroke="url(#${chartId}-line)" pathLength="1"/>`).join("")}
        ${coords.map((point, index) => `<g class="price-point-group${index === coords.length - 1 ? " latest" : ""}">
          <circle class="price-point${index % pointInterval === 0 || index === coords.length - 1 ? " visible" : ""}" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${index === coords.length - 1 ? "4.2" : "2.4"}"/>
          <circle class="price-point-hit" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="7"><title>${escapeHtml(point.date)} · ${escapeHtml(formatUsd(point.usd))}</title></circle>
        </g>`).join("")}
      </svg>
      <div class="price-history-summary">
        <div><span>起始</span><strong>${escapeHtml(formatHistoryDate(first.date))} · ${escapeHtml(formatUsd(first.usd))}</strong></div>
        <div class="price-history-change ${direction}"><span>区间变化</span><strong>${escapeHtml(changeText)}</strong></div>
        <div class="latest"><span>当前</span><strong>${escapeHtml(formatHistoryDate(latest.date))} · ${escapeHtml(formatUsd(latest.usd))}</strong></div>
      </div>
    </section>`;
  }

  function openTotalPriceHistory() {
    const points = totalSeries(state.priceHistory);
    const firstPoint = points[0];
    const latestPoint = points[points.length - 1];
    const source = state.priceIndexSource;
    const historyRange = source && source.historyFrom
      ? `${formatHistoryDate(source.historyFrom)} 至 ${formatHistoryDate(source.historyTo || source.date)}`
      : "首次使用时加载精简历史索引";
    const fullRange = firstPoint && latestPoint
      ? `全部历史 · ${formatHistoryDate(firstPoint.date)} 至 ${formatHistoryDate(latestPoint.date)} · ${points.length} 个每日快照`
      : "全部历史";
    const tools = `<div class="price-history-tools">
      <div><strong>MTGJSON 历史同步</strong><small>${escapeHtml(historyRange)} · 仅补全最近 90 天，不限制下方曲线范围</small></div>
      <button type="button" class="text-button" data-sync-price-history ${state.syncingPriceHistory ? "disabled" : ""}>${state.syncingPriceHistory ? "正在同步…" : "同步近 90 天"}</button>
    </div>`;
    elements.priceHistoryContent.innerHTML = tools + renderPriceHistoryPanel({
      title: "Cube 总价",
      subtitle: fullRange,
      points,
      emptyText: "暂无总价历史。点击总价旁边的刷新按钮后，会记录今天的 Cube 总价。"
    });
    if (!elements.priceHistoryDialog.open) elements.priceHistoryDialog.showModal();
  }

  function mtgjsonHistoryEndpoint() {
    if (isLocalHttpPage()) return "/mtgjson-price-history";
    if (location.protocol === "file:") return "http://127.0.0.1:4173/mtgjson-price-history";
    return "";
  }

  function mtgjsonLocalPriceEndpoint() {
    if (isLocalHttpPage()) return "/mtgjson-price-index/local";
    if (location.protocol === "file:") return "http://127.0.0.1:4173/mtgjson-price-index/local";
    return "";
  }

  function localProductSourceEndpoint() {
    if (isLocalHttpPage()) return "/product-source-index/local";
    if (location.protocol === "file:") return "http://127.0.0.1:4173/product-source-index/local";
    return "";
  }

  function localPriceCubeData() {
    return {
      meta: { name: state.data.meta.name || "Arcana Cube" },
      cards: getValuedCards().map((card) => ({
        scryfallId: card.scryfallId || "",
        oracleId: card.oracleId || "",
        set: card.set || "",
        collectorNumber: card.collectorNumber || "",
        name: card.name || ""
      }))
    };
  }

  function priceIndexGeneratedToday(index) {
    const generatedAt = new Date(index && index.generatedAt || "");
    return !Number.isNaN(generatedAt.getTime()) && dateKey(generatedAt) === dateKey();
  }

  function priceIndexMatchesCube(index) {
    return Boolean(index && index.source && index.source.cubeFingerprint === cubeFingerprint(getValuedCards()));
  }

  function productSourceIndexMatchesCube(index) {
    return Boolean(index && index.source && index.source.cubeFingerprint === cubeFingerprint(getValuedCards()));
  }

  async function requestLocalProductSourceIndex(update = false) {
    const endpoint = localProductSourceEndpoint();
    if (!endpoint) return null;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), update ? 10 * 60 * 1000 : 3000);
    try {
      const response = await fetch(endpoint, {
        method: update ? "POST" : "GET",
        headers: { Accept: "application/json", ...(update ? { "Content-Type": "application/json" } : {}) },
        ...(update ? { body: JSON.stringify({ cubeData: localPriceCubeData() }) } : {}),
        cache: "no-store",
        signal: controller.signal
      });
      if (!update && response.status === 404) return null;
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "本地产品来源索引不可用");
      return payload;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function loadPreferredProductSourceIndex() {
    const fingerprint = cubeFingerprint(getValuedCards());
    if (preferredProductSourceIndex.fingerprint === fingerprint && preferredProductSourceIndex.promise) {
      return preferredProductSourceIndex.promise;
    }
    const promise = (async () => {
      let warning = "";
      productSourceCatalog.clearCache();
      const bundledIndex = await productSourceCatalog.loadIndex();
      if (productSourceIndexMatchesCube(bundledIndex)) {
        return { index: bundledIndex, matchesCube: true, warning };
      }
      const endpoint = localProductSourceEndpoint();
      if (endpoint) {
        let localIndex = null;
        try {
          localIndex = await requestLocalProductSourceIndex(false);
          if (!productSourceIndexMatchesCube(localIndex)) localIndex = await requestLocalProductSourceIndex(true);
        } catch (error) {
          warning = error.name === "AbortError" ? "本地产品来源更新超时" : error.message || "本地产品来源更新失败";
        }
        if (productSourceIndexMatchesCube(localIndex)) {
          await productSourceCatalog.setIndex(localIndex);
          return { index: localIndex, matchesCube: true, warning };
        }
      }
      return { index: bundledIndex, matchesCube: false, warning };
    })();
    preferredProductSourceIndex = { fingerprint, promise };
    promise.catch(() => {
      if (preferredProductSourceIndex.promise === promise) preferredProductSourceIndex = { fingerprint: "", promise: null };
    });
    return promise;
  }

  async function requestLocalPriceIndex(update = false) {
    const endpoint = mtgjsonLocalPriceEndpoint();
    if (!endpoint) return null;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), update ? 10 * 60 * 1000 : 3000);
    try {
      const response = await fetch(endpoint, {
        method: update ? "POST" : "GET",
        headers: { Accept: "application/json", ...(update ? { "Content-Type": "application/json" } : {}) },
        ...(update ? { body: JSON.stringify({ cubeData: localPriceCubeData() }) } : {}),
        cache: "no-store",
        signal: controller.signal
      });
      if (!update && response.status === 404) return null;
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "本地 MTGJSON 价格索引不可用");
      if (!validateMtgjsonPriceIndex(payload)) throw new Error("本地 MTGJSON 价格索引格式无效");
      return payload;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function loadCachedLocalPriceIndex() {
    if (!localMtgjsonPriceIndexPromise) {
      const request = requestLocalPriceIndex(false);
      localMtgjsonPriceIndexPromise = request;
      request.catch(() => {
        if (localMtgjsonPriceIndexPromise === request) localMtgjsonPriceIndexPromise = null;
      });
    }
    return localMtgjsonPriceIndexPromise;
  }

  function cacheLocalPriceIndex(index) {
    localMtgjsonPriceIndexPromise = Promise.resolve(index);
    return index;
  }

  async function loadPreferredMtgjsonPriceIndex(options = {}) {
    const endpoint = mtgjsonLocalPriceEndpoint();
    let localIndex = null;
    let warning = "";
    if (endpoint) {
      if (!options.rebuildLocal) {
        try {
          localIndex = await loadCachedLocalPriceIndex();
        } catch (error) {
          warning = error.name === "AbortError" ? "连接本地价格服务超时" : error.message || "本地价格服务不可用";
        }
      }
      const shouldUpdate = options.rebuildLocal || (options.refreshLocalIfStale && (!priceIndexGeneratedToday(localIndex) || !priceIndexMatchesCube(localIndex)));
      if (shouldUpdate) {
        try {
          localIndex = await requestLocalPriceIndex(true);
          if (!priceIndexMatchesCube(localIndex)) throw new Error("本地价格索引与当前牌表不一致");
          cacheLocalPriceIndex(localIndex);
          state.priceIndexMode = "local";
          return { index: localIndex, mode: "local", rebuilt: true, warning: "" };
        } catch (error) {
          warning = error.name === "AbortError" ? "本地价格索引更新超时" : error.message || "本地价格索引更新失败";
          if (options.rebuildLocal) {
            throw new Error(`${warning}。请先双击“启动 Cube.command”，再从 http://127.0.0.1:4173/ 打开 Cube`);
          }
        }
      }
      if (localIndex && priceIndexMatchesCube(localIndex)) {
        cacheLocalPriceIndex(localIndex);
        state.priceIndexMode = "local";
        return { index: localIndex, mode: "local", rebuilt: false, warning };
      }
      if (localIndex && !warning) warning = "本地价格索引与当前牌表不一致，已忽略旧缓存";
    }
    const index = await bundledMtgjsonPriceCatalog.loadIndex();
    state.priceIndexMode = "bundled";
    return { index, mode: "bundled", rebuilt: false, warning };
  }

  async function loadMtgjsonPrintingPriceIndex() {
    const preferred = await loadPreferredMtgjsonPriceIndex();
    if (preferred.mode === "bundled") return preferred.index;
    const bundled = await bundledMtgjsonPriceCatalog.loadIndex();
    if (combinedMtgjsonPriceIndexCache.bundled === bundled && combinedMtgjsonPriceIndexCache.local === preferred.index) {
      return combinedMtgjsonPriceIndexCache.index;
    }
    const index = overlayMtgjsonPriceIndex(bundled, preferred.index);
    combinedMtgjsonPriceIndexCache = { bundled, local: preferred.index, index };
    return index;
  }

  function abortReason(signal) {
    return signal && signal.reason instanceof Error ? signal.reason : new DOMException("请求已取消", "AbortError");
  }

  function waitForAbortable(task, signal) {
    if (!signal) return Promise.resolve(task);
    if (signal.aborted) return Promise.reject(abortReason(signal));
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(abortReason(signal));
      signal.addEventListener("abort", onAbort, { once: true });
      Promise.resolve(task).then((value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      }, (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      });
    });
  }

  async function loadMissingMtgjsonHistory(index, cards, signal) {
    const requestedIds = [...new Set(cards
      .filter((card) => card.scryfallId && !hasMtgjsonHistoricalEntry(index, card))
      .map((card) => card.scryfallId))];
    if (!requestedIds.length) return { index, requested: 0, resolved: 0, bundled: 0 };
    const bundled = await waitForAbortable(mtgjsonHistoryShardCatalog.load(index, requestedIds), signal);
    const bundledCards = Object.fromEntries(Object.entries(bundled.cards).map(([scryfallId, entry]) => {
      const latest = index.printingPrices && index.printingPrices[scryfallId] || {};
      return [scryfallId, {
        ...entry,
        foil: mergeMtgjsonPriceSeries(entry.foil, latest.foil, index.providers),
        nonfoil: mergeMtgjsonPriceSeries(entry.nonfoil, latest.nonfoil, index.providers)
      }];
    }));
    let mergedIndex = index;
    if (Object.keys(bundledCards).length) {
      mergedIndex = mergeMtgjsonPriceIndexes(index, {
        format: index.format,
        version: index.version,
        providers: index.providers,
        source: {
          ...(index.source || {}),
          historyFrom: bundled.historyFrom,
          historyTo: bundled.historyTo
        },
        cards: bundledCards
      });
    }
    const missingIds = requestedIds.filter((scryfallId) => !bundledCards[scryfallId]);
    if (!missingIds.length) {
      return {
        index: mergedIndex,
        requested: requestedIds.length,
        resolved: requestedIds.length,
        bundled: requestedIds.length
      };
    }
    const endpoint = mtgjsonHistoryEndpoint();
    if (!endpoint) throw new Error(`有 ${missingIds.length} 个版本不在离线历史包中，请更新 MTGJSON 价格数据后重试`);
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scryfallIds: missingIds }),
        signal
      });
    } catch (error) {
      if (signal && signal.aborted) throw abortReason(signal);
      throw new Error(`有 ${missingIds.length} 个新版本需要本地补全，请先运行“启动 Cube.command”`);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "MTGJSON 新版本历史补全失败");
    const merged = mergeMtgjsonPriceIndexes(mergedIndex, payload);
    return {
      index: merged,
      requested: requestedIds.length,
      resolved: Object.keys(bundledCards).length + Object.keys(payload.cards || {}).length,
      bundled: Object.keys(bundledCards).length
    };
  }

  async function syncMtgjsonPriceHistory() {
    if (state.syncingPriceHistory) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(new DOMException("价格历史同步超时", "TimeoutError")), PRICE_HISTORY_SYNC_TIMEOUT_MS);
    state.priceHistorySyncController = controller;
    state.syncingPriceHistory = true;
    openTotalPriceHistory();
    try {
      const historyIndex = await loadMtgjsonPrintingPriceIndex();
      if (controller.signal.aborted) throw abortReason(controller.signal);
      const cards = getValuedCards();
      const supplemental = await loadMissingMtgjsonHistory(historyIndex, cards, controller.signal);
      const index = supplemental.index;
      state.priceIndexSource = index.source || null;
      const result = syncPriceHistoryWindow(
        state.priceHistory,
        cards,
        (card, finish) => mtgjsonPriceSeries(index, card, finish),
        {
          origin: "mtgjson",
          windowDays: 90,
          endDate: index.source && (index.source.historyTo || index.source.date)
        }
      );
      if (!result.syncedSnapshots) {
        toast("没有可同步的数据", "MTGJSON 索引最近 90 天没有可用价格");
        return;
      }
      state.priceHistory = result.history;
      const providerSummary = Object.entries(result.providers)
        .map(([provider, count]) => `${providerLabel(provider)} ${count}`)
        .join(" · ");
      recordChange("prices.history_synced", `同步 MTGJSON 最近 90 天价格：覆盖 ${result.replacedSnapshots} 个日期`, {
        meta: {
          windowDays: result.windowDays,
          pricePoints: result.pricePoints,
          createdSnapshots: result.createdSnapshots,
          replacedSnapshots: result.replacedSnapshots,
          removedLocalPoints: result.removedLocalPoints,
          firstDate: result.firstDate,
          lastDate: result.lastDate
        }
      }, { persist: false });
      saveState(["priceHistory", "changeLog"]);
      renderScheduler.request("stats", "cards", "basics");
      const supplementalText = supplemental.requested
        ? ` · 按需补全 ${supplemental.resolved}/${supplemental.requested} 个新版本`
        : "";
      toast("最近 90 天已同步", `覆盖 ${result.replacedSnapshots} 个日期，新建 ${result.createdSnapshots} 个日期，共 ${result.pricePoints} 个价格点${providerSummary ? ` · ${providerSummary}` : ""}${supplementalText}`);
    } catch (error) {
      if (error.name === "AbortError") return;
      toast(error.name === "TimeoutError" ? "历史同步超时" : "历史同步失败", error.message || "无法读取 MTGJSON 价格历史", true);
    } finally {
      window.clearTimeout(timeout);
      if (state.priceHistorySyncController === controller) state.priceHistorySyncController = null;
      state.syncingPriceHistory = false;
      if (elements.priceHistoryDialog.open && elements.priceHistoryContent.querySelector("[data-sync-price-history]")) openTotalPriceHistory();
    }
  }

  function openPriceChanges(period = "today", ranking = "percent") {
    const today = dateKey();
    const periodLabels = {
      today: "今日价格变动",
      week: "本周价格变动",
      month: "本月价格变动",
      history: "历史价格变动"
    };
    const rankingLabels = {
      percent: "涨跌幅",
      absolute: "涨跌金额"
    };
    const selectedPeriod = Object.prototype.hasOwnProperty.call(periodLabels, period) ? period : "today";
    const selectedRanking = Object.prototype.hasOwnProperty.call(rankingLabels, ranking) ? ranking : "percent";
    const result = priceChangesForPeriod(state.priceHistory, getValuedCards(), selectedPeriod, today);
    const allIncreases = result.changes.filter((change) => change.direction === "up");
    const allDecreases = result.changes.filter((change) => change.direction === "down");
    const increases = topPriceMovers(result.changes, "up", 20, selectedRanking);
    const decreases = topPriceMovers(result.changes, "down", 20, selectedRanking);
    const renderChanges = (items) => items.map((change) => {
      const card = change.card || {};
      const displayName = cardDisplayName(card);
      const percent = change.percent === null ? "—" : `${Math.abs(change.percent).toFixed(2)}%`;
      const delta = `${change.delta > 0 ? "+" : "−"}${formatUsd(Math.abs(change.delta))}`;
      const primaryValue = selectedRanking === "absolute" ? delta : percent;
      const secondaryValue = selectedRanking === "absolute" ? percent : delta;
      const finish = normalizeFinish(card.finish) === "foil" ? "Foil" : "Non-Foil";
      const thumbnail = getCardImage(card);
      return `<article class="price-change-row ${change.direction}">
        <div class="price-change-card"><span class="price-change-thumbnail-wrap">${thumbnail ? `<img class="price-change-thumbnail" src="${escapeHtml(thumbnail)}" alt="" loading="lazy" />` : ""}</span><span class="price-change-copy"><strong>${escapeHtml(displayName)}</strong><small>${escapeHtml(card.set || "—")}${card.collectorNumber ? ` · ${escapeHtml(card.collectorNumber)}` : ""} · ${finish}</small></span></div>
        <span>${change.direction === "up" ? "▲" : "▼"} ${escapeHtml(primaryValue)}</span>
        <small>${escapeHtml(formatUsd(change.previousUsd))} → ${escapeHtml(formatUsd(change.latestUsd))} · ${escapeHtml(secondaryValue)}</small>
      </article>`;
    }).join("");
    const hasRange = result.previousDate && result.latestDate && result.previousDate !== result.latestDate;
    const groupMetric = selectedRanking === "absolute" ? "金额" : "幅度";
    const body = result.changes.length ? `<div class="price-change-groups">
      ${increases.length ? `<section class="price-change-group up"><h3>上涨${groupMetric} <small>TOP ${increases.length} · 共 ${allIncreases.length} 张</small></h3><div class="price-change-list">${renderChanges(increases)}</div></section>` : ""}
      ${decreases.length ? `<section class="price-change-group down"><h3>下跌${groupMetric} <small>TOP ${decreases.length} · 共 ${allDecreases.length} 张</small></h3><div class="price-change-list">${renderChanges(decreases)}</div></section>` : ""}
    </div>` : `<p class="price-change-empty">${hasRange ? "这个时间范围内没有同版本、同工艺的单卡价格变动。" : "这个时间范围还没有至少两个可比较的价格快照。"}</p>`;
    const tabs = Object.entries(periodLabels).map(([key, label]) => `<button type="button" class="${selectedPeriod === key ? "active" : ""}" data-price-change-period="${key}" aria-pressed="${selectedPeriod === key ? "true" : "false"}">${label}</button>`).join("");
    const rankingButtons = Object.entries(rankingLabels).map(([key, label]) => `<button type="button" class="${selectedRanking === key ? "active" : ""}" data-price-change-ranking="${key}" aria-pressed="${selectedRanking === key ? "true" : "false"}">${label}</button>`).join("");
    const rangeText = hasRange
      ? `${formatHistoryDate(result.previousDate)} → ${formatHistoryDate(result.latestDate)}`
      : formatHistoryDate(result.latestDate || today);
    elements.priceHistoryContent.innerHTML = `<section class="price-history-panel">
      <div class="price-history-head"><div><span>PRICE CHANGES</span><strong>${escapeHtml(periodLabels[selectedPeriod])}</strong></div><small>${escapeHtml(rangeText)}</small></div>
      <div class="price-change-tabs" aria-label="价格变动时间范围">${tabs}</div>
      <div class="price-change-ranking"><span>排序方式</span><div aria-label="价格变动排序方式">${rankingButtons}</div></div>
      ${body}
    </section>`;
    elements.priceHistoryDialog.showModal();
  }

  function openTodayPriceChanges() {
    openPriceChanges("today");
  }

  function formatLogTime(time) {
    const parsed = new Date(time);
    if (Number.isNaN(parsed.getTime())) return time || "";
    return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(parsed);
  }

  function openChangeLogDialog() {
    const entries = latestEntries(state.changeLog, 100);
    elements.changeLogContent.innerHTML = entries.length ? entries.map((entry) => `
      <article class="change-log-entry">
        <time>${escapeHtml(formatLogTime(entry.time))}</time>
        <div><strong>${escapeHtml(entry.summary || entry.type)}</strong><small>${escapeHtml(changeLogDetail(entry))}</small></div>
      </article>
    `).join("") : `<p class="change-log-empty">还没有记录。之后添加、删除、换版本、导入、更新价格等操作会自动写入这里。</p>`;
    elements.changeLogDialog.showModal();
  }

  async function collectWorkspaceImageFiles() {
    return workspace.listImageFiles(state.storage.directoryHandle);
  }

  function renderWorkspaceHealth(result) {
    const summary = result.summary;
    const metrics = [
      ["牌表", summary.cards, ""],
      ["原图", summary.originalFiles, ""],
      ["缩略图", summary.thumbnailFiles, ""],
      ["错误", summary.errors, "error"],
      ["警告", summary.warnings, "warning"],
      ["提示", summary.info, ""]
    ];
    const issues = result.issues.map((issue) => `<article class="workspace-health-issue ${issue.severity}">
      <header><strong>${escapeHtml(issue.title)}</strong><span>${issue.count} 项</span></header>
      <p>${escapeHtml(issue.description)}</p>
      ${issue.examples.length ? `<div class="workspace-health-examples">${issue.examples.map((example) => `<code title="${escapeHtml(example)}">${escapeHtml(example)}</code>`).join("")}</div>` : ""}
    </article>`).join("");
    elements.healthCheckContent.innerHTML = `
      <div class="workspace-health-summary">${metrics.map(([label, value, level]) => `<div class="workspace-health-metric ${level}"><span>${label}</span><strong>${value}</strong></div>`).join("")}</div>
      ${result.healthy
        ? `<p class="workspace-health-status clean">没有发现数据或图片关联问题。</p>`
        : `<p class="workspace-health-status">检查完成。错误需要优先确认；警告建议处理；提示不一定代表故障。</p><div class="workspace-health-issues">${issues}</div>`}`;
  }

  async function openWorkspaceHealthCheck() {
    if (state.storage.mode !== "directory" || !state.storage.directoryHandle) {
      toast("请先连接文件夹", "健康检查只适用于 Cube 文件夹模式", true);
      return;
    }
    elements.healthCheckBtn.disabled = true;
    try {
      if (!await requestDirectoryPermission(state.storage.directoryHandle, "read")) {
        toast("无法读取文件夹", "请重新授权这个 Cube 文件夹", true);
        return;
      }
      elements.healthCheckContent.innerHTML = `<p class="workspace-health-loading">正在核对牌表与本地图片…</p>`;
      elements.healthCheckDialog.showModal();
      const imageFiles = await collectWorkspaceImageFiles();
      renderWorkspaceHealth(analyzeWorkspaceHealth({ cards: getValuedCards(), ...imageFiles }));
    } catch (error) {
      elements.healthCheckContent.innerHTML = `<p class="workspace-health-loading">检查失败：${escapeHtml(error.message || "无法读取文件夹")}</p>`;
    } finally {
      elements.healthCheckBtn.disabled = false;
    }
  }

  function changeLogDetail(entry) {
    const parts = [];
    if (entry.type) parts.push(entry.type);
    if (entry.card && entry.card.name) parts.push(entry.card.set && entry.card.collectorNumber ? `${entry.card.name} · ${entry.card.set} ${entry.card.collectorNumber}` : entry.card.name);
    return parts.join(" · ");
  }

  function recordCurrentPriceHistory(options = {}) {
    if (options.onlyIfMissing && hasDailySnapshot(state.priceHistory)) return false;
    state.priceHistory = recordDailySnapshot(state.priceHistory, getValuedCards(), { refresh: options.refresh });
    return true;
  }

  function excelPriceExtras(card) {
    const priceView = selectors.selectPriceView(state.data.cards, state.dataRevision, state.priceHistory, state.historyRevision);
    const trend = selectors.trendForCard(priceView, card, card.finish);
    return {
      previousPrice: trend ? trend.previousUsd.toFixed(2) : "",
      priceDelta: trend ? trend.delta.toFixed(2) : "",
      pricePercent: trend && trend.percent !== null ? `${trend.percent.toFixed(2)}%` : "",
      imageStatus: cardImageStatus(card)
    };
  }

  function cardImageStatus(card) {
    const missing = [];
    if (!card.localImage) missing.push("正面图");
    if (card.backImage && !card.localBackImage) missing.push("背面图");
    return missing.length ? `缺${missing.join("、")}` : "完整";
  }

  function observeVisibleFoils(root) {
    const previous = foilObservers.get(root);
    if (previous) previous.disconnect();
    const cards = $$('[data-finish="foil"]', root);
    if (typeof IntersectionObserver !== "function") {
      cards.forEach((card) => card.classList.add("foil-visible"));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => entry.target.classList.toggle("foil-visible", entry.isIntersecting));
    }, { rootMargin: "160px 0px" });
    cards.forEach((card) => observer.observe(card));
    foilObservers.set(root, observer);
  }

  function renderCards() {
    const cardView = selectors.selectCards(state.data.cards, state.dataRevision, state.filters);
    const priceView = selectors.selectPriceView(state.data.cards, state.dataRevision, state.priceHistory, state.historyRevision);
    const { cards, groups } = cardView;
    elements.resultCount.textContent = cards.length;
    elements.emptyState.classList.toggle("hidden", cards.length > 0);
    elements.cardGrid.classList.toggle("hidden", cards.length === 0);
    elements.cardGrid.classList.toggle("list-mode", state.mode === "list");
    elements.cardGrid.innerHTML = [...groups.entries()].map(([key, groupCards]) => `
      <section class="card-group" data-card-group="${key}">
        <div class="card-group-heading"><span class="card-group-mark"></span><h2>${cardGroupLabel(key)}</h2><small>${groupCards.length} 张</small></div>
        <div class="card-group-grid">${groupCards.map((card, index) => cardTemplate(card, index, priceView)).join("")}</div>
      </section>`).join("");
    observeVisibleFoils(elements.cardGrid);
    if (state.nameLanguage === "zh") refreshMissingLocalizedNames(cards);

    const labels = [];
    if (state.filters.color !== "all") labels.push(`颜色：${colorLabel(state.filters.color)}`);
    if (state.filters.type !== "all") labels.push(`类型：${typeLabel(state.filters.type)}`);
    if (state.filters.finish !== "all") labels.push(`Finish：${state.filters.finish === "foil" ? "仅 Foil" : "仅 Non-Foil"}`);
    if (state.filters.japanPrint !== "all") labels.push(`日印：${state.filters.japanPrint === "japan" ? "日印" : "非日印"}`);
    if (state.filters.query) labels.push(`搜索：“${state.filters.query}”`);
    $("#activeFilterText").textContent = labels.join(" · ") || "按颜色与类型整理";
  }

  function replaceCardNode(cardId) {
    const card = selectors.cardById(state.data.cards, state.dataRevision, cardId);
    const node = elements.cardGrid.querySelector(cardItemSelector(cardId));
    if (!card || !node || filterCards([card], state.filters).length === 0) {
      renderScheduler.request("cards");
      return false;
    }
    const priceView = selectors.selectPriceView(state.data.cards, state.dataRevision, state.priceHistory, state.historyRevision);
    const template = document.createElement("template");
    template.innerHTML = cardTemplate(card, 0, priceView).trim();
    node.replaceWith(template.content.firstElementChild);
    observeVisibleFoils(elements.cardGrid);
    return true;
  }

  function requestCardMutationRender(cardId) {
    renderScheduler.request("stats");
    replaceCardNode(cardId);
  }

  function cardGroupLabel(key) {
    return ({ W: "白色", U: "蓝色", B: "黑色", R: "红色", G: "绿色", C: "无色", M: "多色", L: "地牌" })[key] || "其他";
  }

  function findCardLocation(cardId) {
    const draftIndex = state.data.cards.findIndex((card) => card.id === cardId);
    if (draftIndex >= 0) return { cards: state.data.cards, index: draftIndex, pool: "draft" };
    const basicIndex = state.data.basicLands.findIndex((card) => card.id === cardId);
    return basicIndex >= 0 ? { cards: state.data.basicLands, index: basicIndex, pool: "basic" } : null;
  }

  function cardByIdAny(cardId) {
    const location = findCardLocation(cardId);
    return location ? location.cards[location.index] : null;
  }

  function requestPoolRender(pool) {
    if (pool === "basic") renderScheduler.request("basics", "stats");
    else requestDataRender();
  }

  function requestCollectionCommandRender(render) {
    if (render.pool) requestPoolRender(render.pool);
    else if (render.cardId) requestCardMutationRender(render.cardId);
    else if (Array.isArray(render.scopes)) renderScheduler.request(...render.scopes);
  }

  function getValuedCards() {
    return [...state.data.cards, ...state.data.basicLands];
  }

  function loadBasicLandGrouping() {
    return viewPreferences.get("basicLandGrouping");
  }

  function setBasicLandGrouping(mode) {
    if (mode !== "kind" && mode !== "set") return;
    state.basicLandGrouping = mode;
    viewPreferences.set("basicLandGrouping", mode);
    renderScheduler.request("basics");
  }

  function renderBasicLands() {
    const cards = state.data.basicLands;
    const priceView = selectors.selectPriceView(cards, state.dataRevision, state.priceHistory, state.historyRevision);
    const counts = Object.fromEntries(BASIC_LAND_ORDER.map((kind) => [kind, cards.filter((card) => getBasicLandKind(card) === kind).length]));
    elements.basicLandSummary.innerHTML = [
      ["基本地总数", cards.length],
      ...BASIC_LAND_ORDER.map((kind) => [BASIC_LAND_LABELS[kind], counts[kind]]),
      ["基本地总价", formatUsd(priceView.currentTotal)]
    ].map(([label, value]) => `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></article>`).join("");
    $$('[data-basic-land-grouping]').forEach((button) => {
      const active = button.dataset.basicLandGrouping === state.basicLandGrouping;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    elements.basicLandGrid.dataset.grouping = state.basicLandGrouping;
    elements.basicLandGrid.innerHTML = groupBasicLands(cards, state.basicLandGrouping).map((group) => {
      const setMeta = state.basicLandGrouping === "set"
        ? `<span class="basic-land-set-meta">${group.setCode ? escapeHtml(group.setCode) : "—"}${group.releasedAt ? ` · ${escapeHtml(group.releasedAt)}` : ""}</span>`
        : "";
      return `<section class="card-group" data-basic-land-group="${escapeHtml(group.key)}">
        <div class="card-group-heading"><span class="card-group-mark"></span><h2>${escapeHtml(group.label)}</h2>${setMeta}<small>${group.cards.length} 张</small></div>
        <div class="card-group-grid">${group.cards.map((card, index) => cardTemplate(card, index, priceView)).join("")}</div>
      </section>`;
    }).join("");
    observeVisibleFoils(elements.basicLandGrid);
    elements.basicLandEmpty.classList.toggle("hidden", cards.length > 0);
    if (state.nameLanguage === "zh") refreshMissingLocalizedNames(cards);
  }

  function archiveValue(value) {
    return escapeHtml(value || "暂无资料");
  }

  function archiveColor(card) {
    const names = { W: "白", U: "蓝", B: "黑", R: "红", G: "绿" };
    const colors = getFrontColors(card);
    return colors.length ? colors.map((color) => names[color] || color).join(" / ") : "无色";
  }

  function renderArchiveRules(card) {
    const faceNames = String(card.name || "").split(/\s*\/\/\s*/);
    const blocks = [{ label: faceNames[0] || "正面", text: card.oracleText }];
    if (card.backOracleText) blocks.push({ label: faceNames[1] || "背面", text: card.backOracleText });
    return blocks.map((block) => `<div class="card-archive-rules-block">
      <strong>${escapeHtml(block.label)}</strong>
      <p>${archiveValue(block.text)}</p>
    </div>`).join("");
  }

  function productSourceHintLabel(value) {
    const key = String(value || "").toLocaleLowerCase();
    return ({
      collector: "聚珍补充包",
      play: "常规补充包",
      set: "系列补充包",
      draft: "轮抽补充包",
      default: "补充包",
      buyabox: "Buy-a-Box",
      prerelease: "售前",
      boosterfun: "特殊画框",
      starterdeck: "入门预组"
    })[key] || value;
  }

  function renderProductSourcePanel(card) {
    const preview = state.previewProductSources;
    const isCurrent = preview.cardId === card.id;
    let body;
    if (!isCurrent || preview.status === "loading") {
      body = `<div class="product-source-status loading"><span></span><p>正在查询当前版本的产品来源…</p></div>`;
    } else if (preview.status === "error") {
      body = `<div class="product-source-status"><p>${escapeHtml(preview.error || "产品来源暂时无法加载")}</p></div>`;
    } else {
      const result = preview.result || {};
      const products = result.products || [];
      const entry = result.entry || {};
      if (products.length) {
        body = `<div class="product-source-list">${products.map((product) => `
          <article class="product-source-row" data-product-type="${escapeHtml(product.type)}">
            <span class="product-source-type">${escapeHtml(product.typeLabel)}</span>
            <div>
              <strong>${escapeHtml(product.name)}</strong>
              <small>${escapeHtml(product.availability)} · ${escapeHtml((product.finishLabels || []).join(" / "))}</small>
            </div>
          </article>`).join("")}</div>`;
      } else {
        const hints = [...new Set([...(entry.boosterTypes || []), ...(entry.promoTypes || [])])]
          .map(productSourceHintLabel)
          .filter(Boolean);
        const emptyMessage = !result.entry && result.indexMatchesCube === false
          ? "当前产品来源索引与牌表版本不一致，暂时无法确认这个版本的获取方式。"
          : !result.entry
            ? "MTGJSON 当前没有这张实体版本的产品来源记录。"
            : "MTGJSON 已识别当前实体版本，但没有所选表面工艺的具体产品来源。";
        body = `<div class="product-source-status"><p>${escapeHtml(emptyMessage)}</p>
          ${result.warning ? `<p>${escapeHtml(result.warning)}</p>` : ""}
          ${hints.length ? `<div class="product-source-hints">${hints.map((hint) => `<span>${escapeHtml(hint)}</span>`).join("")}</div>` : ""}
        </div>`;
      }
    }
    const source = isCurrent && preview.result && preview.result.source;
    return `<section class="card-product-sources" data-product-sources-card="${escapeHtml(card.id)}">
      <div class="product-source-heading">
        <span>获取方式</span>
        <a href="https://mtgjson.com/" target="_blank" rel="noreferrer">MTGJSON${source && source.date ? ` · ${escapeHtml(source.date)}` : ""}</a>
      </div>
      ${body}
    </section>`;
  }

  function updateProductSourcePanel(cardId) {
    const card = cardByIdAny(cardId);
    const escapedCardId = window.CSS && typeof window.CSS.escape === "function"
      ? window.CSS.escape(cardId)
      : String(cardId).replace(/["\\]/g, "\\$&");
    const current = elements.imagePreview.querySelector(`[data-product-sources-card="${escapedCardId}"]`);
    if (!card || !current) return;
    const template = document.createElement("template");
    template.innerHTML = renderProductSourcePanel(card).trim();
    current.replaceWith(template.content.firstElementChild);
  }

  async function enrichPreviewProductSources(cardId) {
    const card = cardByIdAny(cardId);
    if (!card || !card.scryfallId) {
      state.previewProductSources = { cardId, status: "ready", result: { entry: null, products: [], source: null }, error: "" };
      updateProductSourcePanel(cardId);
      return;
    }
    try {
      const preferred = await loadPreferredProductSourceIndex();
      const result = await productSourceCatalog.lookup(card);
      result.indexMatchesCube = preferred.matchesCube;
      result.warning = preferred.warning;
      if (state.previewCardId !== cardId || !elements.imagePreviewDialog.open) return;
      state.previewProductSources = { cardId, status: "ready", result, error: "" };
      updateProductSourcePanel(cardId);
    } catch (error) {
      if (state.previewCardId !== cardId || !elements.imagePreviewDialog.open) return;
      state.previewProductSources = {
        cardId,
        status: "error",
        result: null,
        error: error.message || "产品来源暂时无法加载"
      };
      updateProductSourcePanel(cardId);
    }
  }

  function renderImagePreview(card) {
    const displayName = cardDisplayName(card);
    const finish = normalizeFinish(card.finish);
    const images = [
      { src: getCardImage(card, "front", true), alt: `${displayName} 正面` },
      { src: getCardImage(card, "back", true), alt: `${displayName} 背面` }
    ].filter((item) => item.src);
    const points = cardSeries(state.priceHistory, card, finish);
    const englishName = getCardDisplayName(card, card.name);
    const localizedName = getPreferredLocalizedName(card);
    const secondaryName = displayName === englishName ? localizedName : englishName;
    elements.imagePreview.innerHTML = `<div class="card-archive-preview" data-finish="${finish}">
      <button type="button" class="close-button card-archive-close" data-close-image-preview aria-label="关闭卡图预览">×</button>
      <div class="card-archive-images${images.length > 1 ? " two-sided" : ""}">
      ${images.map((item) => `<span class="card-archive-image-frame"><img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt)}" /></span>`).join("")}
      </div>
      <section class="card-archive-details">
        <header class="card-archive-header">
          <span>CARD ARCHIVE · ${escapeHtml(archiveColor(card))}</span>
          <h2>${escapeHtml(displayName)}</h2>
          ${secondaryName ? `<p>${escapeHtml(secondaryName)}</p>` : ""}
          <small>${archiveValue(getFrontTypeLine(card))}</small>
        </header>
        <div class="card-archive-pills">
          <span class="archive-pill ${finish}">${finish === "foil" ? "Foil" : "Non-Foil"}</span>
          <span class="archive-pill">${escapeHtml(card.set || "—")}${card.collectorNumber ? ` · ${escapeHtml(card.collectorNumber)}` : ""}</span>
          <span class="archive-pill">${card.JapanPrint === true ? "日印" : "非日印"}</span>
          ${card.manaCost ? `<span class="archive-pill">${escapeHtml(card.manaCost)}</span>` : ""}
        </div>
        <section class="card-archive-rules"><span>规则文字</span>${renderArchiveRules(card)}</section>
        <dl class="card-archive-meta">
          <div><dt>系列与编号</dt><dd>${archiveValue(card.setName || card.set)}${card.collectorNumber ? ` · ${escapeHtml(card.collectorNumber)}` : ""}</dd></div>
          <div><dt>稀有度</dt><dd>${archiveValue(card.rarity)}</dd></div>
          <div><dt>画师</dt><dd>${archiveValue(card.artist)}</dd></div>
          ${card.backArtist ? `<div><dt>背面画师</dt><dd>${escapeHtml(card.backArtist)}</dd></div>` : ""}
          <div><dt>发行日期</dt><dd>${archiveValue(card.releasedAt)}</dd></div>
          <div><dt>颜色</dt><dd>${escapeHtml(archiveColor(card))}</dd></div>
          <div><dt>法术力值</dt><dd>${escapeHtml(String(Number(card.cmc) || 0))}</dd></div>
          <div><dt>当前价格</dt><dd>${escapeHtml(formatUsd(cardPrice(card)))} · ${finish === "foil" ? "Foil" : "Non-Foil"}</dd></div>
        </dl>
        ${renderProductSourcePanel(card)}
        ${renderPriceHistoryPanel({
          title: `${displayName} · ${finish === "foil" ? "Foil" : "Non-Foil"}`,
          subtitle: `${card.set}${card.collectorNumber ? ` · ${card.collectorNumber}` : ""}`,
          points,
          emptyText: "这张牌当前版本还没有历史价格。点击总价旁边的刷新按钮后会记录。"
        })}
      </section>
    </div>`;
  }

  async function enrichPreviewMetadata(cardId) {
    const card = cardByIdAny(cardId);
    const metadataKey = card && card.scryfallId ? `${cardId}:${card.scryfallId}` : "";
    if (!card || !metadataKey || (card.setName && card.releasedAt) || state.previewMetadataCompleted.has(metadataKey)) return;
    try {
      const printing = await catalog.lookupById(card.scryfallId, state.previewController.signal);
      if (!printing || state.previewCardId !== cardId || !elements.imagePreviewDialog.open) return;
      const location = findCardLocation(cardId);
      if (!location) return;
      const current = location.cards[location.index];
      if (current.scryfallId !== card.scryfallId) return;
      location.cards[location.index] = mergeArchiveMetadata(current, printing);
      state.previewMetadataCompleted.add(metadataKey);
      saveState("cube");
      renderImagePreview(location.cards[location.index]);
    } catch (error) {
      if (error.name !== "AbortError") console.warn("无法补全卡牌档案资料", error);
    }
  }

  function openImagePreview(cardId) {
    const card = cardByIdAny(cardId);
    if (!card || !getCardImage(card, "front", true)) return;
    if (state.previewController) state.previewController.abort();
    state.previewController = new AbortController();
    state.previewCardId = cardId;
    state.previewProductSources = { cardId, status: "loading", result: null, error: "" };
    renderImagePreview(card);
    elements.imagePreviewDialog.showModal();
    void enrichPreviewMetadata(cardId);
    void enrichPreviewProductSources(cardId);
  }

  function clearImagePreview() {
    if (state.previewController) state.previewController.abort();
    state.previewController = null;
    state.previewCardId = null;
    state.previewProductSources = { cardId: null, status: "idle", result: null, error: "" };
    elements.imagePreview.innerHTML = "";
  }

  function closeImagePreview() {
    if (elements.imagePreviewDialog.open) elements.imagePreviewDialog.close();
    clearImagePreview();
  }

  function cardTemplate(card, index, priceView = selectors.selectPriceView(state.data.cards, state.dataRevision, state.priceHistory, state.historyRevision)) {
    const cost = (card.manaCost || "").replace(/[{}]/g, "").replace(/(?=\D)/g, " ").trim();
    const finish = normalizeFinish(card.finish);
    const availableFinishes = getAvailableFinishes(card);
    const finishDisabled = availableFinishes.length < 2;
    const price = formatUsd(cardPrice(card));
    const trend = selectors.trendForCard(priceView, card, finish);
    const displayName = cardDisplayName(card);
    const japanPrint = card.JapanPrint === true;
    const gridImage = getCardImage(card);
    return `<article class="card-item" data-id="${escapeHtml(card.id)}" data-finish="${finish}" style="animation-delay:${Math.min(index * 18, 220)}ms">
      <div class="card-image-wrap">
        <div class="card-fallback"><span class="fallback-name">${escapeHtml(displayName)}</span><span class="fallback-type">${escapeHtml(card.typeLine)}</span></div>
        ${gridImage ? `<button type="button" class="card-image-button" data-preview-image="${escapeHtml(card.id)}" aria-label="查看 ${escapeHtml(displayName)} 大图"><img class="card-image" src="${escapeHtml(gridImage)}" alt="${escapeHtml(displayName)}" loading="lazy" /></button>` : ""}
      </div>
      <div class="card-info">
        <div class="card-name-row"><button class="japan-print-toggle${japanPrint ? " active" : ""}" data-toggle-japan-print="${escapeHtml(card.id)}" title="${japanPrint ? "取消日印标记" : "标记为日印"}" aria-label="${japanPrint ? `取消 ${escapeHtml(displayName)} 的日印标记` : `标记 ${escapeHtml(displayName)} 为日印`}" aria-pressed="${japanPrint ? "true" : "false"}"><span></span></button><span class="card-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span><span class="card-cost${cost ? "" : " empty"}">${escapeHtml(cost)}</span></div>
        <div class="card-meta"><span class="card-type">${escapeHtml(card.typeLine.split(" — ")[0])}</span><button class="finish-pill ${finish}" data-toggle-finish="${escapeHtml(card.id)}" ${finishDisabled ? "disabled" : ""} title="${finishDisabled ? `此版本仅支持 ${finish === "foil" ? "Foil" : "Non-Foil"}` : `切换 ${escapeHtml(displayName)} 的 Foil 状态`}">${finish === "foil" ? "Foil" : "Non-Foil"}</button></div>
        <div class="card-meta"><span class="card-printing">${escapeHtml(card.set)}${card.collectorNumber ? ` · ${escapeHtml(card.collectorNumber)}` : ""} · <span class="card-price">${escapeHtml(price)}${priceTrendBadge(trend)}</span></span><button class="printing-button" data-change-printing="${escapeHtml(card.id)}" title="选择 ${escapeHtml(displayName)} 的其他版本">选择版本</button></div>
      </div>
      <button class="remove-card" data-remove="${escapeHtml(card.id)}" title="从 Cube 移除" aria-label="移除 ${escapeHtml(displayName)}">−</button>
    </article>`;
  }

  function renderAnalytics() {
    const stats = selectors.selectStats(state.data.cards, state.dataRevision);
    const colorNames = { W: "白色", U: "蓝色", B: "黑色", R: "红色", G: "绿色", C: "无色", M: "多色", L: "地牌" };
    const typeNames = { Creature: "生物", Instant: "瞬间", Sorcery: "法术", Artifact: "神器", Enchantment: "结界", Planeswalker: "鹏洛客", Land: "地", Other: "其他" };
    const analyticsFilters = state.analyticsFilters;
    const allColorButton = $("#analyticsAllColor");
    if (allColorButton) {
      const active = analyticsFilters.color === "all";
      allColorButton.classList.toggle("active", active);
      allColorButton.setAttribute("aria-pressed", active ? "true" : "false");
    }
    const maxColor = Math.max(1, ...Object.values(stats.colors));
    $("#colorAnalysis").innerHTML = Object.entries(stats.colors).map(([key, value]) => `
      <button type="button" class="color-row${analyticsFilters.color === key ? " active" : ""}" data-analytics-color="${key}" data-color-bucket="${key}" aria-pressed="${analyticsFilters.color === key ? "true" : "false"}" title="筛选${colorNames[key]}的法力曲线">
        <span class="color-name">${colorNames[key]}</span><span class="analysis-track"><span class="analysis-fill" style="width:${value / maxColor * 100}%"></span></span><span class="analysis-value">${value}</span>
      </button>`).join("");

    const curveView = selectors.selectAnalytics(state.data.cards, state.dataRevision, analyticsFilters);
    const curveCards = curveView.cards;
    const curveStats = curveView.stats;
    const curveNonlands = curveCards.length - curveStats.lands;
    const curveLabels = [];
    if (analyticsFilters.color !== "all") curveLabels.push(colorNames[analyticsFilters.color]);
    if (analyticsFilters.type !== "all") curveLabels.push(typeNames[analyticsFilters.type] || analyticsFilters.type);
    const curveLabel = curveLabels.join(" + ") || "全部";
    const averageLabel = curveNonlands ? `平均 CMC ${curveStats.averageCmc.toFixed(2)}` : "平均 CMC —";
    $("#manaCurveScope").textContent = `${curveLabel} · ${curveCards.length} 张 · ${averageLabel} · 地牌不计入`;
    $("#manaChart").dataset.colorBucket = analyticsFilters.color;
    if (analyticsFilters.type !== "all" && analyticsFilters.color === "all") $("#manaChart").dataset.cardType = analyticsFilters.type;
    else delete $("#manaChart").dataset.cardType;
    const maxCurve = Math.max(1, ...Object.values(curveStats.curve));
    $("#manaChart").innerHTML = Object.entries(curveStats.curve).map(([key, value]) => `
      <div class="curve-column"><span class="curve-value">${value}</span><div class="curve-bar" style="height:${value / maxCurve * 155}px"></div><span class="curve-label">${key}</span></div>`).join("");

    const typeEntries = Object.entries(stats.types).sort(([keyA, countA], [keyB, countB]) => {
      if (keyA === keyB) return 0;
      if (keyA === "Land") return 1;
      if (keyB === "Land") return -1;
      return countB - countA;
    });
    const maxType = Math.max(1, ...typeEntries.map(([, count]) => count));
    $("#typeAnalysis").innerHTML = typeEntries.map(([key, value]) => `
      <button type="button" class="type-row${analyticsFilters.type === key ? " active" : ""}" data-analytics-type="${escapeHtml(key)}" data-card-type="${escapeHtml(key)}" aria-pressed="${analyticsFilters.type === key ? "true" : "false"}" title="筛选${typeNames[key] || key}的法力曲线">
        <span class="type-name">${typeNames[key] || key}</span><span class="analysis-track"><span class="analysis-fill" style="width:${value / maxType * 100}%"></span></span><span class="analysis-value">${value}</span>
      </button>`).join("");
    $("#cubeNotes").value = state.data.notes || "";
  }

  function colorLabel(color) {
    return ({ W: "白", U: "蓝", B: "黑", R: "红", G: "绿", C: "无色", M: "多色", L: "地牌" })[color] || "全部";
  }

  function typeLabel(type) {
    return ({ Creature: "生物", Instant: "瞬间", Sorcery: "法术", Artifact: "神器", Enchantment: "结界", Planeswalker: "鹏洛客", Land: "地" })[type] || "全部";
  }

  function toast(title, message, error = false, action = null) {
    const node = document.createElement("div");
    node.className = `toast${error ? " error" : ""}`;
    node.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(message)}`;
    let timer;
    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", () => {
        clearTimeout(timer);
        node.remove();
        action.run();
      }, { once: true });
      node.append(button);
    }
    elements.toastRegion.append(node);
    timer = setTimeout(() => node.remove(), action ? 6500 : 3300);
  }

  async function refreshStalePrices(force = false) {
    if (state.refreshingPrices) return;
    const needsMtgjsonPrice = (card) => !card.priceSource || card.priceSource.origin !== "mtgjson" || needsPriceRefresh(card);
    const targets = getValuedCards().filter((card) => force || needsMtgjsonPrice(card));
    if (!targets.length) {
      const recorded = recordCurrentPriceHistory({ onlyIfMissing: !force, refresh: force ? { checked: 0, updated: 0, missing: 0 } : null });
      if (force) {
        recordChange("prices.recorded", "记录价格历史：无需刷新", { meta: { checked: 0 } }, { persist: false });
        saveState(["priceHistory", "changeLog"]);
        renderScheduler.request("stats");
        toast("价格历史已记录", "当前牌表没有需要刷新的价格，已保存今天的快照");
      } else if (recorded) {
        saveState("priceHistory");
        renderScheduler.request("stats");
      }
      return;
    }
    state.refreshingPrices = true;
    renderScheduler.request("stats");
    let refreshResult = null;
    let indexResult = null;
    try {
      indexResult = await loadPreferredMtgjsonPriceIndex({
        rebuildLocal: force,
        refreshLocalIfStale: !force
      });
      const index = indexResult.index;
      state.priceIndexSource = index.source || null;
      const indexedResult = applyIndexedPriceUpdates(targets, index, {
        lookupPrice: lookupMtgjsonPrice,
        findCardLocation,
        needsPriceRefresh: needsMtgjsonPrice,
        force
      });
      refreshResult = {
        checked: targets.length,
        updated: indexedResult.updatedIds.length,
        missing: indexedResult.missing,
        fallback: indexedResult.fallback,
        converted: indexedResult.converted,
        mtgjson: {
          matched: indexedResult.matched,
          updated: indexedResult.updated,
          missing: indexedResult.missing,
          providerFallback: indexedResult.fallback,
          cardmarketConverted: indexedResult.converted
        }
      };
    } catch (error) {
      if (force) toast("价格更新失败", error.message || "MTGJSON 价格索引暂时无法使用", true);
    } finally {
      state.refreshingPrices = false;
    }
    if (!refreshResult) {
      renderScheduler.request("stats");
      return;
    }
    const updated = refreshResult && refreshResult.updated > 0;
    const recorded = updated || force ? recordCurrentPriceHistory({ refresh: refreshResult }) : false;
    if (force) recordChange("prices.refreshed", `更新价格：检查 ${targets.length} 张牌`, { meta: refreshResult }, { persist: false });
    if (updated || recorded || force) {
      state.data.cards = sortCards(state.data.cards);
      saveState([
        ...(updated ? ["cube"] : []),
        ...(recorded ? ["priceHistory"] : []),
        ...(force ? ["changeLog"] : [])
      ]);
      renderScheduler.request("stats", "cards", "basics");
      if (force && refreshResult.missing) {
        toast("价格部分更新", `更新 ${refreshResult.updated} 张，MTGJSON 实体卡价格源仍缺少 ${refreshResult.missing} 张当前工艺价格`, true);
      } else if (force) {
        const sourceDate = state.priceIndexSource && state.priceIndexSource.date ? ` · MTGJSON ${state.priceIndexSource.date}` : "";
        const fallback = refreshResult.fallback ? ` · 替补 ${refreshResult.fallback} 张` : "";
        const converted = refreshResult.converted ? ` · Cardmarket 换算 ${refreshResult.converted} 张` : "";
        const indexMode = indexResult.mode === "local"
          ? indexResult.rebuilt ? " · 本地索引已重建" : " · 使用本地缓存"
          : " · 使用内置备用索引";
        const warning = indexResult.warning ? ` · ${indexResult.warning}` : "";
        toast(indexResult.warning ? "价格已更新，本地数据源未刷新" : "价格已更新", `已检查 ${targets.length} 张牌，更新 ${refreshResult.updated} 张${sourceDate}${indexMode}${fallback}${converted}${warning}，并保存今天的价格历史`, Boolean(indexResult.warning));
      }
      return;
    }
    renderScheduler.request("stats");
    if (force) toast("价格已是最新", "当前牌表没有新的价格变化");
  }

  function schedulePriceMaintenance() {
    window.setTimeout(async () => {
      try {
        await refreshStalePrices();
      } finally {
        schedulePriceMaintenance();
      }
    }, PRICE_MAINTENANCE_INTERVAL_MS);
  }

  function scheduleAutomaticPriceRefresh(delay = 300) {
    window.clearTimeout(automaticPriceRefreshTimer);
    automaticPriceRefreshTimer = window.setTimeout(() => {
      if (state.refreshingPrices) {
        scheduleAutomaticPriceRefresh(1000);
        return;
      }
      refreshStalePrices().catch(() => {});
    }, delay);
  }

  function printingImage(printing) {
    const face = printing.card_faces && printing.card_faces[0];
    const images = printing.image_uris || (face && face.image_uris) || {};
    return images.small || images.normal || "";
  }

  function isCurrentPrinting(card, printing) {
    if (card.scryfallId) return card.scryfallId === printing.id;
    const sameSet = (card.set || "").toLowerCase() === printing.set;
    return sameSet && (!card.collectorNumber || card.collectorNumber === printing.collector_number);
  }

  function printingPriceSummary(printing) {
    const nonfoil = lookupMtgjsonPrintingPrice(state.printingPriceIndex, printing, "nonfoil");
    const foil = lookupMtgjsonPrintingPrice(state.printingPriceIndex, printing, "foil");
    return `Non-Foil ${formatUsd(nonfoil && nonfoil.usd)} · Foil ${formatUsd(foil && foil.usd)}`;
  }

  function printingPriceTitle(printing) {
    if (state.printingPriceError) return `MTGJSON 价格索引不可用：${state.printingPriceError}`;
    const nonfoil = lookupMtgjsonPrintingPrice(state.printingPriceIndex, printing, "nonfoil");
    const foil = lookupMtgjsonPrintingPrice(state.printingPriceIndex, printing, "foil");
    const parts = [
      nonfoil && `Non-Foil：${formatUsd(nonfoil.usd)} · ${providerLabel(nonfoil.provider)}`,
      foil && `Foil：${formatUsd(foil.usd)} · ${providerLabel(foil.provider)}`
    ].filter(Boolean);
    return parts.length ? `MTGJSON ${state.printingPriceIndex.source.date || ""} · ${parts.join("；")}` : "MTGJSON 暂无这个实体版本的价格";
  }

  function renderPrintingFinishFilter() {
    const foilOnly = state.printingFinishFilter === "foil";
    elements.printingFinishToggle.innerHTML = `
      <button type="button" class="finish-toggle-button ${foilOnly ? "foil" : "nonfoil"}" data-toggle-printing-finish-filter aria-pressed="${foilOnly ? "true" : "false"}" title="${foilOnly ? "仅显示支持 Foil 的实体版本" : "显示全部实体版本"}">
        <span>版本</span>
        <strong>${state.printingFinishFilter === "foil" ? "仅 Foil" : "全部"}</strong>
      </button>`;
  }

  function renderPrintings() {
    const card = cardByIdAny(state.editingCardId);
    if (!card) return;
    renderPrintingFinishFilter();
    const filtered = filterPrintings(state.printings, elements.printingSearchInput.value, state.printingFinishFilter);
    elements.printingCount.textContent = `${filtered.length} 个版本`;
    elements.printingStatus.classList.toggle("hidden", filtered.length > 0);
    elements.printingStatus.classList.remove("error");
    elements.printingStatus.textContent = state.printings.length ? "没有符合条件的版本" : "正在获取可用版本…";
    elements.printingGrid.classList.toggle("hidden", filtered.length === 0);
    elements.printingGrid.innerHTML = filtered.map((printing) => {
      const image = printingImage(printing);
      const current = isCurrentPrinting(card, printing);
      return `<button type="button" class="printing-option${current ? " current" : ""}" data-select-printing="${escapeHtml(printing.id)}" aria-label="选择 ${escapeHtml(printing.set_name)} ${escapeHtml(printing.collector_number)}">
        <span class="printing-thumb">${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" />` : ""}</span>
        <span class="printing-option-info"><strong title="${escapeHtml(printing.set_name)}">${escapeHtml(printing.set_name)}</strong><span>${escapeHtml(printing.set.toUpperCase())} · ${escapeHtml(printing.collector_number)}</span><small>${escapeHtml(printing.released_at || "日期未知")} · ${escapeHtml(printing.lang.toUpperCase())}</small><small class="printing-price" title="${escapeHtml(printingPriceTitle(printing))}">${escapeHtml(printingPriceSummary(printing))}</small></span>
      </button>`;
    }).join("");
  }

  async function enrichPrintingPrices(cardId, requestId, pricePromise) {
    const priceResult = await pricePromise;
    if (requestId !== printingRequestId || state.editingCardId !== cardId || !elements.printingDialog.open) return;
    state.printingPriceIndex = priceResult.index;
    state.printingPriceError = priceResult.error;
    if (priceResult.index) state.priceIndexSource = priceResult.index.source || null;
    if (state.printings.length) renderPrintings();
  }

  async function openPrintingDialog(cardId) {
    const card = cardByIdAny(cardId);
    if (!card) return;
    if (state.printingController) state.printingController.abort();
    state.printingController = new AbortController();
    const requestId = ++printingRequestId;
    state.editingCardId = cardId;
    state.printings = [];
    state.printingFinishFilter = "all";
    state.printingPriceIndex = null;
    state.printingPriceError = "";
    elements.printingSearchInput.value = "";
    elements.printingGrid.innerHTML = "";
    elements.printingGrid.classList.add("hidden");
    elements.printingStatus.classList.remove("hidden", "error");
    elements.printingStatus.textContent = "正在获取可用版本…";
    elements.printingCount.textContent = "0 个版本";
    $("#printingDialogTitle").textContent = `${cardDisplayName(card)} · 选择版本`;
    renderPrintingFinishFilter();
    elements.printingDialog.showModal();
    const pricePromise = loadMtgjsonPrintingPriceIndex()
      .then((index) => ({ index, error: "" }))
      .catch((error) => ({ index: null, error: error.message || "加载失败" }));
    void enrichPrintingPrices(cardId, requestId, pricePromise);
    try {
      const printingResult = await catalog.lookupAllPrintings(card, state.printingController.signal);
      if (requestId !== printingRequestId || state.editingCardId !== cardId || !elements.printingDialog.open) return;
      const { oracleId, printings } = printingResult;
      if (card.oracleId !== oracleId) {
        card.oracleId = oracleId;
        saveState("cube");
      }
      state.printings = printings;
      renderPrintings();
    } catch (error) {
      if (requestId !== printingRequestId || state.editingCardId !== cardId || !elements.printingDialog.open) return;
      elements.printingStatus.classList.add("error");
      elements.printingStatus.textContent = error.message || "版本加载失败，请稍后重试";
    }
  }

  function selectPrinting(scryfallId) {
    const location = findCardLocation(state.editingCardId);
    const printing = state.printings.find((item) => item.id === scryfallId);
    if (!location || !printing) return;
    const current = location.cards[location.index];
    const replaced = replacePrinting(current, printing, state.printingFinishFilter === "foil" ? "foil" : current.finish);
    const next = applyIndexedPricesToCard(replaced, state.printingPriceIndex, lookupMtgjsonPrintingPrice, { clearMissing: true });
    next.priceUpdatedAt = "";
    location.cards[location.index] = next;
    collectionCommands.execute({
      changed: true,
      changes: [{
        type: "card.versionChanged",
        summary: `${current.name} 版本从 ${current.set} · ${current.collectorNumber} 改为 ${next.set} · ${next.collectorNumber}`,
        details: {
          card: cardLogInfo(next),
          before: { set: current.set, collectorNumber: current.collectorNumber, finish: current.finish },
          after: { set: next.set, collectorNumber: next.collectorNumber, finish: next.finish }
        }
      }],
      render: { pool: location.pool },
      feedback: { title: "版本已更新", message: `${printing.set.toUpperCase()} · ${printing.collector_number}` }
    });
    scheduleAutomaticPriceRefresh();
    elements.printingDialog.close();
  }

  function toggleCardFinish(cardId) {
    const location = findCardLocation(cardId);
    if (!location) return;
    const current = location.cards[location.index];
    const available = getAvailableFinishes(current);
    if (available.length < 2) {
      toast("无法切换", `此版本仅支持 ${available[0] === "foil" ? "Foil" : "Non-Foil"}`, true);
      return;
    }
    const before = normalizeFinish(current.finish);
    current.finish = normalizeFinish(current.finish) === "foil" ? "nonfoil" : "foil";
    current.priceSource = current.priceSources && current.priceSources[current.finish] || null;
    location.cards[location.index] = current;
    collectionCommands.execute({
      changed: true,
      changes: [{
        type: "card.finishChanged",
        summary: `${current.name} 从 ${before === "foil" ? "Foil" : "Non-Foil"} 切换为 ${current.finish === "foil" ? "Foil" : "Non-Foil"}`,
        details: { card: cardLogInfo(current), before: { finish: before }, after: { finish: current.finish } }
      }],
      render: location.pool === "basic" ? { pool: "basic" } : { cardId },
      feedback: { title: "Finish 已更新", message: current.finish === "foil" ? "Foil" : "Non-Foil" }
    });
    if (state.editingCardId === cardId && elements.printingDialog.open) {
      renderPrintingFinishFilter();
    }
    if (!current.priceSource) scheduleAutomaticPriceRefresh();
  }

  function toggleJapanPrint(cardId) {
    const location = findCardLocation(cardId);
    if (!location) return;
    const current = location.cards[location.index];
    const before = current.JapanPrint === true;
    current.JapanPrint = current.JapanPrint !== true;
    location.cards[location.index] = current;
    collectionCommands.execute({
      changed: true,
      changes: [{
        type: "card.japanPrintChanged",
        summary: `${current.name} ${current.JapanPrint ? "标记为日印" : "取消日印标记"}`,
        details: { card: cardLogInfo(current), before: { JapanPrint: before }, after: { JapanPrint: current.JapanPrint === true } }
      }],
      render: location.pool === "basic" ? { scopes: ["basics"] } : { cardId },
      feedback: { title: "日印状态已更新", message: current.JapanPrint ? "已标记为日印" : "已标记为非日印" }
    });
  }

  function resetAddLookupButton() {
    elements.lookupButton.disabled = false;
    elements.lookupButton.innerHTML = state.lookupMode === "name" ? "搜索卡牌" : "<span>+</span> 查找并添加";
  }

  function cancelAddLookup() {
    if (state.addLookupController) state.addLookupController.abort();
    state.addLookupController = null;
    state.addLookupRequestId += 1;
    resetAddLookupButton();
  }

  function beginAddLookup() {
    cancelAddLookup();
    const controller = new AbortController();
    state.addLookupController = controller;
    return { controller, requestId: state.addLookupRequestId };
  }

  function isCurrentAddLookup(request) {
    return Boolean(
      request
      && request.requestId === state.addLookupRequestId
      && request.controller === state.addLookupController
      && !request.controller.signal.aborted
      && elements.addCardDialog.open
    );
  }

  function clearNameResults() {
    cancelAddLookup();
    state.nameResults = [];
    elements.lookupResult.classList.add("hidden");
    elements.lookupResult.innerHTML = "";
  }

  function setLookupMode(mode) {
    state.lookupMode = mode;
    const isName = mode === "name";
    $("#nameLookupFields").classList.toggle("hidden", !isName);
    $("#printingLookupFields").classList.toggle("hidden", isName);
    $("#printingLookupHint").classList.toggle("hidden", isName);
    elements.cardNameInput.required = isName;
    elements.setCodeInput.required = !isName;
    elements.collectorNumberInput.required = !isName;
    clearNameResults();
    elements.lookupButton.innerHTML = isName ? "搜索卡牌" : "<span>+</span> 查找并添加";
    $$('[data-lookup-mode]').forEach((button) => {
      const active = button.dataset.lookupMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    setTimeout(() => (isName ? elements.cardNameInput : elements.setCodeInput).focus(), 20);
  }

  function addCard(card) {
    if (state.addTarget === "basic") {
      if (!isSupportedBasicLand(card)) {
        toast("不是支持的基本地", "只允许添加平原、海岛、沼泽、山脉或树林", true);
        return false;
      }
      const duplicate = state.data.basicLands.some((item) => card.scryfallId && item.scryfallId === card.scryfallId);
      if (duplicate) {
        toast("无法重复添加", "已经收藏了这个基本地版本", true);
        return false;
      }
      state.data.basicLands.unshift(card);
      collectionCommands.execute({
        changed: true,
        changes: [{ type: "basicLand.added", summary: `添加基本地：${card.name}`, details: { card: cardLogInfo(card), after: cardLogInfo(card) } }],
        render: { scopes: ["basics", "stats"] }
      });
      scheduleAutomaticPriceRefresh();
      return true;
    }
    const duplicate = findSingletonCard(state.data.cards, card);
    if (duplicate) {
      toast("主牌表严格单例", `已经包含 ${duplicate.name}；如需更换版本，请使用“选择版本”`, true);
      return false;
    }
    state.data.cards.unshift(card);
    state.data.cards = sortCards(state.data.cards);
    collectionCommands.execute({
      changed: true,
      changes: [{ type: "card.added", summary: `添加卡牌：${card.name}`, details: { card: cardLogInfo(card), after: cardLogInfo(card) } }],
      render: { pool: "draft" }
    });
    scheduleAutomaticPriceRefresh();
    return true;
  }

  function openAddCardDialog(target = "draft") {
    state.addTarget = target;
    const basicMode = target === "basic";
    $("#addCardDialog h2").textContent = basicMode ? "添加基本地" : "添加卡牌";
    $("#addCardDialog .modal-copy").textContent = basicMode
      ? "只允许平原、海岛、沼泽、山脉和树林；可按名称或系列与编号定位具体版本。"
      : "按牌名模糊查找，或用系列代码和收藏编号定位一个准确版本。";
    elements.cardNameInput.placeholder = basicMode ? "例如：Plains" : "例如：Lightning Bolt";
    elements.collectorNumberInput.placeholder = basicMode ? "例如：212-216" : "例如：233";
    $("#printingLookupHint").innerHTML = basicMode
      ? '系列代码可在卡牌左下角找到；收藏编号支持单张或纯数字区间，例如 <code>UST</code> <code>212-216</code>。'
      : '系列代码可在卡牌左下角找到，例如 <code>MH3</code>、<code>NEO</code> 或 <code>LEA</code>。';
    elements.addCardDialog.showModal();
    setTimeout(() => (state.lookupMode === "printing" ? elements.setCodeInput : elements.cardNameInput).focus(), 20);
  }

  function renderNameResults() {
    if (!state.nameResults.length) {
      elements.lookupResult.classList.remove("hidden");
      elements.lookupResult.innerHTML = '<div class="name-result-empty">没有找到包含这个名称的实体卡牌</div>';
      return;
    }
    elements.lookupResult.classList.remove("hidden");
    elements.lookupResult.innerHTML = `
      <div class="name-result-summary">找到 ${state.nameResults.length} 张不同卡牌，请选择要添加的牌</div>
      <div class="name-result-list">${state.nameResults.map((card) => {
        const face = card.card_faces && card.card_faces[0];
        const image = printingImage(card);
        const typeLine = (face && face.type_line) || card.type_line || "";
        return `<button type="button" class="name-result-option" data-add-search-result="${escapeHtml(card.id)}">
          <span class="name-result-thumb">${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" />` : ""}</span>
          <span class="name-result-info"><strong>${escapeHtml(card.name)}</strong><span>${escapeHtml(typeLine)}</span><small>${escapeHtml(card.set_name || card.set.toUpperCase())} · ${escapeHtml(card.set.toUpperCase())} ${escapeHtml(card.collector_number)}</small></span>
          <span class="name-result-add">添加</span>
        </button>`;
      }).join("")}</div>`;
  }

  function selectNameResult(scryfallId) {
    const result = state.nameResults.find((card) => card.id === scryfallId);
    if (!result) return;
    const card = normalizeScryfallCard(result);
    if (!addCard(card)) return;
    elements.addCardDialog.close();
    elements.cardNameInput.value = "";
    clearNameResults();
    toast("已添加", card.name);
  }

  function renderBasicLandRangeResult(summary) {
    const skipped = summary.items.filter((item) => item.status !== "added");
    elements.lookupResult.classList.remove("hidden");
    elements.lookupResult.innerHTML = `<div class="basic-range-result">
      <div class="basic-range-result-heading"><strong>基本地区间结果</strong><span>${escapeHtml(summary.setCode)} ${escapeHtml(summary.first)}-${escapeHtml(summary.last)}</span></div>
      <div class="basic-range-counts">
        <span><strong>${summary.counts.added}</strong> 已添加</span>
        <span><strong>${summary.counts.missing}</strong> 缺少卡牌</span>
        <span><strong>${summary.counts.unsupported}</strong> 不是五种基本地</span>
        <span><strong>${summary.counts.digital}</strong> 仅有电子版</span>
        <span><strong>${summary.counts.duplicate}</strong> 已经收藏</span>
      </div>
      ${skipped.length ? `<div class="basic-range-skips">${skipped.map((item) => `<div><code>${escapeHtml(item.collectorNumber)}</code><span>${escapeHtml(item.reason)}</span></div>`).join("")}</div>` : '<p class="basic-range-complete">区间内的基本地已全部添加。</p>'}
    </div>`;
  }

  async function addBasicLandRange(setCode, collectorNumbers, request) {
    const targets = collectorNumbers.map((collectorNumber) => ({ setCode, collectorNumber }));
    const cardsByPrinting = await catalog.lookupPrintingBatch(targets, request.controller.signal);
    if (!isCurrentAddLookup(request)) return null;
    const classified = classifyBasicLandBatch(targets, cardsByPrinting, state.data.basicLands);
    const changes = classified.accepted.map((result) => {
      const card = normalizeScryfallCard(result);
      state.data.basicLands.unshift(card);
      return { type: "basicLand.added", summary: `添加基本地：${card.name}`, details: { card: cardLogInfo(card), after: cardLogInfo(card) } };
    });
    const { counts, items } = classified;
    collectionCommands.execute({ changed: counts.added > 0, changes, render: { scopes: ["basics", "stats"] } });
    if (counts.added > 0) scheduleAutomaticPriceRefresh();
    const summary = { setCode: setCode.toUpperCase(), first: collectorNumbers[0], last: collectorNumbers[collectorNumbers.length - 1], counts, items };
    renderBasicLandRangeResult(summary);
    toast("批量添加完成", `添加 ${counts.added} 张，跳过 ${items.length - counts.added} 张`);
    return summary;
  }

  async function handleAddCard(event) {
    event.preventDefault();
    const isNameLookup = state.lookupMode !== "printing";
    const name = elements.cardNameInput.value.trim();
    const setCode = elements.setCodeInput.value.trim();
    const collectorNumber = elements.collectorNumberInput.value.trim();
    if (isNameLookup ? !name : (!setCode || !collectorNumber)) return;
    const request = beginAddLookup();
    elements.lookupButton.disabled = true;
    elements.lookupButton.textContent = "正在查找…";
    try {
      if (isNameLookup) {
        elements.lookupResult.classList.remove("hidden");
        elements.lookupResult.innerHTML = '<div class="name-result-empty">正在搜索实体卡牌…</div>';
        const basicName = BASIC_LAND_ORDER.find((candidate) => candidate.toLocaleLowerCase() === name.toLocaleLowerCase());
        const results = state.addTarget === "basic" ? basicName ? [await catalog.lookupNamed(basicName, request.controller.signal)] : [] : await catalog.searchByName(name, request.controller.signal);
        if (!isCurrentAddLookup(request)) return;
        state.nameResults = state.addTarget === "basic" && basicName ? results.filter(isSupportedBasicLand).slice(0, 1) : state.addTarget === "basic" ? [] : results;
        renderNameResults();
        return;
      }
      const parsedCollector = parseCollectorNumberRange(collectorNumber);
      if (state.addTarget === "basic" && parsedCollector.isRange) {
        await addBasicLandRange(setCode, parsedCollector.numbers, request);
        return;
      }
      if (parsedCollector.isRange) throw new Error("普通牌表只能输入单个收藏编号");
      const result = await catalog.lookupPrinting(setCode, collectorNumber, request.controller.signal);
      if (!isCurrentAddLookup(request)) return;
      const card = normalizeScryfallCard(result);
      if (!addCard(card)) return;
      elements.addCardDialog.close();
      elements.cardNameInput.value = "";
      elements.setCodeInput.value = "";
      elements.collectorNumberInput.value = "";
      toast("已添加", card.name);
    } catch (error) {
      if (error.name === "AbortError" || !isCurrentAddLookup(request)) return;
      toast("添加失败", error.message || "请检查网络后重试", true);
    } finally {
      if (state.addLookupController === request.controller) {
        state.addLookupController = null;
        resetAddLookupButton();
      }
    }
  }

  function setImportMode(mode) {
    if (state.importing) return;
    state.importMode = mode;
    $("#textImportPane").classList.toggle("hidden", mode !== "text");
    $("#excelImportPane").classList.toggle("hidden", mode !== "excel");
    $$('[data-import-mode]').forEach((button) => {
      const active = button.dataset.importMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    elements.importStatus.classList.add("hidden");
    if (mode === "text") updateTextAction();
    else updateExcelAction();
  }

  function updateTextAction() {
    const valid = state.textRows.filter((row) => row.importable).length;
    if (state.textValidated) {
      elements.startImportBtn.textContent = `导入通过的 ${valid} 张`;
      elements.startImportBtn.disabled = valid === 0;
    } else {
      elements.startImportBtn.textContent = "检查并预览";
      elements.startImportBtn.disabled = !elements.importText.value.trim();
    }
  }

  function resetTextValidation() {
    state.textRows = [];
    state.textValidated = false;
    elements.textPreview.classList.add("hidden");
    elements.importStatus.classList.add("hidden");
    if (state.importMode === "text" && !state.importing) updateTextAction();
  }

  function updateExcelAction() {
    const valid = state.excelRows.filter((row) => row.importable).length;
    if (state.excelValidated) {
      elements.startImportBtn.textContent = `导入通过的 ${valid} 张`;
      elements.startImportBtn.disabled = valid === 0;
    } else {
      elements.startImportBtn.textContent = "检查并预览";
      elements.startImportBtn.disabled = !state.excelFile;
    }
  }

  function chooseExcelFile(file) {
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      toast("文件格式不支持", "请选择 .xlsx 或 .xls 文件", true);
      return;
    }
    state.excelFile = file;
    state.excelRows = [];
    state.excelValidated = false;
    elements.excelFileName.textContent = file.name;
    elements.excelPreview.classList.add("hidden");
    elements.importStatus.classList.add("hidden");
    updateExcelAction();
  }

  function loadGlobalScript(url, readValue, errors) {
    const existing = readValue();
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.onload = () => {
        const value = readValue();
        if (value) resolve(value);
        else {
          script.remove();
          reject(new Error(errors.invalid));
        }
      };
      script.onerror = () => {
        script.remove();
        reject(new Error(errors.load));
      };
      document.head.append(script);
    });
  }

  function loadSheetJs() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (sheetJsLoader) return sheetJsLoader;
    const loader = loadGlobalScript(SHEETJS_URL, () => window.XLSX, {
      invalid: "Excel 解析组件格式无效",
      load: "Excel 解析组件加载失败，请检查网络后重试"
    });
    sheetJsLoader = loader;
    loader.catch(() => {
      if (sheetJsLoader === loader) sheetJsLoader = null;
    });
    return loader;
  }

  function loadProductSourceIndexScript() {
    if (window.CubeProductSourceIndex) return Promise.resolve(window.CubeProductSourceIndex);
    if (productSourceIndexLoader) return productSourceIndexLoader;
    const loader = loadGlobalScript(PRODUCT_SOURCE_INDEX_SCRIPT_URL, () => window.CubeProductSourceIndex, {
      invalid: "本地产品来源索引格式无效",
      load: "本地产品来源索引加载失败"
    });
    productSourceIndexLoader = loader;
    loader.catch(() => {
      if (productSourceIndexLoader === loader) productSourceIndexLoader = null;
    });
    return loader;
  }

  function loadMtgjsonPriceIndexScript() {
    if (window.CubeMtgjsonPriceIndex) return Promise.resolve(window.CubeMtgjsonPriceIndex);
    if (mtgjsonPriceIndexLoader) return mtgjsonPriceIndexLoader;
    const loader = loadGlobalScript(MTGJSON_PRICE_INDEX_SCRIPT_URL, () => window.CubeMtgjsonPriceIndex, {
      invalid: "本地 MTGJSON 价格索引格式无效",
      load: "本地 MTGJSON 价格索引加载失败"
    });
    mtgjsonPriceIndexLoader = loader;
    loader.catch(() => {
      if (mtgjsonPriceIndexLoader === loader) mtgjsonPriceIndexLoader = null;
    });
    return loader;
  }

  async function readExcelRows(file) {
    const XLSX = await loadSheetJs();
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) throw new Error("Excel 文件没有工作表");
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { header: 1, defval: "", raw: false, blankrows: false });
    return parseExcelRows(rows);
  }

  function excelStatus(row) {
    const statuses = {
      valid: ["valid", "通过"],
      mismatch: ["warning", "名称不匹配"],
      duplicate: ["warning", "文件内重复"],
      existing: ["warning", "牌表中已有"],
      missing: ["error", "缺少必填列"],
      notFound: ["error", "未找到版本"]
    };
    return statuses[row.status] || ["error", "校验失败"];
  }

  function renderExcelPreview() {
    const counts = state.excelRows.reduce((result, row) => {
      const [severity] = excelStatus(row);
      result[severity] += 1;
      return result;
    }, { valid: 0, warning: 0, error: 0 });
    elements.excelSummary.innerHTML = [
      ["总行数", state.excelRows.length, ""],
      ["可以导入", counts.valid, "valid"],
      ["需要检查", counts.warning, "warning"],
      ["错误", counts.error, "error"]
    ].map(([label, value, kind]) => `<div class="excel-summary-item ${kind}"><span>${label}</span><strong>${value}</strong></div>`).join("");
    elements.excelPreviewBody.innerHTML = state.excelRows.map((row) => {
      const [severity, label] = excelStatus(row);
      const actual = row.card ? `<strong>${escapeHtml(row.card.name)}</strong><span>${escapeHtml(row.card.set.toUpperCase())} · ${escapeHtml(row.card.collector_number)}</span>` : `<strong>—</strong><span>${escapeHtml(row.message || "没有核验结果")}</span>`;
      return `<tr><td>${row.rowNumber}</td><td class="excel-card-input"><strong>${escapeHtml(row.expectedName || "未填写名称")}</strong><span>${escapeHtml(row.setCode || "—")} · ${escapeHtml(row.collectorNumber || "—")}</span></td><td class="excel-card-result">${actual}</td><td><span class="excel-status ${severity}">${label}</span></td></tr>`;
    }).join("");
    elements.excelPreview.classList.remove("hidden");
  }

  async function validateExcelImport() {
    if (!state.excelFile) return;
    state.importing = true;
    elements.startImportBtn.disabled = true;
    elements.importStatus.classList.remove("hidden");
    try {
      const rows = await readExcelRows(state.excelFile);
      if (!rows.length) throw new Error("第一个工作表中没有可读取的数据");
      const seen = new Set();
      const existing = new Set(state.data.cards.filter((card) => card.set && card.collectorNumber).map((card) => printingKey(card.set, card.collectorNumber)));
      state.excelRows = rows.map((sourceRow) => {
        const row = { ...sourceRow, status: "valid", importable: false, card: null, message: "" };
        if (!row.setCode || !row.collectorNumber || !row.expectedName) {
          row.status = "missing";
          row.message = "系列、编号和名称都必须填写";
        } else {
          const key = printingKey(row.setCode, row.collectorNumber);
          if (seen.has(key)) {
            row.status = "duplicate";
            row.message = "相同系列与编号已在文件中出现";
          } else if (existing.has(key)) {
            row.status = "existing";
            row.message = "当前 Cube 已包含这个版本";
          }
          seen.add(key);
        }
        return row;
      });

      const candidates = state.excelRows.filter((row) => row.status === "valid");
      elements.importStatus.textContent = `正在批量核验 ${candidates.length} 个版本…`;
      const cardsByPrinting = await catalog.lookupPrintingBatch(candidates);
      const acceptedCards = [];
      candidates.forEach((row) => {
        row.card = cardsByPrinting.get(printingKey(row.setCode, row.collectorNumber)) || null;
        if (!row.card) {
          row.status = "notFound";
          row.message = "Scryfall 中没有这个系列与编号";
          return;
        }
        const acceptedNames = [row.card.name, row.card.printed_name].filter(Boolean).map(normalizeCardName);
        if (acceptedNames.includes(normalizeCardName(row.expectedName))) {
          const existingCard = findSingletonCard(state.data.cards, row.card);
          const duplicateCard = findSingletonCard(acceptedCards, row.card);
          if (existingCard) {
            row.status = "existing";
            row.message = `主牌表已包含 ${existingCard.name} 的其他版本`;
          } else if (duplicateCard) {
            row.status = "duplicate";
            row.message = `文件中已有 ${duplicateCard.name} 的其他版本`;
          } else {
            row.importable = true;
            acceptedCards.push(row.card);
          }
        } else {
          row.status = "mismatch";
          row.message = `实际为 ${row.card.name}`;
        }
      });

      state.excelValidated = true;
      renderExcelPreview();
      elements.importStatus.textContent = "核验完成。请检查结果后再导入。";
    } catch (error) {
      state.excelValidated = false;
      elements.importStatus.textContent = error.message || "Excel 文件读取失败";
      toast("无法检查 Excel", error.message || "请确认文件内容后重试", true);
    } finally {
      state.importing = false;
      updateExcelAction();
    }
  }

  function commitExcelImport() {
    const rows = state.excelRows.filter((row) => row.importable && row.card);
    rows.forEach((row) => {
      const card = normalizeScryfallCard(row.card);
      state.data.cards.push({ ...card, finish: chooseValidFinish(card, row.finish), JapanPrint: row.JapanPrint === true });
    });
    state.data.cards = sortCards(state.data.cards);
    recordChange("import.excel", `Excel 导入 ${rows.length} 张牌`, { meta: { count: rows.length } }, { persist: false });
    saveState(["cube", "changeLog"]);
    requestDataRender();
    elements.importDialog.close();
    toast("Excel 导入完成", `已添加 ${rows.length} 张核验通过的卡牌`);
    if (rows.length) scheduleAutomaticPriceRefresh();
    state.excelFile = null;
    state.excelRows = [];
    state.excelValidated = false;
    elements.excelFileInput.value = "";
    elements.excelFileName.textContent = "选择 Excel 文件";
    elements.excelPreview.classList.add("hidden");
  }

  function renderTextPreview() {
    const counts = state.textRows.reduce((result, row) => {
      const [severity] = excelStatus(row);
      result[severity] += 1;
      return result;
    }, { valid: 0, warning: 0, error: 0 });
    elements.textSummary.innerHTML = [
      ["总行数", state.textRows.length, ""],
      ["可以导入", counts.valid, "valid"],
      ["需要检查", counts.warning, "warning"],
      ["错误", counts.error, "error"]
    ].map(([label, value, kind]) => `<div class="excel-summary-item ${kind}"><span>${label}</span><strong>${value}</strong></div>`).join("");
    elements.textPreviewBody.innerHTML = state.textRows.map((row) => {
      const [severity, label] = excelStatus(row);
      const actual = row.card ? `<strong>${escapeHtml(row.card.name)}</strong><span>${escapeHtml(row.card.set.toUpperCase())} · ${escapeHtml(row.card.collector_number)}</span>` : `<strong>—</strong><span>${escapeHtml(row.message || "没有核验结果")}</span>`;
      return `<tr><td>${row.rowNumber}</td><td class="excel-card-input"><strong>${escapeHtml(row.expectedName)}</strong></td><td class="excel-card-result">${actual}</td><td><span class="excel-status ${severity}">${label}</span></td></tr>`;
    }).join("");
    elements.textPreview.classList.remove("hidden");
  }

  async function validateTextImport() {
    const names = parseDecklist(elements.importText.value);
    if (!names.length) {
      toast("没有牌名", "请先粘贴牌表", true);
      return;
    }
    state.importing = true;
    elements.startImportBtn.disabled = true;
    elements.importStatus.classList.remove("hidden");
    try {
      const existingNames = state.data.cards.flatMap((card) => String(card.name || "").split(" // "));
      state.textRows = prepareTextImportRows(names, existingNames);
      const candidates = state.textRows.filter((row) => row.status === "valid");
      elements.importStatus.textContent = `正在批量核验 ${candidates.length} 个牌名…`;
      const cardsByName = await catalog.lookupCardNameBatch(candidates.map((row) => row.expectedName));
      const acceptedCards = [];
      candidates.forEach((row) => {
        row.card = cardsByName.get(normalizeCardName(row.expectedName)) || null;
        if (!row.card) {
          row.status = "notFound";
          row.message = "Scryfall 中没有精确匹配的实体卡牌";
        } else if (findSingletonCard(state.data.cards, row.card)) {
          row.status = "existing";
          row.message = "当前 Cube 已包含这张牌的其他版本";
        } else if (findSingletonCard(acceptedCards, row.card)) {
          row.status = "duplicate";
          row.message = "输入中已有这张牌的其他名称或版本";
        } else {
          row.importable = true;
          acceptedCards.push(row.card);
        }
      });
      state.textValidated = true;
      renderTextPreview();
      elements.importStatus.textContent = "核验完成。请检查结果后再导入。";
    } catch (error) {
      state.textValidated = false;
      elements.importStatus.textContent = error.message || "文本牌表核验失败";
      toast("无法检查牌表", error.message || "请检查网络后重试", true);
    } finally {
      state.importing = false;
      updateTextAction();
    }
  }

  function commitTextImport() {
    const rows = state.textRows.filter((row) => row.importable && row.card);
    rows.forEach((row) => state.data.cards.push(normalizeScryfallCard(row.card)));
    state.data.cards = sortCards(state.data.cards);
    recordChange("import.text", `文本导入 ${rows.length} 张牌`, { meta: { count: rows.length } }, { persist: false });
    saveState(["cube", "changeLog"]);
    requestDataRender();
    elements.importDialog.close();
    toast("文本导入完成", `已添加 ${rows.length} 张核验通过的卡牌`);
    if (rows.length) scheduleAutomaticPriceRefresh();
    elements.importText.value = "";
    resetTextValidation();
  }

  async function handleImport(event) {
    event.preventDefault();
    if (state.importMode === "excel") {
      if (state.excelValidated) commitExcelImport();
      else await validateExcelImport();
      return;
    }
    if (state.textValidated) commitTextImport();
    else await validateTextImport();
  }

  async function exportData() {
    try {
      const XLSX = await loadSheetJs();
      const extras = {
        byCardId: Object.fromEntries(getValuedCards().map((card) => [card.id, excelPriceExtras(card)]))
      };
      const rows = buildExcelRows(state.data.cards, extras);
      const basicLandRows = buildExcelRows(state.data.basicLands, extras);
      const worksheet = XLSX.utils.aoa_to_sheet(rows);
      const basicLandWorksheet = XLSX.utils.aoa_to_sheet(basicLandRows);
      worksheet["!cols"] = [
        { wch: 10 }, { wch: 12 }, { wch: 34 }, { wch: 14 }, { wch: 12 }, { wch: 8 },
        { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 38 },
        { wch: 36 }, { wch: 36 }, { wch: 16 }
      ];
      worksheet["!autofilter"] = { ref: `A1:O${rows.length}` };
      basicLandWorksheet["!cols"] = worksheet["!cols"].map((column) => ({ ...column }));
      basicLandWorksheet["!autofilter"] = { ref: `A1:O${basicLandRows.length}` };
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Cube 牌表");
      XLSX.utils.book_append_sheet(workbook, basicLandWorksheet, "基本地");
      const fileName = `${state.data.meta.name.replace(/[\\/:*?"<>|]/g, "-") || "Cube牌表"}.xlsx`;
      XLSX.writeFile(workbook, fileName, { compression: true });
      toast("已导出", `Excel 表格包含 ${state.data.cards.length} 张轮抽牌和 ${state.data.basicLands.length} 张基本地`);
    } catch (error) {
      toast("导出失败", error.message || "Excel 组件加载失败，请稍后重试", true);
    }
  }

  function downloadJsonBackup() {
    const payload = JSON.stringify(buildBackup(state.data, {
      priceHistory: state.priceHistory,
      changeLog: state.changeLog
    }), null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${state.data.meta.name.replace(/[\\/:*?"<>|]/g, "-") || "Cube备份"}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("备份完成", "牌表、价格历史与改动记录已备份；本地卡图仍保留在 Cube 文件夹");
  }

  async function restoreJsonBackup(file) {
    if (!file) return;
    try {
      const restored = parseBackup(await file.text());
      const resolved = resolveLoadedWorkspace(restored.cubeData, restored.priceHistoryData, restored.changeLogData);
      if (!window.confirm(`恢复“${resolved.cubeData.meta.name}”将覆盖当前 Cube、价格历史和改动记录，是否继续？`)) return;
      applyCubeData(resolved.cubeData);
      applyPriceHistoryData(resolved.priceHistoryData);
      applyChangeLogData(resolved.changeLogData);
      recordChange("backup.restored", `恢复 JSON 备份：${state.data.cards.length} 张牌`, { meta: { count: state.data.cards.length, name: resolved.cubeData.meta.name } }, { persist: false });
      saveState(["cube", "priceHistory", "changeLog"]);
      clearFilters();
      renderAll();
      toast("恢复完成", `已恢复 ${state.data.cards.length} 张牌`);
    } catch (error) {
      toast("恢复失败", error.message || "无法读取这个备份文件", true);
    } finally {
      elements.backupFileInput.value = "";
    }
  }

  function removeCard(id) {
    const location = findCardLocation(id);
    if (!location) return;
    const [removed] = location.cards.splice(location.index, 1);
    collectionCommands.execute({
      changed: true,
      changes: [{ type: "card.removed", summary: `移除卡牌：${removed.name}`, details: { card: cardLogInfo(removed), before: cardLogInfo(removed) } }],
      render: { pool: location.pool },
      feedback: {
        title: "已移除",
        message: removed.name,
        action: {
          label: "撤销",
          run: () => {
            if (location.cards.some((card) => card.id === removed.id)) return;
            location.cards.push(removed);
            if (location.pool === "draft") state.data.cards = sortCards(state.data.cards);
            collectionCommands.execute({
              changed: true,
              changes: [{ type: "card.removeUndone", summary: `撤销移除：${removed.name}`, details: { card: cardLogInfo(removed), after: cardLogInfo(removed) } }],
              render: { pool: location.pool },
              feedback: { title: "已恢复", message: removed.name }
            });
          }
        }
      }
    });
  }

  function setView(view) {
    state.view = view;
    elements.collectionView.classList.toggle("hidden", view !== "collection");
    elements.analyticsView.classList.toggle("hidden", view !== "analytics");
    elements.basicLandsView.classList.toggle("hidden", view !== "basicLands");
    $("#addCardBtn").classList.toggle("hidden", view === "basicLands");
    $$(".nav-item").forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (view === "analytics") renderScheduler.request("analytics");
    if (view === "basicLands") renderScheduler.request("basics");
  }

  function bindTabKeyboard(selector) {
    const buttons = $$(selector);
    buttons.forEach((button, index) => button.addEventListener("keydown", (event) => {
      let nextIndex = null;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % buttons.length;
      if (event.key === "ArrowLeft") nextIndex = (index - 1 + buttons.length) % buttons.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = buttons.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      buttons[nextIndex].click();
      buttons[nextIndex].focus();
    }));
  }

  function clearFilters(options = {}) {
    state.filters = { query: "", color: "all", type: "all", finish: "all", japanPrint: "all" };
    elements.searchInput.value = "";
    elements.typeFilter.value = "all";
    elements.finishFilter.value = "all";
    elements.japanPrintFilter.value = "all";
    $$("[data-color]").forEach((button) => {
      const active = button.dataset.color === "all";
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (options.render !== false) renderScheduler.request("cards");
  }

  function handleCollectionCardClick(event) {
    const imageButton = event.target.closest("[data-preview-image]");
    if (imageButton) return openImagePreview(imageButton.dataset.previewImage);
    const japanPrintButton = event.target.closest("[data-toggle-japan-print]");
    if (japanPrintButton) return toggleJapanPrint(japanPrintButton.dataset.toggleJapanPrint);
    const finishButton = event.target.closest("[data-toggle-finish]");
    if (finishButton) return toggleCardFinish(finishButton.dataset.toggleFinish);
    const removeButton = event.target.closest("[data-remove]");
    if (removeButton) return removeCard(removeButton.dataset.remove);
    const printingButton = event.target.closest("[data-change-printing]");
    if (printingButton) openPrintingDialog(printingButton.dataset.changePrinting);
  }

  function bindEvents() {
    elements.statsGrid.addEventListener("click", (event) => {
      const historyButton = event.target.closest("[data-show-total-history]");
      if (historyButton) {
        openTotalPriceHistory();
        return;
      }
      const changesButton = event.target.closest("[data-show-today-price-changes]");
      if (changesButton) {
        openTodayPriceChanges();
        return;
      }
      const button = event.target.closest("[data-refresh-prices]");
      if (button) refreshStalePrices(true);
    });
    elements.priceHistoryContent.addEventListener("click", (event) => {
      if (event.target.closest("[data-sync-price-history]")) syncMtgjsonPriceHistory();
      const periodButton = event.target.closest("[data-price-change-period]");
      if (periodButton) {
        const ranking = elements.priceHistoryContent.querySelector("[data-price-change-ranking].active")?.dataset.priceChangeRanking;
        openPriceChanges(periodButton.dataset.priceChangePeriod, ranking);
        return;
      }
      const rankingButton = event.target.closest("[data-price-change-ranking]");
      if (rankingButton) {
        const period = elements.priceHistoryContent.querySelector("[data-price-change-period].active")?.dataset.priceChangePeriod;
        openPriceChanges(period, rankingButton.dataset.priceChangeRanking);
      }
    });
    elements.priceHistoryContent.addEventListener("error", (event) => {
      if (event.target.classList && event.target.classList.contains("price-change-thumbnail")) event.target.classList.add("hidden");
    }, true);
    $("#addCardBtn").addEventListener("click", () => openAddCardDialog("draft"));
    elements.addBasicLandBtn.addEventListener("click", () => openAddCardDialog("basic"));
    $$('[data-basic-land-grouping]').forEach((button) => button.addEventListener("click", () => setBasicLandGrouping(button.dataset.basicLandGrouping)));
    $("#addCardForm").addEventListener("submit", handleAddCard);
    elements.cardNameInput.addEventListener("input", clearNameResults);
    elements.setCodeInput.addEventListener("input", clearNameResults);
    elements.collectorNumberInput.addEventListener("input", clearNameResults);
    elements.lookupResult.addEventListener("click", (event) => {
      const button = event.target.closest("[data-add-search-result]");
      if (button) selectNameResult(button.dataset.addSearchResult);
    });
    $$('[data-lookup-mode]').forEach((button) => button.addEventListener("click", () => setLookupMode(button.dataset.lookupMode)));
    $("#importBtn").addEventListener("click", () => { elements.importDialog.showModal(); setImportMode(state.importMode); });
    $("#importForm").addEventListener("submit", handleImport);
    elements.importText.addEventListener("input", resetTextValidation);
    $$('[data-import-mode]').forEach((button) => button.addEventListener("click", () => setImportMode(button.dataset.importMode)));
    elements.excelFileInput.addEventListener("change", (event) => chooseExcelFile(event.target.files[0]));
    ["dragenter", "dragover"].forEach((type) => elements.excelDropZone.addEventListener(type, (event) => { event.preventDefault(); elements.excelDropZone.classList.add("dragging"); }));
    ["dragleave", "drop"].forEach((type) => elements.excelDropZone.addEventListener(type, (event) => { event.preventDefault(); elements.excelDropZone.classList.remove("dragging"); }));
    elements.excelDropZone.addEventListener("drop", (event) => chooseExcelFile(event.dataTransfer.files[0]));
    $("#exportBtn").addEventListener("click", exportData);
    $("#backupBtn").addEventListener("click", downloadJsonBackup);
    elements.changeLogBtn.addEventListener("click", openChangeLogDialog);
    elements.healthCheckBtn.addEventListener("click", openWorkspaceHealthCheck);
    $("#restoreBtn").addEventListener("click", () => elements.backupFileInput.click());
    elements.backupFileInput.addEventListener("change", (event) => restoreJsonBackup(event.target.files[0]));
    elements.connectFolderBtn.addEventListener("click", handleConnectFolderClick);
    elements.cacheImagesBtn.addEventListener("click", cacheAllImages);
    elements.syncFolderBtn.addEventListener("click", syncCurrentDataToDirectory);
    elements.reloadFolderBtn.addEventListener("click", reloadFromDirectory);
    elements.disconnectFolderBtn.addEventListener("click", () => disconnectDirectoryMode());
    $("#clearFiltersBtn").addEventListener("click", clearFilters);
    $("#newCubeBtn").addEventListener("click", () => toast("即将支持", "多 Cube 管理已列入下一版"));

    $$(".nav-item").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
    elements.searchInput.addEventListener("input", (event) => {
      state.filters.query = event.target.value;
      if (searchRenderFrame) return;
      searchRenderFrame = requestAnimationFrame(() => {
        searchRenderFrame = 0;
        renderScheduler.request("cards");
      });
    });
    elements.typeFilter.addEventListener("change", (event) => { state.filters.type = event.target.value; renderScheduler.request("cards"); });
    elements.finishFilter.addEventListener("change", (event) => { state.filters.finish = event.target.value; renderScheduler.request("cards"); });
    elements.japanPrintFilter.addEventListener("change", (event) => { state.filters.japanPrint = event.target.value; renderScheduler.request("cards"); });
    $("#analyticsView").addEventListener("click", (event) => {
      const colorButton = event.target.closest("[data-analytics-color]");
      const typeButton = event.target.closest("[data-analytics-type]");
      if (!colorButton && !typeButton) return;
      if (colorButton) {
        const color = colorButton.dataset.analyticsColor;
        state.analyticsFilters = {
          ...state.analyticsFilters,
          color: color === "all" || state.analyticsFilters.color === color ? "all" : color
        };
      } else {
        const type = typeButton.dataset.analyticsType;
        state.analyticsFilters = {
          ...state.analyticsFilters,
          type: state.analyticsFilters.type === type ? "all" : type
        };
      }
      renderScheduler.request("analytics");
    });
    $$("[data-color]").forEach((button) => button.addEventListener("click", () => {
      state.filters.color = button.dataset.color;
      $$("[data-color]").forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      renderScheduler.request("cards");
    }));
    $$("[data-mode]").forEach((button) => button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      $$("[data-mode]").forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      renderScheduler.request("cards");
    }));
    $$("[data-name-language]").forEach((button) => button.addEventListener("click", () => setNameLanguage(button.dataset.nameLanguage)));
    elements.cardGrid.addEventListener("click", handleCollectionCardClick);
    elements.basicLandGrid.addEventListener("click", handleCollectionCardClick);
    [elements.cardGrid, elements.basicLandGrid].forEach((grid) => grid.addEventListener("error", (event) => {
      if (event.target.classList && event.target.classList.contains("card-image")) event.target.classList.add("hidden");
    }, true));
    elements.printingSearchInput.addEventListener("input", renderPrintings);
    elements.printingFinishToggle.addEventListener("click", (event) => {
      const button = event.target.closest("[data-toggle-printing-finish-filter]");
      if (!button) return;
      state.printingFinishFilter = state.printingFinishFilter === "foil" ? "all" : "foil";
      renderPrintings();
    });
    elements.printingGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-select-printing]");
      if (button) selectPrinting(button.dataset.selectPrinting);
    });

    $("#editCubeBtn").addEventListener("click", () => {
      $("#editCubeName").value = state.data.meta.name;
      $("#editCubeDescription").value = state.data.meta.description;
      elements.editCubeDialog.showModal();
    });
    $("#editCubeForm").addEventListener("submit", (event) => {
      event.preventDefault();
      state.data.meta.name = $("#editCubeName").value.trim();
      state.data.meta.description = $("#editCubeDescription").value.trim();
      saveState("cube"); renderScheduler.request("meta"); elements.editCubeDialog.close(); toast("已保存", "Cube 信息已更新");
    });
    $("#cubeNotes").addEventListener("input", (event) => { state.data.notes = event.target.value; saveState("cube", { delayMs: 400 }); });
    $("#cubeNotes").addEventListener("blur", () => persistence.flush());
    window.addEventListener("pagehide", () => persistence.flushBrowserSync());
    $("#editNotesBtn").addEventListener("click", () => $("#cubeNotes").focus());

    $$('[data-close-dialog]').forEach((button) => button.addEventListener("click", () => {
      if (state.importing) return;
      button.closest("dialog").close();
    }));

    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setView("collection"); elements.searchInput.focus();
      }
      if (event.key === "Escape") {
        const openDialog = $("dialog[open]");
        if (openDialog && !(state.importing && openDialog === elements.importDialog)) {
          event.preventDefault();
          openDialog.close();
        }
      }
    });
    $$("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
      if (event.target === dialog && !state.importing) dialog.close();
    }));
    elements.importDialog.addEventListener("cancel", (event) => {
      if (state.importing) event.preventDefault();
    });
    elements.imagePreviewDialog.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-image-preview]")) {
        closeImagePreview();
        return;
      }
      if (event.target === elements.imagePreviewDialog || event.target.closest(".card-archive-images img")) closeImagePreview();
    });
    elements.imagePreviewDialog.addEventListener("cancel", clearImagePreview);
    elements.imagePreviewDialog.addEventListener("close", clearImagePreview);
    elements.priceHistoryDialog.addEventListener("close", () => {
      if (state.priceHistorySyncController) state.priceHistorySyncController.abort(new DOMException("价格历史同步已取消", "AbortError"));
    });
    elements.addCardDialog.addEventListener("close", clearNameResults);
    elements.printingDialog.addEventListener("close", () => {
      if (state.printingController) state.printingController.abort();
      state.printingController = null;
      printingRequestId += 1;
      state.editingCardId = null;
      state.printings = [];
    });
    bindTabKeyboard('[data-lookup-mode]');
    bindTabKeyboard('[data-import-mode]');
    bindTabKeyboard('[data-name-language]');
    $$('[data-lookup-mode]').forEach((button) => { button.tabIndex = button.dataset.lookupMode === state.lookupMode ? 0 : -1; });
    $$('[data-import-mode]').forEach((button) => { button.tabIndex = button.dataset.importMode === state.importMode ? 0 : -1; });
    $$('[data-name-language]').forEach((button) => { button.tabIndex = button.dataset.nameLanguage === state.nameLanguage ? 0 : -1; });
  }

  async function initialize() {
    bindEvents();
    await loadPublishedCubeData();
    renderAll();
    renderStorageStatus();
    await restoreDirectoryMode();
    localMirrorSave();
    savePriceHistoryLocal();
    saveChangeLogLocal();
    try {
      await refreshStalePrices();
    } finally {
      schedulePriceMaintenance();
    }
  }

  void initialize();
})();
