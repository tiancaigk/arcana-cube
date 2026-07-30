const test = require("node:test");
const assert = require("node:assert/strict");
const { createLocalServer, historyCorsHeaders, isLoopbackRequest, readServerOptions } = require("./scripts/local-server.js");

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

test("local price updates are restricted to loopback clients", () => {
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: "127.0.0.1" } }), true);
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: "::ffff:127.0.0.1" } }), true);
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: "192.168.1.50" } }), false);
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

test("local server reads and rebuilds the machine-local MTGJSON index", async (t) => {
  const calls = [];
  const cached = { format: "arcana-cube-mtgjson-prices", version: 2, providers: [], source: { date: "2026-07-28" }, cards: {} };
  const updated = { ...cached, source: { date: "2026-07-29" } };
  const server = createLocalServer({
    host: "127.0.0.1",
    port: 0,
    priceIndexService: {
      readIndex: async () => cached,
      update: async (cubeData) => {
        calls.push(cubeData);
        return updated;
      }
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const readResponse = await fetch(`http://127.0.0.1:${port}/mtgjson-price-index/local`, {
    headers: { Origin: "null" }
  });
  assert.equal(readResponse.status, 200);
  assert.equal((await readResponse.json()).source.date, "2026-07-28");

  const updateResponse = await fetch(`http://127.0.0.1:${port}/mtgjson-price-index/local`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "null" },
    body: JSON.stringify({ cubeData: { meta: { name: "Test" }, cards: [{ name: "Card" }] } })
  });
  assert.equal(updateResponse.status, 200);
  assert.equal((await updateResponse.json()).source.date, "2026-07-29");
  assert.equal(calls.length, 1);
});
