// Renders a free-form canvas layout (made in editor.html) for a timer state.
// Shared by canvas.html (the OBS source) and editor.html (the live preview).
// Written for older Chromium (OBS's browser source): no container queries, no :has(), text sized in JS.
(function () {
  const W = 1920, H = 1080;

  const DEFAULT_LAYOUT = {
    version: 1,
    canvas: { width: W, height: H, background: "", image: "", imageFit: "cover" },
    theme: {
      font: "", text: "#ffffff", ok: "#34c759", warn: "#ffcc00", danger: "#ff3b30", over: "#ff3b30",
      track: "rgba(255,255,255,0.18)", warnAt: 0.5, dangerAt: 0.2, showIdle: true, format: "auto",
    },
    items: [
      { id: "panel1", type: "panel", x: 60, y: 60, w: 620, h: 250, bg: "#000000", bgOpacity: 0.55, radius: 24 },
      { id: "label1", type: "label", x: 100, y: 84, w: 300, h: 34, text: "Time left", align: "left", opacity: 0.8 },
      { id: "clock", type: "clock", x: 96, y: 118, w: 420, h: 130, align: "left" },
      { id: "percent", type: "percent", x: 520, y: 170, w: 130, h: 60, align: "right", colorMode: "accent" },
      { id: "bar", type: "bar", x: 100, y: 262, w: 540, h: 18, radius: 9 },
      { id: "banner", type: "banner", x: 360, y: 84, w: 290, h: 34, align: "right", timesUpText: "Time's up", overtimeText: "Over time" },
    ],
  };

  const TYPES = {
    clock: { name: "Clock", text: true },
    label: { name: "Label", text: true },
    percent: { name: "Percent", text: true },
    banner: { name: "Time's-up banner", text: true },
    bar: { name: "Progress bar" },
    ring: { name: "Progress ring" },
    panel: { name: "Panel" },
    image: { name: "Image" },
  };

  // Fonts the editor offers from Google Fonts. Any layout using one loads it from fonts.googleapis.com
  // (OBS's browser source has internet access); everything else must be installed on the computer.
  const GOOGLE_FONTS = [
    { name: "Inter", category: "Sans" }, { name: "Roboto", category: "Sans" }, { name: "Montserrat", category: "Sans" },
    { name: "Poppins", category: "Sans" }, { name: "Space Grotesk", category: "Sans" }, { name: "Rubik", category: "Sans" },
    { name: "Lexend", category: "Sans" }, { name: "Nunito", category: "Rounded" }, { name: "Quicksand", category: "Rounded" },
    { name: "Fredoka", category: "Rounded" }, { name: "Oswald", category: "Condensed" }, { name: "Bebas Neue", category: "Condensed" },
    { name: "Anton", category: "Condensed" }, { name: "Barlow Condensed", category: "Condensed" }, { name: "Teko", category: "Condensed" },
    { name: "Rajdhani", category: "Tech" }, { name: "Orbitron", category: "Tech" }, { name: "Exo 2", category: "Tech" },
    { name: "Audiowide", category: "Tech" }, { name: "Russo One", category: "Tech" }, { name: "Roboto Mono", category: "Mono" },
    { name: "JetBrains Mono", category: "Mono" }, { name: "Space Mono", category: "Mono" }, { name: "Share Tech Mono", category: "Mono" },
    { name: "VT323", category: "Retro" }, { name: "Press Start 2P", category: "Retro" }, { name: "Silkscreen", category: "Retro" },
    { name: "Black Ops One", category: "Display" }, { name: "Bungee", category: "Display" }, { name: "Righteous", category: "Display" },
    { name: "Archivo Black", category: "Display" }, { name: "Playfair Display", category: "Serif" }, { name: "Merriweather", category: "Serif" },
    { name: "DM Serif Display", category: "Serif" }, { name: "Permanent Marker", category: "Handwritten" }, { name: "Caveat", category: "Handwritten" },
  ];
  const GOOGLE_FONT_NAMES = {};
  GOOGLE_FONTS.forEach((f) => { GOOGLE_FONT_NAMES[f.name.toLowerCase()] = f.name; });
  const loadedFonts = {};

  /** Adds a Google Fonts stylesheet for each listed family not loaded yet. Returns true if it added any. */
  function loadGoogleFonts(names) {
    const wanted = names.map((n) => GOOGLE_FONT_NAMES[String(n || "").toLowerCase()]).filter((n) => n && !loadedFonts[n]);
    if (!wanted.length) return false;
    wanted.forEach((n) => { loadedFonts[n] = true; });
    // One request per 12 families keeps URLs short.
    for (let i = 0; i < wanted.length; i += 12) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?" + wanted.slice(i, i + 12)
        .map((n) => "family=" + encodeURIComponent(n).replace(/%20/g, "+") + ":wght@300;400;500;600;700;800;900").join("&") + "&display=swap";
      document.head.appendChild(link);
    }
    return true;
  }

  function fontsInLayout(layout) {
    const names = [layout.theme.font];
    layout.items.forEach((i) => names.push(i.font));
    return names.filter(Boolean);
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /** Fills in anything missing from a saved layout, in place (the editor keeps references to its objects). */
  function normalize(layout) {
    const base = clone(DEFAULT_LAYOUT);
    if (!layout || typeof layout !== "object") return base;
    layout.version = 1;
    for (const key of ["canvas", "theme"]) {
      if (!layout[key] || typeof layout[key] !== "object") layout[key] = {};
      for (const k in base[key]) if (!(k in layout[key])) layout[key][k] = base[key][k];
    }
    layout.items = Array.isArray(layout.items) ? layout.items.filter((i) => i && TYPES[i.type]) : base.items;
    return layout;
  }

  function rgba(color, opacity) {
    if (!color) return "transparent";
    if (opacity == null || opacity >= 1) return color;
    const m = /^#?([0-9a-f]{6})$/i.exec(color);
    if (!m) return color;
    const n = parseInt(m[1], 16);
    return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + opacity + ")";
  }

  function format(seconds, mode) {
    seconds = Math.max(0, Math.round(seconds || 0));
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
    const pad = (n) => (n < 10 ? "0" : "") + n;
    switch (mode) {
      case "mss": return (h * 60 + m) + ":" + pad(s);
      case "seconds": return String(seconds);
      case "zoom": return null; // use Zoom's own display string
      default: return h > 0 ? h + ":" + pad(m) + ":" + pad(s) : pad(m) + ":" + pad(s);
    }
  }

  /**
   * createRenderer(stage) draws into `stage`, a positioned element. The layout is drawn at canvas
   * size and scaled with a CSS transform to fit `stage` (or to `fixedScale` when given).
   */
  function createRenderer(stage, options) {
    options = options || {};
    const root = document.createElement("div");
    root.className = "ztc-root";
    root.style.cssText = "position:absolute;left:0;top:0;transform-origin:0 0;overflow:hidden;";
    stage.appendChild(root);

    let layout = normalize(null);
    let state = null;
    const nodes = {}; // id -> { el, inner, ... }

    function accent(p) {
      const t = layout.theme;
      if (!state || state.status === "timesup" || state.status === "overtime") return t.over;
      if (state.status === "idle") return t.ok;
      return p > t.warnAt ? t.ok : p > t.dangerAt ? t.warn : t.danger;
    }

    function fraction() {
      if (!state) return 1;
      if (state.status === "timesup" || state.status === "overtime") return 0;
      return state.percentRemaining == null ? 1 : state.percentRemaining;
    }

    function clockText() {
      if (!state) return "--:--";
      const mode = layout.theme.format;
      if (mode === "zoom") return state.display || "--:--";
      if (state.status === "overtime") return (layout.theme.overPrefix != null ? layout.theme.overPrefix : "-") + format(state.overtimeSeconds, mode);
      if (state.remainingSeconds == null) return state.display || "--:--";
      return format(state.remainingSeconds, mode);
    }

    function fitScale() {
      if (options.fixedScale) return options.fixedScale;
      const sw = stage.clientWidth, sh = stage.clientHeight;
      return Math.min(sw / layout.canvas.width, sh / layout.canvas.height) || 1;
    }

    function resize() {
      const scale = fitScale();
      root.style.width = layout.canvas.width + "px";
      root.style.height = layout.canvas.height + "px";
      root.style.transform = "scale(" + scale + ")";
      if (options.center !== false) {
        root.style.left = Math.max(0, (stage.clientWidth - layout.canvas.width * scale) / 2) + "px";
        root.style.top = Math.max(0, (stage.clientHeight - layout.canvas.height * scale) / 2) + "px";
      }
      return scale;
    }

    function buildItem(item) {
      const el = document.createElement("div");
      el.className = "ztc-item ztc-" + item.type;
      el.dataset.id = item.id;
      el.style.cssText = "position:absolute;box-sizing:border-box;overflow:hidden;white-space:nowrap;";
      const node = { el: el, item: item, lastText: null };
      if (TYPES[item.type].text) {
        const span = document.createElement("span");
        span.style.cssText = "display:inline-block;line-height:1;font-variant-numeric:tabular-nums;";
        el.appendChild(span);
        node.span = span;
        el.style.display = "flex";
        el.style.alignItems = "center";
      } else if (item.type === "bar") {
        const fill = document.createElement("div");
        fill.style.cssText = "height:100%;width:100%;transform-origin:0 50%;transition:transform 1s linear,background-color .6s ease;";
        el.appendChild(fill);
        node.fill = fill;
      } else if (item.type === "ring") {
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", "0 0 100 100");
        svg.style.cssText = "width:100%;height:100%;transform:rotate(-90deg);display:block;";
        const track = document.createElementNS(ns, "circle");
        const fill = document.createElementNS(ns, "circle");
        for (const c of [track, fill]) {
          c.setAttribute("cx", "50"); c.setAttribute("cy", "50"); c.setAttribute("fill", "none");
          svg.appendChild(c);
        }
        fill.setAttribute("stroke-linecap", "round");
        fill.style.transition = "stroke-dashoffset 1s linear, stroke .6s ease";
        el.appendChild(svg);
        node.track = track; node.ringFill = fill;
      } else if (item.type === "image") {
        el.style.backgroundRepeat = "no-repeat";
        el.style.backgroundPosition = "center";
      }
      return node;
    }

    function applyItemStyle(node) {
      const it = node.item, t = layout.theme, el = node.el;
      el.style.left = it.x + "px";
      el.style.top = it.y + "px";
      el.style.width = Math.max(1, it.w) + "px";
      el.style.height = Math.max(1, it.h) + "px";
      el.style.borderRadius = (it.radius || 0) + "px";
      el.style.opacity = it.opacity == null ? "" : it.opacity;
      el.style.background = it.type === "bar" ? (it.track || t.track) : rgba(it.bg, it.bgOpacity == null ? 1 : it.bgOpacity);
      el.style.fontFamily = (it.font || t.font ? '"' + (it.font || t.font) + '", ' : "") + '-apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';
      el.style.fontWeight = it.weight || (it.type === "label" ? 600 : 700);
      el.style.justifyContent = { left: "flex-start", right: "flex-end" }[it.align] || "center";
      el.style.padding = it.type === "panel" || it.type === "bar" || it.type === "ring" || it.type === "image" ? "0" : "0 " + (it.padding || 0) + "px";
      el.style.textTransform = it.uppercase || it.type === "banner" ? "uppercase" : "";
      el.style.letterSpacing = it.letterSpacing != null ? it.letterSpacing + "em" : it.type === "label" || it.type === "banner" ? "0.06em" : "";
      el.style.textShadow = it.shadow ? "0 2px 12px rgba(0,0,0,.55)" : "";
      if (it.type === "image") {
        el.style.backgroundImage = it.src ? 'url("' + it.src + '")' : "";
        el.style.backgroundSize = it.fit || "contain";
      }
      if (node.track) {
        const sw = it.thickness || 8, r = 50 - sw / 2;
        node.track.setAttribute("r", r); node.ringFill.setAttribute("r", r);
        node.track.setAttribute("stroke-width", sw); node.ringFill.setAttribute("stroke-width", sw);
        node.track.setAttribute("stroke", it.track || t.track);
        node.ringFill.setAttribute("pathLength", "100");
        node.ringFill.setAttribute("stroke-dasharray", "100");
      }
      if (node.fill) node.fill.style.borderRadius = (it.radius || 0) + "px";
      node.lastText = null; // force re-fit
    }

    /** Sizes text to fill the box height without overflowing its width. */
    function fitText(node, text) {
      if (node.lastText === text && node.lastW === node.item.w && node.lastH === node.item.h) return;
      node.span.textContent = text;
      const it = node.item;
      const maxH = it.h * (it.type === "clock" ? 0.9 : 0.82);
      const availW = Math.max(1, it.w - 2 * (it.padding || 0));
      node.span.style.fontSize = "100px";
      const width = node.span.offsetWidth || 1;
      node.span.style.fontSize = Math.max(4, Math.min(maxH, (100 * availW) / width * 0.98)) + "px";
      node.lastText = text; node.lastW = it.w; node.lastH = it.h;
    }

    function setLayout(next) {
      layout = normalize(next);
      // Rebuild nodes (cheap; layouts have a handful of items).
      for (const id in nodes) { nodes[id].el.remove(); delete nodes[id]; }
      const c = layout.canvas;
      root.style.backgroundColor = c.background || "transparent";
      root.style.backgroundImage = c.image ? 'url("' + c.image + '")' : "";
      root.style.backgroundSize = c.imageFit || "cover";
      root.style.backgroundPosition = "center";
      root.style.backgroundRepeat = "no-repeat";
      root.style.color = layout.theme.text;
      for (const item of layout.items) {
        const node = buildItem(item);
        nodes[item.id] = node;
        root.appendChild(node.el);
        applyItemStyle(node);
      }
      // Text is sized by measuring it, so measure again once web fonts arrive.
      loadGoogleFonts(fontsInLayout(layout));
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);
      resize();
      render();
      return layout;
    }

    function refit() {
      for (const id in nodes) nodes[id].lastText = null;
      render();
    }

    /** Re-applies one item's geometry/style after the editor changes it, without rebuilding. */
    function updateItem(item) {
      const node = nodes[item.id];
      if (!node || node.item.type !== item.type) return setLayout(layout);
      node.item = item;
      if (loadGoogleFonts(fontsInLayout(layout)) && document.fonts) document.fonts.ready.then(refit);
      applyItemStyle(node);
      render();
    }

    function setState(next) {
      state = next;
      render();
    }

    function render() {
      const status = state ? state.status : "offline";
      const p = fraction();
      const acc = accent(p);
      const t = layout.theme;
      const hiddenAll = !options.alwaysVisible &&
        (["offline", "zoomClosed", "notFound"].indexOf(status) >= 0 || (!t.showIdle && status === "idle"));
      root.style.visibility = hiddenAll ? "hidden" : "visible";
      root.className = root.className.replace(/\bs-\S+/g, "").trim() + " s-" + status;
      const clock = clockText();
      for (const id in nodes) {
        const node = nodes[id], it = node.item, el = node.el;
        let visible = it.visible !== false;
        if (it.type === "banner") visible = visible && (status === "timesup" || status === "overtime" || options.showAllBanners);
        if (it.showIn && it.showIn !== "always") {
          visible = visible && (it.showIn === "running" ? ["running", "paused", "idle"].indexOf(status) >= 0 : ["timesup", "overtime"].indexOf(status) >= 0);
        }
        el.style.display = visible ? (node.span ? "flex" : "block") : "none";
        if (!visible) continue;
        const stateColor = status === "timesup" || status === "overtime" ? t.over : null;
        switch (it.type) {
          case "clock":
            el.style.color = it.colorMode === "accent" ? acc : (stateColor && it.colorMode !== "fixed" ? stateColor : it.color || t.text);
            el.style.opacity = status === "paused" ? 0.55 : (it.opacity == null ? "" : it.opacity);
            fitText(node, clock);
            break;
          case "percent":
            el.style.color = it.colorMode === "accent" || !it.color ? acc : it.color;
            fitText(node, Math.round(p * 100) + "%");
            break;
          case "label":
            el.style.color = it.color || t.text;
            fitText(node, it.text || "");
            break;
          case "banner":
            el.style.color = it.color || t.over;
            fitText(node, status === "overtime" ? (it.overtimeText || "Over time") : (it.timesUpText || "Time's up"));
            break;
          case "bar":
            node.fill.style.background = it.colorMode === "fixed" && it.color ? it.color : acc;
            node.fill.style.transform = "scaleX(" + p + ")";
            break;
          case "ring":
            node.ringFill.setAttribute("stroke", it.colorMode === "fixed" && it.color ? it.color : acc);
            node.ringFill.setAttribute("stroke-dashoffset", String(100 - p * 100));
            break;
        }
      }
    }

    window.addEventListener("resize", resize);
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", refit);
    return {
      setLayout: setLayout, setState: setState, updateItem: updateItem, resize: resize,
      get layout() { return layout; }, get state() { return state; }, root: root,
    };
  }

  /** Fake timer for previews: idle → running (30 s) → time's up → overtime, looping. */
  function demoStates(total) {
    total = total || 30;
    const fmt = (n) => (n < 600 ? "0" : "") + Math.floor(n / 60) + ":" + (n % 60 < 10 ? "0" : "") + (n % 60);
    const seq = [];
    for (let i = 0; i < 2; i++) seq.push({ status: "idle", display: fmt(total), remainingSeconds: total, totalSeconds: total, percentRemaining: 1 });
    for (let r = total; r > 0; r--) seq.push({ status: "running", display: fmt(r), remainingSeconds: r, totalSeconds: total, percentRemaining: r / total });
    for (let i = 0; i < 4; i++) seq.push({ status: "timesup", display: "00:00", remainingSeconds: 0, totalSeconds: total, percentRemaining: 0 });
    for (let o = 1; o <= 8; o++) seq.push({ status: "overtime", display: "-" + fmt(o), remainingSeconds: 0, overtimeSeconds: o, totalSeconds: total, percentRemaining: 0 });
    return seq;
  }

  window.ZoomTimerCanvas = { createRenderer: createRenderer, normalize: normalize, DEFAULT_LAYOUT: DEFAULT_LAYOUT, TYPES: TYPES, demoStates: demoStates, clone: clone,
                               GOOGLE_FONTS: GOOGLE_FONTS, loadGoogleFonts: loadGoogleFonts };
})();
