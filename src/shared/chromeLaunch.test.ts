import test from "node:test";
import assert from "node:assert/strict";
import {
  isOpenChromePageRequest,
  normalizeChromePageUrl
} from "./chromeLaunch.js";

test("ChromeLaunch normalizes blank input to about:blank", () => {
  assert.deepEqual(normalizeChromePageUrl("  "), {
    ok: true,
    url: "about:blank"
  });
});

test("ChromeLaunch preserves allowed explicit URLs", () => {
  assert.deepEqual(normalizeChromePageUrl("https://example.com/path?q=1"), {
    ok: true,
    url: "https://example.com/path?q=1"
  });
  assert.deepEqual(normalizeChromePageUrl("file:///C:/fixtures/page.html"), {
    ok: true,
    url: "file:///C:/fixtures/page.html"
  });
});

test("ChromeLaunch defaults local addresses to HTTP", () => {
  assert.deepEqual(normalizeChromePageUrl("localhost:5173/test-pages/table.html"), {
    ok: true,
    url: "http://localhost:5173/test-pages/table.html"
  });
  assert.deepEqual(normalizeChromePageUrl("192.168.1.20:8080/app"), {
    ok: true,
    url: "http://192.168.1.20:8080/app"
  });
});

test("ChromeLaunch defaults domains and public IPs to HTTPS", () => {
  assert.deepEqual(normalizeChromePageUrl("example.com/docs"), {
    ok: true,
    url: "https://example.com/docs"
  });
  assert.deepEqual(normalizeChromePageUrl("8.8.8.8/search"), {
    ok: true,
    url: "https://8.8.8.8/search"
  });
});

test("ChromeLaunch rejects unapproved and malformed URLs", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,hello",
    "chrome://settings",
    "http://[invalid"
  ]) {
    assert.deepEqual(normalizeChromePageUrl(value), {
      ok: false,
      code: "invalid-url"
    });
  }
});

test("ChromeLaunch accepts only valid open-page request shapes", () => {
  assert.equal(
    isOpenChromePageRequest({
      requestId: "r1",
      preferredEndpoint: "localhost:9222",
      source: { kind: "test-page", id: "table" }
    }),
    true
  );
  assert.equal(
    isOpenChromePageRequest({
      requestId: "r2",
      source: { kind: "custom", value: "example.com" }
    }),
    true
  );
  assert.equal(
    isOpenChromePageRequest({
      requestId: "",
      source: { kind: "custom", value: "example.com" }
    }),
    false
  );
  assert.equal(
    isOpenChromePageRequest({
      requestId: "r3",
      source: { kind: "unknown", value: "example.com" }
    }),
    false
  );
});
