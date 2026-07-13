(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CubeViewPreferences = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createViewPreferenceStore(storage, definitions = {}) {
    function definitionFor(name) {
      const definition = definitions[name];
      if (!definition || !Array.isArray(definition.allowedValues) || definition.allowedValues.length === 0) return null;
      return definition;
    }

    function normalize(definition, value) {
      return definition.allowedValues.includes(value) ? value : definition.fallback;
    }

    function get(name) {
      const definition = definitionFor(name);
      if (!definition) return undefined;
      try {
        return normalize(definition, storage.getItem(definition.key));
      } catch (_error) {
        return definition.fallback;
      }
    }

    function set(name, value) {
      const definition = definitionFor(name);
      if (!definition) return undefined;
      const normalized = normalize(definition, value);
      try {
        storage.setItem(definition.key, normalized);
      } catch (_error) {
        // Preferences are optional and must never block the application.
      }
      return normalized;
    }

    return { get, set };
  }

  return { createViewPreferenceStore };
});
