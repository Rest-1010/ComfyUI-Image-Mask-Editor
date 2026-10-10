const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {test} = require("node:test");
const vm = require("node:vm");
const source = readFileSync(join(__dirname, "../web/image_mask_editor.js"), "utf8")
  .replace(/^import .*;\r?\n/gm, "").split("app.registerExtension(")[0];
const sandbox = {};
vm.runInNewContext(source + "\nglobalThis.Editor = ImageMaskEditorUI;", sandbox);
function editor() {
  const instance = Object.create(sandbox.Editor.prototype);
  Object.assign(instance, {size:{value:"30",min:"1",max:"200"}, sizeValue:{value:"30"},
    updates:0, updateCursor() {this.updates++;}});
  return instance;
}
test("numeric entry changes brush size and updates its cursor", () => {
  const instance = editor();
  instance.setBrushSize("73");
  assert.equal(instance.size.value, "73");
  assert.equal(instance.updates, 1);
});
test("empty entry leaves the brush valid and restores its value on commit", () => {
  const instance = editor();
  instance.sizeValue.value = "";
  instance.setBrushSize("");
  assert.equal(instance.size.value, "30");
  instance.setBrushSize("", true);
  assert.equal(instance.sizeValue.value, "30");
});
test("out of range values are clamped only when committed", () => {
  const instance = editor();
  instance.setBrushSize("500");
  assert.equal(instance.size.value, "30");
  instance.setBrushSize("500", true);
  assert.equal(instance.size.value, "200");
  assert.equal(instance.sizeValue.value, "200");
  instance.setBrushSize("0", true);
  assert.equal(instance.size.value, "1");
});

test("expansion and retention settings default and restore independently of pixel state", () => {
  const instance = editor();
  Object.assign(instance, {node:{properties:{}}, keepEdits:{}, expandPaint:{}, markDirty() {}});
  instance.restoreSettings();
  assert.equal(instance.keepEdits.checked, false);
  assert.equal(instance.expandPaint.checked, true);
  instance.node.properties.image_mask_editor_keep_edits = true;
  instance.node.properties.image_mask_editor_expand = false;
  instance.restoreSettings();
  assert.equal(instance.keepEdits.checked, true);
  assert.equal(instance.expandPaint.checked, false);
});
