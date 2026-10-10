const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {test} = require("node:test");
const vm = require("node:vm");
const source = readFileSync(join(__dirname, "../web/image_mask_editor.js"), "utf8")
  .replace(/^import .*;\r?\n/gm, "").split("app.registerExtension(")[0];
function setup() {
  const draws = [], timers = [];
  const canvas = {getContext:() => ({drawImage:(...args) => draws.push(args)}),
    toBlob(callback, type) {assert.equal(type, "image/png"); callback({png:true});}};
  const link = {clicks:0,click() {this.clicks++;},remove() {this.removed=true;}};
  const downloads = [];
  const sandbox = {fetch:async url => ({blob:async () => {downloads.push(url);return {metadata:true};}}),
    document:{createElement:type => type === "canvas" ? canvas : link,body:{append() {}}},
    URL:{createObjectURL:() => "blob:test",revokeObjectURL() {}},setTimeout:callback => timers.push(callback)};
  vm.runInNewContext(source + "\nglobalThis.Editor = ImageMaskEditorUI;", sandbox);
  const editor = Object.create(sandbox.Editor.prototype);
  Object.assign(editor, {previewImage:{hidden:false,naturalWidth:1024,naturalHeight:768},
    previewName:"result.jpg",previewZoom:4,previewPan:{x:50,y:20}});
  return {editor,canvas,link,draws,timers,downloads};
}
test("download saves the left image at native resolution regardless of preview zoom", async () => {
  const {editor,canvas,link,draws,timers} = setup();
  await editor.savePreview();
  assert.equal(canvas.width, 1024);
  assert.equal(canvas.height, 768);
  assert.equal(draws[0][0], editor.previewImage);
  assert.equal(link.download, "result.png");
  assert.equal(link.clicks, 1);
  assert.equal(link.removed, true);
  assert.equal(timers.length, 1);
});
test("missing preview does not start a download", async () => {
  const {editor,link} = setup();
  editor.previewImage.hidden = true;
  await editor.savePreview();
  assert.equal(link.clicks, 0);
});

test("save downloads the original PNG rather than stripping its metadata through canvas", async () => {
  const {editor,draws,downloads,link} = setup();
  editor.previewKey = "data:image/png;base64,metadata-snapshot";
  await editor.savePreview();
  assert.deepEqual(downloads, [editor.previewKey]);
  assert.equal(draws.length, 0);
  assert.equal(link.clicks, 1);
});
