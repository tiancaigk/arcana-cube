const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

test("application shell loads dependencies before app.js", () => {
  const core = html.indexOf('src="core.js"');
  const priceHistory = html.indexOf('src="priceHistory.js"');
  const changeLog = html.indexOf('src="changeLog.js"');
  const storage = html.indexOf('src="storage.js"');
  const scryfall = html.indexOf('src="scryfall.js"');
  const app = html.indexOf('src="app.js"');
  assert.ok(core >= 0 && core < priceHistory && priceHistory < changeLog && changeLog < storage && storage < scryfall && scryfall < app);
});

test("key interactive regions expose accessible state", () => {
  assert.match(html, /id="sidebar"/);
  assert.match(html, /id="resultCount"[^>]+aria-live="polite"/);
  assert.match(html, /data-color="all"[^>]+aria-pressed="true"/);
  assert.match(html, /data-mode="grid"[^>]+aria-pressed="true"/);
  assert.match(html, /id="connectFolderBtn"/);
  assert.match(html, /id="syncFolderBtn"/);
  assert.match(html, /id="storageStatusLabel"/);
  assert.match(html, /class="storage-note"[^>]+aria-live="polite"/);
  assert.match(html, /id="priceHistoryDialog"/);
  assert.match(html, /id="changeLogDialog"/);
  assert.match(html, /id="manaCurveScope"/);
  assert.match(html, /id="manaChart"[^>]+data-color-bucket="all"/);
  assert.match(html, /id="analyticsAllColor"/);
  assert.match(fs.readFileSync(path.join(__dirname, "app.js"), "utf8"), /data-card-type=/);
  assert.match(fs.readFileSync(path.join(__dirname, "app.js"), "utf8"), /data-show-today-price-changes/);
});
