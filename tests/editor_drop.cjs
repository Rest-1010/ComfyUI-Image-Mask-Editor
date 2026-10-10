const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {test} = require("node:test");
const vm = require("node:vm");
const source = readFileSync(join(__dirname, "../web/image_mask_editor.js"), "utf8")
  .replace(/^import .*;\r?\n/gm, "").split("app.registerExtension(")[0];
const sandbox = {FileReader:class {
  readAsDataURL(file) {this.result = `data:${file.type};base64,test`; this.onload();}
}};
vm.runInNewContext(source + "\nglobalThis.Editor = ImageMaskEditorUI;", sandbox);
function setup(files) {
  const editor = Object.create(sandbox.Editor.prototype);
  const previews = [], errors = [];
  Object.assign(editor, {previewViewport:{dataset:{}}, setPreview:async (...args) => previews.push(args),
    reportError:error => errors.push(error.message), sourceKey:"unchanged", history:["unchanged"]});
  const event = {dataTransfer:{files}, prevented:false, stopped:false,
    preventDefault() {this.prevented = true;}, stopPropagation() {this.stopped = true;}};
  return {editor, event, previews, errors};
}
test("file drop loads the first image into the left preview without transferring or resetting edits", async () => {
  const {editor,event,previews} = setup([{type:"text/plain",name:"notes.txt"},
    {type:"image/png",name:"first.png"}, {type:"image/jpeg",name:"second.jpg"}]);
  await editor.dropImage(event);
  assert.equal(previews.length, 1);
  assert.equal(previews[0][1], "first.png");
  assert.equal(editor.sourceKey, "unchanged");
  assert.deepEqual(editor.history, ["unchanged"]);
  assert.ok(event.prevented && event.stopped);
});
test("image extension is accepted when the OS supplies no MIME type", async () => {
  const {editor,event,previews} = setup([{type:"",name:"photo.PNG"}]);
  await editor.dropImage(event);
  assert.equal(previews[0][1], "photo.PNG");
});
test("non-image file drops are blocked without replacing the preview", async () => {
  const {editor,event,previews,errors} = setup([{type:"application/json",name:"workflow.json"}]);
  await editor.dropImage(event);
  assert.equal(previews.length, 0);
  assert.equal(errors.length, 1);
  assert.ok(event.prevented && event.stopped);
});
test("non-file drags are left alone", async () => {
  const {editor,event} = setup([]);
  await editor.dropImage(event);
  assert.equal(event.prevented, false);
});
test("release version is recorded as 1.0.8", () => {
  assert.equal(readFileSync(join(__dirname, "../VERSION"), "utf8").trim(), "1.0.8");
});

test("drag highlight survives child crossings and clears on exit and drop", async () => {
  const {editor,event} = setup([{type:"image/png",name:"photo.png"}]);
  Object.assign(event.dataTransfer, {types:["Files"], items:[{kind:"file",type:"image/png"}]});
  event.type = "dragenter";
  editor.previewDrag(event);
  editor.previewDrag(event);
  assert.equal(editor.previewViewport.dataset.dropActive, "true");
  event.type = "dragleave";
  editor.previewDrag(event);
  assert.equal(editor.previewViewport.dataset.dropActive, "true");
  editor.previewDrag(event);
  assert.equal(editor.previewViewport.dataset.dropActive, "false");
  event.type = "dragenter";
  editor.previewDrag(event);
  await editor.dropImage(event);
  assert.equal(editor.previewViewport.dataset.dropActive, "false");
  assert.equal(editor.previewDragDepth, 0);
});

test("known non-image files do not highlight the drop area", () => {
  const {editor,event} = setup([]);
  event.type = "dragenter";
  Object.assign(event.dataTransfer, {types:["Files"], items:[{kind:"file",type:"application/json"}]});
  editor.previewDrag(event);
  assert.notEqual(editor.previewViewport.dataset.dropActive, "true");
});
