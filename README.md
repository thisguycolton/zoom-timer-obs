# zoom-timer-obs

Show the Zoom in-meeting Timer app as a restylable overlay in OBS.

Zoom's Timer (a Zoom App) has no API, but on macOS its countdown is exposed through the
Accessibility API. **ZoomTimerBridge** is a small Mac helper that reads it four times a second
and serves it on `http://127.0.0.1:17845` so an OBS Browser Source can display it however you like.

## Requirements

- macOS 13 or later, Zoom desktop app, Swift toolchain (Xcode or Command Line Tools)
- The Timer app open in a Zoom meeting (popped out as "Zoom Apps - Timer" or popped in)
- **Accessibility permission** for whatever launches the helper: System Settings ›
  Privacy & Security › Accessibility › turn on your terminal app (or the `ZoomTimerBridge`
  binary if you run it directly). The helper prints a warning if the permission is missing.

## Build and run

```bash
swift run -c release ZoomTimerBridge
```

Options: `--port 17845` (default) and `--overlay path/to/folder` (defaults to `./overlay`).

Then open **http://127.0.0.1:17845/config.html** in your browser to pick a style (layout, colors,
warning thresholds, labels) with a live preview, and copy the URL it gives you. In OBS add a
**Browser Source** with that URL (width 800, height 400 is a good start).

## Free-form layout editor (drag & resize)

Open **http://127.0.0.1:17845/editor.html** to build the overlay on a 1920×1080 canvas (size is adjustable):

- Drag any part to move it, drag its handles to resize (hold ⇧ on a corner to keep proportions).
  Text scales to fill its box.
- Parts: clock, label, progress bar, progress ring, percent, time's-up banner, panels (background boxes)
  and images. Add as many as you like, show/hide them, reorder layers, duplicate (⌘D), delete (⌫).
- Per part: colors (or follow the green → yellow → red progress color), font, weight, alignment,
  background color/opacity, corner radius, opacity, and whether it shows always, only before zero,
  or only at time's up/overtime.
- Canvas: transparent by default, or a background color or uploaded image. Theme colors, warning
  thresholds and time format apply to everything.
- Snap to grid, arrow-key nudging (⇧ for 10 px), undo/redo (⌘Z / ⇧⌘Z). Preview with a looping demo,
  a fixed state, or the live Zoom timer.

Changes save automatically to `~/Library/Application Support/ZoomTimerBridge/layout.json`
(uploaded images go in `assets/` next to it). In OBS add a **Browser Source** with URL
**http://127.0.0.1:17845/canvas.html** and the canvas size (1920×1080 by default); it reloads the
layout live whenever you change it in the editor. `canvas.html?demo=1` shows a fake timer.

## Simple overlay options

The simpler single-widget overlay at `/` is still available.

The overlay (`overlay/index.html`) is styled with URL parameters, which `config.html` builds for you:

| Parameter | Default | Meaning |
| --- | --- | --- |
| `layout` | `bar` | `bar` (time + progress bar), `ring` (progress ring), `text` (time only) |
| `warn` / `danger` | `0.5` / `0.2` | Fraction of time left at which the color switches to warning / danger |
| `blend` | off | `1` fades smoothly between colors instead of stepping |
| `ok`, `warnColor`, `dangerColor`, `over`, `text`, `track`, `panelColor` | | Colors, hex with or without `#` |
| `size` | `96` | Clock size in px; everything scales from it |
| `font` | system | Any installed font name |
| `label` | none | Small caption above the time |
| `timesup` / `overtime` | `Time's up` / `Over time` | Text shown at zero and in overtime |
| `percent=0`, `panel=0`, `idle=0` | | Hide the percentage, the dark panel, or the timer before Start |
| `demo=1` | | Fake 30 s timer, for styling without Zoom |

For deeper changes, every color and size is a CSS variable in `overlay/overlay.css`, so you can
also override them in OBS's Browser Source **Custom CSS** box, e.g. `:root { --size: 140px; --ok: #00e5ff; }`.

## Endpoints

| Path | Description |
| --- | --- |
| `/` | Static files from `overlay/` (the OBS overlay) |
| `/state` | Current state as JSON |
| `/events` | Server-Sent Events: the state JSON on every change, a `layout` event when the layout is saved, and a `: ping` comment every 5 s |
| `/layout` | GET the saved editor layout (404 if none yet); POST a JSON layout to save it |
| `/assets` | POST an image (PNG, JPEG, GIF, WebP, SVG) as the raw body; returns `{"url": "/assets/<name>"}` |

All responses send `Access-Control-Allow-Origin: *`.

### State JSON

```json
{
  "status": "running",
  "display": "00:37",
  "remainingSeconds": 37,
  "totalSeconds": 60,
  "overtimeSeconds": null,
  "percentRemaining": 0.6167,
  "updatedAt": "2026-11-04T04:03:49.502Z"
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `status` | string | `zoomClosed`, `notFound` (Zoom open, Timer not), `idle` (setup screen), `running`, `paused`, `timesup`, `overtime` |
| `display` | string | Time as Zoom shows it, e.g. `03:00`, `00:37`, `-00:05` |
| `remainingSeconds` | number \| null | Seconds left (`0` in overtime) |
| `totalSeconds` | number \| null | Duration of the current run: the time set on the idle screen, plus any time added with +30 |
| `overtimeSeconds` | number \| null | Seconds past zero, only in `overtime` |
| `percentRemaining` | number \| null | `remainingSeconds / totalSeconds`, 0–1 |
| `updatedAt` | string | ISO 8601 time of the last read |

### Notes

- While running, Zoom shows only plain text (e.g. `00` `:` `37`), so the helper finds the clock by
  its shape rather than by element names.
- After zero Zoom shows "Time's Up!" for a few seconds, then counts up with a minus sign; that's `overtime`.
- `paused` is a best guess (digits on screen with a Start/Resume button) and hasn't been verified yet.
  Stopwatch mode isn't handled.
- If the helper starts mid-countdown, `totalSeconds` is the first remaining value it sees.
