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
    widgets:[{name:"mask_blur",type:"number",value:4}, {name:"inpaint_area",value:"Only masked",options:{values:["Whole picture","Only masked"]}}]};
  sandbox.app.extension.nodeCreated(node);
  assert.equal(node.widgets.find(widget=>widget.name==="mask_blur").type,"number");
  assert.equal(node.widgets.find(widget=>widget.name==="mask_blur").value,4);
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
  const area={name:"inpaint_area",type:"combo",value:"Only masked",options:{values:["Whole picture","Only masked"]}};
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

test("Padding disables in Whole picture and reordered controls restore old workflows", () => {
  const sandbox={app:{registerExtension(extension) {this.extension=extension;}}};
  const fullSource=readFileSync(join(__dirname,"../web/image_mask_editor.js"),"utf8").replace(/^import .*;\r?\n/gm, "");
  vm.runInNewContext(fullSource,sandbox);
  const area={name:"inpaint_area",value:"Only masked",options:{values:["Whole picture","Only masked"]}};
  const padding={name:"padding",value:32};
  const content={name:"masked_content",value:"original",options:{values:["original","fill"]}};
  const blur={name:"mask_blur",value:4};
  const node={type:"ImageMaskEditorPrepare",inputs:[],widgets:[area,padding,content,blur]};
  sandbox.app.extension.nodeCreated(node);
  assert.deepEqual(node.widgets.map(widget=>widget.name),["mask_blur","masked_content","inpaint_area","padding"]);
  assert.equal(padding.disabled,false);
  area.value="Whole picture";area.callback();
  assert.equal(padding.disabled,true);assert.equal(padding.value,32);
  node.onConfigure({widgets_values:["Only masked",48,"fill",4]});
  assert.equal(area.value,"Only masked");assert.equal(content.value,"fill");
  assert.equal(padding.value,48);assert.equal(padding.disabled,false);
  node.onConfigure({widgets_values:["original","Whole picture",64,4]});
  assert.equal(padding.value,64);assert.equal(area.value,"Whole picture");
  assert.equal(content.value,"original");assert.equal(padding.disabled,true);
  node.widgets.forEach((widget,index)=>widget.value=[8,"fill","Only masked",80][index]);
  node.onConfigure({widgets_values:[8,"fill","Only masked",80]});
  assert.equal(blur.value,8);assert.equal(content.value,"fill");
  assert.equal(area.value,"Only masked");assert.equal(padding.value,80);
  assert.equal(padding.disabled,false);
});

test("choice buttons keep combo values and widget order through selection and restore", () => {
  const sandbox={app:{graph:{setDirtyCanvas() {}},registerExtension(extension) {this.extension=extension;}}};
  const fullSource=readFileSync(join(__dirname,"../web/image_mask_editor.js"),"utf8").replace(/^import .*;\r?\n/gm, "");
  vm.runInNewContext(fullSource,sandbox);
  let callbacks=0;
  const area={name:"inpaint_area",type:"combo",value:"Only masked",y:100,
    options:{values:["Whole picture","Only masked"]},callback() {callbacks++;}};
  const content={name:"masked_content",type:"combo",value:"original",y:180,
    options:{values:["original","fill"]}};
  const preset={name:"generation_size",type:"combo",value:"1024×1024"};
  const node={type:"ImageMaskEditorPrepare",inputs:[],pos:[40,50],size:[320,360],widgets:[area,content,preset]};
  sandbox.app.extension.nodeCreated(node);
  const originalWidgets=node.widgets.slice();
  assert.equal(area.type,"combo");assert.equal(content.type,"combo");
  assert.equal(area.computeSize(320)[1],44);
  area.mouse({type:"pointerdown",button:0},[80,129],node);
  assert.equal(area.value,"Whole picture");assert.equal(callbacks,1);assert.equal(preset.disabled,true);
  area.mouse({type:"pointerup",button:0},[230,129],node);
  assert.equal(area.value,"Whole picture");
  area.mouse({type:"pointerdown",button:2},[230,129],node);
  assert.equal(area.value,"Whole picture");
  area.mouse({type:"pointerdown",button:0},[230,108],node);
  assert.equal(area.value,"Whole picture");
  area.mouse({type:"pointerdown",button:0},[230,129],node);
  assert.equal(area.value,"Only masked");assert.equal(preset.disabled,false);
  content.setValue=function(value,{node,canvas}) {assert.equal(node.type,"ImageMaskEditorPrepare");assert.ok(canvas);this.value=value;};
  content.onClick({e:{canvasX:270,canvasY:259,button:0},node,canvas:{}});
  assert.equal(content.value,"fill");
  content.computedDisabled=true;
  content.mouse({type:"pointerdown",button:0},[80,209],node);
  assert.equal(content.value,"fill");
  const saved=JSON.parse(JSON.stringify(node.widgets.map(widget=>widget.value)));
  saved.forEach((value,index)=>node.widgets[index].value=value);
  node.onConfigure();
  assert.deepEqual(node.widgets,originalWidgets);
  assert.equal(content.value,"fill");assert.equal(area.value,"Only masked");
  const labels=[];
  const context={save(){},restore(){},beginPath(){},roundRect(){},fill(){},stroke(){},fillText(text){labels.push(text);}};
  area.draw(context,node,320,100);
  assert.deepEqual(labels,["inpaint_area","Whole picture","Only masked"]);
});
