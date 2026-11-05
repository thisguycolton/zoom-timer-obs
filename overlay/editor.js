// Layout editor: drag/resize timer parts on a canvas, style them, and save to the helper (/layout),
// which pushes the change live to canvas.html in OBS.
(function () {
  const ZTC = window.ZoomTimerCanvas;
  const $ = (id) => document.getElementById(id);
  const stage = $("stage");
  const renderer = ZTC.createRenderer(stage, { alwaysVisible: true, showAllBanners: true });
  const root = renderer.root;

  let layout = ZTC.normalize(null);
  let selectedId = null;
  const history = [];
  let future = [];

  // ---------- Loading & saving ----------

  function load() {
    fetch("/layout", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((saved) => {
        layout = ZTC.normalize(saved);
        history.length = 0;
        history.push(JSON.stringify(layout));
        refreshAll();
        setStatus(saved ? "Loaded" : "New layout (not saved yet)");
      });
  }

  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    setStatus("Saving…");
    saveTimer = setTimeout(() => {
      fetch("/layout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(layout) })
        .then((r) => setStatus(r.ok ? "Saved" : "Save failed (" + r.status + ")"))
        .catch(() => setStatus("Helper not reachable"));
    }, 300);
  }

  function setStatus(text) { $("saveStatus").textContent = text; }

  /** Call after any finished change: records undo history, saves, refreshes the UI. */
  function commit(opts) {
    const snapshot = JSON.stringify(layout);
    if (history[history.length - 1] !== snapshot) {
      history.push(snapshot);
      if (history.length > 200) history.shift();
      future = [];
    }
    save();
    if (!opts || opts.rebuild !== false) refreshAll(); else { refreshParts(); positionSelection(); }
  }

  function undo() {
    if (history.length < 2) return;
    future.push(history.pop());
    layout = JSON.parse(history[history.length - 1]);
    if (!find(selectedId)) selectedId = null;
    save(); refreshAll();
  }
  function redo() {
    if (!future.length) return;
    const next = future.pop();
    history.push(next);
    layout = JSON.parse(next);
    save(); refreshAll();
  }

  // ---------- Helpers ----------

  function find(id) { return layout.items.find((i) => i.id === id) || null; }
  function selected() { return find(selectedId); }
  function gridSize() { return Math.max(1, Number($("gridSize").value) || 10); }
  function snap(v) { return $("snap").checked ? Math.round(v / gridSize()) * gridSize() : Math.round(v); }
  function scale() { return renderer.resize(); }
  function typeName(item) { return (ZTC.TYPES[item.type] || {}).name || item.type; }
  function newId(type) { let n = 1; while (find(type + n)) n++; return type + n; }

  function refreshAll() {
    renderer.setLayout(layout);
    layout = renderer.layout; // normalized copy shares item objects with the renderer
    root.classList.toggle("has-bg", !!(layout.canvas.background || layout.canvas.image));
    applyGrid();
    refreshParts();
    refreshProps();
    positionSelection();
    $("obsUrl").textContent = location.origin + "/canvas.html";
    $("obsSize").textContent = layout.canvas.width + " × " + layout.canvas.height;
  }

  function applyGrid() {
    root.classList.toggle("grid-on", $("showGrid").checked);
    root.style.setProperty("--grid", gridSize() + "px");
  }

  // ---------- Parts list ----------

  function refreshParts() {
    const list = $("parts");
    list.innerHTML = "";
    // Topmost first, like layer panels in design tools.
    layout.items.slice().reverse().forEach((item) => {
      const li = document.createElement("li");
      li.className = (item.id === selectedId ? "sel " : "") + (item.visible === false ? "off" : "");
      const eye = document.createElement("button");
      eye.className = "eye";
      eye.title = item.visible === false ? "Show" : "Hide";
      eye.textContent = item.visible === false ? "◌" : "●";
      eye.onclick = (e) => { e.stopPropagation(); item.visible = item.visible === false; commit(); };
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = item.name || (item.type === "label" && item.text ? "Label: " + item.text : typeName(item));
      li.append(eye, name);
      li.onclick = () => select(item.id);
      list.appendChild(li);
    });
  }

  // ---------- Selection & dragging ----------

  const selBox = document.createElement("div");
  selBox.className = "sel-box hidden";
  const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const CURSORS = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };
  HANDLES.forEach((h) => {
    const d = document.createElement("div");
    d.className = "h";
    d.dataset.handle = h;
    d.style.cursor = CURSORS[h];
    selBox.appendChild(d);
  });
  const hoverBox = document.createElement("div");
  hoverBox.className = "hover-box hidden";

  function ensureOverlays() {
    if (selBox.parentNode !== root) root.appendChild(selBox);
    if (hoverBox.parentNode !== root) root.appendChild(hoverBox);
  }

  function positionSelection() {
    ensureOverlays();
    const item = selected();
    if (!item) { selBox.classList.add("hidden"); return; }
    const s = scale();
    const hs = 10 / s, bw = 2 / s;
    selBox.classList.remove("hidden");
    selBox.style.left = item.x + "px";
    selBox.style.top = item.y + "px";
    selBox.style.width = item.w + "px";
    selBox.style.height = item.h + "px";
    selBox.style.borderWidth = bw + "px";
    selBox.style.margin = -bw + "px 0 0 " + -bw + "px";
    for (const d of selBox.children) {
      const h = d.dataset.handle;
      d.style.width = d.style.height = hs + "px";
      d.style.borderWidth = bw + "px";
      d.style.left = h.indexOf("w") >= 0 ? -hs / 2 + "px" : h.indexOf("e") >= 0 ? "calc(100% - " + hs / 2 + "px)" : "calc(50% - " + hs / 2 + "px)";
      d.style.top = h.indexOf("n") >= 0 ? -hs / 2 + "px" : h.indexOf("s") >= 0 ? "calc(100% - " + hs / 2 + "px)" : "calc(50% - " + hs / 2 + "px)";
    }
  }

  function select(id) {
    selectedId = id;
    refreshParts();
    refreshProps();
    positionSelection();
  }

  let drag = null;

  root.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(".h");
    const itemEl = e.target.closest(".ztc-item");
    if (!handle && !itemEl) { select(null); return; }
    const id = handle ? selectedId : itemEl.dataset.id;
    const item = find(id);
    if (!item) return;
    if (id !== selectedId) select(id);
    e.preventDefault();
    root.setPointerCapture(e.pointerId);
    drag = { id: id, handle: handle ? handle.dataset.handle : null, startX: e.clientX, startY: e.clientY,
             orig: { x: item.x, y: item.y, w: item.w, h: item.h }, scale: scale(), moved: false };
  });

  root.addEventListener("pointermove", (e) => {
    if (!drag) {
      const itemEl = e.target.closest(".ztc-item");
      const item = itemEl && find(itemEl.dataset.id);
      if (item && item.id !== selectedId) {
        hoverBox.classList.remove("hidden");
        Object.assign(hoverBox.style, { left: item.x + "px", top: item.y + "px", width: item.w + "px", height: item.h + "px" });
      } else hoverBox.classList.add("hidden");
      return;
    }
    const item = find(drag.id);
    if (!item) return;
    const dx = (e.clientX - drag.startX) / drag.scale, dy = (e.clientY - drag.startY) / drag.scale;
    if (Math.abs(dx) + Math.abs(dy) > 1) drag.moved = true;
    const o = drag.orig, min = 8;
    if (!drag.handle) {
      item.x = snap(o.x + dx);
      item.y = snap(o.y + dy);
    } else {
      const h = drag.handle;
      let x = o.x, y = o.y, w = o.w, hh = o.h;
      if (h.indexOf("e") >= 0) w = Math.max(min, snap(o.x + o.w + dx) - o.x);
      if (h.indexOf("s") >= 0) hh = Math.max(min, snap(o.y + o.h + dy) - o.y);
      if (h.indexOf("w") >= 0) { x = Math.min(snap(o.x + dx), o.x + o.w - min); w = o.x + o.w - x; }
      if (h.indexOf("n") >= 0) { y = Math.min(snap(o.y + dy), o.y + o.h - min); hh = o.y + o.h - y; }
      if (e.shiftKey && h.length === 2) {
        const ratio = o.w / o.h;
        if (w / hh > ratio) w = Math.round(hh * ratio); else hh = Math.round(w / ratio);
        if (h.indexOf("w") >= 0) x = o.x + o.w - w;
        if (h.indexOf("n") >= 0) y = o.y + o.h - hh;
      }
      Object.assign(item, { x: x, y: y, w: w, h: hh });
    }
    renderer.updateItem(item);
    positionSelection();
    refreshGeometryFields(item);
  });

  function endDrag() {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (moved) commit({ rebuild: false });
  }
  root.addEventListener("pointerup", endDrag);
  root.addEventListener("pointercancel", endDrag);
  root.addEventListener("pointerleave", () => hoverBox.classList.add("hidden"));
  $("stageWrap").addEventListener("pointerdown", (e) => { if (e.target === $("stageWrap") || e.target === stage) select(null); });

  // ---------- Keyboard ----------

  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName) && document.activeElement.type !== "checkbox";
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (typing) return;
    const item = selected();
    if (e.key === "Escape") return select(null);
    if (!item) return;
    const step = e.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      item.x += moves[e.key][0];
      item.y += moves[e.key][1];
      renderer.updateItem(item);
      positionSelection();
      refreshGeometryFields(item);
      clearTimeout(nudgeTimer);
      nudgeTimer = setTimeout(() => commit({ rebuild: false }), 250);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeItem(item);
    } else if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      duplicate(item);
    }
  });
  let nudgeTimer;

  // ---------- Adding / removing ----------

  const NEW_ITEMS = {
    clock: { w: 420, h: 140, align: "center" },
    label: { w: 320, h: 40, text: "Label", align: "center", opacity: 0.85 },
    bar: { w: 600, h: 20, radius: 10 },
    ring: { w: 300, h: 300, thickness: 8 },
    percent: { w: 160, h: 70, align: "center", colorMode: "accent" },
    banner: { w: 400, h: 50, align: "center", timesUpText: "Time's up", overtimeText: "Over time" },
    panel: { w: 500, h: 260, bg: "#000000", bgOpacity: 0.55, radius: 20 },
    image: { w: 300, h: 300, fit: "contain" },
  };

  function addItem(type) {
    const preset = ZTC.clone(NEW_ITEMS[type]);
    const c = layout.canvas;
    const item = Object.assign({ id: newId(type), type: type, x: snap((c.width - preset.w) / 2), y: snap((c.height - preset.h) / 2) }, preset);
    if (type === "panel") layout.items.unshift(item); else layout.items.push(item);
    selectedId = item.id;
    commit();
    if (type === "image") pickImage((url) => { item.src = url; commit(); });
  }

  function duplicate(item) {
    const copy = ZTC.clone(item);
    copy.id = newId(item.type);
    copy.x += 20; copy.y += 20;
    layout.items.splice(layout.items.indexOf(item) + 1, 0, copy);
    selectedId = copy.id;
    commit();
  }

  function removeItem(item) {
    layout.items = layout.items.filter((i) => i !== item);
    selectedId = null;
    commit();
  }

  function moveLayer(item, delta) {
    const i = layout.items.indexOf(item), j = i + delta;
    if (j < 0 || j >= layout.items.length) return;
    layout.items.splice(i, 1);
    layout.items.splice(j, 0, item);
    commit();
  }

  document.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => addItem(b.dataset.add)));

  // ---------- Image upload ----------

  let pickCallback = null;
  function pickImage(cb) { pickCallback = cb; $("fileInput").value = ""; $("fileInput").click(); }
  $("fileInput").addEventListener("change", () => {
    const file = $("fileInput").files[0];
    if (!file || !pickCallback) return;
    const cb = pickCallback; pickCallback = null;
    setStatus("Uploading…");
    fetch("/assets", { method: "POST", headers: { "Content-Type": file.type }, body: file })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => cb(j.url))
      .catch((err) => setStatus("Upload failed (" + err + ")"));
  });

  // ---------- Properties panel ----------

  const props = $("props");

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === "text") n.textContent = attrs[k];
      else if (k.indexOf("on") === 0) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    (children || []).forEach((c) => c && n.appendChild(c));
    return n;
  }
  function heading(text) { return el("h2", { text: text }); }

  /** A labelled control bound to obj[key]. kind: text | number | color | select | check | range */
  function field(label, obj, key, kind, extra) {
    extra = extra || {};
    const onChange = (v) => {
      if (v === "" || v == null) delete obj[key]; else obj[key] = v;
      if (extra.after) extra.after(v);
      commit({ rebuild: !!extra.rebuild });
      if (!extra.rebuild) { renderer.setLayout(layout); layout = renderer.layout; root.classList.toggle("has-bg", !!(layout.canvas.background || layout.canvas.image)); positionSelection(); }
    };
    if (kind === "check") {
      const input = el("input", { type: "checkbox" });
      input.checked = extra.invert ? obj[key] === false : (obj[key] === undefined ? !!extra.default : !!obj[key]);
      input.addEventListener("change", () => onChange(extra.invert ? (input.checked ? false : true) : input.checked));
      return el("label", { class: "check" }, [input, el("span", { text: label })]);
    }
    let control;
    const value = obj[key] == null ? (extra.default != null ? extra.default : "") : obj[key];
    if (kind === "select") {
      control = el("select");
      extra.options.forEach(([v, t]) => { const o = el("option", { value: v, text: t }); if (String(value) === String(v)) o.selected = true; control.appendChild(o); });
      control.addEventListener("change", () => onChange(extra.number ? Number(control.value) : control.value));
    } else if (kind === "color") {
      const text = el("input", { type: "text", placeholder: extra.placeholder || "none" });
      text.value = obj[key] || "";
      const swatch = el("input", { type: "color" });
      swatch.value = /^#[0-9a-f]{6}$/i.test(obj[key] || "") ? obj[key] : (extra.swatch || "#000000");
      swatch.addEventListener("input", () => { text.value = swatch.value; onChange(swatch.value); });
      text.addEventListener("change", () => onChange(text.value.trim()));
      control = el("div", { class: "row" }, [swatch, text]);
    } else if (kind === "font") {
      control = FontPicker.create({ value: obj[key] || "", placeholder: extra.placeholder, googleFonts: ZTC.GOOGLE_FONTS, onChange: onChange }).element;
    } else if (kind === "range") {
      control = el("input", { type: "range", min: extra.min, max: extra.max, step: extra.step });
      control.value = value;
      control.addEventListener("input", () => { obj[key] = Number(control.value); renderer.setLayout(layout); layout = renderer.layout; positionSelection(); });
      control.addEventListener("change", () => onChange(Number(control.value)));
    } else {
      control = el("input", { type: kind === "number" ? "number" : "text" });
      if (extra.min != null) control.min = extra.min;
      if (extra.step != null) control.step = extra.step;
      control.value = value;
      if (extra.placeholder) control.placeholder = extra.placeholder;
      control.addEventListener("change", () => onChange(kind === "number" ? (control.value === "" ? "" : Number(control.value)) : control.value));
    }
    return el("label", { class: "field" }, [el("span", { text: label }), control]);
  }

  const geometryInputs = {};
  function geometry(item) {
    const wrap = el("div", { class: "grid4" });
    ["x", "y", "w", "h"].forEach((k) => {
      const input = el("input", { type: "number", step: "1" });
      input.value = Math.round(item[k]);
      input.addEventListener("change", () => {
        item[k] = Math.max(k === "w" || k === "h" ? 4 : -100000, Number(input.value) || 0);
        renderer.updateItem(item); positionSelection(); commit({ rebuild: false });
      });
      geometryInputs[k] = input;
      wrap.appendChild(el("label", {}, [el("span", { text: k.toUpperCase() }), input]));
    });
    return wrap;
  }
  function refreshGeometryFields(item) {
    ["x", "y", "w", "h"].forEach((k) => { if (geometryInputs[k]) geometryInputs[k].value = Math.round(item[k]); });
  }

  const FONT_WEIGHTS = [["300", "Light"], ["400", "Regular"], ["500", "Medium"], ["600", "Semibold"], ["700", "Bold"], ["800", "Heavy"], ["900", "Black"]];
  const ALIGN = [["left", "Left"], ["center", "Center"], ["right", "Right"]];
  const SHOW_IN = [["always", "Always"], ["running", "Before zero only"], ["over", "Time's up / overtime only"]];

  function refreshProps() {
    props.innerHTML = "";
    for (const k in geometryInputs) delete geometryInputs[k];
    const item = selected();
    if (!item) return canvasProps();

    props.appendChild(heading(typeName(item)));
    props.appendChild(field("Name", item, "name", "text", { placeholder: typeName(item), rebuild: true }));
    props.appendChild(geometry(item));
    props.appendChild(el("div", { class: "actions" }, [
      el("button", { text: "Bring forward", onclick: () => moveLayer(item, 1) }),
      el("button", { text: "Send back", onclick: () => moveLayer(item, -1) }),
      el("button", { text: "Duplicate", onclick: () => duplicate(item) }),
      el("button", { class: "danger", text: "Delete", onclick: () => removeItem(item) }),
    ]));
    props.appendChild(field("Visible", item, "visible", "check", { invert: false, default: true }));
    if (item.type !== "banner") props.appendChild(field("Show", item, "showIn", "select", { options: SHOW_IN, default: "always" }));

    const textual = ZTC.TYPES[item.type].text;
    if (item.type === "label") props.appendChild(field("Text", item, "text", "text", { rebuild: true }));
    if (item.type === "banner") {
      props.appendChild(field("Time's up", item, "timesUpText", "text"));
      props.appendChild(field("Overtime", item, "overtimeText", "text"));
    }
    if (textual) {
      props.appendChild(heading("Text"));
      if (item.type === "clock" || item.type === "percent") {
        props.appendChild(field("Color mode", item, "colorMode", "select", { default: item.type === "percent" ? "accent" : "auto",
          options: [["auto", "Text color, red when over"], ["fixed", "Always this color"], ["accent", "Follow progress color"]] }));
      }
      props.appendChild(field("Color", item, "color", "color", { placeholder: "theme" , swatch: "#ffffff" }));
      props.appendChild(field("Font", item, "font", "font", { placeholder: "Theme font" }));
      props.appendChild(field("Weight", item, "weight", "select", { options: FONT_WEIGHTS, default: item.type === "label" ? "600" : "700" }));
      props.appendChild(field("Align", item, "align", "select", { options: ALIGN, default: "center" }));
      props.appendChild(field("Padding", item, "padding", "number", { min: 0, placeholder: "0" }));
      props.appendChild(field("Spacing (em)", item, "letterSpacing", "number", { step: 0.01, placeholder: "0" }));
      props.appendChild(field("Uppercase", item, "uppercase", "check"));
      props.appendChild(field("Shadow", item, "shadow", "check"));
    }
    if (item.type === "bar" || item.type === "ring") {
      props.appendChild(heading("Progress"));
      props.appendChild(field("Color mode", item, "colorMode", "select", { default: "accent",
        options: [["accent", "Green → yellow → red"], ["fixed", "Always this color"]] }));
      props.appendChild(field("Color", item, "color", "color", { swatch: "#34c759" }));
      props.appendChild(field("Track", item, "track", "color", { placeholder: "theme" }));
      if (item.type === "ring") props.appendChild(field("Thickness", item, "thickness", "range", { min: 1, max: 40, step: 1, default: 8 }));
    }
    if (item.type === "image") {
      props.appendChild(heading("Image"));
      props.appendChild(el("div", { class: "actions" }, [el("button", { text: item.src ? "Replace image" : "Choose image", onclick: () => pickImage((url) => { item.src = url; commit(); }) })]));
      props.appendChild(field("Fit", item, "fit", "select", { options: [["contain", "Contain"], ["cover", "Cover"], ["100% 100%", "Stretch"]], default: "contain" }));
    }
    props.appendChild(heading("Box"));
    props.appendChild(field("Background", item, "bg", "color"));
    props.appendChild(field("Bg opacity", item, "bgOpacity", "range", { min: 0, max: 1, step: 0.01, default: 1 }));
    props.appendChild(field("Corner radius", item, "radius", "number", { min: 0, placeholder: "0" }));
    props.appendChild(field("Opacity", item, "opacity", "range", { min: 0, max: 1, step: 0.01, default: 1 }));
  }

  function canvasProps() {
    const c = layout.canvas, t = layout.theme;
    props.appendChild(heading("Canvas"));
    props.appendChild(el("p", { class: "muted", text: "Click a part to edit it. These settings apply to the whole overlay." }));
    const size = el("div", { class: "grid4" });
    [["width", "W"], ["height", "H"]].forEach(([k, label]) => {
      const input = el("input", { type: "number", min: "100", step: "10" });
      input.value = c[k];
      input.addEventListener("change", () => { c[k] = Math.max(100, Number(input.value) || c[k]); commit(); });
      size.appendChild(el("label", {}, [el("span", { text: label }), input]));
    });
    props.appendChild(size);
    props.appendChild(field("Background", c, "background", "color", { placeholder: "transparent" }));
    props.appendChild(el("div", { class: "actions" }, [
      el("button", { text: c.image ? "Replace bg image" : "Background image…", onclick: () => pickImage((url) => { c.image = url; commit(); }) }),
      c.image ? el("button", { class: "danger", text: "Remove image", onclick: () => { c.image = ""; commit(); } }) : null,
    ]));
    if (c.image) props.appendChild(field("Image fit", c, "imageFit", "select", { options: [["cover", "Cover"], ["contain", "Contain"], ["100% 100%", "Stretch"]], rebuild: true }));

    props.appendChild(heading("Theme"));
    props.appendChild(field("Font", t, "font", "font", { placeholder: "System default" }));
    props.appendChild(field("Text", t, "text", "color", { swatch: "#ffffff" }));
    props.appendChild(field("Plenty left", t, "ok", "color"));
    props.appendChild(field("Warning", t, "warn", "color"));
    props.appendChild(field("Danger", t, "danger", "color"));
    props.appendChild(field("Over time", t, "over", "color"));
    props.appendChild(field("Track", t, "track", "color"));
    props.appendChild(field("Warn below", t, "warnAt", "select", { number: true, options: [[0.75, "75% left"], [0.5, "50% left"], [0.33, "33% left"], [0.25, "25% left"], [0, "Never"]] }));
    props.appendChild(field("Danger below", t, "dangerAt", "select", { number: true, options: [[0.33, "33% left"], [0.2, "20% left"], [0.1, "10% left"], [0.05, "5% left"], [0, "Never"]] }));
    props.appendChild(field("Format", t, "format", "select", { options: [["auto", "03:00 / 1:02:03"], ["mss", "3:00"], ["seconds", "180"], ["zoom", "Exactly like Zoom"]] }));
    props.appendChild(field("Overtime prefix", t, "overPrefix", "text", { placeholder: "-" }));
    props.appendChild(field("Show before Start", t, "showIdle", "check", { default: true }));
  }

  // ---------- Preview state ----------

  let previewTimer, events;
  function setPreview(mode) {
    clearInterval(previewTimer);
    if (events) { events.close(); events = null; }
    const total = 180;
    const st = (status, r, extra) => Object.assign({ status: status, remainingSeconds: r, totalSeconds: total, percentRemaining: r / total }, extra || {});
    const fixed = {
      running: st("running", 132), warn: st("running", 71), danger: st("running", 24), paused: st("paused", 95), idle: st("idle", 180),
      timesup: st("timesup", 0, { display: "00:00" }), overtime: st("overtime", 0, { overtimeSeconds: 12, display: "-00:12" }),
    };
    if (mode === "demo") {
      const seq = ZTC.demoStates(30);
      let i = 0;
      renderer.setState(seq[0]);
      previewTimer = setInterval(() => renderer.setState(seq[++i % seq.length]), 1000);
    } else if (mode === "live") {
      events = new EventSource("/events");
      events.onmessage = (e) => { try { renderer.setState(JSON.parse(e.data)); } catch (err) {} };
    } else {
      renderer.setState(fixed[mode]);
    }
  }

  // ---------- Header controls ----------

  $("preview").addEventListener("change", (e) => setPreview(e.target.value));
  $("snap").addEventListener("change", () => {});
  $("gridSize").addEventListener("change", applyGrid);
  $("showGrid").addEventListener("change", applyGrid);
  $("undo").addEventListener("click", undo);
  $("redo").addEventListener("click", redo);
  $("reset").addEventListener("click", () => {
    if (!confirm("Replace the layout with the default one?")) return;
    layout = ZTC.normalize(null);
    selectedId = null;
    commit();
  });
  $("copyUrl").addEventListener("click", () => {
    const url = location.origin + "/canvas.html";
    const done = () => { $("copyUrl").textContent = "Copied!"; setTimeout(() => ($("copyUrl").textContent = "Copy OBS URL"), 1200); };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt("OBS Browser Source URL", url));
    else prompt("OBS Browser Source URL", url);
  });
  window.addEventListener("resize", positionSelection);
  new ResizeObserver(() => positionSelection()).observe($("stageWrap"));

  // Shortcut hints are written for macOS; show Ctrl on Windows/Linux.
  if (!/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) {
    document.querySelectorAll("kbd, button[title]").forEach((n) => {
      if (n.tagName === "KBD") n.textContent = n.textContent.replace("⌘", "Ctrl+").replace("⇧", "Shift").replace("⌫", "Delete");
      else n.title = n.title.replace("⇧⌘", "Ctrl+Shift+").replace("⌘", "Ctrl+");
    });
  }

  // Hide Overlay toggle: the editor always draws, but says when OBS is showing nothing.
  function watchVisibility() {
    const source = new EventSource("/events");
    source.onmessage = (e) => {
      try { $("hiddenNote").classList.toggle("hidden", !JSON.parse(e.data).overlayHidden); } catch (err) {}
    };
  }
  $("showOverlay").addEventListener("click", () => {
    fetch("/visibility/show", { method: "POST" }).then(() => $("hiddenNote").classList.add("hidden")).catch(() => {});
  });

  setPreview("demo");
  load();
  watchVisibility();
})();
