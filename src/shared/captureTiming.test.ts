import test from "node:test";
import assert from "node:assert/strict";
import { getCaptureCountdown } from "./captureTiming.js";

test("CaptureTiming rounds a future deadline up to whole seconds", () => {
  assert.deepEqual(getCaptureCountdown(3_500, 1_000), {
    remainingSeconds: 3,
    ready: false
  });
});

test("CaptureTiming becomes ready at or after the deadline", () => {
  assert.deepEqual(getCaptureCountdown(2_000, 2_000), {
    remainingSeconds: 0,
    ready: true
  });
  assert.deepEqual(getCaptureCountdown(2_000, 2_500), {
    remainingSeconds: 0,
    ready: true
  });
});

test("CaptureTiming treats a cleared deadline as cancelled", () => {
  assert.deepEqual(getCaptureCountdown(null, 5_000), {
    remainingSeconds: 0,
    ready: false
  });
});
