(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CubeChangeLog = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const CHANGE_LOG_FORMAT = "arcana-cube-change-log";
  const CHANGE_LOG_VERSION = 1;
  const DEFAULT_LIMIT = 1000;

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function cryptoId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function emptyChangeLog() {
    return {
      version: CHANGE_LOG_VERSION,
      updatedAt: "",
      entries: []
    };
  }

  function normalizeEntry(entry) {
    const source = entry && typeof entry === "object" ? entry : {};
    const time = typeof source.time === "string" && source.time ? source.time : new Date().toISOString();
    return {
      id: typeof source.id === "string" && source.id ? source.id : cryptoId(),
      time,
      type: typeof source.type === "string" && source.type ? source.type : "misc",
      summary: typeof source.summary === "string" ? source.summary : "",
      card: source.card && typeof source.card === "object" ? clone(source.card) : null,
      before: source.before && typeof source.before === "object" ? clone(source.before) : null,
      after: source.after && typeof source.after === "object" ? clone(source.after) : null,
      meta: source.meta && typeof source.meta === "object" ? clone(source.meta) : null
    };
  }

  function normalizeChangeLog(value) {
    const source = value && typeof value === "object" ? value : {};
    const entries = Array.isArray(source.entries) ? source.entries.map(normalizeEntry) : [];
    entries.sort((a, b) => String(b.time).localeCompare(String(a.time)));
    return {
      version: CHANGE_LOG_VERSION,
      updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
      entries
    };
  }

  function appendChange(log, entry, options = {}) {
    const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : DEFAULT_LIMIT;
    const next = normalizeChangeLog(log);
    const normalizedEntry = normalizeEntry({
      ...entry,
      time: entry && entry.time || (options.now instanceof Date ? options.now.toISOString() : new Date().toISOString())
    });
    next.entries = [normalizedEntry, ...next.entries].slice(0, limit);
    next.updatedAt = normalizedEntry.time;
    return next;
  }

  function latestEntries(log, limit = 100) {
    return normalizeChangeLog(log).entries.slice(0, limit);
  }

  function wrapChangeLogData(log) {
    return {
      format: CHANGE_LOG_FORMAT,
      version: CHANGE_LOG_VERSION,
      savedAt: new Date().toISOString(),
      data: clone(normalizeChangeLog(log))
    };
  }

  function parseChangeLogData(text) {
    const payload = JSON.parse(text);
    if (payload && payload.format === CHANGE_LOG_FORMAT) return normalizeChangeLog(payload.data);
    return normalizeChangeLog(payload);
  }

  return {
    CHANGE_LOG_FORMAT,
    CHANGE_LOG_VERSION,
    appendChange,
    emptyChangeLog,
    latestEntries,
    normalizeChangeLog,
    parseChangeLogData,
    wrapChangeLogData
  };
});
