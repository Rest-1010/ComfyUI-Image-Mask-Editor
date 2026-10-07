const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {test} = require("node:test");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "../web/image_mask_editor.js"), "utf8")
  .replace(/^import .*;\r?\n/gm, "").split("app.registerExtension(")[0];
const sandbox = {app:{graph:{setDirtyCanvas() {}}}};
vm.runInNewContext(source + "\nglobalThis.Editor = ImageMaskEditorUI;", sandbox);

function editor(width = 1200, scale = 1, saved) {
  const instance = Object.create(sandbox.Editor.prototype);
  const styles = {};
  const attributes = {};
  Object.assign(instance, {
    node:{properties:saved === undefined ? {} : {image_mask_editor_split:saved}},
    panes:{clientWidth:width, style:{setProperty(key, value) {styles[key] = value;}},
      getBoundingClientRect:() => ({width:instance.panes.clientWidth * scale})},
    splitter:{dataset:{}, setAttribute(key, value) {attributes[key] = value;},
      setPointerCapture() {}, hasPointerCapture:() => true, releasePointerCapture() {}},
    history:["mask"], zoom:3, pan:{x:50, y:20}, uploads:0,
    finishStroke() {}, markDirty() {this.uploads++;},
  });
  instance.restoreSplitRatio();
  return {instance, styles, attributes};
}

function event(x, extra = {}) {
  return {clientX:x, button:0, pointerId:1, preventDefault() {}, stopPropagation() {}, ...extra};
}

test("splitter drag respects graph zoom and saves the final ratio", () => {
  const {instance} = editor(1300, 0.5);
  instance.startSplit(event(300));
  instance.moveSplit(event(400));
  assert.ok(Math.abs(instance.splitRatio - (0.46 + 200 / 1290)) < 1e-9);
  assert.equal(instance.node.properties.image_mask_editor_split, undefined);
  instance.finishSplit(event(400));
  assert.equal(instance.node.properties.image_mask_editor_split, instance.splitRatio);
  assert.equal(instance.splitDrag, null);
  assert.equal(instance.history[0], "mask");
  assert.equal(instance.zoom, 3);
  assert.equal(instance.pan.x, 50);
  assert.equal(instance.uploads, 0);
});

test("both panes retain their minimum widths", () => {
  const {instance, styles} = editor(800);
  instance.setSplitRatio(-10);
  assert.ok(instance.visibleSplitRatio * 790 >= 220 - 1e-9);
  instance.setSplitRatio(10);
  assert.ok((1 - instance.visibleSplitRatio) * 790 >= 450 - 1e-9);
  assert.ok(Math.abs(parseFloat(styles["--split-left"]) - 340) < 1e-9);
  instance.setSplitRatio(-10);
  assert.ok(Math.abs(parseFloat(styles["--split-left"]) - 220) < 1e-9);
});

test("saved ratio is restored and survives temporarily narrower nodes", () => {
  const {instance} = editor(1500, 1, 0.65);
  assert.equal(instance.splitRatio, 0.65);
  instance.panes.clientWidth = 800;
  instance.applySplitRatio();
  assert.ok(instance.visibleSplitRatio < 0.65);
  assert.equal(instance.splitRatio, 0.65);
  instance.panes.clientWidth = 1500;
  instance.applySplitRatio();
  assert.equal(instance.visibleSplitRatio, 0.65);
});

test("older workflows and invalid saved values use the default split", () => {
  for (const saved of [undefined, NaN, "wide"]) {
    assert.equal(editor(1200, 1, saved).instance.splitRatio, 0.46);
  }
});
