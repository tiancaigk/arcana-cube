const test = require("node:test");
const assert = require("node:assert/strict");
const { readServerOptions } = require("./scripts/local-server.js");

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
