const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

test("application shell loads dependencies before app.js", () => {
  const core = html.indexOf('src="core.js"');
  const storage = html.indexOf('src="storage.js"');
  const scryfall = html.indexOf('src="scryfall.js"');
  const app = html.indexOf('src="app.js"');
  assert.ok(core >= 0 && core < storage && storage < scryfall && scryfall < app);
});

test("key interactive regions expose accessible state", () => {
  assert.match(html, /id="mobileMenu"[^>]+aria-controls="sidebar"[^>]+aria-expanded="false"/);
  assert.match(html, /id="resultCount"[^>]+aria-live="polite"/);
  assert.match(html, /data-color="all"[^>]+aria-pressed="true"/);
  assert.match(html, /data-mode="grid"[^>]+aria-pressed="true"/);
});
