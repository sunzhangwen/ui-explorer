import test from "node:test";
import assert from "node:assert/strict";
import { ELEMENT_PICKER_SCRIPT, HIGHLIGHT_SCRIPT, SNAPSHOT_SCRIPT } from "./browserScripts.js";

test("snapshot script records frame and shadow context boundaries", () => {
  assert.match(SNAPSHOT_SCRIPT, /kind:\s*"frame"/);
  assert.match(SNAPSHOT_SCRIPT, /kind:\s*"shadow"/);
  assert.match(SNAPSHOT_SCRIPT, /cross-origin-frame/);
  assert.match(SNAPSHOT_SCRIPT, /closed-shadow-root/);
});

test("highlight and picker scripts visit accessible frame documents", () => {
  assert.match(HIGHLIGHT_SCRIPT, /ownerDocument/);
  assert.match(HIGHLIGHT_SCRIPT, /documents/);
  assert.match(ELEMENT_PICKER_SCRIPT, /contentDocument/);
  assert.match(ELEMENT_PICKER_SCRIPT, /composedPath/);
});

test("picker installs listeners in every captured document", () => {
  assert.match(ELEMENT_PICKER_SCRIPT, /__uiExplorerDocuments/);
  assert.match(ELEMENT_PICKER_SCRIPT, /for\s*\(const doc of documents\)/);
  assert.match(ELEMENT_PICKER_SCRIPT, /install\(doc\)/);
});
