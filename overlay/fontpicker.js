// Searchable font dropdown that previews each font in itself.
// Font names come from the helper's /fonts (the fonts installed on this computer), falling back to
// the browser's Local Font Access API, then to a short list of common fonts.
//   const picker = FontPicker.create({ value: "Avenir Next", placeholder: "Default", onChange: (name) => ... });
//   container.appendChild(picker.element);
(function () {
  const COMMON = ["Arial", "Arial Black", "Avenir Next", "Bebas Neue", "Courier New", "Futura", "Georgia", "Gill Sans",
    "Helvetica Neue", "Impact", "Inter", "Menlo", "Montserrat", "Roboto", "Segoe UI", "SF Mono", "SF Pro Display",
    "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana"];

  let fontsPromise;
  function loadFonts() {
    if (!fontsPromise) {
      fontsPromise = fetch("/fonts", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no /fonts"))))
        .then((list) => (Array.isArray(list) && list.length ? list : Promise.reject(new Error("empty"))))
        .catch(() => (window.queryLocalFonts
          ? window.queryLocalFonts().then((fonts) => [...new Set(fonts.map((f) => f.family))])
          : Promise.reject(new Error("no local fonts"))))
        .catch(() => COMMON)
        .then((list) => [...new Set(list.map(String).filter((n) => n && !n.startsWith(".")))]
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));
    }
    return fontsPromise;
  }

  const css = `
  .fp { position: relative; }
  .fp-button { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 6px; text-align: left;
    background: var(--fp-bg, #121316); color: inherit; border: 1px solid var(--fp-line, #33363d); border-radius: 6px;
    padding: 6px 8px; cursor: pointer; font-size: 14px; min-height: 32px; }
  .fp-button .fp-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fp-button .fp-muted { opacity: .55; }
  .fp-button::after { content: ""; border: 4px solid transparent; border-top-color: currentColor; margin-top: 4px; opacity: .7; flex: none; }
  .fp-pop { position: absolute; z-index: 1000; left: 0; right: 0; top: calc(100% + 4px); min-width: 220px;
    background: var(--fp-pop, #1c1d21); border: 1px solid var(--fp-line, #33363d); border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0,0,0,.45); padding: 6px; display: none; }
  .fp.open .fp-pop { display: block; }
  .fp-search { width: 100%; box-sizing: border-box; background: var(--fp-bg, #121316); color: inherit;
    border: 1px solid var(--fp-line, #33363d); border-radius: 6px; padding: 6px 8px; font: 13px -apple-system, "Segoe UI", sans-serif; margin-bottom: 6px; }
  .fp-list { max-height: 260px; overflow-y: auto; }
  .fp-item { padding: 6px 8px; border-radius: 5px; cursor: pointer; font-size: 17px; line-height: 1.25;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fp-item small { font: 11px -apple-system, "Segoe UI", sans-serif; opacity: .55; margin-left: 6px; }
  .fp-item.active, .fp-item:hover { background: var(--fp-hi, #2d8cff); color: #fff; }
  .fp-item.current { font-weight: 700; }
  .fp-empty { padding: 8px; opacity: .6; font: 12px -apple-system, "Segoe UI", sans-serif; }`;

  function injectStyle() {
    if (document.getElementById("fp-style")) return;
    const s = document.createElement("style");
    s.id = "fp-style";
    s.textContent = css;
    document.head.appendChild(s);
  }

  const quote = (name) => '"' + name.replace(/["\\]/g, "") + '"';

  function create(opts) {
    injectStyle();
    const placeholder = opts.placeholder || "Default";
    let value = opts.value || "";

    const root = document.createElement("div");
    root.className = "fp";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "fp-button";
    const label = document.createElement("span");
    label.className = "fp-name";
    button.appendChild(label);
    const pop = document.createElement("div");
    pop.className = "fp-pop";
    const search = document.createElement("input");
    search.className = "fp-search";
    search.placeholder = "Search or type a font name";
    search.setAttribute("aria-label", "Search fonts");
    const list = document.createElement("div");
    list.className = "fp-list";
    list.setAttribute("role", "listbox");
    pop.append(search, list);
    root.append(button, pop);

    let fonts = [];
    let rows = [];
    let active = 0;

    function showValue() {
      label.textContent = value || placeholder;
      label.classList.toggle("fp-muted", !value);
      label.style.fontFamily = value ? quote(value) + ", sans-serif" : "";
    }

    function choose(name) {
      value = name || "";
      showValue();
      close();
      if (opts.onChange) opts.onChange(value);
    }

    function render() {
      const q = search.value.trim();
      const ql = q.toLowerCase();
      const matches = ql ? fonts.filter((f) => f.toLowerCase().includes(ql)) : fonts;
      const entries = [];
      if (!ql) entries.push({ name: "", text: placeholder });
      if (q && !fonts.some((f) => f.toLowerCase() === ql)) entries.push({ name: q, text: q, note: "use this name" });
      matches.slice(0, 400).forEach((f) => entries.push({ name: f, text: f }));
      list.textContent = "";
      rows = entries.map((e, i) => {
        const row = document.createElement("div");
        row.className = "fp-item" + (e.name === value ? " current" : "");
        row.setAttribute("role", "option");
        row.textContent = e.text;
        if (e.name) row.style.fontFamily = quote(e.name) + ", sans-serif";
        if (e.note) { const s = document.createElement("small"); s.textContent = e.note; row.appendChild(s); }
        row.addEventListener("mousedown", (ev) => { ev.preventDefault(); choose(e.name); });
        row.addEventListener("mousemove", () => setActive(i));
        list.appendChild(row);
        return { row, name: e.name };
      });
      if (!rows.length) {
        const empty = document.createElement("div");
        empty.className = "fp-empty";
        empty.textContent = "No matching fonts";
        list.appendChild(empty);
      }
      const current = rows.findIndex((r) => r.name === value);
      setActive(ql ? 0 : Math.max(0, current), !ql);
    }

    function setActive(i, scroll) {
      if (!rows.length) return;
      active = Math.max(0, Math.min(rows.length - 1, i));
      rows.forEach((r, j) => r.row.classList.toggle("active", j === active));
      if (scroll !== false) rows[active].row.scrollIntoView({ block: "nearest" });
    }

    function open() {
      root.classList.add("open");
      search.value = "";
      list.innerHTML = '<div class="fp-empty">Loading fonts…</div>';
      loadFonts().then((f) => { fonts = f; if (root.classList.contains("open")) render(); });
      search.focus();
    }
    function close() { root.classList.remove("open"); }

    button.addEventListener("click", () => (root.classList.contains("open") ? close() : open()));
    search.addEventListener("input", render);
    search.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
      else if (e.key === "Enter") { e.preventDefault(); if (rows[active]) choose(rows[active].name); }
      else if (e.key === "Escape") { e.preventDefault(); close(); button.focus(); }
      e.stopPropagation(); // keep the editor's keyboard shortcuts (delete, arrows) out of the search box
    });
    document.addEventListener("mousedown", (e) => { if (!root.contains(e.target)) close(); });

    showValue();
    return {
      element: root,
      get value() { return value; },
      set value(v) { value = v || ""; showValue(); },
    };
  }

  window.FontPicker = { create, loadFonts };
})();
