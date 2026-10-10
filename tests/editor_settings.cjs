const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {test} = require("node:test");
const vm = require("node:vm");
const source = readFileSync(join(__dirname, "../web/image_mask_editor.js"), "utf8")
  .replace(/^import .*;\r?\n/gm, "").split("app.registerExtension(")[0];

test("editor has no common footer and persists expansion and transfer checkboxes", async () => {
  function element() {
    return {children:[], listeners:{}, style:{setProperty() {}}, clientWidth:900,
      append(...items) {this.children.push(...items);},
      setAttribute() {}, addEventListener(type, callback) {this.listeners[type] = callback;},
      getContext() {return {};}};
  }
  const sandbox = {document:{createElement:element, createTextNode:text => ({textContent:text})},
    app:{graph:{setDirtyCanvas() {}}}, ResizeObserver:class {observe() {}}};
  vm.runInNewContext(source + "\nglobalThis.Editor = ImageMaskEditorUI;", sandbox);
  const node = {id:1,properties:{}};
  const editor = new sandbox.Editor(node, {value:""});
  assert.equal(editor.element.children[0], editor.panes);
  assert.equal(editor.element.children.length, 1);
  assert.equal(editor.expandPaint.checked, true);
  assert.equal(editor.keepEdits.checked, false);
  editor.expandPaint.checked = false;
  editor.expandPaint.listeners.change();
  const transfers = [];
  editor.previewKey = "preview";
  editor.setSource = async (...args) => transfers.push(args);
  editor.sendButton.listeners.click(); await editor.transfer;
  editor.keepEdits.checked = true;
  editor.keepEdits.listeners.change();
  editor.sendButton.listeners.click(); await editor.transfer;
  assert.deepEqual(transfers, [["preview",true],["preview",false]]);
  const restored = new sandbox.Editor({id:2,properties:JSON.parse(JSON.stringify(node.properties))}, {value:""});
  assert.equal(restored.keepEdits.checked, true);
  assert.equal(restored.expandPaint.checked, false);
});

test("Prepare uses its standard numeric widget and labels do not change input identifiers", () => {
  const sandbox = {app:{registerExtension(extension) {this.extension=extension;}}};
  const fullSource = readFileSync(join(__dirname,"../web/image_mask_editor.js"),"utf8").replace(/^import .*;\r?\n/gm, "");
  vm.runInNewContext(fullSource, sandbox);
  const node = {type:"ImageMaskEditorPrepare",inputs:[{name:"image"},{name:"mask"},{name:"original"}],
    widgets:[{name:"mask_blur",type:"number",value:4}, {name:"inpaint_area",value:"Only masked"}]};
  sandbox.app.extension.nodeCreated(node);
  assert.equal(node.widgets[0].type,"number");
  assert.equal(node.widgets[0].value,4);
  assert.deepEqual(node.inputs.map(slot=>slot.name),["image","mask","original"]);
  assert.equal(node.inputs[0].label,"edit image");
  assert.equal(node.inputs[2].label,"original image");
  node.inputs[0].label="old";node.onConfigure();
  assert.equal(node.inputs[0].label,"edit image");
});

test("upscale controls stay visible and disable by area and preset without losing values", () => {
  const sandbox = {app:{registerExtension(extension) {this.extension=extension;}}};
  const fullSource = readFileSync(join(__dirname,"../web/image_mask_editor.js"),"utf8").replace(/^import .*;\r?\n/gm, "");
  vm.runInNewContext(fullSource, sandbox);
  const area={name:"inpaint_area",type:"combo",value:"Only masked"};
  const preset={name:"generation_size",type:"combo",value:"1024×1024"};
  const custom={name:"custom_size",type:"number",value:1200};
  const node={type:"ImageMaskEditorPrepare",inputs:[],widgets:[area,preset,custom]};
  sandbox.app.extension.nodeCreated(node);
  assert.equal(preset.label,"Inpaint upscale size");
  assert.equal(preset.type,"combo");
  assert.equal(custom.type,"number");
  assert.equal(custom.disabled,true);
  assert.equal(preset.disabled,false);
  preset.value="Custom";preset.callback();
  assert.equal(custom.type,"number");assert.equal(custom.disabled,false);
  area.value="Whole picture";area.callback();
  assert.equal(preset.type,"combo");assert.equal(custom.type,"number");
  assert.equal(preset.disabled,true);assert.equal(custom.disabled,true);
  assert.equal(custom.value,1200);assert.equal(custom.options.serialize,true);
  area.value="Only masked";node.onConfigure();
  assert.equal(preset.type,"combo");assert.equal(custom.type,"number");
  assert.equal(preset.disabled,false);assert.equal(custom.disabled,false);
  assert.equal(custom.value,1200);
});
