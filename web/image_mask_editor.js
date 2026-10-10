import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const TYPE = "ImageMaskEditor";
const MIN_WIDTH = 820;
const MIN_HEIGHT = 220;
const SPLITTER_WIDTH = 10;
const MIN_PREVIEW_WIDTH = 220;
const MIN_EDITOR_WIDTH = 450;
const workflowSessions = new Map();

function workflowEditors() {
  const root = app.rootGraph || app.graph;
  const editors = new Map();
  for (const graph of [root, ...(root.subgraphs?.values() || [])]) {
    for (const node of graph._nodes) {
      if (node.sketchEditor) editors.set(`${graph === root ? "root" : graph.id}:${node.id}`, node.sketchEditor);
    }
  }
  return editors;
}

function pruneWorkflowSessions() {
  const workflows = app.extensionManager.workflow;
  for (const workflow of workflowSessions.keys()) {
    if (!workflows.isOpen(workflow)) workflowSessions.delete(workflow);
  }
}
const ICONS = {
  undo: '<path d="M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12"/>',
  redo: '<path d="m15 5 5 5-5 5m5-5h-9a6 6 0 0 0 0 12"/>',
  clear: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6"/>',
  reset: '<path d="M4 9V4h5M4 4l5 5M20 9V4h-5m5 0-5 5M4 15v5h5m-5 0 5-5m11 0v5h-5m5 0-5-5"/>',
  eraser: '<path d="m14 3 7 7-10 11H6l-4-4L14 3Zm-7 9 7 7M11 21h10"/>',
  line: '<path d="M5 19 19 5"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/>',
  load: '<path d="M3 7h7l2 3h9l-3 11H3V7Zm0 0V4h7l2 3"/>',
  send: '<path d="M3 12h15m-5-5 5 5-5 5M21 4v16"/>',
  save: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  eyedropper: '<path d="m14 3 7 7-3 3-2-2L6 21H3v-3L13 8l-2-2 3-3ZM6 15l3 3M13 8l3 3"/>',
  mask: '<path d="M3 3h18v18H3z"/><path fill="currentColor" stroke="none" d="M3 3h6v6H3zm12 0h6v6h-6zM9 9h6v6H9zM3 15h6v6H3zm12 0h6v6h-6z"/>',
};

function addStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .image-mask-editor { width:100%; height:100%; min-height:0; display:flex; flex-direction:column; gap:6px; box-sizing:border-box; overflow:hidden; }
    .image-mask-editor__panes { display:grid; grid-template-columns:var(--split-left,46%) 10px minmax(0,1fr); flex:1 1 0; min-width:0; min-height:0; }
    .image-mask-editor__pane { display:flex; flex-direction:column; gap:6px; flex:1 1 0; min-width:0; min-height:0; }
    .image-mask-editor__splitter { cursor:col-resize; touch-action:none; user-select:none; background:#373737; border:0; box-sizing:border-box; position:relative; }
    .image-mask-editor__splitter::after { content:""; position:absolute; left:3px; top:calc(50% - 18px); height:36px; width:2px; background:#888; }
    .image-mask-editor__splitter:hover, .image-mask-editor__splitter:focus-visible, .image-mask-editor__splitter[data-dragging="true"] { background:#176b9a; outline:none; }
    .image-mask-editor__preview { width:100%; height:100%; position:absolute; inset:0; object-fit:contain; }
    .image-mask-editor__missing:not([hidden]) { position:absolute; inset:0; display:grid; place-items:center; padding:16px; box-sizing:border-box; color:#ccc; font-size:12px; text-align:center; pointer-events:none; }
    .image-mask-editor__viewport[data-drop-active="true"]::after { content:"ここに画像をドロップ"; position:absolute; inset:0; z-index:2; display:grid; place-items:center; box-shadow:inset 0 0 0 3px #80d4ff; background:rgba(23,107,154,0.3); color:white; font-size:14px; text-shadow:0 1px 3px #000; pointer-events:none; }
    .image-mask-editor__caption { font-size:11px; height:18px; flex:0 0 18px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .image-mask-editor__dimensions { height:14px; flex:0 0 14px; font-size:11px; color:#bbb; text-align:center; line-height:14px; }
    .image-mask-editor__load-tools { display:flex; gap:6px; height:30px; flex:0 0 30px; align-items:center; }
    .image-mask-editor__keep { display:flex; align-items:center; gap:3px; font-size:11px; white-space:nowrap; }
    .image-mask-editor__editor-heading { display:flex; justify-content:space-between; align-items:center; height:18px; flex:0 0 18px; gap:6px; }
    .image-mask-editor__editor-heading .image-mask-editor__caption { flex:1 1 0; min-width:0; }
    .image-mask-editor__tools { display:flex; align-items:center; gap:5px; height:30px; flex:0 0 30px; white-space:nowrap; }
    .image-mask-editor__tools button, .image-mask-editor__load-tools button { display:grid; place-items:center; width:28px; height:28px; min-width:28px; padding:4px; border:1px solid #666; border-radius:4px; background:#303030; color:#eee; cursor:pointer; }
    .image-mask-editor__load-tools button:disabled, .image-mask-editor__tools button:disabled { opacity:0.4; cursor:default; }
    .image-mask-editor__tools button[aria-pressed="true"] { background:#176b9a; border-color:#80d4ff; color:white; }
    .image-mask-editor__tools svg, .image-mask-editor__load-tools svg { width:19px; height:19px; }
    .image-mask-editor__tools input[type="color"] { width:30px; height:28px; flex:0 0 30px; padding:1px; border:1px solid #666; }
    .image-mask-editor__tools label { display:flex; align-items:center; gap:4px; font-size:11px; }
    .image-mask-editor__tools input[type="range"] { width:65px; min-width:65px; margin:0; }
    .image-mask-editor__tools input[type="number"] { width:45px; min-width:45px; height:26px; box-sizing:border-box; padding:2px; text-align:right; }
    .image-mask-editor__viewport { flex:1 1 0; min-height:0; position:relative; overflow:hidden; background:#252525; touch-action:none; }
    .image-mask-editor__canvas { position:absolute; inset:0; width:100%; height:100%; display:block; cursor:none; }
    .image-mask-editor__cursor { position:absolute; border:1px solid white; box-shadow:0 0 0 1px #111; border-radius:50%; transform:translate(-50%,-50%); pointer-events:none; box-sizing:border-box; display:none; }
  `;
  document.head.append(style);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load sketch image"));
    image.src = url;
  });
}

function layerUrl(name) {
  if (name.startsWith("data:image/png;base64,")) return name;
  const match = name.match(/^(.*?)(?: \[(input|output|temp)\])?$/);
  const path = match[1].replaceAll("\\", "/");
  const slash = path.lastIndexOf("/");
  return api.apiURL(`/view?${new URLSearchParams({filename:path.slice(slash + 1), subfolder:path.slice(0, Math.max(0, slash)), type:match[2] || "input"})}`);
}

async function imageDigest(value) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

class ImageMaskEditorUI {
  constructor(node, paintWidget) {
    this.node = node;
    this.paintWidget = paintWidget;
    this.background = null;
    this.sourceKey = "";
    this.pendingSource = "";
    this.previewKey = "";
    this.previewName = "";
    this.inputKey = "";
    this.previewRequest = 0;
    this.history = [];
    this.redoHistory = [];
    this.mode = "paint";
    this.lineTool = false;
    this.gesture = null;
    this.zoom = 1;
    this.pan = {x:0, y:0};
    this.element = document.createElement("div");
    this.element.className = "image-mask-editor";
    this.tools = document.createElement("div");
    this.tools.className = "image-mask-editor__tools";
    this.viewport = document.createElement("div");
    this.viewport.className = "image-mask-editor__viewport";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "image-mask-editor__canvas";
    this.context = this.canvas.getContext("2d");
    this.cursor = document.createElement("div");
    this.cursor.className = "image-mask-editor__cursor";
    this.layers = [document.createElement("canvas"), document.createElement("canvas")];
    this.layers.forEach(layer => { layer.width = 512; layer.height = 512; });
    this.button("undo", "Undo", () => this.undo());
    this.button("redo", "Redo", () => this.redo());
    this.button("clear", "Clear drawing", () => this.clear());
    this.button("reset", "Fit image / reset view", () => this.resetView());
    this.color = document.createElement("input");
    this.color.type = "color";
    this.color.value = "#ff0000";
    this.color.title = "Paint color";
    this.color.setAttribute("aria-label", "Paint color");
    this.tools.append(this.color);
    this.eyedropperButton = this.button("eyedropper", "Pick color", () => this.pickColor());
    this.eyedropperButton.setAttribute("aria-pressed", "false");
    this.eyedropperButton.title = "Pick color — 画面から色を取得（非対応ブラウザでは画像内をクリック）";
    this.maskButton = this.button("mask", "Mask only", () => this.setMode(this.mode === "mask" ? "paint" : "mask"));
    this.size = document.createElement("input");
    this.size.type = "range";
    this.size.min = "1";
    this.size.max = "200";
    this.size.value = "30";
    this.size.setAttribute("aria-label", "Brush size");
    this.sizeValue = document.createElement("input");
    this.sizeValue.type = "number";
    this.sizeValue.min = this.size.min;
    this.sizeValue.max = this.size.max;
    this.sizeValue.step = "1";
    this.sizeValue.value = this.size.value;
    this.sizeValue.setAttribute("aria-label", "Brush size value");
    this.sizeValue.title = "Brush size — 数値を直接入力（1〜200）";
    this.sizeValue.addEventListener("input", () => this.setBrushSize(this.sizeValue.value));
    this.sizeValue.addEventListener("change", () => this.setBrushSize(this.sizeValue.value, true));
    this.sizeValue.addEventListener("blur", () => this.setBrushSize(this.sizeValue.value, true));
    this.sizeValue.addEventListener("keydown", event => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        this.setBrushSize(this.sizeValue.value, true);
        this.sizeValue.blur();
      }
    });
    const label = document.createElement("label");
    label.textContent = "Size";
    label.append(this.size, this.sizeValue);
    this.tools.append(label);
    this.eraserButton = this.button("eraser", "Eraser", () => this.setMode(this.mode === "eraser" ? "paint" : "eraser"));
    this.lineButton = this.button("line", "直線ツール", () => {
      this.finishStroke();
      this.lineTool = !this.lineTool;
      this.lineButton.setAttribute("aria-pressed", String(this.lineTool));
    });
    this.lineButton.setAttribute("aria-pressed", "false");
    this.setMode("paint");
    this.viewport.append(this.canvas, this.cursor);
    const panes = this.panes = document.createElement("div");
    panes.className = "image-mask-editor__panes";
    const left = document.createElement("div");
    left.className = "image-mask-editor__pane";
    const right = document.createElement("div");
    right.className = "image-mask-editor__pane image-mask-editor__pane--editor";
    this.splitter = document.createElement("div");
    this.splitter.className = "image-mask-editor__splitter";
    this.splitter.tabIndex = 0;
    this.splitter.setAttribute("role", "separator");
    this.splitter.setAttribute("aria-orientation", "vertical");
    this.splitter.setAttribute("aria-label", "画像エリアの分割比率");
    this.splitter.title = "ドラッグで左右の幅を変更 / ダブルクリックで初期比率";
    this.splitter.addEventListener("pointerdown", event => this.startSplit(event));
    this.splitter.addEventListener("pointermove", event => this.moveSplit(event));
    this.splitter.addEventListener("pointerup", event => this.finishSplit(event));
    this.splitter.addEventListener("pointercancel", event => this.finishSplit(event));
    this.splitter.addEventListener("lostpointercapture", event => this.finishSplit(event));
    this.splitter.addEventListener("dblclick", event => {
      event.stopPropagation();
      this.setSplitRatio(0.46, true);
    });
    this.splitter.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      this.setSplitRatio(event.key === "Home" ? 0.46 : this.visibleSplitRatio + (event.key === "ArrowLeft" ? -0.02 : 0.02), true);
    });
    const loadTools = document.createElement("div");
    loadTools.className = "image-mask-editor__load-tools";
    const loadButton = this.button("load", "Load image", () => fileInput.click(), loadTools);
    this.sendButton = this.button("send", "Send inpaint", () => {
      this.transfer = this.setSource(this.previewKey, !this.keepEdits.checked);
      this.transfer.catch(error => this.reportError(error));
    }, loadTools);
    this.sendButton.disabled = true;
    this.keepEdits = document.createElement("input");
    this.keepEdits.type = "checkbox";
    const keepLabel = document.createElement("label");
    keepLabel.className = "image-mask-editor__keep";
    keepLabel.title = "Keep paint and mask when sending an image to the editor";
    keepLabel.append(this.keepEdits, document.createTextNode("Keep edits"));
    loadTools.append(keepLabel);
    this.keepEdits.addEventListener("change", () => {
      this.node.properties ||= {};
      this.node.properties.image_mask_editor_keep_edits = this.keepEdits.checked;
      this.markDirty();
    });
    this.savePreviewButton = this.button("save", "Save image", () => this.savePreview().catch(error => this.reportError(error)), loadTools);
    this.savePreviewButton.style.marginLeft = "18px";
    this.savePreviewButton.disabled = true;
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.hidden = true;
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;
      await this.loadFile(file);
      fileInput.value = "";
    });
    loadTools.append(fileInput);
    this.previewCaption = document.createElement("div");
    this.previewCaption.className = "image-mask-editor__caption";
    this.previewCaption.textContent = "読み込み画像 / 生成結果";
    const previewViewport = this.previewViewport = document.createElement("div");
    previewViewport.className = "image-mask-editor__viewport";
    previewViewport.title = "画像ファイルをドロップして読み込み";
    for (const type of ["dragenter", "dragover", "dragleave"]) {
      previewViewport.addEventListener(type, event => this.previewDrag(event));
    }
    previewViewport.addEventListener("drop", event => this.dropImage(event));
    this.previewImage = document.createElement("img");
    this.previewImage.className = "image-mask-editor__preview";
    this.previewImage.alt = "読み込み画像 / 生成結果";
    this.previewImage.hidden = true;
    this.previewImage.draggable = false;
    this.previewZoom = 1;
    this.previewPan = {x:0, y:0};
    this.previewMessage = document.createElement("div");
    this.previewMessage.className = "image-mask-editor__missing";
    this.previewMessage.textContent = "画像が見つかりません。Load imageから読み込み直してください";
    this.previewMessage.hidden = true;
    this.previewImage.addEventListener("error", () => this.showMissingPreview());
    this.previewImage.addEventListener("load", () => {
      if (this.restoredPreviewView) {
        this.previewZoom = this.restoredPreviewView.zoom;
        this.previewPan = this.restoredPreviewView.pan;
        this.restoredPreviewView = null;
        this.applyPreviewView();
      } else this.resetPreviewView();
      this.previewMessage.hidden = true;
      this.previewImage.hidden = false;
      this.sendButton.disabled = false;
      this.savePreviewButton.disabled = false;
      this.previewSize.textContent = `${this.previewImage.naturalWidth}×${this.previewImage.naturalHeight}`;
    });
    previewViewport.addEventListener("wheel", event => this.zoomPreview(event), {passive:false});
    previewViewport.addEventListener("pointerdown", event => this.startPreviewPan(event));
    previewViewport.addEventListener("pointermove", event => this.movePreviewPan(event));
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      previewViewport.addEventListener(type, event => this.finishPreviewPan(event));
    }
    previewViewport.addEventListener("dblclick", event => {
      event.preventDefault();
      event.stopPropagation();
      this.resetPreviewView();
    });
    previewViewport.append(this.previewImage, this.previewMessage);
    const editorCaption = this.editorCaption = document.createElement("div");
    editorCaption.className = "image-mask-editor__caption";
    editorCaption.textContent = `編集画面 — ID: ${node.id}`;
    this.expandPaint = document.createElement("input");
    this.expandPaint.type = "checkbox";
    this.expandPaint.setAttribute("aria-label", "Expand paint mask");
    const expandLabel = document.createElement("label");
    expandLabel.className = "image-mask-editor__keep";
    expandLabel.title = "Expand the paint-derived mask; mask-only strokes and paint colors stay unchanged";
    expandLabel.append(this.expandPaint, document.createTextNode("Expand paint mask"));
    expandLabel.addEventListener("pointerdown", event => event.stopPropagation());
    this.expandPaint.addEventListener("change", () => {
      this.node.properties ||= {};
      this.node.properties.image_mask_editor_expand = this.expandPaint.checked;
      this.markDirty();
    });
    const editorHeading = document.createElement("div");
    editorHeading.className = "image-mask-editor__editor-heading";
    editorHeading.append(editorCaption, expandLabel);
    this.previewSize = document.createElement("div");
    this.previewSize.className = "image-mask-editor__dimensions";
    this.editorSize = document.createElement("div");
    this.editorSize.className = "image-mask-editor__dimensions";
    left.append(loadTools, this.previewCaption, previewViewport, this.previewSize);
    right.append(this.tools, editorHeading, this.viewport, this.editorSize);
    panes.append(left, this.splitter, right);
    this.element.append(panes);
    this.restoreSettings();
    this.element.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !this.colorPicking) return;
      event.preventDefault();
      event.stopPropagation();
      this.setColorPicking(false);
    });
    this.restoreSplitRatio();
    loadTools.addEventListener("pointerdown", event => event.stopPropagation());
    this.color.addEventListener("input", () => this.setMode("paint"));
    this.size.addEventListener("input", () => {
      this.sizeValue.value = this.size.value;
      this.updateCursor();
    });
    this.tools.addEventListener("pointerdown", event => event.stopPropagation());
    this.canvas.addEventListener("pointerdown", event => this.startStroke(event));
    this.canvas.addEventListener("contextmenu", event => { event.preventDefault(); event.stopPropagation(); });
    this.canvas.addEventListener("pointermove", event => this.move(event));
    this.canvas.addEventListener("pointerup", event => this.finishStroke(event));
    this.canvas.addEventListener("pointercancel", event => this.finishStroke(event, true));
    this.canvas.addEventListener("lostpointercapture", () => this.finishStroke());
    this.canvas.addEventListener("pointerleave", () => { this.cursor.style.display = "none"; });
    this.canvas.addEventListener("wheel", event => this.wheel(event), {passive:false});
    this.resizeObserver = new ResizeObserver(() => { this.applySplitRatio(); this.resizeViewport(); });
    this.resizeObserver.observe(this.viewport);
    this.resizeObserver.observe(this.panes);
    this.ready = Promise.resolve();
  }

  setBrushSize(value, commit = false) {
    const number = Number(value);
    const min = Number(this.size.min);
    const max = Number(this.size.max);
    if (value === "" || !Number.isFinite(number)) {
      if (commit) this.sizeValue.value = this.size.value;
      return;
    }
    if (!commit && (number < min || number > max || !Number.isInteger(number))) return;
    this.size.value = String(Math.min(max, Math.max(min, Math.round(number))));
    if (commit) this.sizeValue.value = this.size.value;
    this.updateCursor();
  }

  async loadFile(file) {
    try {
      const url = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      await this.setPreview(url, file.name);
    } catch (error) { this.reportError(error); }
  }

  previewDrag(event) {
    if (event.type === "dragleave") {
      event.stopPropagation();
      this.previewDragDepth = Math.max(0, (this.previewDragDepth || 0) - 1);
      if (!this.previewDragDepth) this.previewViewport.dataset.dropActive = "false";
      return;
    }
    if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
    const items = Array.from(event.dataTransfer.items || []).filter(item => item.kind === "file");
    if (items.length && !items.some(item => !item.type || item.type.startsWith("image/"))) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === "dragenter") this.previewDragDepth = (this.previewDragDepth || 0) + 1;
    this.previewViewport.dataset.dropActive = "true";
    event.dataTransfer.dropEffect = "copy";
  }

  async dropImage(event) {
    this.previewDragDepth = 0;
    this.previewViewport.dataset.dropActive = "false";
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    const image = files.find(file => file.type.startsWith("image/") ||
      /\.(png|jpe?g|webp|gif|bmp|avif|tiff?|svg)$/i.test(file.name));
    if (!image) {
      this.reportError(new Error("画像ファイルをドロップしてね。"));
      return;
    }
    await this.loadFile(image);
  }

  button(icon, label, action, parent = this.tools) {
    const button = document.createElement("button");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>`;
    button.addEventListener("click", action);
    parent.append(button);
    return button;
  }

  setMode(mode) {
    this.mode = mode;
    this.maskButton.setAttribute("aria-pressed", String(mode === "mask"));
    this.eraserButton.setAttribute("aria-pressed", String(mode === "eraser"));
  }

  async pickColor() {
    this.finishStroke();
    if (this.colorPicking || typeof window.EyeDropper !== "function") {
      this.setColorPicking(!this.colorPicking);
      return;
    }
    this.eyedropperButton.disabled = true;
    this.eyedropperButton.setAttribute("aria-pressed", "true");
    try {
      const result = await new window.EyeDropper().open();
      this.applyColor(result.sRGBHex);
    } catch (error) {
      if (error.name !== "AbortError") {
        console.warn("Color picker:", error);
        this.setColorPicking(true);
      }
    } finally {
      this.eyedropperButton.disabled = false;
      this.eyedropperButton.setAttribute("aria-pressed", String(Boolean(this.colorPicking)));
    }
  }

  setColorPicking(active) {
    this.colorPicking = active;
    this.eyedropperButton.setAttribute("aria-pressed", String(active));
    this.canvas.style.cursor = active ? "crosshair" : "none";
    this.previewImage.style.cursor = active ? "crosshair" : "default";
    this.cursor.style.display = "none";
    this.eyedropperButton.title = active ? "Pick color — 画像をクリック / もう一度押すと解除" : "Pick color — 画面から色を取得（非対応ブラウザでは画像内をクリック）";
  }

  applyColor(value) {
    this.color.value = value;
    this.setMode("paint");
    this.setColorPicking(false);
  }

  pickPixel(image, x, y, layer = null) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const sample = document.createElement("canvas");
    sample.width = sample.height = 1;
    const context = sample.getContext("2d");
    context.drawImage(image, Math.floor(x), Math.floor(y), 1, 1, 0, 0, 1, 1);
    if (layer) context.drawImage(layer, Math.floor(x), Math.floor(y), 1, 1, 0, 0, 1, 1);
    const pixel = context.getImageData(0, 0, 1, 1).data;
    if (!pixel[3]) return;
    this.applyColor("#" + Array.from(pixel.slice(0, 3), value => value.toString(16).padStart(2, "0")).join(""));
  }

  async savePreview() {
    const image = this.previewImage;
    if (image.hidden || !image.naturalWidth || !image.naturalHeight) return;
    let blob;
    if (this.previewKey?.startsWith("data:image/png;base64,")) {
      blob = await (await fetch(this.previewKey)).blob();
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d").drawImage(image, 0, 0);
      blob = await new Promise((resolve, reject) => canvas.toBlob(value => {
        if (value) resolve(value);
        else reject(new Error("画像を保存できませんでした。もう一度試してください。"));
      }, "image/png"));
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const name = (this.previewName || "preview").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "_");
    link.download = `${name || "preview"}.png`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  resetPreviewView() {
    this.previewZoom = 1;
    this.previewPan = {x:0, y:0};
    this.applyPreviewView();
  }

  applyPreviewView() {
    this.previewImage.style.transform = `translate(${this.previewPan.x}px, ${this.previewPan.y}px) scale(${this.previewZoom})`;
  }

  previewPoint(event) {
    const rect = this.previewViewport.getBoundingClientRect();
    return {x:(event.clientX - rect.left) * this.previewViewport.clientWidth / rect.width,
      y:(event.clientY - rect.top) * this.previewViewport.clientHeight / rect.height};
  }

  zoomPreview(event) {
    event.preventDefault();
    event.stopPropagation();
    if (this.previewImage.hidden || this.previewPanDrag) return;
    const point = this.previewPoint(event);
    const oldZoom = this.previewZoom;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.previewViewport.clientHeight : 1);
    this.previewZoom = Math.min(32, Math.max(0.1, oldZoom * Math.exp(-delta * 0.0015)));
    const ratio = this.previewZoom / oldZoom;
    this.previewPan.x = (point.x - this.previewViewport.clientWidth / 2) * (1 - ratio) + this.previewPan.x * ratio;
    this.previewPan.y = (point.y - this.previewViewport.clientHeight / 2) * (1 - ratio) + this.previewPan.y * ratio;
    this.applyPreviewView();
  }

  startPreviewPan(event) {
    if (event.button !== 0 || this.previewImage.hidden) return;
    if (!event.shiftKey) { this.pickPreviewPixel(event); return; }
    event.preventDefault();
    event.stopPropagation();
    this.previewPanDrag = {pointerId:event.pointerId, point:this.previewPoint(event)};
    this.previewViewport.setPointerCapture(event.pointerId);
    this.previewViewport.style.cursor = "grabbing";
  }

  movePreviewPan(event) {
    if (!this.previewPanDrag || this.previewPanDrag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const point = this.previewPoint(event);
    this.previewPan.x += point.x - this.previewPanDrag.point.x;
    this.previewPan.y += point.y - this.previewPanDrag.point.y;
    this.previewPanDrag.point = point;
    this.applyPreviewView();
  }

  finishPreviewPan(event) {
    if (!this.previewPanDrag || this.previewPanDrag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    this.previewPanDrag = null;
    this.previewViewport.style.cursor = "";
    if (this.previewViewport.hasPointerCapture(event.pointerId)) this.previewViewport.releasePointerCapture(event.pointerId);
  }

  pickPreviewPixel(event) {
    if (!this.colorPicking || event.button !== 0 || this.previewImage.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    const image = this.previewImage;
    const rect = image.getBoundingClientRect();
    const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
    const x = (event.clientX - rect.left - (rect.width - image.naturalWidth * scale) / 2) / scale;
    const y = (event.clientY - rect.top - (rect.height - image.naturalHeight * scale) / 2) / scale;
    this.pickPixel(image, x, y);
  }

  splitLimits() {
    const available = Math.max(MIN_PREVIEW_WIDTH + MIN_EDITOR_WIDTH, this.panes.clientWidth - SPLITTER_WIDTH);
    return {min:MIN_PREVIEW_WIDTH / available, max:1 - MIN_EDITOR_WIDTH / available, available};
  }

  applySplitRatio() {
    const {min, max} = this.splitLimits();
    this.visibleSplitRatio = Math.min(max, Math.max(min, this.splitRatio));
    this.panes.style.setProperty("--split-left", `${this.visibleSplitRatio * this.splitLimits().available}px`);
    this.splitter.setAttribute("aria-valuenow", String(Math.round(this.visibleSplitRatio * 100)));
    this.splitter.setAttribute("aria-valuemin", String(Math.ceil(min * 100)));
    this.splitter.setAttribute("aria-valuemax", String(Math.floor(max * 100)));
  }

  restoreSplitRatio() {
    const saved = this.node.properties?.image_mask_editor_split;
    this.splitRatio = typeof saved === "number" && Number.isFinite(saved) ? Math.min(1, Math.max(0, saved)) : 0.46;
    this.applySplitRatio();
  }

  setSplitRatio(ratio, save = false) {
    const {min, max} = this.splitLimits();
    this.splitRatio = Math.min(max, Math.max(min, ratio));
    this.applySplitRatio();
    if (save) {
      const graph = this.node.graph || app.graph;
      graph.beforeChange?.();
      this.node.properties ||= {};
      this.node.properties.image_mask_editor_split = this.splitRatio;
      graph._version = (graph._version || 0) + 1;
      graph.afterChange?.();
      graph.change?.();
      graph.setDirtyCanvas(true, true);
    }
  }

  startSplit(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.finishStroke();
    this.splitter.setPointerCapture(event.pointerId);
    this.splitDrag = {pointerId:event.pointerId, x:event.clientX, ratio:this.visibleSplitRatio};
    this.splitter.dataset.dragging = "true";
  }

  moveSplit(event) {
    event.stopPropagation();
    if (!this.splitDrag || this.splitDrag.pointerId !== event.pointerId) return;
    const rect = this.panes.getBoundingClientRect();
    const {available} = this.splitLimits();
    const delta = (event.clientX - this.splitDrag.x) * this.panes.clientWidth / rect.width;
    this.setSplitRatio(this.splitDrag.ratio + delta / available);
  }

  finishSplit(event) {
    event.stopPropagation();
    if (!this.splitDrag || this.splitDrag.pointerId !== event.pointerId) return;
    if (event.type === "pointerup") this.moveSplit(event);
    this.splitDrag = null;
    this.splitter.dataset.dragging = "false";
    this.setSplitRatio(this.splitRatio, true);
    if (this.splitter.hasPointerCapture(event.pointerId)) this.splitter.releasePointerCapture(event.pointerId);
  }

  resizeViewport() {
    const width = Math.max(1, Math.round(this.viewport.clientWidth));
    const height = Math.max(1, Math.round(this.viewport.clientHeight));
    if (width === this.canvas.width && height === this.canvas.height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    // Resizing clears the bitmap; refill it before the browser paints this frame.
    if (this.renderFrame != null) {
      cancelAnimationFrame(this.renderFrame);
      this.renderFrame = null;
    }
    this.renderNow();
    this.updateCursor();
  }

  transform() {
    const image = this.layers[0];
    const scale = Math.min(this.canvas.width / image.width, this.canvas.height / image.height) * this.zoom;
    return {scale, x:(this.canvas.width - image.width * scale) / 2 + this.pan.x, y:(this.canvas.height - image.height * scale) / 2 + this.pan.y};
  }

  restoreSettings() {
    this.keepEdits.checked = this.node.properties?.image_mask_editor_keep_edits === true;
    this.expandPaint.checked = this.node.properties?.image_mask_editor_expand !== false;
  }

  async setSource(dataUrl, clearEdits = false) {
    if (!dataUrl) return;
    this.finishStroke();
    this.pendingSource = dataUrl;
    await this.ready;
    if (dataUrl !== this.pendingSource) return;
    if (dataUrl === this.sourceKey) {
      if (clearEdits) this.clear();
      return;
    }
    const image = await loadImage(layerUrl(dataUrl));
    if (dataUrl !== this.pendingSource || dataUrl === this.sourceKey) return;
    this.sourceKey = dataUrl;
    this.background = image;
    this.editorSize.textContent = `${image.naturalWidth}×${image.naturalHeight}`;
    for (const layer of this.layers) {
      if (layer.width !== image.naturalWidth || layer.height !== image.naturalHeight) {
        const copy = document.createElement("canvas");
        copy.width = layer.width;
        copy.height = layer.height;
        copy.getContext("2d").drawImage(layer, 0, 0);
        layer.width = image.naturalWidth;
        layer.height = image.naturalHeight;
        layer.getContext("2d").drawImage(copy, 0, 0, layer.width, layer.height);
      }
    }
    this.history = this.resizeHistory(this.history, image.naturalWidth, image.naturalHeight);
    this.redoHistory = this.resizeHistory(this.redoHistory, image.naturalWidth, image.naturalHeight);
    this.trimHistory();
    if (clearEdits) this.clear();
    this.resetView();
    await this.markDirty();
  }

  resizeHistory(history, width, height) {
    return history.map(entry => {
      if (entry.width === width && entry.height === height) return entry;
      const patches = entry.patches.map(patch => {
        const pixels = patch.pixels;
        const x = Math.floor(patch.x * width / entry.width);
        const y = Math.floor(patch.y * height / entry.height);
        const right = Math.floor((patch.x + pixels.width) * width / entry.width);
        const bottom = Math.floor((patch.y + pixels.height) * height / entry.height);
        if (right === x || bottom === y) return null;
        const original = document.createElement("canvas");
        original.width = pixels.width;
        original.height = pixels.height;
        original.getContext("2d").putImageData(pixels, 0, 0);
        const resized = document.createElement("canvas");
        resized.width = right - x;
        resized.height = bottom - y;
        const context = resized.getContext("2d");
        context.drawImage(original, 0, 0, resized.width, resized.height);
        return {index:patch.index, x, y, pixels:context.getImageData(0, 0, resized.width, resized.height)};
      }).filter(Boolean);
      return {width, height, patches};
    });
  }

  setPreview(url, name = "IMAGE入力") {
    this.previewLoad = this.loadPreview(url, name);
    return this.previewLoad;
  }

  async loadPreview(url, name) {
    const request = ++this.previewRequest;
    await this.ready;
    let image;
    try {
      image = await loadImage(layerUrl(url));
    } catch (error) {
      if (request !== this.previewRequest) return;
      this.showMissingPreview();
      throw error;
    }
    if (request !== this.previewRequest) return;
    if (url.startsWith("data:image/png;base64,")) this.previewKey = url;
    else {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d").drawImage(image, 0, 0);
      this.previewKey = canvas.toDataURL("image/png");
    }
    this.previewName = name;
    this.previewSize.textContent = `${image.naturalWidth}×${image.naturalHeight}`;
    this.restoredPreviewView = null;
    this.previewImage.src = this.previewKey;
    this.previewImage.hidden = false;
    this.previewMessage.hidden = true;
    this.previewCaption.textContent = name;
    this.sendButton.disabled = false;
    this.savePreviewButton.disabled = false;
    await this.markDirty();
  }

  async acceptInput(url) {
    await this.ready;
    const key = await imageDigest(url);
    if (key === this.inputKey) return;
    this.inputKey = key;
    await this.setPreview(url);
  }

  showMissingPreview() {
    this.previewSize.textContent = "";
    this.previewImage.hidden = true;
    this.previewMessage.hidden = false;
    this.sendButton.disabled = true;
    this.savePreviewButton.disabled = true;
  }

  reportError(error) {
    console.error("Image & Mask Editor:", error);
    this.previewCaption.textContent = `画像の読み込みに失敗: ${error.message}`;
  }

  async restoreLayers() {
    const value = this.paintWidget.value;
    if (!value) return;
    const names = value.startsWith("{") ? JSON.parse(value) : {paint:value};
    this.inputKey = names.inputKey?.startsWith("data:") ? await imageDigest(names.inputKey) : names.inputKey || "";
    if (names.preview) {
      this.previewKey = names.preview;
      this.previewName = names.previewName || "読み込み画像";
      this.previewImage.src = layerUrl(names.preview);
      this.previewImage.hidden = false;
      this.previewCaption.textContent = this.previewName;
      this.sendButton.disabled = true;
    }
    const missing = [];
    const restoreImage = async name => {
      if (!name) return null;
      try {
        return await loadImage(layerUrl(name));
      } catch (error) {
        missing.push(name);
        return null;
      }
    };
    const [background, ...images] = await Promise.all([names.source, names.paint, names.mask].map(restoreImage));
    if (background) {
      this.background = background;
      this.sourceKey = names.source;
      this.editorSize.textContent = `${background.naturalWidth}×${background.naturalHeight}`;
    }
    if (missing.length) {
      this.previewCaption.textContent = "保存済み画像の一部が見つかりません。Load imageから読み込み直してください";
    }
    const image = images.find(Boolean) || background;
    if (!image) return;
    this.layers.forEach((layer, index) => {
      layer.width = image.naturalWidth;
      layer.height = image.naturalHeight;
      if (images[index]) layer.getContext("2d").drawImage(images[index], 0, 0);
    });
    this.history = [];
    this.redoHistory = [];
    this.resetView();
    // Do not overwrite missing saved assets with empty layers during restoration.
    if (!missing.length) await this.markDirty();
  }

  render() {
    if (this.renderFrame != null) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      this.renderNow();
    });
  }

  renderNow() {
    const {scale, x, y} = this.transform();
    const context = this.context;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    context.save();
    context.translate(x, y);
    context.scale(scale, scale);
    if (this.background) context.drawImage(this.background, 0, 0);
    context.drawImage(this.layers[0], 0, 0);
    context.globalAlpha = 0.4;
    context.drawImage(this.layers[1], 0, 0);
    context.restore();
  }

  localPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {x:(event.clientX - rect.left) * this.canvas.width / rect.width, y:(event.clientY - rect.top) * this.canvas.height / rect.height};
  }

  imagePoint(point) {
    const {scale, x, y} = this.transform();
    return {x:(point.x - x) / scale, y:(point.y - y) / scale};
  }

  updateCursor(point = this.pointer) {
    if (this.colorPicking) { this.cursor.style.display = "none"; return; }
    if (!point) return;
    this.pointer = point;
    const diameter = Number(this.size.value) * this.transform().scale;
    Object.assign(this.cursor.style, {left:`${point.x}px`, top:`${point.y}px`, width:`${diameter}px`, height:`${diameter}px`, display:this.gesture === "pan" ? "none" : "block"});
  }

  startStroke(event) {
    if (!this.background) return;
    if (event.button === 2) {
      event.preventDefault();
      event.stopPropagation();
      this.finishStroke();
      const point = this.imagePoint(this.localPoint(event));
      this.pickPixel(this.background, point.x, point.y, this.layers[0]);
      return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (this.colorPicking) {
      const point = this.imagePoint(this.localPoint(event));
      this.pickPixel(this.background, point.x, point.y, this.layers[0]);
      return;
    }
    this.canvas.setPointerCapture(event.pointerId);
    const point = this.localPoint(event);
    this.gesture = event.shiftKey ? "pan" : this.lineTool ? "line" : "draw";
    this.lastPoint = this.gesture === "pan" ? point : this.imagePoint(point);
    if (this.gesture === "line") {
      this.lineStart = this.lastPoint;
      this.strokeTiles = new Map();
      this.previewLine(this.lastPoint);
    }
    if (this.gesture === "draw") {
      this.strokeTiles = new Map();
      this.drawSegment(this.lastPoint, this.lastPoint);
    }
    this.canvas.style.cursor = this.gesture === "pan" ? "grabbing" : "none";
    this.updateCursor(point);
  }

  move(event) {
    event.stopPropagation();
    const point = this.localPoint(event);
    if (this.gesture === "pan") {
      this.pan.x += point.x - this.lastPoint.x;
      this.pan.y += point.y - this.lastPoint.y;
      this.lastPoint = point;
      this.render();
    } else if (this.gesture === "draw") {
      const samples = event.getCoalescedEvents?.();
      for (const sample of samples?.length ? samples : [event]) {
        const imagePoint = this.imagePoint(this.localPoint(sample));
        this.drawSegment(this.lastPoint, imagePoint);
        this.lastPoint = imagePoint;
      }
    } else if (this.gesture === "line") {
      this.previewLine(this.imagePoint(point));
    }
    this.updateCursor(point);
  }

  previewLine(point) {
    this.restoreTiles();
    this.drawSegment(this.lineStart, point);
  }

  finishStroke(event, cancelled = false) {
    event?.stopPropagation();
    if (!this.gesture) return;
    if (this.gesture === "line") {
      if (cancelled) {
        this.restoreTiles();
        this.render();
      } else {
        if (event) this.previewLine(this.imagePoint(this.localPoint(event)));
        this.redoHistory = [];
        this.remember();
        this.markDirty();
      }
      this.strokeTiles = null;
    }
    if (this.gesture === "draw") {
      if (cancelled) {
        this.restoreTiles();
        this.strokeTiles = null;
        this.render();
      } else {
        this.redoHistory = [];
        this.remember();
        this.markDirty();
      }
    }
    this.gesture = null;
    this.canvas.style.cursor = "none";
    if (event && this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    this.updateCursor();
  }

  wheel(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) {
      if (event.deltaY !== 0) this.setBrushSize(String(Number(this.size.value) + Math.sign(event.deltaY)), true);
      return;
    }
    if (this.gesture) return;
    const point = this.localPoint(event);
    const anchor = this.imagePoint(point);
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.canvas.height : 1);
    this.zoom = Math.min(32, Math.max(0.1, this.zoom * Math.exp(-delta * 0.0015)));
    const view = this.transform();
    this.pan.x += point.x - (view.x + anchor.x * view.scale);
    this.pan.y += point.y - (view.y + anchor.y * view.scale);
    this.render();
    this.updateCursor(point);
  }

  drawSegment(from, to) {
    const radius = Number(this.size.value) / 2 + 2;
    const indices = this.mode === "eraser" ? [0, 1] : [this.mode === "mask" ? 1 : 0];
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 64));
    for (let step = 0; step < steps; step++) {
      const x = from.x + (to.x - from.x) * step / steps;
      const y = from.y + (to.y - from.y) * step / steps;
      const nextX = from.x + (to.x - from.x) * (step + 1) / steps;
      const nextY = from.y + (to.y - from.y) * (step + 1) / steps;
      this.captureTiles(Math.min(x, nextX) - radius, Math.min(y, nextY) - radius,
        Math.max(x, nextX) + radius, Math.max(y, nextY) + radius, indices);
    }
    const layers = this.mode === "eraser" ? this.layers : [this.layers[this.mode === "mask" ? 1 : 0]];
    for (const layer of layers) {
      const context = layer.getContext("2d");
      context.save();
      context.globalCompositeOperation = this.mode === "eraser" ? "destination-out" : "source-over";
      context.strokeStyle = context.fillStyle = this.mode === "mask" ? "#62cfff" : this.color.value;
      context.lineWidth = Number(this.size.value);
      context.lineCap = context.lineJoin = "round";
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
      context.beginPath();
      context.arc(to.x, to.y, context.lineWidth / 2, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
    this.render();
  }

  captureTiles(left, top, right, bottom, indices) {
    if (!this.strokeTiles) return;
    for (const index of indices) {
      const layer = this.layers[index];
      const x0 = Math.max(0, Math.floor(left / 128) * 128);
      const y0 = Math.max(0, Math.floor(top / 128) * 128);
      const x1 = Math.min(layer.width, right);
      const y1 = Math.min(layer.height, bottom);
      for (let y = y0; y < y1; y += 128) {
        for (let x = x0; x < x1; x += 128) {
          const key = `${index}:${x}:${y}`;
          if (this.strokeTiles.has(key)) continue;
          const pixels = layer.getContext("2d").getImageData(x, y, Math.min(128, layer.width - x), Math.min(128, layer.height - y));
          this.strokeTiles.set(key, {index, x, y, pixels});
        }
      }
    }
  }

  restoreTiles() {
    for (const patch of this.strokeTiles.values()) {
      this.layers[patch.index].getContext("2d").putImageData(patch.pixels, patch.x, patch.y);
    }
  }

  remember() {
    if (!this.strokeTiles?.size) return;
    this.history.push({width:this.layers[0].width, height:this.layers[0].height, patches:[...this.strokeTiles.values()]});
    this.strokeTiles = null;
    this.trimHistory();
  }

  trimHistory() {
    const bytes = entry => entry.patches.reduce((total, patch) => total + patch.pixels.width * patch.pixels.height * 4, 0);
    let total = [...this.history, ...this.redoHistory].reduce((sum, entry) => sum + bytes(entry), 0);
    while (this.history.length + this.redoHistory.length > 1 &&
      (this.history.length + this.redoHistory.length > 30 || total > 256 * 1024 * 1024)) {
      const oldest = this.history.length > 1 ? this.history.shift() : this.redoHistory.shift();
      total -= bytes(oldest);
    }
  }

  restore(snapshot) {
    for (const patch of snapshot.patches) {
      const context = this.layers[patch.index].getContext("2d");
      const current = context.getImageData(patch.x, patch.y, patch.pixels.width, patch.pixels.height);
      context.putImageData(patch.pixels, patch.x, patch.y);
      patch.pixels = current;
    }
    this.render();
    this.markDirty();
  }

  undo() {
    this.finishStroke();
    const entry = this.history.pop();
    if (!entry) return;
    this.restore(entry);
    this.redoHistory.push(entry);
  }

  redo() {
    this.finishStroke();
    const snapshot = this.redoHistory.pop();
    if (!snapshot) return;
    this.history.push(snapshot);
    this.restore(snapshot);
  }

  clear() {
    this.finishStroke();
    this.strokeTiles = new Map();
    this.captureTiles(0, 0, this.layers[0].width, this.layers[0].height, [0, 1]);
    this.layers.forEach(layer => layer.getContext("2d").clearRect(0, 0, layer.width, layer.height));
    this.redoHistory = [];
    this.remember();
    this.render();
    this.markDirty();
  }

  resetView() {
    this.zoom = 1;
    this.pan = {x:0, y:0};
    this.render();
    this.updateCursor();
  }

  markDirty() {
    this.saveRevision = (this.saveRevision || 0) + 1;
    app.graph.setDirtyCanvas(true, true);
  }

  executionState() {
    if (this.executionRevision === this.saveRevision && this.executionData) return this.executionData;
    let source = "";
    if (this.background) {
      // Keep generation metadata on the preview, not recursively inside the next prompt's source PNG.
      const canvas = document.createElement("canvas");
      canvas.width = this.background.naturalWidth;
      canvas.height = this.background.naturalHeight;
      canvas.getContext("2d").drawImage(this.background, 0, 0);
      source = canvas.toDataURL("image/png");
    }
    this.executionData = JSON.stringify({
      paint:this.layers[0].toDataURL("image/png"),
      mask:this.layers[1].toDataURL("image/png"),
      source,
      expand:this.expandPaint?.checked ?? true,
    });
    this.executionRevision = this.saveRevision;
    return this.executionData;
  }

  sessionState() {
    this.finishStroke();
    return {
      background:this.background, sourceKey:this.sourceKey, inputKey:this.inputKey,
      previewKey:this.previewKey, previewName:this.previewName,
      layers:this.layers, history:this.history, redoHistory:this.redoHistory,
      zoom:this.zoom, pan:{...this.pan}, previewZoom:this.previewZoom, previewPan:{...this.previewPan},
      color:this.color.value, size:this.size.value, mode:this.mode, lineTool:this.lineTool,
    };
  }

  restoreSession(state) {
    const {color, size, mode, lineTool, ...images} = state;
    Object.assign(this, images);
    this.pendingSource = this.sourceKey;
    this.color.value = color;
    this.setBrushSize(size, true);
    this.setMode(mode);
    this.lineTool = lineTool;
    this.lineButton.setAttribute("aria-pressed", String(lineTool));
    this.editorSize.textContent = this.background ? `${this.background.naturalWidth}×${this.background.naturalHeight}` : "";
    if (this.previewKey) {
      this.restoredPreviewView = {zoom:this.previewZoom, pan:{...this.previewPan}};
      this.previewImage.src = layerUrl(this.previewKey);
      this.previewCaption.textContent = this.previewName;
      this.previewMessage.hidden = true;
      this.previewImage.hidden = false;
      this.sendButton.disabled = false;
      this.savePreviewButton.disabled = false;
    }
    this.applyPreviewView();
    this.executionData = null;
    this.markDirty();
    this.render();
    this.updateCursor();
  }

  dispose() {
    if (this.renderFrame != null) cancelAnimationFrame(this.renderFrame);
    this.resizeObserver.disconnect();
  }
}

function addPaintWidget(node) {
  const index = node.widgets.findIndex(candidate => candidate.name === "paint");
  // Hidden image state is not prompt text; keep it outside text-preset serializers.
  const widget = {...node.widgets[index]};
  node.widgets[index] = widget;
  widget.type = "converted-widget";
  widget.hidden = true;
  widget.computeSize = () => [0, -4];
  widget.draw = () => {};
  widget.options = {...widget.options, serialize:true};
  widget.serializeValue = async () => {
    await node.sketchEditor.ready;
    await node.sketchEditor.transfer;
    node.sketchEditor.finishStroke();
    return node.sketchEditor.executionState();
  };
  return widget;
}

function labelImageConnectors(slots) {
  for (const slot of slots || []) {
    if (slot.name === "image" || slot.name === "edit image") slot.label = "edit image";
    if (slot.name === "original" || slot.name === "original image") slot.label = "original image";
  }
}

function configureChoiceButtons(widget) {
  if (!widget) return;
  const values = widget.options.values;
  const height = 44;
  widget.computeSize = width => [width, height];
  widget.draw = function(ctx, node, width, y) {
    ctx.save();
    ctx.font = "12px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = this.computedDisabled ? "#777" : "#bbb";
    ctx.fillText(this.label || this.name, 15, y + 8);
    const buttonWidth = (width - 34) / values.length;
    values.forEach((value, index) => {
      const x = 15 + index * buttonWidth;
      const selected = this.value === value;
      ctx.fillStyle = this.computedDisabled ? "#303030" : selected ? "#355e80" : "#303030";
      ctx.strokeStyle = this.computedDisabled ? "#444" : selected ? "#82b9e4" : "#555";
      ctx.beginPath();
      ctx.roundRect(x, y + 18, buttonWidth - 4, 22, 4);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillStyle = this.computedDisabled ? "#777" : selected ? "#fff" : "#bbb";
      ctx.fillText(value, x + (buttonWidth - 4) / 2, y + 29, buttonWidth - 10);
    });
    ctx.restore();
  };
  widget.drawWidget = function(ctx, {width}) {this.draw(ctx, this.node, width, this.y);};
  const pick = (x, y, node, event, canvas) => {
    if (widget.disabled || widget.computedDisabled || (event.button != null && event.button !== 0)) return false;
    const width = widget.width || node.size[0];
    const top = widget.y ?? widget.last_y;
    const buttonWidth = (width - 34) / values.length;
    const index = Math.floor((x - 15) / buttonWidth);
    if (y < top + 18 || y > top + 40 || index < 0 || index >= values.length ||
        x - 15 - index * buttonWidth > buttonWidth - 4) return false;
    const value = values[index];
    if (value === widget.value) return true;
    if (canvas && widget.setValue) widget.setValue(value, {e:event, node, canvas});
    else {
      widget.value = value;
      widget.callback?.(value, canvas, node, [x, y], event);
    }
    node.setDirtyCanvas?.(true, true);
    return true;
  };
  widget.onClick = function({e, node, canvas}) {
    pick(e.canvasX - node.pos[0], e.canvasY - node.pos[1], node, e, canvas);
  };
  widget.mouse = function(event, [x, y], node) {
    if (event.type !== "pointerdown" && event.type !== "mousedown") return false;
    return pick(x, y, node, event);
  };
}

function configurePrepareControls(node) {
  labelImageConnectors(node.inputs);
  const area = node.widgets.find(widget => widget.name === "inpaint_area");
  const content = node.widgets.find(widget => widget.name === "masked_content");
  const padding = node.widgets.find(widget => widget.name === "padding");
  const blur = node.widgets.find(widget => widget.name === "mask_blur");
  const ordered = [blur, content, area, padding].filter(Boolean);
  node.widgets.splice(0, node.widgets.length, ...ordered, ...node.widgets.filter(widget => !ordered.includes(widget)));
  configureChoiceButtons(area);
  configureChoiceButtons(content);
  const preset = node.widgets.find(widget => widget.name === "generation_size");
  const custom = node.widgets.find(widget => widget.name === "custom_size");
  const controls = [padding, preset, custom].filter(Boolean);
  if (preset) preset.label = "Inpaint upscale size";
  const refresh = () => {
    labelImageConnectors(node.inputs);
    for (const widget of controls) {
      widget.disabled = area.value !== "Only masked" || (widget === custom && preset.value !== "Custom");
      widget.options = {...widget.options, serialize:true};
    }
    node.updateComputedDisabled?.();
    app.graph?.setDirtyCanvas(true, true);
  };
  for (const widget of [area, preset].filter(Boolean)) {
    const callback = widget.callback;
    widget.callback = function() {const result = callback?.apply(this, arguments); refresh(); return result;};
  }
  const configure = node.onConfigure;
  node.onConfigure = function(info) {
    const result = configure?.apply(this, arguments);
    const values = info?.widgets_values;
    if (values && ["Whole picture", "Only masked"].includes(values[0]) && content && padding) {
      area.value = values[0];
      padding.value = values[1];
      content.value = values[2];
      if (blur) blur.value = values[3];
    } else if (values && ["original", "fill"].includes(values[0]) && content && padding) {
      content.value = values[0];
      area.value = values[1];
      padding.value = values[2];
      if (blur) blur.value = values[3];
    }
    refresh();
    return result;
  };
  refresh();
}

app.registerExtension({
  name:"image-mask-editor",
  init() {
    addStyles();
  },
  async beforeLoadGraph() {
    pruneWorkflowSessions();
    const workflow = app.extensionManager.workflow.activeWorkflow;
    if (!workflow || !app.extensionManager.workflow.isOpen(workflow)) return;
    const editors = workflowEditors();
    await Promise.allSettled([...editors.values()].flatMap(editor => [editor.ready, editor.transfer, editor.previewLoad]));
    workflowSessions.set(workflow, new Map([...editors].map(([key, editor]) => [key, editor.sessionState()])));
  },
  async afterLoadGraph() {
    pruneWorkflowSessions();
    const workflow = app.extensionManager.workflow.activeWorkflow;
    const session = workflowSessions.get(workflow);
    if (!session) return;
    for (const [key, editor] of workflowEditors()) {
      const state = session.get(key);
      if (!state) continue;
      await editor.ready;
      editor.restoreSession(state);
    }
    workflowSessions.delete(workflow);
  },
  nodeCreated(node) {
    if (node.comfyClass === "ImageMaskEditorPrepare" || node.type === "ImageMaskEditorPrepare") {
      configurePrepareControls(node);
      return;
    }
    if (node.comfyClass === "ImageMaskEditorPreview" || node.type === "ImageMaskEditorPreview") {
      const target = node.widgets.find(widget => widget.name === "target");
      target.type = "combo";
      target.options = {...target.options, values:() => (node.graph || app.graph)._nodes
        .filter(candidate => candidate.comfyClass === TYPE || candidate.type === TYPE)
        .map(candidate => `${candidate.id}: ${candidate.title}`)};
      const executed = node.onExecuted;
      node.onExecuted = function(output) {
        const result = executed?.apply(this, arguments);
        const id = String(output.target?.[0] || "").split(":")[0];
        const editor = (this.graph || app.graph).getNodeById(id)?.sketchEditor;
        const image = output.image_mask_editor_preview?.[0];
        if (editor && image) editor.setPreview(image, "生成結果").catch(error => editor.reportError(error));
        return result;
      };
      return;
    }
    if (node.comfyClass !== TYPE && node.type !== TYPE) return;
    labelImageConnectors(node.outputs);
    const paintWidget = addPaintWidget(node);
    node.sketchEditor = new ImageMaskEditorUI(node, paintWidget);
    const onExecuted = node.onExecuted;
    node.onExecuted = function(output) {
      const result = onExecuted?.apply(this, arguments);
      const source = output.image_mask_editor_source?.[0];
      if (source) this.sketchEditor.acceptInput(source).catch(error => this.sketchEditor.reportError(error));
      return result;
    };
    node.addDOMWidget("sketch_editor", "image-mask-editor", node.sketchEditor.element, {
      serialize:false, hideOnZoom:false, getMinHeight:() => 120, getMinWidth:() => MIN_WIDTH - 20,
    });
    const setSize = node.setSize;
    node.setSize = function(size) {
      return setSize.call(this, [Math.max(MIN_WIDTH, size[0]), Math.max(MIN_HEIGHT, size[1])]);
    };
    const onResize = node.onResize;
    node.onResize = function(size) {
      size[0] = Math.max(MIN_WIDTH, size[0]);
      size[1] = Math.max(MIN_HEIGHT, size[1]);
      return onResize?.apply(this, arguments);
    };
    const onConfigure = node.onConfigure;
    node.onConfigure = function() {
      const result = onConfigure?.apply(this, arguments);
      this.sketchEditor.editorCaption.textContent = `編集画面 — ID: ${this.id}`;
      this.sketchEditor.restoreSplitRatio();
      this.sketchEditor.restoreSettings();
      labelImageConnectors(this.outputs);
      this.setSize(this.size);
      this.sketchEditor.ready = this.sketchEditor.restoreLayers();
      this.sketchEditor.ready.catch(error => console.error("Image & Mask Editor:", error));
      return result;
    };
    const onAdded = node.onAdded;
    node.onAdded = function() {
      const result = onAdded?.apply(this, arguments);
      this.sketchEditor.editorCaption.textContent = `編集画面 — ID: ${this.id}`;
      return result;
    };
    const onRemoved = node.onRemoved;
    node.onRemoved = function() {
      this.sketchEditor.dispose();
      return onRemoved?.apply(this, arguments);
    };
    node.setSize([900, 610]);
  },
});
