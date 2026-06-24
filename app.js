(function () {
  "use strict";

  const STORAGE_KEY = "arcana-cube-v1";
  const NAME_LANGUAGE_KEY = "arcana-cube-card-name-language";
  const DIRECTORY_HANDLE_KEY = "cube-directory-handle";
  const CUBE_FILE_NAME = "cube-data.json";
  const SHEETJS_URL = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
  const { buildBackup, buildCardNameSearchUrl, buildExcelRows, buildLocalizedNameSearchUrl, buildPrintingsUrl, chooseValidFinish, computeStats, filterCards, filterOraclePrintings, filterPrintings, sortCards, getAvailableFinishes, getCardBucket, getFrontColors, getFrontDisplayName, getFrontTypeLine, getLookupName, getOracleId, getPreferredLocalizedName, getPriceNumber, getUsdPrice, isPaperPrinting, needsPriceRefresh, normalizeCardName, normalizeFinish, normalizeLocalizedNames, normalizeScryfallCard, parseBackup, parseDecklist, parseExcelRows, prepareTextImportRows, replacePrinting } = window.CubeCore;
  const { requestJson: scryfallRequest } = window.ScryfallClient;
  const cubeStorage = window.CubeStorage.createStorage(localStorage, STORAGE_KEY);
  const cubeHandleStore = window.CubeStorage.createHandleStore(window.indexedDB);
  let sheetJsLoader;
  let printingRequestId = 0;

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
      name: "暮色典藏",
      description: "为四至八人轮抽设计的中速环境，强调墓地、神器与多色协同。"
    },
    notes: "设计目标：互动优先，让每种颜色都拥有至少两条清晰的轮抽路径。\n\n下次轮抽观察：红色快攻的一费生物密度；蓝黑墓地套牌是否需要更多弃牌出口。",
    cards: seedCards
  };

  const state = {
    data: (() => {
      const loaded = loadState();
      loaded.cards = normalizeStoredCards(loaded.cards || []);
      return loaded;
    })(),
    filters: { query: "", color: "all", type: "all", finish: "all", japanPrint: "all" },
    mode: "grid",
    nameLanguage: loadNameLanguage(),
    nameLocalization: {
      refreshing: false,
      failures: new Set()
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
    printingCache: new Map(),
    lookupMode: "name",
    nameResults: [],
    nameSearchId: 0,
    nameSearchController: null,
    printingController: null,
    refreshingPrices: false,
    storage: {
      mode: "browser",
      supported: typeof window.showDirectoryPicker === "function",
      directoryHandle: null,
      directoryName: "",
      rememberedDirectoryName: "",
      writeQueue: Promise.resolve()
    }
  };

  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

  const elements = {
    statsGrid: $("#statsGrid"), cardGrid: $("#cardGrid"), resultCount: $("#resultCount"),
    emptyState: $("#emptyState"), searchInput: $("#searchInput"), typeFilter: $("#typeFilter"), finishFilter: $("#finishFilter"), japanPrintFilter: $("#japanPrintFilter"),
    collectionView: $("#collectionView"), analyticsView: $("#analyticsView"),
    addCardDialog: $("#addCardDialog"), importDialog: $("#importDialog"), editCubeDialog: $("#editCubeDialog"),
    toastRegion: $("#toastRegion"), cardNameInput: $("#cardNameInput"), lookupButton: $("#lookupButton"),
    setCodeInput: $("#setCodeInput"), collectorNumberInput: $("#collectorNumberInput"),
    printingDialog: $("#printingDialog"), printingSearchInput: $("#printingSearchInput"),
    printingStatus: $("#printingStatus"), printingGrid: $("#printingGrid"), printingCount: $("#printingCount"), printingFinishToggle: $("#printingFinishToggle"),
    importText: $("#importText"), importStatus: $("#importStatus"), startImportBtn: $("#startImportBtn"),
    textPreview: $("#textPreview"), textSummary: $("#textSummary"), textPreviewBody: $("#textPreviewBody"),
    excelFileInput: $("#excelFileInput"), excelFileName: $("#excelFileName"), excelPreview: $("#excelPreview"),
    excelSummary: $("#excelSummary"), excelPreviewBody: $("#excelPreviewBody"), excelDropZone: $("#excelDropZone"),
    lookupResult: $("#lookupResult"), backupFileInput: $("#backupFileInput"),
    connectFolderBtn: $("#connectFolderBtn"), reloadFolderBtn: $("#reloadFolderBtn"), disconnectFolderBtn: $("#disconnectFolderBtn"),
    storageStatusLabel: $("#storageStatusLabel"), storageStatusDetail: $("#storageStatusDetail"),
    nameLanguageToggle: $("#nameLanguageToggle")
  };

  function loadNameLanguage() {
    try {
      return localStorage.getItem(NAME_LANGUAGE_KEY) === "zh" ? "zh" : "en";
    } catch (error) {
      return "en";
    }
  }

  function saveNameLanguage(language) {
    try {
      localStorage.setItem(NAME_LANGUAGE_KEY, language === "zh" ? "zh" : "en");
    } catch (error) {
      // Display preference is optional; the Cube data itself still works.
    }
  }

  function normalizeStoredCards(cards) {
    return sortCards(cards.map((card) => ({
      ...card,
      oracleId: getOracleId(card),
      localizedNames: normalizeLocalizedNames(card),
      frontColors: getFrontColors(card),
      frontTypeLine: getFrontTypeLine(card),
      finishes: getAvailableFinishes(card),
      finish: chooseValidFinish(card, card.finish),
      JapanPrint: card.JapanPrint === true
    })));
  }

  function loadState() {
    return cubeStorage.load(defaultState);
  }

  function snapshotCubeData(data) {
    if (typeof structuredClone === "function") return structuredClone(data);
    return JSON.parse(JSON.stringify(data));
  }

  function applyCubeData(data) {
    state.data = {
      meta: { ...(data.meta || defaultState.meta) },
      notes: typeof data.notes === "string" ? data.notes : "",
      cards: normalizeStoredCards(data.cards || [])
    };
    if (!state.data.meta.name) state.data.meta.name = defaultState.meta.name;
    if (typeof state.data.meta.description !== "string") state.data.meta.description = defaultState.meta.description;
  }

  function localMirrorSave() {
    cubeStorage.save(state.data);
  }

  async function queryDirectoryPermission(directoryHandle, mode = "readwrite") {
    if (!directoryHandle || typeof directoryHandle.queryPermission !== "function") return "granted";
    return directoryHandle.queryPermission({ mode });
  }

  async function requestDirectoryPermission(directoryHandle, mode = "readwrite") {
    const current = await queryDirectoryPermission(directoryHandle, mode);
    if (current === "granted") return true;
    if (typeof directoryHandle.requestPermission !== "function") return false;
    return (await directoryHandle.requestPermission({ mode })) === "granted";
  }

  function isMissingEntryError(error) {
    return error && (error.name === "NotFoundError" || error.code === 8);
  }

  async function getCubeFileHandle(directoryHandle, create = false) {
    return directoryHandle.getFileHandle(CUBE_FILE_NAME, { create });
  }

  async function readCubeDataFile(directoryHandle) {
    try {
      const fileHandle = await getCubeFileHandle(directoryHandle, false);
      const file = await fileHandle.getFile();
      const text = await file.text();
      if (!text.trim()) return null;
      return window.CubeStorage.parseWorkspaceData(text);
    } catch (error) {
      if (isMissingEntryError(error)) return null;
      if (error instanceof SyntaxError) throw new Error("cube-data.json 不是有效的 JSON");
      throw error;
    }
  }

  async function writeCubeDataFile(directoryHandle, data) {
    const fileHandle = await getCubeFileHandle(directoryHandle, true);
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(window.CubeStorage.wrapWorkspaceData(data), null, 2));
    await writable.close();
  }

  function renderStorageStatus() {
    const connectLabel = state.storage.mode === "directory" ? "更换 Cube 文件夹" : "选择 Cube 文件夹";
    if (elements.connectFolderBtn) {
      elements.connectFolderBtn.textContent = connectLabel;
      elements.connectFolderBtn.disabled = !state.storage.supported;
      elements.connectFolderBtn.title = state.storage.supported ? connectLabel : "当前浏览器不支持文件夹写入";
    }
    if (elements.reloadFolderBtn) elements.reloadFolderBtn.classList.toggle("hidden", state.storage.mode !== "directory");
    if (elements.disconnectFolderBtn) elements.disconnectFolderBtn.classList.toggle("hidden", state.storage.mode !== "directory");

    if (!elements.storageStatusLabel || !elements.storageStatusDetail) return;
    if (state.storage.mode === "directory") {
      elements.storageStatusLabel.textContent = "已同步到文件夹";
      elements.storageStatusDetail.textContent = `${state.storage.directoryName}/${CUBE_FILE_NAME}`;
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
    state.storage.mode = "browser";
    state.storage.directoryHandle = null;
    state.storage.directoryName = "";
    state.storage.rememberedDirectoryName = "";
    try {
      await cubeHandleStore.clear(DIRECTORY_HANDLE_KEY);
    } catch (error) {
      // Best-effort cleanup.
    }
    renderStorageStatus();
    if (message) toast("文件夹已断开", message);
  }

  async function queueDirectorySave(snapshot) {
    state.storage.writeQueue = state.storage.writeQueue
      .catch(() => {})
      .then(() => writeCubeDataFile(state.storage.directoryHandle, snapshot))
      .catch(async () => {
        await disconnectDirectoryMode("文件夹写入失败，后续会继续保存在浏览器");
      });
    return state.storage.writeQueue;
  }

  function saveState() {
    try {
      localMirrorSave();
    } catch (error) {
      toast("保存失败", "浏览器存储空间可能不足", true);
    }
    if (state.storage.mode === "directory" && state.storage.directoryHandle) queueDirectorySave(snapshotCubeData(state.data));
  }

  async function reloadFromDirectory() {
    if (!state.storage.directoryHandle) return;
    if (!window.confirm(`从 ${state.storage.directoryName}/${CUBE_FILE_NAME} 重新载入会覆盖当前 Cube，是否继续？`)) return;
    try {
      if (!await requestDirectoryPermission(state.storage.directoryHandle, "readwrite")) {
        toast("无法读取文件夹", "请重新授权这个 Cube 文件夹", true);
        return;
      }
      const fileData = await readCubeDataFile(state.storage.directoryHandle);
      if (!fileData) {
        toast("没有找到数据文件", `${state.storage.directoryName} 里还没有 ${CUBE_FILE_NAME}`, true);
        return;
      }
      applyCubeData(fileData);
      localMirrorSave();
      render();
      renderStorageStatus();
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
      const directoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      if (!await requestDirectoryPermission(directoryHandle, "readwrite")) {
        toast("没有获得权限", "需要允许读写该文件夹才能自动保存", true);
        return;
      }
      const fileData = await readCubeDataFile(directoryHandle);
      if (fileData) {
        const shouldLoad = window.confirm(`发现现有的 ${CUBE_FILE_NAME}。\n确定要载入文件里的 Cube 吗？\n选择“取消”会用当前牌表覆盖文件内容。`);
        if (shouldLoad) applyCubeData(fileData);
        else await writeCubeDataFile(directoryHandle, snapshotCubeData(state.data));
      } else {
        await writeCubeDataFile(directoryHandle, snapshotCubeData(state.data));
      }
      state.storage.mode = "directory";
      state.storage.directoryHandle = directoryHandle;
      state.storage.directoryName = directoryHandle.name || "";
      state.storage.rememberedDirectoryName = directoryHandle.name || "";
      await cubeHandleStore.save(DIRECTORY_HANDLE_KEY, directoryHandle).catch(() => false);
      localMirrorSave();
      render();
      renderStorageStatus();
      toast("已连接文件夹", `后续修改会自动写入 ${state.storage.directoryName}/${CUBE_FILE_NAME}`);
    } catch (error) {
      if (error && error.name === "AbortError") return;
      toast("连接失败", error.message || "无法连接 Cube 文件夹", true);
    }
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
      if (await queryDirectoryPermission(directoryHandle, "readwrite") !== "granted") {
        renderStorageStatus();
        return;
      }
      const fileData = await readCubeDataFile(directoryHandle);
      state.storage.mode = "directory";
      state.storage.directoryHandle = directoryHandle;
      state.storage.directoryName = directoryHandle.name || "";
      if (fileData) {
        applyCubeData(fileData);
        localMirrorSave();
      }
      render();
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
    return getFrontDisplayName(name);
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
    saveNameLanguage(nextLanguage);
    renderNameLanguageToggle();
    renderCards();
  }

  function missingLocalizedNameCards(cards) {
    const seen = new Set();
    return cards.filter((card) => {
      if (getPreferredLocalizedName(card)) return false;
      const oracleId = getOracleId(card);
      if (!oracleId || state.nameLocalization.failures.has(oracleId) || seen.has(oracleId)) return false;
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
    state.data.cards.forEach((card) => {
      if (getOracleId(card) !== oracleId) return;
      const names = normalizeLocalizedNames(card);
      if (names[lang] === name) return;
      card.localizedNames = { ...names, [lang]: name };
      updateCardNameNode(card);
      updated = true;
    });
    return updated;
  }

  async function lookupLocalizedName(oracleId) {
    for (const lang of ["zhs", "zht"]) {
      let url = buildLocalizedNameSearchUrl(oracleId, lang);
      while (url) {
        let page;
        try {
          page = await scryfallRequest(url);
        } catch (error) {
          if (error.status === 404) break;
          throw error;
        }
        const match = (page.data || []).find((printing) => getOracleId(printing) === oracleId && isPaperPrinting(printing) && normalizeLocalizedNames(printing)[lang]);
        if (match) return { lang, name: normalizeLocalizedNames(match)[lang] };
        url = page.has_more ? page.next_page : null;
      }
    }
    return null;
  }

  async function refreshMissingLocalizedNames(cards) {
    if (state.nameLanguage !== "zh" || state.nameLocalization.refreshing) return;
    state.nameLocalization.refreshing = true;
    renderNameLanguageToggle();
    let changedSinceSave = 0;
    try {
      while (state.nameLanguage === "zh") {
        const target = missingLocalizedNameCards(cards)[0];
        if (!target) break;
        const oracleId = getOracleId(target);
        try {
          const localized = await lookupLocalizedName(oracleId);
          if (!localized) {
            state.nameLocalization.failures.add(oracleId);
            continue;
          }
          if (applyLocalizedName(oracleId, localized.lang, localized.name)) changedSinceSave += 1;
          if (changedSinceSave >= 20) {
            saveState();
            changedSinceSave = 0;
          }
        } catch (error) {
          state.nameLocalization.failures.add(oracleId);
          break;
        }
      }
    } finally {
      if (changedSinceSave) saveState();
      state.nameLocalization.refreshing = false;
      renderNameLanguageToggle();
    }
  }

  function render() {
    renderMeta();
    renderStats();
    renderNameLanguageToggle();
    renderCards();
    if (state.view === "analytics") renderAnalytics();
  }

  function renderMeta() {
    $("#cubeTitle").textContent = state.data.meta.name;
    $("#sidebarCubeName").textContent = state.data.meta.name;
    $("#cubeDescription").textContent = state.data.meta.description;
    $("#sidebarCubeCount").textContent = state.data.cards.length;
  }

  function renderStats() {
    const stats = computeStats(state.data.cards);
    const priceInfo = priceStatus(state.data.cards);
    const priceAction = `<button type="button" class="stat-action icon-only${state.refreshingPrices ? " loading" : ""}" data-refresh-prices ${state.refreshingPrices ? "disabled" : ""} aria-label="${state.refreshingPrices ? "正在更新价格" : "手动更新价格"}" title="${state.refreshingPrices ? "正在更新价格" : "手动更新价格"}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 1-2.35-5.65"/><path d="M20 4v7h-7"/></svg>
    </button>`;
    const cards = [
      ["总牌数", stats.total, "张", "当前 Cube 规模", "cards"],
      ["平均费用", stats.averageCmc.toFixed(2), "CMC", "地牌不计入", "curve"],
      ["生物", stats.creatures, "张", `${percent(stats.creatures, stats.total)}% 的牌表`, "creature"],
      ["地牌", stats.lands, "张", `${percent(stats.lands, stats.total)}% 的牌表`, "land"],
      ["总价", formatUsd(cubeValue(state.data.cards)), "USD", priceInfo, "cards", priceAction]
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

  function cubeValue(cards) {
    return cards.reduce((sum, card) => {
      const price = getPriceNumber(card, card.finish);
      return sum + (price || 0);
    }, 0);
  }

  function priceStatus(cards) {
    const missing = cards.filter((card) => getPriceNumber(card, card.finish) === null).length;
    const timestamps = cards.map((card) => Date.parse(card.priceUpdatedAt || "")).filter(Number.isFinite);
    const updated = timestamps.length ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(Math.max(...timestamps)) : "尚未更新";
    return `最近更新 ${updated}${missing ? ` · 缺价 ${missing} 张` : ""}`;
  }

  function renderCards() {
    const cards = sortCards(filterCards(state.data.cards, state.filters));
    elements.resultCount.textContent = cards.length;
    elements.emptyState.classList.toggle("hidden", cards.length > 0);
    elements.cardGrid.classList.toggle("hidden", cards.length === 0);
    elements.cardGrid.classList.toggle("list-mode", state.mode === "list");
    const groups = cards.reduce((result, card) => {
      const key = cardGroupKey(card);
      if (!result.has(key)) result.set(key, []);
      result.get(key).push(card);
      return result;
    }, new Map());
    elements.cardGrid.innerHTML = [...groups.entries()].map(([key, groupCards]) => `
      <section class="card-group" data-card-group="${key}">
        <div class="card-group-heading"><span class="card-group-mark"></span><h2>${cardGroupLabel(key)}</h2><small>${groupCards.length} 张</small></div>
        <div class="card-group-grid">${groupCards.map((card, index) => cardTemplate(card, index)).join("")}</div>
      </section>`).join("");
    $$(".card-image", elements.cardGrid).forEach((image) => image.addEventListener("error", () => image.classList.add("hidden"), { once: true }));
    if (state.nameLanguage === "zh") refreshMissingLocalizedNames(cards);

    const labels = [];
    if (state.filters.color !== "all") labels.push(`颜色：${colorLabel(state.filters.color)}`);
    if (state.filters.type !== "all") labels.push(`类型：${typeLabel(state.filters.type)}`);
    if (state.filters.finish !== "all") labels.push(`Finish：${state.filters.finish === "foil" ? "仅 Foil" : "仅 Non-Foil"}`);
    if (state.filters.japanPrint !== "all") labels.push(`日印：${state.filters.japanPrint === "japan" ? "日印" : "非日印"}`);
    if (state.filters.query) labels.push(`搜索：“${state.filters.query}”`);
    $("#activeFilterText").textContent = labels.join(" · ") || "按颜色与类型整理";
  }

  function cardGroupKey(card) {
    return getCardBucket(card);
  }

  function cardGroupLabel(key) {
    return ({ W: "白色", U: "蓝色", B: "黑色", R: "红色", G: "绿色", C: "无色", M: "多色", L: "地牌" })[key] || "其他";
  }

  function cardTemplate(card, index) {
    const cost = (card.manaCost || "").replace(/[{}]/g, "").replace(/(?=\D)/g, " ").trim();
    const finish = normalizeFinish(card.finish);
    const availableFinishes = getAvailableFinishes(card);
    const finishDisabled = availableFinishes.length < 2;
    const price = formatUsd(cardPrice(card));
    const displayName = cardDisplayName(card);
    const japanPrint = card.JapanPrint === true;
    return `<article class="card-item" data-id="${escapeHtml(card.id)}" data-finish="${finish}" style="animation-delay:${Math.min(index * 18, 220)}ms">
      <div class="card-image-wrap">
        <div class="card-fallback"><span class="fallback-name">${escapeHtml(displayName)}</span><span class="fallback-type">${escapeHtml(card.typeLine)}</span></div>
        ${card.image ? `<img class="card-image" src="${escapeHtml(card.image)}" alt="${escapeHtml(displayName)}" loading="lazy" />` : ""}
      </div>
      <div class="card-info">
        <div class="card-name-row"><button class="japan-print-toggle${japanPrint ? " active" : ""}" data-toggle-japan-print="${escapeHtml(card.id)}" title="${japanPrint ? "取消日印标记" : "标记为日印"}" aria-label="${japanPrint ? `取消 ${escapeHtml(displayName)} 的日印标记` : `标记 ${escapeHtml(displayName)} 为日印`}" aria-pressed="${japanPrint ? "true" : "false"}"><span></span></button><span class="card-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span><span class="card-cost">${escapeHtml(cost)}</span></div>
        <div class="card-meta"><span>${escapeHtml(card.typeLine.split(" — ")[0])}</span><button class="finish-pill ${finish}" data-toggle-finish="${escapeHtml(card.id)}" ${finishDisabled ? "disabled" : ""} title="${finishDisabled ? `此版本仅支持 ${finish === "foil" ? "Foil" : "Non-Foil"}` : `切换 ${escapeHtml(displayName)} 的 Foil 状态`}">${finish === "foil" ? "Foil" : "Non-Foil"}</button></div>
        <div class="card-meta"><span>${escapeHtml(card.set)}${card.collectorNumber ? ` · ${escapeHtml(card.collectorNumber)}` : ""} · <span class="card-price">${escapeHtml(price)}</span></span><button class="printing-button" data-change-printing="${escapeHtml(card.id)}" title="选择 ${escapeHtml(displayName)} 的其他版本">选择版本</button></div>
      </div>
      <button class="remove-card" data-remove="${escapeHtml(card.id)}" title="从 Cube 移除" aria-label="移除 ${escapeHtml(displayName)}">−</button>
    </article>`;
  }

  function renderAnalytics() {
    const stats = computeStats(state.data.cards);
    const colorNames = { W: "白色", U: "蓝色", B: "黑色", R: "红色", G: "绿色", C: "无色", M: "多色" };
    const maxColor = Math.max(1, ...Object.values(stats.colors));
    $("#colorAnalysis").innerHTML = Object.entries(stats.colors).map(([key, value]) => `
      <div class="color-row"><span class="color-name">${colorNames[key]}</span><div class="analysis-track"><div class="analysis-fill" style="width:${value / maxColor * 100}%"></div></div><span class="analysis-value">${value}</span></div>`).join("");

    const maxCurve = Math.max(1, ...Object.values(stats.curve));
    $("#manaChart").innerHTML = Object.entries(stats.curve).map(([key, value]) => `
      <div class="curve-column"><span class="curve-value">${value}</span><div class="curve-bar" style="height:${value / maxCurve * 155}px"></div><span class="curve-label">${key}</span></div>`).join("");

    const typeNames = { Creature: "生物", Instant: "瞬间", Sorcery: "法术", Artifact: "神器", Enchantment: "结界", Planeswalker: "鹏洛客", Land: "地", Other: "其他" };
    const typeEntries = Object.entries(stats.types).sort((a, b) => b[1] - a[1]);
    const maxType = Math.max(1, ...typeEntries.map(([, count]) => count));
    $("#typeAnalysis").innerHTML = typeEntries.map(([key, value]) => `
      <div class="type-row"><span class="type-name">${typeNames[key] || key}</span><div class="analysis-track"><div class="analysis-fill" style="width:${value / maxType * 100}%"></div></div><span class="analysis-value">${value}</span></div>`).join("");
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

  async function lookupCard(name, signal) {
    try {
      return await scryfallRequest(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`, { signal });
    } catch (error) {
      if (error.status === 404) throw new Error("没有找到这张牌");
      throw error;
    }
  }

  async function searchCardsByName(name, signal) {
    let url = buildCardNameSearchUrl(name);
    const cards = [];
    while (url) {
      let page;
      try {
        page = await scryfallRequest(url, { signal });
      } catch (error) {
        if (error.status === 404) return [];
        throw error;
      }
      cards.push(...(page.data || []).filter(isPaperPrinting));
      url = page.has_more ? page.next_page : null;
    }
    return cards;
  }

  async function lookupPrinting(setCode, collectorNumber, signal) {
    const set = setCode.trim().toLowerCase();
    const number = collectorNumber.trim();
    try {
      return await scryfallRequest(`https://api.scryfall.com/cards/${encodeURIComponent(set)}/${encodeURIComponent(number)}`, { signal });
    } catch (error) {
      if (error.status === 404) {
        const notFound = new Error("没有找到这个系列与编号的卡牌");
        notFound.status = 404;
        throw notFound;
      }
      throw error;
    }
  }

  async function lookupCardById(scryfallId, signal) {
    if (!scryfallId) return null;
    try {
      return await scryfallRequest(`https://api.scryfall.com/cards/${encodeURIComponent(scryfallId)}`, { signal });
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async function resolvePrintingIdentity(card, signal) {
    if (card.set && card.collectorNumber) {
      try {
        return await lookupPrinting(card.set, card.collectorNumber, signal);
      } catch (error) {
        if (error.status !== 404) throw error;
      }
    }
    const printing = await lookupCardById(card.scryfallId, signal);
    if (printing) return printing;
    return lookupCard(getLookupName(card.name), signal);
  }

  async function lookupAllPrintings(card, signal) {
    const identity = await resolvePrintingIdentity(card, signal);
    const oracleId = getOracleId(identity);
    if (!oracleId) throw new Error("无法确定这张牌的 Oracle ID，不能加载版本");
    if (card.oracleId !== oracleId) {
      card.oracleId = oracleId;
      saveState();
    }
    if (state.printingCache.has(oracleId)) return filterOraclePrintings(state.printingCache.get(oracleId), oracleId);

    let url = buildPrintingsUrl(oracleId);
    const printings = [];
    const visitedPages = new Set();
    while (url) {
      if (visitedPages.has(url)) throw new Error("Scryfall 返回了重复分页，版本加载已停止");
      visitedPages.add(url);
      const page = await scryfallRequest(url, { signal });
      printings.push(...filterOraclePrintings(page.data || [], oracleId));
      url = page.has_more ? page.next_page : null;
    }
    state.printingCache.set(oracleId, printings);
    return printings;
  }

  async function refreshStalePrices(force = false) {
    if (state.refreshingPrices) return;
    const targets = state.data.cards.filter((card) => force || needsPriceRefresh(card));
    if (!targets.length) return;
    state.refreshingPrices = true;
    renderStats();
    let updated = false;
    try {
      const uniqueTargets = [...new Map(targets.map((card) => [printingKey(card.set, card.collectorNumber), { setCode: card.set, collectorNumber: card.collectorNumber }])).values()];
      const cardsByPrinting = await lookupPrintingBatch(uniqueTargets);
      targets.forEach((target) => {
        const printing = cardsByPrinting.get(printingKey(target.set, target.collectorNumber));
        if (!printing) return;
        const cardIndex = state.data.cards.findIndex((item) => item.id === target.id);
        if (cardIndex < 0) return;
        const current = state.data.cards[cardIndex];
        const samePrinting = current.scryfallId
          ? current.scryfallId === target.scryfallId
          : current.set === target.set && current.collectorNumber === target.collectorNumber;
        if (samePrinting && (force || needsPriceRefresh(current))) {
          state.data.cards[cardIndex] = replacePrinting(current, printing);
          updated = true;
        }
      });
    } catch (error) {
      // Price refresh is best-effort and should not block local use.
      if (force) toast("价格更新失败", "暂时无法连接 Scryfall，请稍后重试", true);
    } finally {
      state.refreshingPrices = false;
    }
    if (updated) {
      state.data.cards = sortCards(state.data.cards);
      saveState();
      render();
      if (force) toast("价格已更新", `已检查 ${targets.length} 张牌的最新价格`);
      return;
    }
    renderStats();
    if (force) toast("价格已是最新", "当前牌表没有新的价格变化");
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
    const prices = printing.prices || {};
    const nonfoil = formatUsd(prices.usd);
    const foil = formatUsd(prices.usd_foil || prices.usd_etched);
    return `Non-Foil ${nonfoil} · Foil ${foil}`;
  }

  function renderPrintingFinishToggle(card) {
    const finish = normalizeFinish(card.finish);
    const available = getAvailableFinishes(card);
    const disabled = available.length < 2;
    elements.printingFinishToggle.innerHTML = `
      <button type="button" class="finish-toggle-button ${finish}" data-toggle-finish="${escapeHtml(card.id)}" ${disabled ? "disabled" : ""} title="${disabled ? `此版本仅支持 ${finish === "foil" ? "Foil" : "Non-Foil"}` : "切换 Finish"}">
        <span>Finish</span>
        <strong>${finish === "foil" ? "Foil" : "Non-Foil"}</strong>
      </button>`;
  }

  function renderPrintings() {
    const card = state.data.cards.find((item) => item.id === state.editingCardId);
    if (!card) return;
    renderPrintingFinishToggle(card);
    const filtered = filterPrintings(state.printings, elements.printingSearchInput.value);
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
        <span class="printing-option-info"><strong title="${escapeHtml(printing.set_name)}">${escapeHtml(printing.set_name)}</strong><span>${escapeHtml(printing.set.toUpperCase())} · ${escapeHtml(printing.collector_number)}</span><small>${escapeHtml(printing.released_at || "日期未知")} · ${escapeHtml(printing.lang.toUpperCase())}</small><small class="printing-price">${escapeHtml(printingPriceSummary(printing))}</small></span>
      </button>`;
    }).join("");
  }

  async function openPrintingDialog(cardId) {
    const card = state.data.cards.find((item) => item.id === cardId);
    if (!card) return;
    if (state.printingController) state.printingController.abort();
    state.printingController = new AbortController();
    const requestId = ++printingRequestId;
    state.editingCardId = cardId;
    state.printings = [];
    elements.printingSearchInput.value = "";
    elements.printingGrid.innerHTML = "";
    elements.printingGrid.classList.add("hidden");
    elements.printingStatus.classList.remove("hidden", "error");
    elements.printingStatus.textContent = "正在获取可用版本…";
    elements.printingCount.textContent = "0 个版本";
    $("#printingDialogTitle").textContent = `${cardDisplayName(card)} · 选择版本`;
    elements.printingDialog.showModal();
    try {
      const printings = await lookupAllPrintings(card, state.printingController.signal);
      if (requestId !== printingRequestId || state.editingCardId !== cardId || !elements.printingDialog.open) return;
      state.printings = printings;
      renderPrintings();
    } catch (error) {
      if (requestId !== printingRequestId || state.editingCardId !== cardId || !elements.printingDialog.open) return;
      elements.printingStatus.classList.add("error");
      elements.printingStatus.textContent = error.message || "版本加载失败，请稍后重试";
    }
  }

  function selectPrinting(scryfallId) {
    const cardIndex = state.data.cards.findIndex((item) => item.id === state.editingCardId);
    const printing = state.printings.find((item) => item.id === scryfallId);
    if (cardIndex < 0 || !printing) return;
    const current = state.data.cards[cardIndex];
    state.data.cards[cardIndex] = replacePrinting(current, printing);
    saveState();
    render();
    elements.printingDialog.close();
    toast("版本已更新", `${printing.set.toUpperCase()} · ${printing.collector_number}`);
  }

  function toggleCardFinish(cardId) {
    const cardIndex = state.data.cards.findIndex((item) => item.id === cardId);
    if (cardIndex < 0) return;
    const current = state.data.cards[cardIndex];
    const available = getAvailableFinishes(current);
    if (available.length < 2) {
      toast("无法切换", `此版本仅支持 ${available[0] === "foil" ? "Foil" : "Non-Foil"}`, true);
      return;
    }
    current.finish = normalizeFinish(current.finish) === "foil" ? "nonfoil" : "foil";
    state.data.cards[cardIndex] = current;
    saveState();
    render();
    if (state.editingCardId === cardId && elements.printingDialog.open) {
      const card = state.data.cards[cardIndex];
      renderPrintingFinishToggle(card);
    }
    toast("Finish 已更新", current.finish === "foil" ? "Foil" : "Non-Foil");
  }

  function toggleJapanPrint(cardId) {
    const cardIndex = state.data.cards.findIndex((item) => item.id === cardId);
    if (cardIndex < 0) return;
    const current = state.data.cards[cardIndex];
    current.JapanPrint = current.JapanPrint !== true;
    state.data.cards[cardIndex] = current;
    saveState();
    renderCards();
    toast("日印状态已更新", current.JapanPrint ? "已标记为日印" : "已标记为非日印");
  }

  function clearNameResults() {
    if (state.nameSearchController) state.nameSearchController.abort();
    state.nameSearchController = null;
    state.nameSearchId += 1;
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
    state.data.cards.unshift(card);
    state.data.cards = sortCards(state.data.cards);
    saveState();
    render();
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
    addCard(card);
    elements.addCardDialog.close();
    elements.cardNameInput.value = "";
    clearNameResults();
    toast("已添加", card.name);
  }

  async function handleAddCard(event) {
    event.preventDefault();
    const isNameLookup = state.lookupMode !== "printing";
    const name = elements.cardNameInput.value.trim();
    const setCode = elements.setCodeInput.value.trim();
    const collectorNumber = elements.collectorNumberInput.value.trim();
    if (isNameLookup ? !name : (!setCode || !collectorNumber)) return;
    elements.lookupButton.disabled = true;
    elements.lookupButton.textContent = "正在查找…";
    try {
      if (isNameLookup) {
        if (state.nameSearchController) state.nameSearchController.abort();
        state.nameSearchController = new AbortController();
        const searchId = ++state.nameSearchId;
        elements.lookupResult.classList.remove("hidden");
        elements.lookupResult.innerHTML = '<div class="name-result-empty">正在搜索实体卡牌…</div>';
        const results = await searchCardsByName(name, state.nameSearchController.signal);
        if (searchId !== state.nameSearchId) return;
        state.nameResults = results;
        renderNameResults();
        return;
      }
      const result = await lookupPrinting(setCode, collectorNumber);
      const card = normalizeScryfallCard(result);
      addCard(card);
      elements.addCardDialog.close();
      elements.cardNameInput.value = "";
      elements.setCodeInput.value = "";
      elements.collectorNumberInput.value = "";
      toast("已添加", card.name);
    } catch (error) {
      if (error.name === "AbortError") return;
      toast("添加失败", error.message || "请检查网络后重试", true);
    } finally {
      elements.lookupButton.disabled = false;
      elements.lookupButton.innerHTML = isNameLookup ? "搜索卡牌" : "<span>+</span> 查找并添加";
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

  function loadSheetJs() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (sheetJsLoader) return sheetJsLoader;
    sheetJsLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SHEETJS_URL;
      script.onload = () => resolve(window.XLSX);
      script.onerror = () => reject(new Error("Excel 解析组件加载失败，请检查网络后重试"));
      document.head.append(script);
    });
    return sheetJsLoader;
  }

  async function readExcelRows(file) {
    const XLSX = await loadSheetJs();
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) throw new Error("Excel 文件没有工作表");
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { header: 1, defval: "", raw: false, blankrows: false });
    return parseExcelRows(rows);
  }

  function normalizeCollectorNumber(value) {
    return String(value || "").trim().toLocaleLowerCase().replace(/^0+(?=\d)/, "");
  }

  function printingKey(setCode, collectorNumber) {
    return `${String(setCode || "").trim().toLocaleLowerCase()}/${normalizeCollectorNumber(collectorNumber)}`;
  }

  async function lookupPrintingBatch(rows) {
    const results = new Map();
    if (!rows.length) return results;
    for (let start = 0; start < rows.length; start += 75) {
      const chunk = rows.slice(start, start + 75);
      const payload = await scryfallRequest("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: chunk.map((row) => ({ set: row.setCode.toLowerCase(), collector_number: row.collectorNumber })) })
      });
      (payload.data || []).forEach((card) => results.set(printingKey(card.set, card.collector_number), card));
    }
    return results;
  }

  async function lookupCardNameBatch(names) {
    const results = new Map();
    for (let start = 0; start < names.length; start += 75) {
      const chunk = names.slice(start, start + 75);
      const payload = await scryfallRequest("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: chunk.map((name) => ({ name })) })
      });
      (payload.data || []).forEach((card) => {
        const faces = (card.card_faces || []).map((face) => face.name);
        [card.name, card.printed_name, ...faces].filter(Boolean).forEach((name) => results.set(normalizeCardName(name), card));
      });
    }
    return results;
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
      const cardsByPrinting = await lookupPrintingBatch(candidates);
      candidates.forEach((row) => {
        row.card = cardsByPrinting.get(printingKey(row.setCode, row.collectorNumber)) || null;
        if (!row.card) {
          row.status = "notFound";
          row.message = "Scryfall 中没有这个系列与编号";
          return;
        }
        const acceptedNames = [row.card.name, row.card.printed_name].filter(Boolean).map(normalizeCardName);
        if (acceptedNames.includes(normalizeCardName(row.expectedName))) {
          row.importable = true;
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
    saveState();
    render();
    elements.importDialog.close();
    toast("Excel 导入完成", `已添加 ${rows.length} 张核验通过的卡牌`);
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
      const cardsByName = await lookupCardNameBatch(candidates.map((row) => row.expectedName));
      const existingOracleIds = new Set(state.data.cards.map((card) => card.oracleId).filter(Boolean));
      candidates.forEach((row) => {
        row.card = cardsByName.get(normalizeCardName(row.expectedName)) || null;
        if (!row.card) {
          row.status = "notFound";
          row.message = "Scryfall 中没有精确匹配的实体卡牌";
        } else if (row.card.oracle_id && existingOracleIds.has(row.card.oracle_id)) {
          row.status = "existing";
          row.message = "当前 Cube 已包含这张牌的其他版本";
        } else {
          row.importable = true;
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
    saveState();
    render();
    elements.importDialog.close();
    toast("文本导入完成", `已添加 ${rows.length} 张核验通过的卡牌`);
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
      const worksheet = XLSX.utils.aoa_to_sheet(buildExcelRows(state.data.cards));
      worksheet["!cols"] = [{ wch: 10 }, { wch: 12 }, { wch: 34 }, { wch: 14 }, { wch: 12 }, { wch: 8 }];
      worksheet["!autofilter"] = { ref: `A1:F${state.data.cards.length + 1}` };
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Cube 牌表");
      const fileName = `${state.data.meta.name.replace(/[\\/:*?"<>|]/g, "-") || "Cube牌表"}.xlsx`;
      XLSX.writeFile(workbook, fileName, { compression: true });
      toast("已导出", `Excel 表格包含 ${state.data.cards.length} 张牌`);
    } catch (error) {
      toast("导出失败", error.message || "Excel 组件加载失败，请稍后重试", true);
    }
  }

  function downloadJsonBackup() {
    const payload = JSON.stringify(buildBackup(state.data), null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${state.data.meta.name.replace(/[\\/:*?"<>|]/g, "-") || "Cube备份"}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("备份完成", "完整 JSON 备份已生成");
  }

  async function restoreJsonBackup(file) {
    if (!file) return;
    try {
      const restored = parseBackup(await file.text());
      if (!window.confirm(`恢复“${restored.meta.name}”将覆盖当前 Cube，是否继续？`)) return;
      state.data = {
        meta: { ...restored.meta },
        notes: typeof restored.notes === "string" ? restored.notes : "",
        cards: normalizeStoredCards(restored.cards)
      };
      saveState();
      clearFilters();
      render();
      toast("恢复完成", `已恢复 ${state.data.cards.length} 张牌`);
    } catch (error) {
      toast("恢复失败", error.message || "无法读取这个备份文件", true);
    } finally {
      elements.backupFileInput.value = "";
    }
  }

  function removeCard(id) {
    const index = state.data.cards.findIndex((card) => card.id === id);
    if (index < 0) return;
    const [removed] = state.data.cards.splice(index, 1);
    saveState();
    render();
    toast("已移除", removed.name, false, {
      label: "撤销",
      run: () => {
        if (state.data.cards.some((card) => card.id === removed.id)) return;
        state.data.cards.push(removed);
        state.data.cards = sortCards(state.data.cards);
        saveState();
        render();
        toast("已恢复", removed.name);
      }
    });
  }

  function setView(view) {
    state.view = view;
    elements.collectionView.classList.toggle("hidden", view !== "collection");
    elements.analyticsView.classList.toggle("hidden", view !== "analytics");
    $$(".nav-item").forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (view === "analytics") renderAnalytics();
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

  function clearFilters() {
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
    renderCards();
  }

  function bindEvents() {
    elements.statsGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-refresh-prices]");
      if (button) refreshStalePrices(true);
    });
    $("#addCardBtn").addEventListener("click", () => { elements.addCardDialog.showModal(); setTimeout(() => (state.lookupMode === "printing" ? elements.setCodeInput : elements.cardNameInput).focus(), 20); });
    $("#addCardForm").addEventListener("submit", handleAddCard);
    elements.cardNameInput.addEventListener("input", clearNameResults);
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
    $("#restoreBtn").addEventListener("click", () => elements.backupFileInput.click());
    elements.backupFileInput.addEventListener("change", (event) => restoreJsonBackup(event.target.files[0]));
    elements.connectFolderBtn.addEventListener("click", connectCubeFolder);
    elements.reloadFolderBtn.addEventListener("click", reloadFromDirectory);
    elements.disconnectFolderBtn.addEventListener("click", () => disconnectDirectoryMode());
    $("#clearFiltersBtn").addEventListener("click", clearFilters);
    $("#newCubeBtn").addEventListener("click", () => toast("即将支持", "多 Cube 管理已列入下一版"));

    $$(".nav-item").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
    elements.searchInput.addEventListener("input", (event) => { state.filters.query = event.target.value; renderCards(); });
    elements.typeFilter.addEventListener("change", (event) => { state.filters.type = event.target.value; renderCards(); });
    elements.finishFilter.addEventListener("change", (event) => { state.filters.finish = event.target.value; renderCards(); });
    elements.japanPrintFilter.addEventListener("change", (event) => { state.filters.japanPrint = event.target.value; renderCards(); });
    $$("[data-color]").forEach((button) => button.addEventListener("click", () => {
      state.filters.color = button.dataset.color;
      $$("[data-color]").forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      renderCards();
    }));
    $$("[data-mode]").forEach((button) => button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      $$("[data-mode]").forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      renderCards();
    }));
    $$("[data-name-language]").forEach((button) => button.addEventListener("click", () => setNameLanguage(button.dataset.nameLanguage)));
    elements.cardGrid.addEventListener("click", (event) => {
      const japanPrintButton = event.target.closest("[data-toggle-japan-print]");
      if (japanPrintButton) {
        toggleJapanPrint(japanPrintButton.dataset.toggleJapanPrint);
        return;
      }
      const finishButton = event.target.closest("[data-toggle-finish]");
      if (finishButton) {
        toggleCardFinish(finishButton.dataset.toggleFinish);
        return;
      }
      const button = event.target.closest("[data-remove]");
      if (button) {
        removeCard(button.dataset.remove);
        return;
      }
      const printingButton = event.target.closest("[data-change-printing]");
      if (printingButton) openPrintingDialog(printingButton.dataset.changePrinting);
    });
    elements.printingSearchInput.addEventListener("input", renderPrintings);
    elements.printingFinishToggle.addEventListener("click", (event) => {
      const button = event.target.closest("[data-toggle-finish]");
      if (button) toggleCardFinish(button.dataset.toggleFinish);
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
      saveState(); renderMeta(); elements.editCubeDialog.close(); toast("已保存", "Cube 信息已更新");
    });
    $("#cubeNotes").addEventListener("input", (event) => { state.data.notes = event.target.value; saveState(); });
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

  bindEvents();
  render();
  renderStorageStatus();
  restoreDirectoryMode();
  setTimeout(() => refreshStalePrices(), 450);
})();
