(function () {
  "use strict";

  const STORAGE_KEY = "arcana-cube-v1";
  const SHEETJS_URL = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
  const { buildCardNameSearchUrl, buildExcelRows, buildPrintingsUrl, computeStats, filterCards, filterPrintings, sortCards, getCardBucket, getFrontColors, getFrontTypeLine, getPriceNumber, getUsdPrice, isPaperPrinting, normalizeCardName, normalizeFinish, normalizeScryfallCard, parseDecklist, parseExcelRows, replacePrinting } = window.CubeCore;
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
      loaded.cards = sortCards((loaded.cards || []).map((card) => ({
        ...card,
        frontColors: getFrontColors(card),
        frontTypeLine: getFrontTypeLine(card),
        finish: normalizeFinish(card.finish)
      })));
      return loaded;
    })(),
    filters: { query: "", color: "all", type: "all", finish: "all" },
    mode: "grid",
    view: "collection",
    importing: false,
    importMode: "text",
    excelFile: null,
    excelRows: [],
    excelValidated: false,
    editingCardId: null,
    printings: [],
    printingCache: new Map(),
    lookupMode: "name",
    nameResults: [],
    nameSearchId: 0
  };

  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

  const elements = {
    statsGrid: $("#statsGrid"), cardGrid: $("#cardGrid"), resultCount: $("#resultCount"),
    emptyState: $("#emptyState"), searchInput: $("#searchInput"), typeFilter: $("#typeFilter"), finishFilter: $("#finishFilter"),
    collectionView: $("#collectionView"), analyticsView: $("#analyticsView"),
    addCardDialog: $("#addCardDialog"), importDialog: $("#importDialog"), editCubeDialog: $("#editCubeDialog"),
    toastRegion: $("#toastRegion"), cardNameInput: $("#cardNameInput"), lookupButton: $("#lookupButton"),
    setCodeInput: $("#setCodeInput"), collectorNumberInput: $("#collectorNumberInput"),
    printingDialog: $("#printingDialog"), printingSearchInput: $("#printingSearchInput"),
    printingStatus: $("#printingStatus"), printingGrid: $("#printingGrid"), printingCount: $("#printingCount"), printingFinishToggle: $("#printingFinishToggle"),
    importText: $("#importText"), importStatus: $("#importStatus"), startImportBtn: $("#startImportBtn"),
    excelFileInput: $("#excelFileInput"), excelFileName: $("#excelFileName"), excelPreview: $("#excelPreview"),
    excelSummary: $("#excelSummary"), excelPreviewBody: $("#excelPreviewBody"), excelDropZone: $("#excelDropZone"),
    lookupResult: $("#lookupResult")
  };

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.cards) && saved.meta) return saved;
    } catch (error) {
      console.warn("Could not load saved Cube", error);
    }
    return structuredClone(defaultState);
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
    } catch (error) {
      toast("保存失败", "浏览器存储空间可能不足", true);
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  function render() {
    renderMeta();
    renderStats();
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
    const cards = [
      ["总牌数", stats.total, "张", "当前 Cube 规模", "cards"],
      ["平均费用", stats.averageCmc.toFixed(2), "CMC", "地牌不计入", "curve"],
      ["生物", stats.creatures, "张", `${percent(stats.creatures, stats.total)}% 的牌表`, "creature"],
      ["地牌", stats.lands, "张", `${percent(stats.lands, stats.total)}% 的牌表`, "land"],
      ["总价", formatUsd(cubeValue(state.data.cards)), "USD", "按当前 Foil / Non-Foil 状态估算", "cards"]
    ];
    const icons = {
      cards: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6"/>',
      curve: '<path d="M3 18h18M5 16c3-1 4-6 7-6s4 4 7 4"/>',
      creature: '<path d="M8 20v-6l-3-3 3-7 4 4 4-4 3 7-3 3v6Z"/>',
      land: '<path d="M12 21V10M7 15c-3-1-4-4-3-7 4 0 7 2 8 5M17 14c3-1 4-4 3-7-4 0-7 2-8 5"/>'
    };
    elements.statsGrid.innerHTML = cards.map(([label, value, unit, foot, icon]) => `
      <article class="stat-card">
        <div class="stat-label"><span>${label}</span><svg viewBox="0 0 24 24">${icons[icon]}</svg></div>
        <span class="stat-value">${value}<small>${unit}</small></span>
        <div class="stat-foot">${foot}</div>
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

    const labels = [];
    if (state.filters.color !== "all") labels.push(`颜色：${colorLabel(state.filters.color)}`);
    if (state.filters.type !== "all") labels.push(`类型：${typeLabel(state.filters.type)}`);
    if (state.filters.finish !== "all") labels.push(`Finish：${state.filters.finish === "foil" ? "仅 Foil" : "仅 Non-Foil"}`);
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
    const price = formatUsd(cardPrice(card));
    return `<article class="card-item" data-id="${escapeHtml(card.id)}" data-finish="${finish}" style="animation-delay:${Math.min(index * 18, 220)}ms">
      <div class="card-image-wrap">
        <div class="card-fallback"><span class="fallback-name">${escapeHtml(card.name)}</span><span class="fallback-type">${escapeHtml(card.typeLine)}</span></div>
        ${card.image ? `<img class="card-image" src="${escapeHtml(card.image)}" alt="${escapeHtml(card.name)}" loading="lazy" />` : ""}
      </div>
      <div class="card-info">
        <div class="card-name-row"><span class="card-name" title="${escapeHtml(card.name)}">${escapeHtml(card.name)}</span><span class="card-cost">${escapeHtml(cost)}</span></div>
        <div class="card-meta"><span>${escapeHtml(card.typeLine.split(" — ")[0])}</span><button class="finish-pill ${finish}" data-toggle-finish="${escapeHtml(card.id)}" title="切换 ${escapeHtml(card.name)} 的 foil 状态">${finish === "foil" ? "Foil" : "Non-Foil"}</button></div>
        <div class="card-meta"><span>${escapeHtml(card.set)}${card.collectorNumber ? ` · ${escapeHtml(card.collectorNumber)}` : ""} · <span class="card-price">${escapeHtml(price)}</span></span><button class="printing-button" data-change-printing="${escapeHtml(card.id)}" title="选择 ${escapeHtml(card.name)} 的其他版本">选择版本</button></div>
      </div>
      <button class="remove-card" data-remove="${escapeHtml(card.id)}" title="从 Cube 移除" aria-label="移除 ${escapeHtml(card.name)}">−</button>
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

  function toast(title, message, error = false) {
    const node = document.createElement("div");
    node.className = `toast${error ? " error" : ""}`;
    node.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(message)}`;
    elements.toastRegion.append(node);
    setTimeout(() => node.remove(), 3300);
  }

  async function lookupCard(name) {
    const response = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(response.status === 404 ? "没有找到这张牌" : "卡牌服务暂时不可用");
    return response.json();
  }

  async function searchCardsByName(name) {
    let url = buildCardNameSearchUrl(name);
    const cards = [];
    while (url) {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) {
        if (response.status === 404) return [];
        throw new Error("卡牌服务暂时不可用");
      }
      const page = await response.json();
      cards.push(...(page.data || []).filter(isPaperPrinting));
      url = page.has_more ? page.next_page : null;
      if (url) await new Promise((resolve) => setTimeout(resolve, 110));
    }
    return cards;
  }

  async function lookupPrinting(setCode, collectorNumber) {
    const set = setCode.trim().toLowerCase();
    const number = collectorNumber.trim();
    const response = await fetch(`https://api.scryfall.com/cards/${encodeURIComponent(set)}/${encodeURIComponent(number)}`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(response.status === 404 ? "没有找到这个系列与编号的卡牌" : "卡牌服务暂时不可用");
    return response.json();
  }

  function needsPriceHydration(card) {
    const prices = card && card.prices ? card.prices : {};
    return Boolean(card && card.set && card.collectorNumber && !prices.usd && !prices.usdFoil);
  }

  async function lookupAllPrintings(card) {
    let oracleId = card.oracleId;
    if (!oracleId) {
      const identity = await lookupCard(card.name);
      oracleId = identity.oracle_id;
    }
    if (state.printingCache.has(oracleId)) return state.printingCache.get(oracleId).filter(isPaperPrinting);

    let url = buildPrintingsUrl(oracleId);
    const printings = [];
    while (url) {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("无法获取这张牌的版本列表");
      const page = await response.json();
      printings.push(...(page.data || []).filter(isPaperPrinting));
      url = page.has_more ? page.next_page : null;
      if (url) await new Promise((resolve) => setTimeout(resolve, 110));
    }
    state.printingCache.set(oracleId, printings);
    return printings;
  }

  async function hydrateMissingPrices() {
    const targets = state.data.cards.filter(needsPriceHydration);
    if (!targets.length) return;
    let updated = false;
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      try {
        const printing = await lookupPrinting(target.set, target.collectorNumber);
        const cardIndex = state.data.cards.findIndex((item) => item.id === target.id);
        if (cardIndex >= 0) {
          const current = state.data.cards[cardIndex];
          const samePrinting = current.scryfallId
            ? current.scryfallId === target.scryfallId
            : current.set === target.set && current.collectorNumber === target.collectorNumber;
          if (samePrinting && needsPriceHydration(current)) {
            state.data.cards[cardIndex] = replacePrinting(current, printing);
            updated = true;
          }
        }
      } catch (error) {
        // Ignore background price hydration failures.
      }
      if (index < targets.length - 1) await new Promise((resolve) => setTimeout(resolve, 110));
    }
    if (updated) {
      state.data.cards = sortCards(state.data.cards);
      saveState();
      render();
    }
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
    const foil = formatUsd(prices.usd_foil);
    return `Non-Foil ${nonfoil} · Foil ${foil}`;
  }

  function renderPrintingFinishToggle(card) {
    const finish = normalizeFinish(card.finish);
    elements.printingFinishToggle.innerHTML = `
      <button type="button" class="finish-toggle-button ${finish}" data-toggle-finish="${escapeHtml(card.id)}">
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
    const requestId = ++printingRequestId;
    state.editingCardId = cardId;
    state.printings = [];
    elements.printingSearchInput.value = "";
    elements.printingGrid.innerHTML = "";
    elements.printingGrid.classList.add("hidden");
    elements.printingStatus.classList.remove("hidden", "error");
    elements.printingStatus.textContent = "正在获取可用版本…";
    elements.printingCount.textContent = "0 个版本";
    $("#printingDialogTitle").textContent = `${card.name} · 选择版本`;
    elements.printingDialog.showModal();
    try {
      const printings = await lookupAllPrintings(card);
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

  function clearNameResults() {
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
        const searchId = ++state.nameSearchId;
        elements.lookupResult.classList.remove("hidden");
        elements.lookupResult.innerHTML = '<div class="name-result-empty">正在搜索实体卡牌…</div>';
        const results = await searchCardsByName(name);
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
    });
    elements.importStatus.classList.add("hidden");
    if (mode === "text") {
      elements.startImportBtn.disabled = false;
      elements.startImportBtn.textContent = "开始导入";
    } else {
      updateExcelAction();
    }
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
      const response = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: chunk.map((row) => ({ set: row.setCode.toLowerCase(), collector_number: row.collectorNumber })) })
      });
      if (!response.ok) throw new Error("Scryfall 批量核验暂时不可用");
      const payload = await response.json();
      (payload.data || []).forEach((card) => results.set(printingKey(card.set, card.collector_number), card));
      if (start + 75 < rows.length) await new Promise((resolve) => setTimeout(resolve, 110));
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
    rows.forEach((row) => state.data.cards.push(normalizeScryfallCard(row.card)));
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

  async function handleTextImport() {
    if (state.importing) return;
    const names = parseDecklist(elements.importText.value);
    if (!names.length) {
      toast("没有牌名", "请先粘贴牌表", true);
      return;
    }
    state.importing = true;
    elements.startImportBtn.disabled = true;
    elements.importStatus.classList.remove("hidden");
    let success = 0;
    let failed = 0;

    try {
      for (let index = 0; index < names.length; index += 1) {
        elements.importStatus.textContent = `正在获取 ${index + 1} / ${names.length}：${names[index]}`;
        try {
          const result = await lookupCard(names[index]);
          state.data.cards.push(normalizeScryfallCard(result));
          success += 1;
        } catch (error) {
          failed += 1;
        }
        if (index < names.length - 1) await new Promise((resolve) => setTimeout(resolve, 110));
      }
      state.data.cards = sortCards(state.data.cards);
      saveState();
      render();
      elements.importStatus.textContent = `完成：成功 ${success} 张，未找到 ${failed} 张。`;
      toast("导入完成", `添加 ${success} 张牌${failed ? `，${failed} 张未找到` : ""}`);
      if (!failed) setTimeout(() => elements.importDialog.close(), 850);
    } finally {
      state.importing = false;
      elements.startImportBtn.disabled = false;
    }
  }

  async function handleImport(event) {
    event.preventDefault();
    if (state.importMode === "excel") {
      if (state.excelValidated) commitExcelImport();
      else await validateExcelImport();
      return;
    }
    await handleTextImport();
  }

  async function exportData() {
    try {
      const XLSX = await loadSheetJs();
      const worksheet = XLSX.utils.aoa_to_sheet(buildExcelRows(state.data.cards));
      worksheet["!cols"] = [{ wch: 10 }, { wch: 12 }, { wch: 34 }, { wch: 14 }, { wch: 12 }];
      worksheet["!autofilter"] = { ref: `A1:E${state.data.cards.length + 1}` };
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Cube 牌表");
      const fileName = `${state.data.meta.name.replace(/[\\/:*?"<>|]/g, "-") || "Cube牌表"}.xlsx`;
      XLSX.writeFile(workbook, fileName, { compression: true });
      toast("已导出", `Excel 表格包含 ${state.data.cards.length} 张牌`);
    } catch (error) {
      toast("导出失败", error.message || "Excel 组件加载失败，请稍后重试", true);
    }
  }

  function removeCard(id) {
    const index = state.data.cards.findIndex((card) => card.id === id);
    if (index < 0) return;
    const [removed] = state.data.cards.splice(index, 1);
    saveState();
    render();
    toast("已移除", removed.name);
  }

  function setView(view) {
    state.view = view;
    elements.collectionView.classList.toggle("hidden", view !== "collection");
    elements.analyticsView.classList.toggle("hidden", view !== "analytics");
    $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
    if (view === "analytics") renderAnalytics();
    $(".sidebar").classList.remove("open");
  }

  function clearFilters() {
    state.filters = { query: "", color: "all", type: "all", finish: "all" };
    elements.searchInput.value = "";
    elements.typeFilter.value = "all";
    elements.finishFilter.value = "all";
    $$("[data-color]").forEach((button) => button.classList.toggle("active", button.dataset.color === "all"));
    renderCards();
  }

  function bindEvents() {
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
    $$('[data-import-mode]').forEach((button) => button.addEventListener("click", () => setImportMode(button.dataset.importMode)));
    elements.excelFileInput.addEventListener("change", (event) => chooseExcelFile(event.target.files[0]));
    ["dragenter", "dragover"].forEach((type) => elements.excelDropZone.addEventListener(type, (event) => { event.preventDefault(); elements.excelDropZone.classList.add("dragging"); }));
    ["dragleave", "drop"].forEach((type) => elements.excelDropZone.addEventListener(type, (event) => { event.preventDefault(); elements.excelDropZone.classList.remove("dragging"); }));
    elements.excelDropZone.addEventListener("drop", (event) => chooseExcelFile(event.dataTransfer.files[0]));
    $("#exportBtn").addEventListener("click", exportData);
    $("#clearFiltersBtn").addEventListener("click", clearFilters);
    $("#mobileMenu").addEventListener("click", () => $(".sidebar").classList.toggle("open"));
    $("#newCubeBtn").addEventListener("click", () => toast("即将支持", "多 Cube 管理已列入下一版"));

    $$(".nav-item").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
    elements.searchInput.addEventListener("input", (event) => { state.filters.query = event.target.value; renderCards(); });
    elements.typeFilter.addEventListener("change", (event) => { state.filters.type = event.target.value; renderCards(); });
    elements.finishFilter.addEventListener("change", (event) => { state.filters.finish = event.target.value; renderCards(); });
    $$("[data-color]").forEach((button) => button.addEventListener("click", () => {
      state.filters.color = button.dataset.color;
      $$("[data-color]").forEach((item) => item.classList.toggle("active", item === button));
      renderCards();
    }));
    $$("[data-mode]").forEach((button) => button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      $$("[data-mode]").forEach((item) => item.classList.toggle("active", item === button));
      renderCards();
    }));
    elements.cardGrid.addEventListener("click", (event) => {
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
          return;
        }
        $(".sidebar").classList.remove("open");
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
      printingRequestId += 1;
      state.editingCardId = null;
      state.printings = [];
    });
  }

  bindEvents();
  render();
  setTimeout(() => hydrateMissingPrices(), 450);
})();
