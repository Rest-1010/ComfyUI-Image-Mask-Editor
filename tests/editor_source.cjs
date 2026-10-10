const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "../web/image_mask_editor.js"), "utf8")
  .replace(/^import .*;\r?\n/gm, "")
  .split("app.registerExtension(")[0];

function editor() {
  const pending = new Map();
  const requestAnimationFrame = callback => { queueMicrotask(callback); return 1; };
  const sandbox = { URLSearchParams, api: {apiURL: path => new URLSearchParams(path.split("?")[1]).get("filename")}, app: { graph: { setDirtyCanvas() {} } }, document: {createElement() {
    const canvas = {width:0, height:0};
    canvas.toDataURL = () => "data:image/png;base64,reloaded";
    canvas.getContext = () => ({
      putImageData(pixels) { canvas.pixels = pixels; },
      drawImage(original) { canvas.pixels = original.pixels; },
      getImageData() { return {...canvas.pixels, width:canvas.width, height:canvas.height}; },
    });
    return canvas;
  }}, Image: class {
    naturalWidth = 8;
    naturalHeight = 4;
    set src(value) { this.url = value; pending.set(value, this); }
  } };
  Object.assign(sandbox, {requestAnimationFrame, setTimeout});
  vm.runInNewContext(source + "\nglobalThis.Editor = ImageMaskEditorUI;", sandbox);
  const instance = Object.create(sandbox.Editor.prototype);
  Object.assign(instance, { ready: Promise.resolve(), sourceKey: "", pendingSource: "", background: null,
    storeAsset: async value => value,
    history: [], redoHistory: [], paintWidget: { value: "" }, zoom: 1, pan: { x: 0, y: 0 }, previewMessage:{hidden:true},
    canvas: { width: 500, height: 250 }, rendered: [], previewRequest:0,
    previewImage:{hidden:false}, previewCaption:{textContent:"missing.png"}, sendButton:{disabled:false},
    previewSize:{textContent:""}, editorSize:{textContent:""},
    savePreviewButton:{disabled:true},
    context: { clearRect() {}, save() {}, restore() {}, translate() {}, scale() {},
      drawImage(image) { instance.rendered.push(image); } },
    layers: ["paint", "mask"].map(name => ({ width: 8, height: 4,
      getContext: () => ({ drawImage() {}, getImageData: () => ({name, width:8, height:4}) }),
      toDataURL: () => "data:image/png;base64," + name,
    })),
  });
  return { instance, complete(url) { pending.get(url).onload(); }, fail(url) {pending.get(url).onerror();}, pending };
}

test("cached source redraw preserves mask, zoom, and undo history", async () => {
  const { instance, complete } = editor();
  const first = instance.setSource("source");
  await new Promise(resolve => setImmediate(resolve));
  complete("source");
  await first;
  assert.ok(instance.rendered.includes(instance.background));
  const value = instance.paintWidget.value;
  const history = instance.history;
  instance.zoom = 3;
  instance.pan.x = 42;
  await instance.setSource("source");
  assert.equal(instance.paintWidget.value, value);
  assert.equal(instance.history, history);
  assert.equal(instance.zoom, 3);
  assert.equal(instance.pan.x, 42);
});

test("Send inpaint replaces only the background and retains undo and redo", async () => {
  const { instance, complete } = editor();
  const first = instance.setSource("first");
  await new Promise(resolve => setImmediate(resolve));
  complete("first");
  await first;
  for (let i = 0; i < 2; i++) {
    instance.strokeTiles = new Map();
    instance.captureTiles(0, 0, 8, 4, [0, 1]);
    instance.remember();
  }
  const undo = instance.history[0];
  const redo = instance.history[1];
  instance.redoHistory = [redo];
  const second = instance.setSource("second");
  await new Promise(resolve => setImmediate(resolve));
  complete("second");
  await second;
  assert.equal(instance.history[0], undo);
  assert.equal(instance.redoHistory[0], redo);
  assert.equal(instance.background.url, "second");
  assert.equal(instance.sourceKey, "second");
});

test("a late older preview cannot replace the newest input image", async () => {
  const { instance, complete, pending } = editor();
  const old = instance.setSource("old");
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(pending.has("old"));
  const recent = instance.setSource("recent");
  await new Promise(resolve => setImmediate(resolve));
  complete("recent");
  await recent;
  complete("old");
  await old;
  assert.equal(instance.background.url, "recent");
  assert.equal(instance.sourceKey, "recent");
});

test("a successful transfer clears edits only after loading; a failed transfer does not", async () => {
  const {instance, complete, fail} = editor();
  let clears = 0;
  instance.clear = () => {clears++; assert.equal(instance.background.url, "new");};
  const transfer = instance.setSource("new", true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(clears, 0);
  complete("new"); await transfer;
  assert.equal(clears, 1);
  const failed = instance.setSource("missing", true);
  const rejection = assert.rejects(failed);
  await new Promise(resolve => setImmediate(resolve));
  fail("missing"); await rejection;
  assert.equal(clears, 1);
});

test("different image dimensions resize both undo and redo snapshots", () => {
  const {instance} = editor();
  const old = {width:800, height:400, patches:["paint", "mask"].map((name, index) =>
    ({index, x:0, y:0, pixels:{name, width:800, height:400}}))};
  instance.history = instance.resizeHistory([old], 400, 800);
  instance.redoHistory = instance.resizeHistory([old], 400, 800);
  for (const history of [instance.history, instance.redoHistory]) {
    assert.equal(history[0].patches[0].pixels.width, 400);
    assert.equal(history[0].patches[1].pixels.height, 800);
    assert.equal(history[0].patches[1].pixels.name, "mask");
  }
});

test("missing preview hides the broken image, disables transfer, and recovers after reload", async () => {
  const {instance, complete, fail} = editor();
  const failed = instance.setPreview("missing.png");
  const rejection = assert.rejects(failed);
  await new Promise(resolve => setImmediate(resolve));
  fail("missing.png");
  await rejection;
  assert.equal(instance.previewImage.hidden, true);
  assert.equal(instance.previewMessage.hidden, false);
  assert.equal(instance.sendButton.disabled, true);
  const reloaded = instance.setPreview("found.png", "found.png");
  await new Promise(resolve => setImmediate(resolve));
  complete("found.png");
  await reloaded;
  assert.equal(instance.previewImage.hidden, false);
  assert.equal(instance.previewMessage.hidden, true);
  assert.equal(instance.sendButton.disabled, false);
});

test("an older failed preview does not hide a newer successful load", async () => {
  const {instance, complete, fail} = editor();
  const old = instance.setPreview("old.png");
  await new Promise(resolve => setImmediate(resolve));
  const current = instance.setPreview("current.png");
  await new Promise(resolve => setImmediate(resolve));
  complete("current.png");
  await current;
  fail("old.png");
  await old;
  assert.equal(instance.previewImage.hidden, false);
  assert.equal(instance.previewMessage.hidden, true);
  assert.equal(instance.sendButton.disabled, false);
});

test("missing saved source and mask do not block reload; available paint is preserved", async () => {
  const {instance, complete, fail} = editor();
  const saved = JSON.stringify({source:"missing-source.png",paint:"paint.png",mask:"missing-mask.png"});
  instance.paintWidget.value = saved;
  const paints = [];
  instance.layers[0].getContext = () => ({drawImage:image => paints.push(image.url)});
  instance.ready = instance.restoreLayers();
  await new Promise(resolve => setImmediate(resolve));
  fail("missing-source.png");
  complete("paint.png");
  fail("missing-mask.png");
  await instance.ready;
  assert.deepEqual(paints, ["paint.png"]);
  assert.equal(instance.paintWidget.value, saved);
  const reload = instance.setPreview("new.png", "new.png");
  await new Promise(resolve => setImmediate(resolve));
  complete("new.png");
  await reload;
  assert.equal(instance.sendButton.disabled, false);
  const transfer = instance.setSource(instance.previewKey);
  await new Promise(resolve => setImmediate(resolve));
  complete(instance.previewKey);
  await transfer;
  assert.equal(instance.background.url, instance.previewKey);
  assert.deepEqual(paints, ["paint.png"]);
});

test("all missing saved assets still allow a new image to load", async () => {
  const {instance, complete, fail} = editor();
  instance.paintWidget.value = JSON.stringify({source:"source.png",paint:"paint.png",mask:"mask.png"});
  instance.ready = instance.restoreLayers();
  await new Promise(resolve => setImmediate(resolve));
  for (const name of ["source.png", "paint.png", "mask.png"]) fail(name);
  await instance.ready;
  const reload = instance.setPreview("fresh.png");
  await new Promise(resolve => setImmediate(resolve));
  complete("fresh.png");
  await reload;
  assert.equal(instance.previewImage.hidden, false);
  assert.equal(instance.sendButton.disabled, false);
});

test("left and right dimensions track their own images independently", async () => {
  const {instance, complete, pending} = editor();
  const right = instance.setSource("right.png");
  await new Promise(resolve => setImmediate(resolve));
  Object.assign(pending.get("right.png"), {naturalWidth:1024,naturalHeight:768});
  complete("right.png");
  await right;
  const left = instance.setPreview("left.png");
  await new Promise(resolve => setImmediate(resolve));
  Object.assign(pending.get("left.png"), {naturalWidth:512,naturalHeight:1024});
  complete("left.png");
  await left;
  assert.equal(instance.previewSize.textContent, "512×1024");
  assert.equal(instance.editorSize.textContent, "1024×768");
  instance.showMissingPreview();
  assert.equal(instance.previewSize.textContent, "");
  assert.equal(instance.editorSize.textContent, "1024×768");
});

test("PNG preview data remains byte-for-byte intact, including generation metadata", async () => {
  const {instance, complete} = editor();
  const url = "data:image/png;base64,with-metadata";
  const loaded = instance.setPreview(url);
  await new Promise(resolve => setImmediate(resolve));
  complete(url); await loaded;
  assert.equal(instance.previewKey, url);
});
