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

  function splitDateSeries(points, maxGapDays = 7) {
    const source = Array.isArray(points) ? points : [];
    if (!source.length) return [];
    const maxGapMs = Math.max(0, Number(maxGapDays) || 0) * 24 * 60 * 60 * 1000;
    return source.reduce((segments, point, index) => {
      const previous = source[index - 1];
      const previousTime = previous && Date.parse(`${previous.date}T00:00:00`);
      const currentTime = Date.parse(`${point.date}T00:00:00`);
      const hasLongGap = index > 0
        && Number.isFinite(previousTime)
        && Number.isFinite(currentTime)
        && currentTime - previousTime > maxGapMs;
      if (!segments.length || hasLongGap) segments.push([]);
      segments[segments.length - 1].push(point);
      return segments;
    }, []);
  }

  function dateLabelIndexes(positions, minSpacing = 90) {
    const source = Array.isArray(positions) ? positions.map(Number) : [];
    if (!source.length) return [];
    if (source.length === 1) return [0];
    const firstIndex = 0;
    const lastIndex = source.length - 1;
    const firstX = source[firstIndex];
    const lastX = source[lastIndex];
    const midpoint = (firstX + lastX) / 2;
    const interior = source
      .map((x, index) => ({ x, index }))
      .slice(1, -1)
      .filter(({ x }) => Number.isFinite(x) && x - firstX >= minSpacing && lastX - x >= minSpacing)
      .sort((a, b) => Math.abs(a.x - midpoint) - Math.abs(b.x - midpoint))[0];
    return interior ? [firstIndex, interior.index, lastIndex] : [firstIndex, lastIndex];
  }

  return { dateLabelIndexes, datePositions, splitDateSeries };
});
