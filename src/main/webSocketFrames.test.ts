import test from "node:test";
import assert from "node:assert/strict";
import { encodeClientTextFrame, extractServerTextFrames } from "./webSocketFrames.js";

test("encodeClientTextFrame creates masked client text frame", () => {
  const frame = encodeClientTextFrame("hello", Buffer.from([1, 2, 3, 4]));

  assert.equal(frame[0], 0x81);
  assert.equal(frame[1], 0x80 | 5);
  assert.deepEqual([...frame.subarray(2, 6)], [1, 2, 3, 4]);
  const unmasked = Buffer.from(frame.subarray(6));
  for (let index = 0; index < unmasked.length; index += 1) {
    unmasked[index] ^= [1, 2, 3, 4][index % 4];
  }
  assert.equal(unmasked.toString("utf8"), "hello");
});

test("extractServerTextFrames decodes text frames and leaves partial data buffered", () => {
  const complete = Buffer.concat([Buffer.from([0x81, 0x05]), Buffer.from("hello")]);
  const partial = Buffer.from([0x81, 0x05, 0x68]);
  const decoded = extractServerTextFrames(Buffer.concat([complete, partial]));

  assert.deepEqual(decoded.messages, ["hello"]);
  assert.deepEqual([...decoded.remaining], [...partial]);
});
