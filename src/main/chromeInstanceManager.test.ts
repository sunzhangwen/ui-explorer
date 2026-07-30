import test from "node:test";
import assert from "node:assert/strict";
import {
  getChromeLaunchArgs,
  getChromeLaunchPorts,
  isLoopbackEndpoint,
  isSameLoopbackEndpoint
} from "./chromeInstanceManager.js";

test("ChromeInstance uses the preferred port followed by the bounded range", () => {
  assert.deepEqual(getChromeLaunchPorts("http://localhost:9230"), [
    9230, 9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229, 9231, 9232
  ]);
});

test("ChromeInstance builds an isolated non-shell launch argument list", () => {
  assert.deepEqual(getChromeLaunchArgs(9222, "C:\\UI Explorer\\chrome-profile"), [
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=9222",
    "--user-data-dir=C:\\UI Explorer\\chrome-profile",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank"
  ]);
});

test("ChromeInstance automatic reuse accepts loopback endpoints only", () => {
  assert.equal(isLoopbackEndpoint("http://127.0.0.1:9222"), true);
  assert.equal(isLoopbackEndpoint("http://localhost:9222"), true);
  assert.equal(isLoopbackEndpoint("http://192.168.1.20:9222"), false);
  assert.equal(isLoopbackEndpoint("https://example.com:9222"), false);
});

test("ChromeInstance treats localhost aliases on the same port as one endpoint", () => {
  assert.equal(
    isSameLoopbackEndpoint(
      "http://127.0.0.1:9222",
      "http://localhost:9222"
    ),
    true
  );
  assert.equal(
    isSameLoopbackEndpoint(
      "http://127.0.0.1:9222",
      "http://localhost:9223"
    ),
    false
  );
});
