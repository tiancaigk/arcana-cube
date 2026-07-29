const test = require("node:test");
const assert = require("node:assert/strict");
const { createLocalServer, historyCorsHeaders, readServerOptions } = require("./scripts/local-server.js");

test("local server defaults to loopback on port 4173", () => {
  assert.deepEqual(readServerOptions([], {}), { host: "127.0.0.1", port: 4173 });
});

test("local server accepts an explicit LAN host", () => {
  assert.deepEqual(readServerOptions(["--host", "0.0.0.0", "--port", "4174"], {}), { host: "0.0.0.0", port: 4174 });
});

test("local server preserves environment port precedence", () => {
  assert.equal(readServerOptions(["--port", "4174"], { PORT: "5000" }).port, 5000);
});

test("local server rejects invalid ports", () => {
  assert.throws(() => readServerOptions(["--port", "0"], {}), /端口/);
  assert.throws(() => readServerOptions(["--port", "70000"], {}), /端口/);
  assert.throws(() => readServerOptions(["--port", "abc"], {}), /端口/);
});

test("MTGJSON history endpoint accepts LAN same-origin requests", () => {
  assert.deepEqual(historyCorsHeaders({
    headers: {
      host: "192.168.1.20:4173",
      origin: "http://192.168.1.20:4173"
    }
  }), {
    "Access-Control-Allow-Origin": "http://192.168.1.20:4173",
    "Vary": "Origin"
  });
  assert.equal(historyCorsHeaders({
    headers: {
      host: "192.168.1.20:4173",
      origin: "https://example.com"
    }
  }), null);
});

test("local server exposes cached MTGJSON history to local file pages", async (t) => {
  const calls = [];
  const server = createLocalServer({
    host: "127.0.0.1",
    port: 0,
    historyService: {
      getHistory: async (ids) => {
        calls.push(ids);
        return { format: "arcana-cube-mtgjson-prices", version: 2, providers: [], cards: {} };
      }
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/mtgjson-price-history`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": "null" },
    body: JSON.stringify({ scryfallIds: ["printing"] })
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "null");
  assert.deepEqual(calls, [["printing"]]);
});
