(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CubeWorkspace = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const IMAGE_EXTENSION = /\.(?:png|jpe?g|webp|avif)$/i;

  function createWorkspaceService(options = {}) {
    const required = [
      "cubeFileName", "priceHistoryFileName", "changeLogFileName", "imageDirName", "thumbnailDirName",
      "wrapCube", "parseCube", "wrapPriceHistory", "parsePriceHistory", "emptyPriceHistory",
      "wrapChangeLog", "parseChangeLog", "emptyChangeLog"
    ];
    required.forEach((key) => {
      if (options[key] === undefined || options[key] === null || options[key] === "") throw new Error(`工作区配置缺少 ${key}`);
    });

    function isMissingEntryError(error) {
      return Boolean(error && (error.name === "NotFoundError" || error.code === 8));
    }

    async function queryPermission(directoryHandle, mode = "readwrite") {
      if (!directoryHandle || typeof directoryHandle.queryPermission !== "function") return "prompt";
      return directoryHandle.queryPermission({ mode });
    }

    async function requestPermission(directoryHandle, mode = "readwrite") {
      if (await queryPermission(directoryHandle, mode) === "granted") return true;
      if (!directoryHandle || typeof directoryHandle.requestPermission !== "function") return false;
      return (await directoryHandle.requestPermission({ mode })) === "granted";
    }

    async function readJson(directoryHandle, fileName, parse, missingValue, emptyValue) {
      try {
        const fileHandle = await directoryHandle.getFileHandle(fileName, { create: false });
        const file = await fileHandle.getFile();
        const text = await file.text();
        if (!text.trim()) return emptyValue();
        return parse(text);
      } catch (error) {
        if (isMissingEntryError(error)) return missingValue();
        throw error;
      }
    }

    async function writeJson(directoryHandle, fileName, wrap, data) {
      const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
      await writeWritable(fileHandle, JSON.stringify(wrap(data), null, 2));
    }

    async function writeWritable(fileHandle, value) {
      const writable = await fileHandle.createWritable();
      try {
        await writable.write(value);
        await writable.close();
      } catch (error) {
        if (typeof writable.abort === "function") {
          try {
            await writable.abort();
          } catch (abortError) {
            // Preserve the original write failure.
          }
        }
        throw error;
      }
    }

    function readCube(directoryHandle) {
      return readJson(directoryHandle, options.cubeFileName, options.parseCube, () => null, () => null);
    }

    function writeCube(directoryHandle, data) {
      return writeJson(directoryHandle, options.cubeFileName, options.wrapCube, data);
    }

    function readPriceHistory(directoryHandle) {
      return readJson(directoryHandle, options.priceHistoryFileName, options.parsePriceHistory, () => null, options.emptyPriceHistory);
    }

    function writePriceHistory(directoryHandle, data) {
      return writeJson(directoryHandle, options.priceHistoryFileName, options.wrapPriceHistory, data);
    }

    function readChangeLog(directoryHandle) {
      return readJson(directoryHandle, options.changeLogFileName, options.parseChangeLog, () => null, options.emptyChangeLog);
    }

    function writeChangeLog(directoryHandle, data) {
      return writeJson(directoryHandle, options.changeLogFileName, options.wrapChangeLog, data);
    }

    function getImagesDirectory(directoryHandle, create = false) {
      return directoryHandle.getDirectoryHandle(options.imageDirName, { create });
    }

    async function getThumbnailsDirectory(directoryHandle, create = false) {
      const imagesDirectory = await getImagesDirectory(directoryHandle, create);
      return imagesDirectory.getDirectoryHandle(options.thumbnailDirName, { create });
    }

    function imagePathParts(relativePath) {
      const parts = String(relativePath || "").split("/");
      const original = parts.length === 2 && parts[0] === options.imageDirName && parts[1];
      const thumbnail = parts.length === 3 && parts[0] === options.imageDirName && parts[1] === options.thumbnailDirName && parts[2];
      if (!original && !thumbnail) throw new Error("本地图片路径无效");
      return thumbnail ? { directory: "thumbnail", name: parts[2] } : { directory: "original", name: parts[1] };
    }

    async function directoryForPath(directoryHandle, parts, create) {
      return parts.directory === "thumbnail"
        ? getThumbnailsDirectory(directoryHandle, create)
        : getImagesDirectory(directoryHandle, create);
    }

    async function fileExists(directoryHandle, relativePath) {
      try {
        const parts = imagePathParts(relativePath);
        const directory = await directoryForPath(directoryHandle, parts, false);
        await directory.getFileHandle(parts.name, { create: false });
        return true;
      } catch (error) {
        if (isMissingEntryError(error)) return false;
        throw error;
      }
    }

    async function readFile(directoryHandle, relativePath) {
      const parts = imagePathParts(relativePath);
      const directory = await directoryForPath(directoryHandle, parts, false);
      const fileHandle = await directory.getFileHandle(parts.name, { create: false });
      return fileHandle.getFile();
    }

    async function writeFile(directoryHandle, relativePath, value) {
      const parts = imagePathParts(relativePath);
      const directory = await directoryForPath(directoryHandle, parts, true);
      const fileHandle = await directory.getFileHandle(parts.name, { create: true });
      await writeWritable(fileHandle, value);
    }

    async function listImageFiles(directoryHandle) {
      const originalFiles = [];
      const thumbnailFiles = [];
      let imagesDirectory;
      try {
        imagesDirectory = await getImagesDirectory(directoryHandle, false);
      } catch (error) {
        if (isMissingEntryError(error)) return { originalFiles, thumbnailFiles };
        throw error;
      }
      for await (const [name, handle] of imagesDirectory.entries()) {
        if (handle.kind === "file" && IMAGE_EXTENSION.test(name)) originalFiles.push(`${options.imageDirName}/${name}`);
        if (handle.kind !== "directory" || name !== options.thumbnailDirName) continue;
        for await (const [thumbnailName, thumbnailHandle] of handle.entries()) {
          if (thumbnailHandle.kind === "file" && IMAGE_EXTENSION.test(thumbnailName)) {
            thumbnailFiles.push(`${options.imageDirName}/${options.thumbnailDirName}/${thumbnailName}`);
          }
        }
      }
      originalFiles.sort();
      thumbnailFiles.sort();
      return { originalFiles, thumbnailFiles };
    }

    return {
      isMissingEntryError,
      queryPermission,
      requestPermission,
      readCube,
      writeCube,
      readPriceHistory,
      writePriceHistory,
      readChangeLog,
      writeChangeLog,
      getImagesDirectory,
      getThumbnailsDirectory,
      fileExists,
      readFile,
      writeFile,
      listImageFiles
    };
  }

  return { createWorkspaceService };
});
