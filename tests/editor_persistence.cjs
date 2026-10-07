const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {test} = require("node:test");
const vm = require("node:vm");
const source = readFileSync(join(__dirname, "../web/image_mask_editor.js"), "utf8")
  .replace(/^import .*;\r?\n/gm, "").split("app.registerExtension(")[0];
const sandbox = {app:{graph:{setDirtyCanvas() {}}}, api:{fetchApi() {throw Error("Unexpected upload");}},
  document:{createElement:() => ({getContext:() => ({drawImage() {}}), toDataURL:() => "data:image/png;base64,source"})}};
vm.runInNewContext(source + "\nglobalThis.Editor = ImageMaskEditorUI; globalThis.addPaintWidget = addPaintWidget;", sandbox);
function node() {
  const n = {widgets:[{name:"paint",value:"old-mask.png",options:{}}]};
  sandbox.addPaintWidget(n);
  const editor = Object.create(sandbox.Editor.prototype);
  Object.assign(editor, {ready:Promise.resolve(), finishStroke() {}, sourceKey:"", background:null,
    layers:["paint","mask"].map(name => ({toDataURL:() => `data:image/png;base64,${name}`}))});
  n.sketchEditor = editor;
  return n;
}
test("strokes stay in memory; execution returns inline images without changing workflow state", async () => {
  const n = node();
  let count = 0;
  n.sketchEditor.layers.forEach(layer => {const encode = layer.toDataURL; layer.toDataURL = () => {count++; return encode();};});
  for (let i=0;i<50;i++) n.sketchEditor.markDirty();
  assert.equal(count, 0);
  const value = JSON.parse(await n.widgets[0].serializeValue());
  assert.equal(value.mask, "data:image/png;base64,mask");
  assert.equal(value.paint, "data:image/png;base64,paint");
  assert.equal(n.widgets[0].value, "old-mask.png");
  assert.equal(count, 2);
  await n.widgets[0].serializeValue();
  assert.equal(count, 2);
});
test("serialization waits for transfer and uses the latest edited mask", async () => {
  const n = node();
  let release;
  n.sketchEditor.transfer = new Promise(resolve => {release=resolve;});
  const queued = n.widgets[0].serializeValue();
  n.sketchEditor.layers[1].toDataURL = () => "data:image/png;base64,new-mask";
  n.sketchEditor.markDirty();
  release();
  assert.equal(JSON.parse(await queued).mask, "data:image/png;base64,new-mask");
  n.sketchEditor.layers[1].toDataURL = () => "data:image/png;base64,next-mask";
  n.sketchEditor.markDirty();
  assert.equal(JSON.parse(await n.widgets[0].serializeValue()).mask, "data:image/png;base64,next-mask");
});
test("a previously file-backed background is encoded from loaded pixels rather than sent as a path", async () => {
  const n = node();
  Object.assign(n.sketchEditor, {sourceKey:"missing-now.png [input]",background:{naturalWidth:8,naturalHeight:4}});
  assert.equal(JSON.parse(await n.widgets[0].serializeValue()).source, "data:image/png;base64,source");
});
test("encoding failures block execution and leave the workflow data intact", async () => {
  const n = node();
  n.sketchEditor.layers[1].toDataURL = () => {throw Error("encode failed");};
  await assert.rejects(n.widgets[0].serializeValue(), /encode failed/);
  assert.equal(n.widgets[0].value, "old-mask.png");
});
