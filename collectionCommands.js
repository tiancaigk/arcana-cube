(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CubeCollectionCommands = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createCollectionCommandExecutor(dependencies = {}) {
    const recordChange = typeof dependencies.recordChange === "function" ? dependencies.recordChange : () => {};
    const saveState = typeof dependencies.saveState === "function" ? dependencies.saveState : () => {};
    const requestRender = typeof dependencies.requestRender === "function" ? dependencies.requestRender : () => {};
    const toast = typeof dependencies.toast === "function" ? dependencies.toast : () => {};

    function execute(command = {}) {
      if (command.changed !== true) return false;
      const changes = Array.isArray(command.changes) ? command.changes : [];
      changes.forEach((change) => {
        if (!change || !change.type || !change.summary) return;
        recordChange(change.type, change.summary, change.details || {}, { persist: false });
      });
      saveState(command.dirtyDomains || ["cube", "changeLog"]);
      if (command.render) requestRender(command.render);
      if (command.feedback) {
        const feedback = command.feedback;
        toast(feedback.title || "已更新", feedback.message || "", feedback.error === true, feedback.action || null);
      }
      return true;
    }

    return { execute };
  }

  return { createCollectionCommandExecutor };
});
