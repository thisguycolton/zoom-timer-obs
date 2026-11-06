// Zoom Timer overlay: listens to the helper's /events stream and renders the state.
// Options come from URL parameters, e.g. index.html?layout=ring&warn=0.5&danger=0.2&size=120
(() => {
  const params = new URLSearchParams(location.search);
  const opt = {
    layout: params.get("layout") || "bar",          // bar | ring | text
    warn: num(params.get("warn"), 0.5),              // switch to warn color at/below this fraction left
    danger: num(params.get("danger"), 0.2),          // switch to danger color at/below this fraction left
    blend: params.get("blend") === "1",              // fade smoothly between colors instead of stepping
    showPercent: params.get("percent") !== "0",
    showIdle: params.get("idle") !== "0",            // show the set time before Start is pressed
    label: params.get("label") ?? "",
    timesUpText: params.get("timesup") ?? "Time's up",
    overtimeText: params.get("overtime") ?? "Over time",
    panel: params.get("panel") !== "0",
    demo: params.get("demo") === "1",
    source: params.get("source") || "",              // helper base URL when the page isn't served by it
  };
  // URL parameter → CSS variable. Colors may omit the "#", e.g. ok=34c759.
  const cssVars = { ok: "ok", warnColor: "warn", dangerColor: "danger", over: "over", text: "text", panelColor: "panel",
                    track: "track", font: "font", size: "size", radius: "radius", barHeight: "bar-height" };
  const root = document.documentElement.style;
  for (const [param, v] of Object.entries(cssVars)) {
    let val = params.get(param);
    if (val == null) continue;
    if (param === "font") {
      // Quote the name (names like "Exo 2" are invalid unquoted) and keep a fallback stack.
      const name = val.replace(/["\\;{}<>]/g, "").trim();
      if (!name) continue;
      // Ask the helper for the font file itself; OBS often can't find installed fonts by name.
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = opt.source.replace(/\/$/, "") + "/fontface/" + encodeURIComponent(name) + ".css";
      document.head.appendChild(link);
      val = '"' + name + '", -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';
    } else if (param === "size" || param === "radius" || param === "barHeight") {
      if (/^\d+(\.\d+)?$/.test(val)) val += param === "size" ? "px" : "em";
    } else if (/^([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(val)) val = "#" + val;
    root.setProperty("--" + v, val);
  }

  const $ = (id) => document.getElementById(id);
  const el = { timer: $("timer"), clock: $("clock"), ringClock: $("ringClock"), pct: $("pct"), bar: $("bar"),
               ring: $("ringFill"), label: $("label"), banner: $("banner") };
  const CIRC = 2 * Math.PI * 46;
  el.ring.style.strokeDasharray = CIRC;
  document.body.classList.add("layout-" + opt.layout);
  if (opt.layout !== "bar") document.body.classList.remove("layout-bar");
  if (!opt.panel) document.body.classList.add("no-panel");
  el.label.textContent = opt.label;
  if (!opt.showPercent) el.pct.style.display = "none";

  function num(v, d) { const n = parseFloat(v); return Number.isFinite(n) ? n : d; }
  const cssColor = (name) => getComputedStyle(document.documentElement).getPropertyValue("--" + name).trim();

  function accentFor(p) {
    if (!opt.blend) return p > opt.warn ? cssColor("ok") : p > opt.danger ? cssColor("warn") : cssColor("danger");
    // Smooth: ok → warn between 1 and warn, warn → danger between warn and danger.
    if (p >= opt.warn) return mix(cssColor("warn"), cssColor("ok"), (p - opt.warn) / Math.max(1e-6, 1 - opt.warn));
    if (p >= opt.danger) return mix(cssColor("danger"), cssColor("warn"), (p - opt.danger) / Math.max(1e-6, opt.warn - opt.danger));
    return cssColor("danger");
  }
  function mix(a, b, t) {
    const pa = rgb(a), pb = rgb(b);
    if (!pa || !pb) return t >= 0.5 ? b : a;
    t = Math.min(1, Math.max(0, t));
    const c = pa.map((v, i) => v + (pb[i] - v) * t);
    return `rgba(${c.slice(0, 3).map(Math.round).join(",")},${Math.round(c[3] * 1000) / 1000})`;
  }
  /** [r, g, b, a] for any CSS color. */
  function rgb(c) {
    const probe = document.createElement("span"); probe.style.color = c; document.body.appendChild(probe);
    const m = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g); probe.remove();
    return m ? m.slice(0, 3).map(Number).concat(m.length > 3 ? Number(m[3]) : 1) : null;
  }

  function render(s) {
    const visible = !["zoomClosed", "notFound", "offline"].includes(s.status) && (opt.showIdle || s.status !== "idle");
    el.timer.hidden = !visible;
    document.body.className = document.body.className.replace(/\bs-\S+/g, "").trim() + " s-" + s.status;
    if (!visible) return;

    const p = s.status === "overtime" || s.status === "timesup" ? 0 : (s.percentRemaining ?? 1);
    const text = s.display || "--:--";
    el.clock.textContent = text;
    el.ringClock.textContent = text;
    el.pct.textContent = Math.round(p * 100) + "%";
    el.bar.style.transform = `scaleX(${p})`;
    el.ring.style.strokeDashoffset = CIRC * (1 - p);
    root.setProperty("--accent", s.status === "overtime" || s.status === "timesup" ? cssColor("over") : accentFor(p));
    el.banner.textContent = s.status === "timesup" ? opt.timesUpText : s.status === "overtime" ? opt.overtimeText : "";
  }

  if (opt.demo) return runDemo();

  let offlineTimer;
  const events = new EventSource(opt.source.replace(/\/$/, "") + "/events");
  events.onmessage = (e) => { clearTimeout(offlineTimer); try { render(JSON.parse(e.data)); } catch {} };
  events.onerror = () => { clearTimeout(offlineTimer); offlineTimer = setTimeout(() => render({ status: "offline" }), 4000); };

  // Demo: a fake 30 s timer that runs into overtime, for styling without Zoom.
  function runDemo() {
    const total = 30; let t = -3;
    const fmt = (n) => String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
    const tick = () => {
      let s;
      if (t < 0) s = { status: "idle", display: fmt(total), remainingSeconds: total, totalSeconds: total, percentRemaining: 1 };
      else if (t <= total) { const r = total - t; s = { status: r === 0 ? "timesup" : "running", display: fmt(r), remainingSeconds: r, totalSeconds: total, percentRemaining: r / total }; }
      else if (t <= total + 4) s = { status: "timesup", display: "00:00", remainingSeconds: 0, totalSeconds: total, percentRemaining: 0 };
      else { const o = t - total - 4; s = { status: "overtime", display: "-" + fmt(o), remainingSeconds: 0, overtimeSeconds: o, totalSeconds: total, percentRemaining: 0 }; }
      render(s);
      t = t >= total + 14 ? -3 : t + 1;
    };
    tick(); setInterval(tick, 1000);
  }
})();
