(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CubePersistence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DOMAINS = ["cube", "priceHistory", "changeLog"];

  function createPersistenceCoordinator(options = {}) {
    const browserWriters = options.browserWriters || {};
    const directoryWriters = options.directoryWriters || {};
    const getDirectoryHandle = options.getDirectoryHandle || (() => null);
    const onDirectoryError = options.onDirectoryError || (() => {});
    const onBrowserError = options.onBrowserError || (() => {});
    const setTimer = options.setTimer || setTimeout;
    const clearTimer = options.clearTimer || clearTimeout;
    const queueTask = options.queueTask || queueMicrotask;
    const pending = new Map();
    const scheduled = new Map();
    const dirty = new Set();
    let drainPromise = null;
    let drainQueued = false;

    DOMAINS.forEach((domain) => {
      if (typeof browserWriters[domain] !== "function") throw new Error(`缺少 ${domain} 浏览器写入器`);
      if (typeof directoryWriters[domain] !== "function") throw new Error(`缺少 ${domain} 文件夹写入器`);
    });

    function validateDomain(domain) {
      if (!DOMAINS.includes(domain)) throw new Error(`未知保存域：${domain}`);
    }

    function writeBrowser(domain, snapshot) {
      try {
        browserWriters[domain](snapshot);
        return true;
      } catch (error) {
        onBrowserError(error, domain);
        return false;
      }
    }

    function saveBrowser(domain, snapshot) {
      validateDomain(domain);
      return writeBrowser(domain, snapshot);
    }

    function pendingFor(directoryHandle, create = false) {
      let entries = pending.get(directoryHandle);
      if (!entries && create) {
        entries = new Map();
        pending.set(directoryHandle, entries);
      }
      return entries;
    }

    function pendingHasDomain(domain) {
      return [...pending.values()].some((entries) => entries.has(domain));
    }

    function enqueueDirectory(domain, snapshot) {
      const directoryHandle = getDirectoryHandle();
      if (!directoryHandle) return;
      pendingFor(directoryHandle, true).set(domain, snapshot);
      dirty.add(domain);
      scheduleDrain();
    }

    function markDirty(domain, snapshot) {
      validateDomain(domain);
      const delayed = scheduled.get(domain);
      if (delayed) {
        clearTimer(delayed.timer);
        scheduled.delete(domain);
      }
      writeBrowser(domain, snapshot);
      enqueueDirectory(domain, snapshot);
    }

    function promoteScheduled(domain) {
      const delayed = scheduled.get(domain);
      if (!delayed) return;
      clearTimer(delayed.timer);
      scheduled.delete(domain);
      if (!delayed.browserSaved) writeBrowser(domain, delayed.snapshot);
      enqueueDirectory(domain, delayed.snapshot);
    }

    function scheduleDirty(domain, snapshot, delayMs) {
      validateDomain(domain);
      const previous = scheduled.get(domain);
      if (previous) clearTimer(previous.timer);
      const entry = { snapshot, browserSaved: false, timer: null };
      entry.timer = setTimer(() => promoteScheduled(domain), Math.max(0, Number(delayMs) || 0));
      scheduled.set(domain, entry);
      if (getDirectoryHandle()) dirty.add(domain);
    }

    function scheduleDrain() {
      if (drainQueued || drainPromise) return;
      drainQueued = true;
      queueTask(() => {
        drainQueued = false;
        drain();
      });
    }

    function drain() {
      if (drainPromise) return drainPromise;
      drainPromise = (async () => {
        const failedHandles = new Set();
        while (pending.size) {
          const directoryHandle = [...pending.keys()].find((handle) => !failedHandles.has(handle));
          if (!directoryHandle) return;
          const batch = new Map(pending.get(directoryHandle));
          pending.delete(directoryHandle);
          for (let index = 0; index < DOMAINS.length; index += 1) {
            const domain = DOMAINS[index];
            if (!batch.has(domain)) continue;
            const snapshot = batch.get(domain);
            try {
              await directoryWriters[domain](directoryHandle, snapshot);
              if (!pendingHasDomain(domain) && !scheduled.has(domain)) dirty.delete(domain);
            } catch (error) {
              const retry = pendingFor(directoryHandle, true);
              DOMAINS.slice(index).forEach((remainingDomain) => {
                if (!batch.has(remainingDomain) || retry.has(remainingDomain)) return;
                retry.set(remainingDomain, batch.get(remainingDomain));
                dirty.add(remainingDomain);
              });
              failedHandles.add(directoryHandle);
              await onDirectoryError(error, domain, directoryHandle);
              break;
            }
          }
        }
      })().finally(() => {
        drainPromise = null;
      });
      return drainPromise;
    }

    async function flush() {
      [...scheduled.keys()].forEach(promoteScheduled);
      if (drainQueued) await Promise.resolve();
      await drain();
      if (drainPromise) await drainPromise;
    }

    function flushBrowserSync() {
      scheduled.forEach((entry, domain) => {
        if (entry.browserSaved) return;
        writeBrowser(domain, entry.snapshot);
        entry.browserSaved = true;
      });
    }

    function hasDirty(domain) {
      if (domain !== undefined) {
        validateDomain(domain);
        return dirty.has(domain) || scheduled.has(domain) || pendingHasDomain(domain);
      }
      return dirty.size > 0 || scheduled.size > 0 || pending.size > 0;
    }

    function clearDirectory(directoryHandle) {
      if (directoryHandle === undefined) pending.clear();
      else pending.delete(directoryHandle);
      DOMAINS.forEach((domain) => {
        if (!scheduled.has(domain) && !pendingHasDomain(domain)) dirty.delete(domain);
      });
    }

    return { markDirty, scheduleDirty, saveBrowser, flush, flushBrowserSync, hasDirty, clearDirectory };
  }

  return { DOMAINS, createPersistenceCoordinator };
});
