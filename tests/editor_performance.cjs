const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {test} = require("node:test");
const vm = require("node:vm");
const source = readFileSync(join(__dirname, "../web/image_mask_editor.js"), "utf8")
  .replace(/^import .*;\r?\n/gm, "").split("app.registerExtension(")[0];

function setup() {
  const frames = [];
  const timers = [];
  const sandbox = {app:{graph:{setDirtyCanvas() {}}}, cancelAnimationFrame() {}, requestAnimationFrame: callback => {frames.push(callback); return frames.length;},
    setTimeout: callback => timers.push(callback)};
  vm.runInNewContext(source + "\nglobalThis.Editor = ImageMaskEditorUI;", sandbox);
  return {editor:Object.create(sandbox.Editor.prototype), frames, timers};
}

test("many redraw requests produce one frame without resizing source layers", () => {
  const {editor, frames} = setup();
  let count = 0;
  editor.renderNow = () => count++;
  editor.layers = [{width:4096, height:6144}];
  for (let i = 0; i < 100; i++) editor.render();
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(count, 1);
  editor.render();
  assert.equal(frames.length, 1);
  assert.equal(editor.layers[0].width, 4096);
});

test("coalesced pointer samples all become connected stroke segments", () => {
  const {editor} = setup();
  const points = [{x:1,y:2}, {x:3,y:4}, {x:5,y:6}];
  const segments = [];
  Object.assign(editor, {gesture:"draw", lastPoint:{x:0,y:0}, localPoint:e => e,
    imagePoint:p => p, updateCursor() {}, drawSegment:(a,b) => segments.push([a,b])});
  editor.move({stopPropagation() {}, getCoalescedEvents:() => points});
  assert.equal(segments.length, 3);
  assert.equal(segments[1][0], points[0]);
  assert.equal(editor.lastPoint, points[2]);
});

test("large images retain thirty small edits instead of whole-layer snapshots", () => {
  const {editor} = setup();
  Object.assign(editor, {history:[], redoHistory:[], layers:[0,1].map(() => ({width:4096,height:6144,
    getContext:() => ({getImageData:(x,y,width,height) => ({width,height})})}))});
  for (let i = 0; i < 30; i++) {
    editor.strokeTiles = new Map();
    editor.captureTiles(10, 10, 20, 20, [0]);
    editor.remember();
  }
  assert.equal(editor.history.length, 30);
  assert.equal(editor.history[0].patches.length, 1);
  assert.equal(editor.history[0].patches[0].pixels.width, 128);
});

test("strokes schedule no uploads or delayed saves", () => {
  const {editor, timers} = setup();
  let count = 0;
  Object.assign(editor, {layers:[{toDataURL:() => count++}]});
  editor.markDirty();
  editor.markDirty();
  assert.equal(count, 0);
  assert.equal(timers.length, 0);
  assert.equal(count, 0);
});

function pixelEditor() {
  const {editor} = setup();
  const layers = [0, 1].map(() => {
    const data = new Uint8Array(256 * 256 * 4);
    const context = {
      getImageData(x, y, width, height) {
        const pixels = new Uint8Array(width * height * 4);
        for (let row = 0; row < height; row++) pixels.set(data.subarray(((y + row) * 256 + x) * 4,
          ((y + row) * 256 + x + width) * 4), row * width * 4);
        return {width, height, data:pixels};
      },
      putImageData(pixels, x, y) {
        for (let row = 0; row < pixels.height; row++) data.set(pixels.data.subarray(row * pixels.width * 4,
          (row + 1) * pixels.width * 4), ((y + row) * 256 + x) * 4);
      },
      clearRect() {data.fill(0);},
    };
    return {width:256, height:256, data, getContext:() => context};
  });
  Object.assign(editor, {layers, history:[], redoHistory:[], gesture:null,
    render() {}, markDirty() {}});
  return editor;
}

test("viewport resizing redraws immediately instead of presenting an empty frame", () => {
  const {editor, frames} = setup();
  const drawn = [];
  Object.assign(editor, {viewport:{clientWidth:450,clientHeight:300}, canvas:{width:600,height:300},
    renderNow() {drawn.push(this.canvas.width);}, updateCursor() {}});
  editor.render();
  assert.equal(frames.length, 1);
  editor.resizeViewport();
  assert.deepEqual(drawn, [450]);
  assert.equal(editor.renderFrame, null);
  editor.resizeViewport();
  assert.equal(drawn.length, 1);
});

test("patches swap exact paint and mask pixels through repeated undo/redo", () => {
  const editor = pixelEditor();
  for (let value = 1; value <= 3; value++) {
    editor.strokeTiles = new Map();
    editor.captureTiles(5, 5, 10, 10, [0, 1]);
    editor.layers[0].data[0] = value;
    editor.layers[1].data[0] = value + 10;
    editor.captureTiles(5, 5, 10, 10, [0, 1]);
    assert.equal(editor.strokeTiles.size, 2);
    editor.remember();
  }
  for (const value of [2, 1, 0]) {
    editor.undo();
    assert.equal(editor.layers[0].data[0], value);
    assert.equal(editor.layers[1].data[0], value ? value + 10 : 0);
  }
  for (const value of [1, 2, 3]) {
    editor.redo();
    assert.equal(editor.layers[0].data[0], value);
    assert.equal(editor.layers[1].data[0], value + 10);
  }
});

test("clear restores both layers and changes outside a patch are untouched", () => {
  const editor = pixelEditor();
  editor.layers[0].data[0] = 7;
  editor.layers[1].data[editor.layers[1].data.length - 1] = 99;
  editor.clear();
  assert.equal(editor.layers[0].data[0], 0);
  editor.undo();
  assert.equal(editor.layers[0].data[0], 7);
  assert.equal(editor.layers[1].data.at(-1), 99);
  editor.redo();
  assert.equal(editor.layers[1].data.at(-1), 0);
  editor.strokeTiles = new Map();
  editor.captureTiles(0, 0, 20, 20, [0]);
  editor.layers[0].data[0] = 25;
  editor.remember();
  editor.layers[0].data[editor.layers[0].data.length - 1] = 33;
  editor.undo();
  assert.equal(editor.layers[0].data.at(-1), 33);
});
