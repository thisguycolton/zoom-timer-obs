// Color picker with transparency: a swatch button that opens a popover with a saturation/brightness
// square, hue and opacity sliders, a text box (hex, rgb(), rgba(), hsl() or a color name), preset
// swatches and recently used colors.
//   const picker = ColorPicker.create({ value: "#34c759", placeholder: "theme", allowEmpty: true, onChange: (v) => ... });
//   container.appendChild(picker.element);
// Values come out as "#rrggbb" when fully opaque, otherwise "rgba(r, g, b, a)"; "" means none / default.
(function () {
  const PRESETS = ["#ffffff", "#000000", "#34c759", "#ffcc00", "#ff9500", "#ff3b30", "#2d8cff", "#af52de",
    "rgba(0, 0, 0, 0.55)", "rgba(255, 255, 255, 0.18)", "rgba(0, 0, 0, 0)"];
  const RECENT_KEY = "ztColorRecent";

  const css = `
  .cp { position: relative; display: flex; gap: 6px; align-items: center; min-width: 0; }
  .cp-chip { width: 30px; height: 28px; flex: none; border-radius: 6px; border: 1px solid var(--cp-line, #33363d); padding: 0; cursor: pointer;
    background: var(--cp-checker); position: relative; overflow: hidden; }
  .cp-chip > i, .cp-sw > i { position: absolute; inset: 0; }
  .cp-text { flex: 1; min-width: 0; width: 100%; box-sizing: border-box; background: var(--cp-bg, #121316); color: inherit;
    border: 1px solid var(--cp-line, #33363d); border-radius: 6px; padding: 5px 7px; font: 12px ui-monospace, Menlo, monospace; }
  .cp-pop { position: absolute; z-index: 1000; left: 0; top: calc(100% + 4px); width: 232px; box-sizing: border-box;
    background: var(--cp-pop, #1c1d21); border: 1px solid var(--cp-line, #33363d); border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0,0,0,.45); padding: 10px; display: none; user-select: none; }
  .cp.open .cp-pop { display: block; }
  .cp-sv { position: relative; height: 140px; border-radius: 6px; cursor: crosshair; touch-action: none;
    background-image: linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0)); }
  .cp-slider { position: relative; height: 14px; border-radius: 7px; margin-top: 10px; cursor: pointer; touch-action: none; }
  .cp-hue { background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); }
  .cp-alpha { background: var(--cp-checker); }
  .cp-alpha > i { position: absolute; inset: 0; border-radius: 7px; }
  .cp-knob { position: absolute; width: 14px; height: 14px; border-radius: 50%; border: 2px solid #fff;
    box-shadow: 0 0 0 1px rgba(0,0,0,.5), inset 0 0 0 1px rgba(0,0,0,.3); transform: translate(-50%, -50%); pointer-events: none; box-sizing: border-box; }
  .cp-slider .cp-knob { top: 50%; }
  .cp-row { display: flex; gap: 6px; align-items: center; margin-top: 10px; }
  .cp-row .cp-text { font-size: 12px; }
  .cp-alpha-num { width: 54px; flex: none; box-sizing: border-box; background: var(--cp-bg, #121316); color: inherit;
    border: 1px solid var(--cp-line, #33363d); border-radius: 6px; padding: 5px 4px; font: 12px ui-monospace, Menlo, monospace; text-align: right; }
  .cp-label { font: 10px -apple-system, "Segoe UI", sans-serif; text-transform: uppercase; letter-spacing: .06em; opacity: .55; margin: 10px 0 4px; }
  .cp-swatches { display: flex; flex-wrap: wrap; gap: 5px; }
  .cp-sw { width: 18px; height: 18px; border-radius: 4px; border: 1px solid rgba(255,255,255,.18); cursor: pointer; padding: 0;
    position: relative; overflow: hidden; background: var(--cp-checker); }
  .cp-clear { margin-top: 10px; width: 100%; background: transparent; color: inherit; border: 1px solid var(--cp-line, #33363d);
    border-radius: 6px; padding: 4px; cursor: pointer; font: 12px -apple-system, "Segoe UI", sans-serif; }
  .cp, .cp-pop { --cp-checker: repeating-conic-gradient(#808080 0 25%, #c8c8c8 0 50%) 0 0 / 10px 10px; }`;

  function injectStyle() {
    if (document.getElementById("cp-style")) return;
    const s = document.createElement("style");
    s.id = "cp-style";
    s.textContent = css;
    document.head.appendChild(s);
  }

  /** Parses any CSS color into {r, g, b, a}, or null. */
  function parse(text) {
    text = String(text || "").trim();
    if (!text) return null;
    if (/^[0-9a-f]{3,8}$/i.test(text)) text = "#" + text;
    const probe = document.createElement("span");
    probe.style.color = "rgb(1, 2, 3)";
    probe.style.color = text;
    if (probe.style.color === "rgb(1, 2, 3)" && text.replace(/\s/g, "") !== "rgb(1,2,3)") return null; // not a color
    probe.style.display = "none";
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    const m = computed.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?/);
    if (!m) return null;
    let a = m[4] == null ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]), a: Math.max(0, Math.min(1, a)) };
  }

  function format(c) {
    if (!c) return "";
    const a = Math.round(c.a * 100) / 100;
    if (a >= 1) return "#" + [c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, "0")).join("");
    return "rgba(" + c.r + ", " + c.g + ", " + c.b + ", " + a + ")";
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return { h: h, s: max ? d / max : 0, v: max };
  }

  function hsvToRgb(h, s, v) {
    const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return { r: Math.round(f(5) * 255), g: Math.round(f(3) * 255), b: Math.round(f(1) * 255) };
  }

  function recent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").filter((c) => typeof c === "string").slice(0, 8); } catch (e) { return []; }
  }
  function remember(color) {
    if (!color) return;
    try { localStorage.setItem(RECENT_KEY, JSON.stringify([color].concat(recent().filter((c) => c !== color)).slice(0, 8))); } catch (e) {}
  }

  function el(tag, cls, parent) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }

  function create(opts) {
    injectStyle();
    opts = opts || {};
    let value = opts.value || "";
    // Working color in HSV + alpha so hue survives dragging to black/white.
    let hsv = { h: 0, s: 0, v: 1 }, alpha = 1;

    const root = el("div", "cp");
    const chip = el("button", "cp-chip", root);
    chip.type = "button";
    chip.title = "Pick a color";
    const chipFill = el("i", "", chip);
    const text = el("input", "cp-text", root);
    text.placeholder = opts.placeholder || "none";
    text.spellcheck = false;

    const pop = el("div", "cp-pop", root);
    const sv = el("div", "cp-sv", pop);
    const svKnob = el("div", "cp-knob", sv);
    const hue = el("div", "cp-slider cp-hue", pop);
    const hueKnob = el("div", "cp-knob", hue);
    const alphaBar = el("div", "cp-slider cp-alpha", pop);
    const alphaFill = el("i", "", alphaBar);
    const alphaKnob = el("div", "cp-knob", alphaBar);
    const row = el("div", "cp-row", pop);
    const popText = el("input", "cp-text", row);
    popText.spellcheck = false;
    popText.setAttribute("aria-label", "Color value");
    const alphaNum = el("input", "cp-alpha-num", row);
    alphaNum.type = "number"; alphaNum.min = "0"; alphaNum.max = "100"; alphaNum.step = "1";
    alphaNum.title = "Opacity %";
    const presetLabel = el("div", "cp-label", pop);
    presetLabel.textContent = "Presets";
    const presets = el("div", "cp-swatches", pop);
    const recentLabel = el("div", "cp-label", pop);
    recentLabel.textContent = "Recent";
    const recents = el("div", "cp-swatches", pop);
    let clear;
    if (opts.allowEmpty !== false) {
      clear = el("button", "cp-clear", pop);
      clear.type = "button";
      clear.textContent = opts.placeholder ? "Use " + opts.placeholder : "None";
    }

    function current() {
      const c = hsvToRgb(hsv.h, hsv.s, hsv.v);
      c.a = alpha;
      return c;
    }

    function loadValue(v) {
      const c = parse(v) || parse(opts.fallback) || { r: 255, g: 255, b: 255, a: 1 };
      const next = rgbToHsv(c.r, c.g, c.b);
      if (next.s === 0 || next.v === 0) next.h = hsv.h; // keep hue for greys
      hsv = next; alpha = c.a;
    }

    function paint(skipText) {
      const c = current();
      const solid = "rgb(" + c.r + "," + c.g + "," + c.b + ")";
      sv.style.backgroundColor = "hsl(" + hsv.h + ", 100%, 50%)";
      svKnob.style.left = hsv.s * 100 + "%";
      svKnob.style.top = (1 - hsv.v) * 100 + "%";
      hueKnob.style.left = hsv.h / 360 * 100 + "%";
      alphaKnob.style.left = alpha * 100 + "%";
      alphaFill.style.background = "linear-gradient(to right, rgba(" + c.r + "," + c.g + "," + c.b + ",0), " + solid + ")";
      if (!skipText) popText.value = format(c);
      if (document.activeElement !== alphaNum) alphaNum.value = Math.round(alpha * 100);
    }

    function showValue() {
      chipFill.style.background = value || "transparent";
      if (document.activeElement !== text) text.value = value;
    }

    function emit(next, final) {
      value = next;
      showValue();
      if (final) remember(value);
      if (opts.onChange) opts.onChange(value);
    }

    // Live updates while dragging are throttled to one per frame.
    let frame = 0;
    function emitLive() {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; emit(format(current()), false); });
    }

    function drag(target, onMove) {
      target.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        target.setPointerCapture(e.pointerId);
        const move = (ev) => {
          const r = target.getBoundingClientRect();
          onMove(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)));
          paint();
          emitLive();
        };
        const up = () => {
          target.removeEventListener("pointermove", move);
          target.removeEventListener("pointerup", up);
          target.removeEventListener("pointercancel", up);
          remember(value);
        };
        target.addEventListener("pointermove", move);
        target.addEventListener("pointerup", up);
        target.addEventListener("pointercancel", up);
        move(e);
      });
    }
    drag(sv, (x, y) => { hsv.s = x; hsv.v = 1 - y; });
    drag(hue, (x) => { hsv.h = Math.min(359.9, x * 360); });
    drag(alphaBar, (x) => { alpha = Math.round(x * 100) / 100; });

    function swatches(container, colors) {
      container.textContent = "";
      colors.forEach((c) => {
        const b = el("button", "cp-sw", container);
        b.type = "button";
        b.title = c;
        el("i", "", b).style.background = c;
        b.addEventListener("click", () => { loadValue(c); paint(); emit(format(current()), true); renderRecents(); });
      });
    }
    function renderRecents() {
      const list = recent();
      recentLabel.style.display = recents.style.display = list.length ? "" : "none";
      swatches(recents, list);
    }
    swatches(presets, opts.presets || PRESETS);

    function typed(input, final) {
      const raw = input.value.trim();
      if (!raw && opts.allowEmpty !== false) { if (final) emit("", true); return; }
      const c = parse(raw);
      if (!c) return;
      loadValue(raw);
      paint(input === popText);
      if (final) emit(format(c), true);
    }
    popText.addEventListener("input", () => typed(popText, false));
    popText.addEventListener("change", () => typed(popText, true));
    text.addEventListener("change", () => { typed(text, true); text.value = value; });
    alphaNum.addEventListener("input", () => {
      if (alphaNum.value === "") return;
      alpha = Math.max(0, Math.min(100, Number(alphaNum.value) || 0)) / 100;
      paint();
      emitLive();
    });
    alphaNum.addEventListener("change", () => remember(value));
    [text, popText, alphaNum].forEach((i) => i.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
      if (e.key === "Enter") { e.preventDefault(); i.dispatchEvent(new Event("change")); }
      e.stopPropagation(); // keep the editor's keyboard shortcuts out of these boxes
    }));
    if (clear) clear.addEventListener("click", () => { emit("", true); close(); });

    // The picker usually sits inside a <label>; clicks on the square or sliders would otherwise be
    // forwarded to the label's first control (the swatch button) and close the popover.
    pop.addEventListener("click", (e) => { if (!e.target.closest("button, input")) e.preventDefault(); });

    function open() {
      document.querySelectorAll(".cp.open").forEach((o) => o !== root && o.classList.remove("open"));
      loadValue(value);
      paint();
      renderRecents();
      root.classList.add("open");
      // Keep the popover on screen.
      pop.style.left = "0"; pop.style.right = "auto";
      const r = pop.getBoundingClientRect();
      if (r.right > window.innerWidth - 8) { pop.style.left = "auto"; pop.style.right = "0"; }
    }
    function close() { root.classList.remove("open"); }
    chip.addEventListener("click", () => (root.classList.contains("open") ? close() : open()));
    document.addEventListener("pointerdown", (e) => { if (!root.contains(e.target)) close(); });

    showValue();
    return {
      element: root,
      get value() { return value; },
      set value(v) { value = v || ""; showValue(); },
    };
  }

  window.ColorPicker = { create, parse, format };
})();
