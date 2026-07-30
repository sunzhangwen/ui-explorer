import test from "node:test";
import assert from "node:assert/strict";
import { TestPageServer } from "./testPageServer.js";

test("TestPageServer resolves a whitelisted page against the dev server", async () => {
  const server = new TestPageServer({
    devBaseUrl: "http://127.0.0.1:5173",
    fixtureRoot: "unused"
  });
  assert.equal(
    await server.resolve("table"),
    "http://127.0.0.1:5173/test-pages/table.html"
  );
});

test("TestPageServer rejects unknown fixture ids", async () => {
  const server = new TestPageServer({
    devBaseUrl: "http://127.0.0.1:5173",
    fixtureRoot: "unused"
  });
  await assert.rejects(() => server.resolve("../secret"), /Unknown test page/);
});
