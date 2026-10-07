const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {test} = require("node:test");
const vm = require("node:vm");
const source = readFileSync(join(__dirname, "../web/image_mask_editor.js"), "utf8").replace(/^import .*;\r?\n/gm, "");

function setup() {
  const a = {path:"a"}, b = {path:"b"};
  const open = new Set([a,b]);
  const app = {graph:{_nodes:[],setDirtyCanvas() {}},extensionManager:{workflow:{activeWorkflow:a,isOpen:w => open.has(w)}},
    registerExtension(extension) {this.extension = extension;}};
  const sandbox = {app,api:{apiURL:url => url}};
  vm.runInNewContext(source + "\nglobalThis.Editor = ImageMaskEditorUI; globalThis.sessions = workflowSessions;", sandbox);
  function editor(name) {
    const e = Object.create(sandbox.Editor.prototype);
    const button = () => ({setAttribute() {}});
    Object.assign(e,{ready:Promise.resolve(),finishStroke() {}, background:{naturalWidth:1024,naturalHeight:768},
      sourceKey:name,inputKey:name,previewKey:"data:image/png;base64,"+name,previewName:name,
      layers:[{name:name+"-paint"},{name:name+"-mask"}],history:[{name:name+"-undo"}],redoHistory:[{name:name+"-redo"}],
      zoom:2,pan:{x:10,y:20},previewZoom:3,previewPan:{x:30,y:40},color:{value:"#abcdef"},size:{value:"40",min:"1",max:"200"},
      sizeValue:{value:"40"},mode:"mask",lineTool:true,lineButton:button(),maskButton:button(),eraserButton:button(),
      editorSize:{},previewImage:{style:{}},previewCaption:{},previewMessage:{},sendButton:{},savePreviewButton:{},
      render() {},updateCursor() {}});
    return e;
  }
  function activate(workflow, e, subgraph = false) {
    app.extensionManager.workflow.activeWorkflow = workflow;
    app.graph._nodes = subgraph ? [] : [{id:1,sketchEditor:e}];
    app.graph.subgraphs = subgraph ? new Map([["sub",{id:"sub",_nodes:[{id:1,sketchEditor:e}]}]]) : new Map();
  }
  return {a,b,open,app,sandbox,editor,activate,extension:app.extension};
}

test("workflow switches preserve both images, layers, history, tools and views without encoding", async () => {
  const s = setup(), original = s.editor("a");
  s.activate(s.a,original);
  await s.extension.beforeLoadGraph();
  const other = s.editor("b");
  s.activate(s.b,other);
  await s.extension.afterLoadGraph();
  assert.equal(other.sourceKey,"b");
  await s.extension.beforeLoadGraph();
  const restored = s.editor("empty");
  s.activate(s.a,restored);
  await s.extension.afterLoadGraph();
  for (const key of ["background","layers","history","redoHistory"]) assert.equal(restored[key],original[key]);
  assert.equal(restored.previewKey,original.previewKey);
  assert.equal(restored.sourceKey,"a");
  assert.equal(restored.mode,"mask");
  assert.equal(restored.lineTool,true);
  assert.equal(restored.zoom,2);
  assert.equal(restored.previewZoom,3);
  assert.equal(restored.previewPan.x,30);
  assert.equal(restored.editorSize.textContent,"1024×768");
  assert.equal(restored.sendButton.disabled,false);
  assert.equal(s.sandbox.sessions.has(s.a),false);
});

test("same node ID in different workflows has independent edits after repeated switches", async () => {
  const s = setup();
  for (const [workflow,name] of [[s.a,"a"],[s.b,"b"]]) {
    s.activate(workflow,s.editor(name));
    await s.extension.beforeLoadGraph();
  }
  for (const [workflow,name] of [[s.a,"a"],[s.b,"b"],[s.a,"a"]]) {
    const e = s.editor("empty"); s.activate(workflow,e);
    await s.extension.afterLoadGraph();
    assert.equal(e.layers[0].name,name+"-paint");
    await s.extension.beforeLoadGraph();
  }
});

test("pending image transfers finish before switching state is captured", async () => {
  const s = setup(), e = s.editor("old");
  let release;
  e.transfer = new Promise(resolve => {release=() => {e.sourceKey="new";resolve();};});
  s.activate(s.a,e);
  const capture = s.extension.beforeLoadGraph();
  release(); await capture;
  const restored = s.editor("empty"); s.activate(s.a,restored);
  await s.extension.afterLoadGraph();
  assert.equal(restored.sourceKey,"new");
});

test("a pending left preview is retained when its load completes during switching", async () => {
  const s=setup(), e=s.editor("old");
  let release;
  e.previewLoad=new Promise(resolve => {release=() => {e.previewKey="data:image/png;base64,new";resolve();};});
  s.activate(s.a,e);
  const capture=s.extension.beforeLoadGraph();
  release(); await capture;
  const restored=s.editor("empty"); s.activate(s.a,restored);
  await s.extension.afterLoadGraph();
  assert.equal(restored.previewKey,"data:image/png;base64,new");
});

test("closed workflow memory is released and reopening does not resurrect it", async () => {
  const s = setup(); s.activate(s.a,s.editor("a"));
  await s.extension.beforeLoadGraph();
  s.open.delete(s.a); s.activate(s.b,s.editor("b"));
  await s.extension.afterLoadGraph();
  assert.equal(s.sandbox.sessions.has(s.a),false);
  s.open.add(s.a); const e=s.editor("empty"); s.activate(s.a,e);
  await s.extension.afterLoadGraph(); assert.equal(e.sourceKey,"empty");
});

test("subgraph editors restore separately from root node IDs", async () => {
  const s = setup(); s.activate(s.a,s.editor("sub"),true);
  await s.extension.beforeLoadGraph();
  const e=s.editor("empty"); s.activate(s.a,e,true);
  await s.extension.afterLoadGraph(); assert.equal(e.sourceKey,"sub");
});

test("fresh page sessions and duplicated workflows do not inherit cached state", async () => {
  const s = setup(); s.activate(s.a,s.editor("a")); await s.extension.beforeLoadGraph();
  const duplicate={path:"a-copy"}; s.open.add(duplicate);
  const e=s.editor("empty"); s.activate(duplicate,e);
  await s.extension.afterLoadGraph(); assert.equal(e.sourceKey,"empty");
  assert.equal(setup().sandbox.sessions.size,0);
});
