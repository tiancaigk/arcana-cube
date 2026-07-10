(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CubeImageCache = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function isRemoteImageUrl(value) {
    return /^https?:\/\//i.test(String(value || ""));
  }

  function preferPngImageUrl(url) {
    const value = String(url || "");
    if (!isRemoteImageUrl(value) || !/cards\.scryfall\.io/i.test(value)) return value;
    return value
      .replace(/\/(?:small|normal|large)\//, "/png/")
      .replace(/\.(?:jpg|jpeg)(\?[^/?#]*)?$/i, ".png$1");
  }

  function imageExtensionFrom(url, blob) {
    const type = String(blob && blob.type || "").toLocaleLowerCase();
    if (type.includes("png")) return "png";
    if (type.includes("webp")) return "webp";
    if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
    const match = String(url || "").split("?", 1)[0].match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLocaleLowerCase() : "png";
  }

  function createImageCache(options = {}) {
    const workspace = options.workspace;
    const getDirectoryHandle = options.getDirectoryHandle;
    const fetchImpl = options.fetchImpl;
    const mapFetchUrl = options.mapFetchUrl || ((url) => url);
    const buildFileName = options.buildFileName;
    const createThumbnail = options.createThumbnail;
    const imageDirName = options.imageDirName || "images";
    const thumbnailDirName = options.thumbnailDirName || "thumbnails";
    const timeoutMs = Number(options.timeoutMs) || 25000;
    const setTimer = options.setTimer || setTimeout;
    const clearTimer = options.clearTimer || clearTimeout;
    if (!workspace || typeof workspace.fileExists !== "function" || typeof workspace.readFile !== "function" || typeof workspace.writeFile !== "function") throw new Error("图片缓存缺少工作区服务");
    if (typeof getDirectoryHandle !== "function") throw new Error("图片缓存缺少目录句柄提供器");
    if (typeof fetchImpl !== "function") throw new Error("图片缓存缺少 fetch");
    if (typeof buildFileName !== "function") throw new Error("图片缓存缺少文件命名器");
    if (typeof createThumbnail !== "function") throw new Error("图片缓存缺少缩略图转换器");

    function downloadCandidates(card, face = "front") {
      const source = face === "back"
        ? card.remoteBackImage || (isRemoteImageUrl(card.backImage) ? card.backImage : "")
        : card.remoteImage || (isRemoteImageUrl(card.image) ? card.image : "");
      return [...new Set([preferPngImageUrl(source), source].filter(isRemoteImageUrl))];
    }

    async function fetchImageBlob(candidates) {
      let lastError;
      for (const url of candidates) {
        const controller = new AbortController();
        const timeout = setTimer(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchImpl(mapFetchUrl(url), { signal: controller.signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          if (!blob.size) throw new Error("图片为空");
          return { url, blob };
        } catch (error) {
          lastError = error;
        } finally {
          clearTimer(timeout);
        }
      }
      throw lastError || new Error("没有可下载的图片地址");
    }

    async function ensureThumbnail(card, face, sourceBlob) {
      const directoryHandle = getDirectoryHandle();
      const thumbnailKey = face === "back" ? "localBackThumbnail" : "localThumbnail";
      const localKey = face === "back" ? "localBackImage" : "localImage";
      const fileName = buildFileName(card, "webp", face);
      const expectedPath = `${imageDirName}/${thumbnailDirName}/${fileName}`;
      if (card[thumbnailKey] && await workspace.fileExists(directoryHandle, card[thumbnailKey])) return "skipped";
      if (await workspace.fileExists(directoryHandle, expectedPath)) {
        card[thumbnailKey] = expectedPath;
        return "updated";
      }
      const originalBlob = sourceBlob || await workspace.readFile(directoryHandle, card[localKey]);
      const thumbnailBlob = await createThumbnail(originalBlob);
      await workspace.writeFile(directoryHandle, expectedPath, thumbnailBlob);
      card[thumbnailKey] = expectedPath;
      return "updated";
    }

    async function cacheFace(card, face = "front") {
      const directoryHandle = getDirectoryHandle();
      if (!directoryHandle) throw new Error("没有可用的 Cube 文件夹");
      const localKey = face === "back" ? "localBackImage" : "localImage";
      const imageKey = face === "back" ? "backImage" : "image";
      const remoteKey = face === "back" ? "remoteBackImage" : "remoteImage";
      const errors = [];
      let updated = false;
      if (card[localKey] && await workspace.fileExists(directoryHandle, card[localKey])) {
        if (card[imageKey] !== card[localKey]) {
          card[imageKey] = card[localKey];
          updated = true;
        }
        try {
          if (await ensureThumbnail(card, face) === "updated") updated = true;
        } catch (error) {
          errors.push({ face, stage: "thumbnail", error });
        }
        return { status: updated ? "updated" : "skipped", errors };
      }
      const candidates = downloadCandidates(card, face);
      if (!candidates.length) return { status: "missing", errors };
      const { url, blob } = await fetchImageBlob(candidates);
      const fileName = buildFileName(card, imageExtensionFrom(url, blob), face);
      const localPath = `${imageDirName}/${fileName}`;
      await workspace.writeFile(directoryHandle, localPath, blob);
      card[remoteKey] = url;
      card[localKey] = localPath;
      card[imageKey] = localPath;
      try {
        await ensureThumbnail(card, face, blob);
      } catch (error) {
        errors.push({ face, stage: "thumbnail", error });
      }
      return { status: "updated", errors };
    }

    async function cacheCard(card) {
      const results = [await cacheFace(card, "front")];
      if (downloadCandidates(card, "back").length || card.localBackImage) results.push(await cacheFace(card, "back"));
      const errors = results.flatMap((result) => result.errors);
      const statuses = results.map((result) => result.status);
      const status = statuses.includes("updated") ? "updated" : (statuses.includes("missing") ? "missing" : "skipped");
      return { status, errors };
    }

    function hasCacheTarget(card) {
      return downloadCandidates(card).length || card.localImage || downloadCandidates(card, "back").length || card.localBackImage;
    }

    async function cacheAll(cards, runOptions = {}) {
      const targets = (Array.isArray(cards) ? cards : []).filter(hasCacheTarget);
      const summary = { updated: 0, skipped: 0, missing: 0, failed: 0, total: targets.length, errors: [] };
      const onProgress = runOptions.onProgress || (() => {});
      const checkpoint = runOptions.checkpoint || (() => {});
      const checkpointEvery = Math.max(1, Number(runOptions.checkpointEvery) || 100);
      for (let index = 0; index < targets.length; index += 1) {
        let result;
        try {
          result = await cacheCard(targets[index]);
          summary[result.status] += 1;
          if (result.errors.length) {
            summary.failed += 1;
            summary.errors.push(...result.errors.map((entry) => ({ card: targets[index], ...entry })));
          }
        } catch (error) {
          result = { status: "failed", errors: [{ card: targets[index], stage: "original", error }] };
          summary.failed += 1;
          summary.errors.push(...result.errors);
        }
        await onProgress({ index: index + 1, total: targets.length, card: targets[index], result, summary: { ...summary, errors: [...summary.errors] } });
        if ((index + 1) % checkpointEvery === 0) await checkpoint({ ...summary, errors: [...summary.errors] });
      }
      return summary;
    }

    return { cacheCard, cacheAll, hasCacheTarget, downloadCandidates };
  }

  return { createImageCache, imageExtensionFrom, isRemoteImageUrl, preferPngImageUrl };
});
