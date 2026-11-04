# Setup guide

Zoom Timer Bridge puts the timer from Zoom's built-in **Timer** app into OBS, styled however you like.
It's a small Mac menu bar app: it reads the timer from the Zoom window, and OBS shows it through a
Browser Source. It never clicks or changes anything in Zoom.

You'll need a Mac running macOS 13 (Ventura) or later, the Zoom desktop app with the Timer app added,
and OBS Studio.

---

## 1. Install

1. Download **ZoomTimerBridge-1.0.0.zip** and double-click it to unzip.
2. Drag **Zoom Timer Bridge.app** into your **Applications** folder.
3. **First launch:** the app isn't from the App Store, so macOS blocks a normal double-click the first time.
   - Right-click (or Control-click) the app › **Open** › **Open**.
   - If there's no Open button: double-click it once, close the warning, then go to
     **System Settings › Privacy & Security**, scroll down and click **Open Anyway** next to
     "Zoom Timer Bridge".

A **timer icon** appears in the menu bar at the top right of your screen. There's no Dock icon, so
click the menu bar icon whenever you need it.

## 2. Allow Accessibility access

The app reads the timer through macOS Accessibility, which you have to allow once.

1. On first launch macOS asks *"Zoom Timer Bridge would like to control this computer using accessibility
   features."* Click **Open System Settings**.
   (If you missed it, click the menu bar icon › **Grant Accessibility Permission…**.)
2. In **Privacy & Security › Accessibility**, turn on **Zoom Timer Bridge**. You may need your Mac password.
3. You don't need to restart. Within a couple of seconds the menu changes from "Needs Accessibility
   permission" to "Waiting for Zoom" or "Ready".

## 3. Open the Zoom Timer

In a meeting, open **Apps › Timer**. Popped out into its own window ("Zoom Apps - Timer") is the
tested setup; docked inside the meeting window should work too. The menu bar status shows what it sees:

| Menu says | Meaning |
| --- | --- |
| Waiting for Zoom | Zoom isn't running |
| Waiting for Zoom Timer | Zoom is open, but the Timer app isn't |
| Ready · 03:00 set | Timer is on its setup screen |
| Running · 02:31 of 03:00 | Counting down (the time also shows next to the icon) |
| Time's up / Over time · -00:12 | Reached zero / counting past zero |

## 4. Design your overlay

Click the menu bar icon › **Open Layout Editor**. Your browser opens the editor:

- **Drag** a part to move it; **drag its handles** to resize. Text grows to fill its box.
- **Add** parts from the left: clock, label, progress bar, ring, percent, time's-up banner, panels
  (background boxes) and images.
- **Click a part** to change its color, font, background, corner radius, and when it shows.
  **Click empty canvas** for overall settings: canvas size, background color or image (transparent
  by default), and the green → yellow → red warning colors.
- The **Preview** menu at the top switches between a looping demo, a fixed state like "Time's up",
  or your live Zoom timer.
- Arrow keys nudge (hold ⇧ for 10 px), ⌘D duplicates, ⌫ deletes, ⌘Z undoes.

Changes save automatically.

## 5. Add it to OBS

1. Click the menu bar icon › **Copy OBS URL**. It copies `http://127.0.0.1:17845/canvas.html`.
2. In OBS: **Sources › + › Browser** › name it "Zoom Timer" › OK.
3. Paste the URL, set **Width 1920** and **Height 1080** (or the canvas size you chose in the editor), and click OK.
   Leave "Local file" unchecked.
4. Resize or crop the source in your OBS scene like any other source.

Edits you make in the editor appear in OBS within a second. You don't need to refresh anything.

**Simpler option:** menu bar icon › **Open Simple Setup** gives a single ready-made widget (bar, ring
or text) styled with a few options, and a URL to paste into OBS the same way (800×400 is a good size).

## 6. Start at Login (optional)

Menu bar icon › **Start at Login** keeps the app running after restarts. It only works once the app
is in your Applications folder.

---

## Troubleshooting

**The overlay in OBS is blank.**
Usually that's correct: the overlay hides itself while the Zoom Timer isn't open. Otherwise check:
- Is the menu bar icon there? If not, open Zoom Timer Bridge from Applications.
- Does the menu show a time? If it says "Needs Accessibility permission", see step 2.
- Blank only before you press Start? Click empty canvas in the editor and make sure
  **Show before Start** is turned on.
- In OBS, right-click the source › **Refresh**.

**"Needs Accessibility permission" even though it's switched on.**
macOS ties the permission to the exact copy of the app. After updating or rebuilding it, select
**Zoom Timer Bridge** in **System Settings › Privacy & Security › Accessibility**, click **–** to
remove it, then click **+** and add it from Applications again (or open the app and approve the
prompt again).

**"Zoom Timer Bridge couldn't start: port 17845 is unavailable."**
Another copy is already running. Check for a second timer icon in the menu bar, or a terminal running
`swift run`. Quit it, then open the app again.

**The timer shows but the progress bar starts partway.**
If the app starts while a countdown is already running, it uses the time left at that moment as the full
length. The next timer you start shows correctly.

**Zoom shows the time but the app says "Waiting for Zoom Timer".**
Close and reopen the Timer app in Zoom (Apps › Timer). If it's docked in the meeting window, try
popping it out.

**Where are my settings?**
`~/Library/Application Support/ZoomTimerBridge/`: `layout.json` holds the editor layout, and
`assets/` holds uploaded images. Delete `layout.json` to start over (or use **Reset layout** in the editor).

---

## For developers

Build the app and zip yourself (requires Xcode or the Command Line Tools):

```bash
scripts/build-app.sh
```

That writes `dist/Zoom Timer Bridge.app` and `dist/ZoomTimerBridge-1.0.0.zip`. Add `--install` to copy
the app into /Applications too. Each build is signed ad hoc, so macOS treats it as a new app: re-grant
Accessibility after rebuilding (see Troubleshooting).
