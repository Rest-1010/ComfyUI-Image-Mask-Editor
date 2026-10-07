const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "../web/image_mask_editor.js"), "utf8")
  .replace(/^import .*;\r?\n/gm, "")
  .split("app.registerExtension(")[0];
const sandbox = {};
vm.runInNewContext(source + "\nglobalThis.Editor = ImageMaskEditorUI;", sandbox);

function editor(width = 800, height = 400, viewWidth = 700, viewHeight = 338) {
  const instance = Object.create(sandbox.Editor.prototype);
  Object.assign(instance, {
    background: {},
    layers: [{ width, height }], zoom: 1, pan: { x: 0, y: 0 },
    canvas: { width: viewWidth, height: viewHeight, style: {},
      getBoundingClientRect: () => ({ left: 10, top: 20, width: viewWidth * 0.8, height: viewHeight * 0.8 }),
      setPointerCapture() {}, hasPointerCapture: () => false },
    gesture: null, redoHistory: [], strokes: [], saves: 0, dirty: 0,
    render() {}, updateCursor() {},
    drawSegment(from, to) { this.strokes.push([from, to]); },
    remember() { this.saves++; }, markDirty() { this.dirty++; },
  });
  return instance;
}

function event(x, y, extra = {}) {
  return { clientX: x, clientY: y, pointerId: 1, button: 0,
    preventDefault() {}, stopPropagation() {}, ...extra };
}

test("wide and tall images fit even in short viewports", () => {
  for (const [width, height, vw, vh] of [[800,400,480,129], [400,800,700,338], [800,400,1000,100]]) {
    const view = editor(width, height, vw, vh).transform();
    assert.ok(width * view.scale <= vw);
    assert.ok(height * view.scale <= vh);
    assert.equal((width * view.scale) / (height * view.scale), width / height);
  }
});

test("wheel zoom keeps the image coordinate under the pointer", () => {
  const instance = editor();
  const e = event(183, 109, { deltaY: -500, deltaMode: 0 });
  const local = instance.localPoint(e);
  const before = instance.imagePoint(local);
  instance.wheel(e);
  const after = instance.imagePoint(local);
  assert.ok(instance.zoom > 1);
  assert.ok(Math.abs(before.x - after.x) < 1e-9);
  assert.ok(Math.abs(before.y - after.y) < 1e-9);
  assert.equal(instance.dirty, 0);
});

test("Shift left drag pans without painting or changing history", () => {
  const instance = editor();
  instance.zoom = 4;
  const before = instance.imagePoint({ x: 350, y: 169 });
  instance.startStroke(event(170, 100, { shiftKey: true }));
  instance.move(event(250, 140, { shiftKey: true }));
  instance.finishStroke(event(250, 140));
  assert.equal(instance.pan.x, 100);
  assert.ok(Math.abs(instance.pan.y - 50) < 1e-9);
  assert.equal(instance.strokes.length, 0);
  assert.equal(instance.saves, 0);
  assert.equal(instance.dirty, 0);
  assert.notEqual(instance.imagePoint({ x: 350, y: 169 }).x, before.x);
  instance.resetView();
  assert.equal(instance.zoom, 1);
  assert.equal(instance.pan.x, 0);
});

test("ordinary drawing uses image coordinates after zoom and pan", () => {
  const instance = editor();
  instance.zoom = 3;
  instance.pan = { x: 40, y: -20 };
  const e = event(250, 150);
  const expected = instance.imagePoint(instance.localPoint(e));
  instance.startStroke(e);
  instance.finishStroke(e);
  assert.equal(instance.strokes[0][0].x, expected.x);
  assert.equal(instance.strokes[0][0].y, expected.y);
  assert.equal(instance.saves, 1);
  assert.equal(instance.dirty, 1);
});

test("line previews always start at the anchor and commit one undo step", () => {
  const instance = editor();
  instance.layers[0].getContext = () => ({getImageData: () => "before", putImageData() {}});
  instance.lineTool = true;
  instance.zoom = 3;
  instance.pan = {x:40, y:-20};
  const start = event(200, 140);
  const end = event(330, 190);
  const anchor = instance.imagePoint(instance.localPoint(start));
  const destination = instance.imagePoint(instance.localPoint(end));
  instance.startStroke(start);
  instance.move(event(300, 270));
  instance.move(event(220, 160));
  assert.equal(instance.saves, 0);
  assert.equal(instance.dirty, 0);
  instance.finishStroke(end);
  for (const [from] of instance.strokes) assert.deepEqual(from, anchor);
  assert.deepEqual(instance.strokes.at(-1)[1], destination);
  assert.equal(instance.saves, 1);
  assert.equal(instance.dirty, 1);
  assert.equal(instance.strokeTiles, null);
});

test("cancelling a line restores existing layers and keeps redo history", () => {
  const instance = editor();
  const restored = [];
  instance.layers[0].getContext = () => ({getImageData: () => "before", putImageData(pixels) {restored.push(pixels);}});
  instance.lineTool = true;
  instance.redoHistory = ["redo"];
  instance.startStroke(event(200, 140));
  instance.strokeTiles.set("0:0:0", {index:0, x:0, y:0, pixels:"before"});
  instance.move(event(350, 200));
  instance.finishStroke(event(350, 200), true);
  assert.equal(restored.at(-1), "before");
  assert.equal(instance.redoHistory[0], "redo");
  assert.equal(instance.saves, 0);
  assert.equal(instance.dirty, 0);
});

test("Shift drag still pans when the line tool is selected", () => {
  const instance = editor();
  instance.lineTool = true;
  instance.startStroke(event(170, 100, {shiftKey:true}));
  instance.move(event(250, 140));
  instance.finishStroke(event(250, 140));
  assert.equal(instance.pan.x, 100);
  assert.equal(instance.strokes.length, 0);
  assert.equal(instance.saves, 0);
});

function previewEditor() {
  const instance = editor();
  Object.assign(instance, {previewZoom:1, previewPan:{x:0,y:0},
    previewImage:{hidden:false,style:{},naturalWidth:1024,naturalHeight:768},
    previewViewport:{clientWidth:400,clientHeight:300,style:{},
      getBoundingClientRect:() => ({left:10,top:20,width:200,height:150}),
      setPointerCapture() {}, hasPointerCapture:() => false}});
  return instance;
}

test("Shift wheel changes brush size instead of zoom and obeys the limits", () => {
  const instance = editor();
  Object.assign(instance, {size:{value:"30",min:"1",max:"200"},sizeValue:{value:"30"}});
  instance.wheel(event(100, 100, {shiftKey:true,deltaY:-100}));
  assert.equal(instance.size.value, "29");
  assert.equal(instance.sizeValue.value, "29");
  instance.wheel(event(100, 100, {shiftKey:true,deltaY:100}));
  assert.equal(instance.size.value, "30");
  assert.equal(instance.zoom, 1);
  instance.size.value = "200";
  instance.wheel(event(100, 100, {shiftKey:true,deltaY:100}));
  assert.equal(instance.size.value, "200");
  instance.size.value = "1";
  instance.wheel(event(100, 100, {shiftKey:true,deltaY:-100}));
  assert.equal(instance.size.value, "1");
});

test("preview wheel keeps the pointer anchor fixed without changing image dimensions", () => {
  const instance = previewEditor();
  const e = event(160, 120, {deltaY:-500,deltaMode:0});
  const point = instance.previewPoint(e);
  instance.zoomPreview(e);
  assert.ok(instance.previewZoom > 1);
  assert.ok(Math.abs((point.x - 200 - instance.previewPan.x) / instance.previewZoom - (point.x - 200)) < 1e-9);
  assert.ok(Math.abs((point.y - 150 - instance.previewPan.y) / instance.previewZoom - (point.y - 150)) < 1e-9);
  assert.equal(instance.previewImage.naturalWidth, 1024);
  assert.equal(instance.dirty, 0);
});

test("preview Shift drag respects graph zoom and reset restores the fitted view", () => {
  const instance = previewEditor();
  instance.startPreviewPan(event(80, 70, {shiftKey:true}));
  instance.movePreviewPan(event(100, 80));
  assert.equal(instance.previewPan.x, 40);
  assert.equal(instance.previewPan.y, 20);
  instance.finishPreviewPan(event(100, 80));
  assert.equal(instance.previewPanDrag, null);
  instance.resetPreviewView();
  assert.equal(instance.previewZoom, 1);
  assert.equal(instance.previewPan.x, 0);
  assert.equal(instance.previewPan.y, 0);
  assert.equal(instance.strokes.length, 0);
});
