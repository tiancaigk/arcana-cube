(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CubeRenderScheduler = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createRenderScheduler(renderers, options = {}) {
    const registry = renderers && typeof renderers === "object" ? renderers : {};
    const order = options.order || Object.keys(registry);
    const queueTask = options.queueTask || queueMicrotask;
    const pending = new Set();
    let scheduled = false;
    let scheduleToken = 0;

    function validate(scopes) {
      scopes.forEach((scope) => {
        if (typeof registry[scope] !== "function") throw new Error(`Unknown render scope: ${scope}`);
      });
    }

    function flush() {
      scheduled = false;
      scheduleToken += 1;
      if (!pending.size) return [];
      const scopes = order.filter((scope) => pending.has(scope));
      pending.clear();
      scopes.forEach((scope) => registry[scope]());
      return scopes;
    }

    function request(...scopes) {
      validate(scopes);
      scopes.forEach((scope) => pending.add(scope));
      if (scheduled || !pending.size) return;
      scheduled = true;
      const token = ++scheduleToken;
      queueTask(() => {
        if (!scheduled || token !== scheduleToken) return;
        flush();
      });
    }

    return { request, flush };
  }

  return { createRenderScheduler };
});
