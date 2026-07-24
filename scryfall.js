(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ScryfallClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  let queue = Promise.resolve();
  let lastRequestAt = 0;

  function abortReason(signal) {
    return signal && signal.reason || new DOMException("Aborted", "AbortError");
  }

  function wait(ms, signal) {
    if (signal && signal.aborted) return Promise.reject(abortReason(signal));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        reject(abortReason(signal));
      };
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  function schedule(minIntervalMs, signal) {
    const turn = queue.then(async () => {
      const remaining = minIntervalMs - (Date.now() - lastRequestAt);
      if (remaining > 0) await wait(remaining, signal);
      if (signal && signal.aborted) throw abortReason(signal);
      lastRequestAt = Date.now();
    });
    queue = turn.catch(() => {});
    return turn;
  }

  function retryDelay(response, attempt, baseDelayMs) {
    const retryAfter = Number(response && response.headers && response.headers.get("Retry-After"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
    return baseDelayMs * Math.pow(2, attempt);
  }

  async function requestJson(url, options = {}) {
    const {
      signal,
      timeoutMs = 12000,
      retries = 2,
      retryDelayMs = 350,
      minIntervalMs = 100,
      fetchImpl = typeof fetch === "function" ? fetch : null,
      ...fetchOptions
    } = options;
    if (!fetchImpl) throw new Error("当前环境不支持网络请求");

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (signal && signal.aborted) throw abortReason(signal);
      await schedule(minIntervalMs, signal);
      const controller = new AbortController();
      const abortFromCaller = () => controller.abort(signal.reason);
      if (signal) signal.addEventListener("abort", abortFromCaller, { once: true });
      const timeout = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);
      let response;
      try {
        response = await fetchImpl(url, {
          ...fetchOptions,
          signal: controller.signal,
          headers: { Accept: "application/json", ...(fetchOptions.headers || {}) }
        });
        const payload = await response.json().catch(() => ({}));
        if (response.ok) return payload;
        const error = new Error(payload.details || payload.error || `Scryfall 请求失败 (${response.status})`);
        error.status = response.status;
        if (attempt < retries && (response.status === 429 || response.status >= 500)) {
          await wait(retryDelay(response, attempt, retryDelayMs), signal);
          continue;
        }
        throw error;
      } catch (error) {
        if (signal && signal.aborted) throw signal.reason || error;
        const retryable = error.name === "TimeoutError" || error.name === "AbortError" || error instanceof TypeError;
        if (attempt < retries && retryable) {
          await wait(retryDelay(response, attempt, retryDelayMs), signal);
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timeout);
        if (signal) signal.removeEventListener("abort", abortFromCaller);
      }
    }
    throw new Error("Scryfall 请求失败");
  }

  return { requestJson };
});
