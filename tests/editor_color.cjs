const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {test} = require("node:test");
const vm = require("node:vm");
const source = readFileSync(join(__dirname, "../web/image_mask_editor.js"), "utf8")
  .replace(/^import .*;\r?\n/gm, "").split("app.registerExtension(")[0];

function editor(EyeDropper) {
  const draws = [];
  const sandbox = {window:{EyeDropper}, console, document:{createElement() {
    return {getContext:() => ({drawImage(...args) {draws.push(args);},
      getImageData:() => ({data:Uint8ClampedArray.from([18, 52, 86, 255])})})};
  }}};
  vm.runInNewContext(source + "\nglobalThis.Editor = ImageMaskEditorUI;", sandbox);
  const instance = Object.create(sandbox.Editor.prototype);
  const button = () => ({setAttribute() {}, style:{}});
  Object.assign(instance, {eyedropperButton:button(), maskButton:button(), eraserButton:button(),
    color:{value:"#ff0000"}, canvas:{style:{}}, cursor:{style:{}}, finishStroke() {},
    mode:"mask", history:["drawing"], previewImage:{style:{}, naturalWidth:800, naturalHeight:400,
      getBoundingClientRect:() => ({left:10, top:20, width:400, height:400})}});
  return {instance, draws};
}

test("native eyedropper changes paint color without editing masks or history", async () => {
  const {instance} = editor(class {async open() {return {sRGBHex:"#123456"};}});
  await instance.pickColor();
  assert.equal(instance.color.value, "#123456");
  assert.equal(instance.mode, "paint");
  assert.equal(instance.history[0], "drawing");
  assert.equal(instance.eyedropperButton.disabled, false);
});

test("cancelling the native eyedropper leaves selected color unchanged", async () => {
  const {instance} = editor(class {async open() {throw Object.assign(new Error("cancelled"), {name:"AbortError"});}});
  await instance.pickColor();
  assert.equal(instance.color.value, "#ff0000");
  assert.equal(instance.mode, "mask");
  assert.equal(instance.eyedropperButton.disabled, false);
});

test("unsupported browser toggles the local image picker", async () => {
  const {instance} = editor();
  await instance.pickColor();
  assert.equal(instance.colorPicking, true);
  assert.equal(instance.canvas.style.cursor, "crosshair");
  await instance.pickColor();
  assert.equal(instance.colorPicking, false);
});

test("preview picking accounts for aspect-fit padding and ignores letterbox clicks", () => {
  const {instance, draws} = editor();
  instance.colorPicking = true;
  const event = (x,y) => ({clientX:x, clientY:y, button:0, preventDefault() {}, stopPropagation() {}});
  instance.pickPreviewPixel(event(210, 70));
  assert.equal(draws.length, 0);
  instance.pickPreviewPixel(event(210, 220));
  assert.equal(draws[0][1], 400);
  assert.equal(draws[0][2], 200);
  assert.equal(instance.color.value, "#123456");
  assert.equal(instance.colorPicking, false);
});

test("editor sampling composites paint but never the colored mask overlay", () => {
  const {instance, draws} = editor();
  const background = {naturalWidth:800, naturalHeight:400};
  const paint = {};
  instance.pickPixel(background, 15, 20, paint);
  assert.equal(draws.length, 2);
  assert.equal(draws[0][0], background);
  assert.equal(draws[1][0], paint);
});

test("right click on the preview does not pick a color or start panning", () => {
  const {instance, draws} = editor();
  instance.startPreviewPan({button:2, clientX:210, clientY:220, preventDefault() {}, stopPropagation() {}});
  assert.equal(draws.length, 0);
  assert.equal(instance.color.value, "#ff0000");
  assert.equal(instance.previewPanDrag, undefined);
  assert.equal(instance.history.length, 1);
});

test("right click samples editor image coordinates and paint without starting a stroke", () => {
  const {instance, draws} = editor();
  const background = {naturalWidth:800,naturalHeight:400};
  const paint = {};
  Object.assign(instance, {background, layers:[paint,{}],localPoint:() => ({x:10,y:20}),
    imagePoint:p => ({x:p.x * 2,y:p.y * 2})});
  instance.startStroke({button:2,preventDefault() {},stopPropagation() {}});
  assert.equal(draws[0][1], 20);
  assert.equal(draws[0][2], 40);
  assert.equal(draws[1][0], paint);
  assert.equal(instance.color.value, "#123456");
  assert.equal(instance.gesture, undefined);
  assert.equal(instance.history.length, 1);
});
