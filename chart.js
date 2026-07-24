(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CubeChart = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function datePositions(points, minX, maxX) {
    const source = Array.isArray(points) ? points : [];
    if (!source.length) return [];
    if (source.length === 1) return [(minX + maxX) / 2];
    const times = source.map((point) => Date.parse(`${point.date}T00:00:00`));
    const first = Math.min(...times);
    const last = Math.max(...times);
    if (times.every(Number.isFinite) && last > first) {
      return times.map((time) => minX + ((time - first) / (last - first)) * (maxX - minX));
    }
    return source.map((_point, index) => minX + index * ((maxX - minX) / (source.length - 1)));
  }

  return { datePositions };
});
