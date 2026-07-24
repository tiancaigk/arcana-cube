(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CubeWorkspaceSession = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function cubeIdOf(cubeData) {
    return String(cubeData && cubeData.meta && cubeData.meta.id || "").trim();
  }

  function resolveDomain(value, emptyValue, cubeId, domain) {
    const missing = !value;
    const next = clone(value || emptyValue());
    const existingId = String(next.cubeId || "").trim();
    if (existingId && existingId !== cubeId) {
      throw new Error(`${domain} 属于另一个 Cube，已停止载入以避免混合数据`);
    }
    const needsWrite = missing || existingId !== cubeId;
    next.cubeId = cubeId;
    return { data: next, needsWrite };
  }

  function resolveWorkspaceDomains(options = {}) {
    const cubeData = options.cubeData;
    if (!cubeData) throw new Error("Cube 文件夹缺少主牌表数据");
    const cubeId = cubeIdOf(cubeData);
    if (!cubeId) throw new Error("Cube 主牌表缺少身份标识");
    if (typeof options.emptyPriceHistory !== "function" || typeof options.emptyChangeLog !== "function") {
      throw new Error("工作区缺少空数据工厂");
    }
    const priceHistory = resolveDomain(options.priceHistoryData, options.emptyPriceHistory, cubeId, "价格历史");
    const changeLog = resolveDomain(options.changeLogData, options.emptyChangeLog, cubeId, "改动记录");
    return {
      cubeId,
      cubeData: clone(cubeData),
      priceHistoryData: priceHistory.data,
      changeLogData: changeLog.data,
      needsWrite: {
        priceHistory: priceHistory.needsWrite,
        changeLog: changeLog.needsWrite
      }
    };
  }

  return { cubeIdOf, resolveWorkspaceDomains };
});
