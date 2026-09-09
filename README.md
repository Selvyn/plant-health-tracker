> **⚠️ AI-assisted project.** This app was built with the help of Claude Code (an
> AI coding assistant), including most of its code, structure, and this README.
> It has not been professionally security- or code-reviewed. It's a personal
> field tool — read through the code, test it yourself, and don't rely on it
> for anything business-critical without your own review.

# Plant Health Tracker

Offline PWA for scoring plant health (1-5) on a field grid and tracking it week
over week as a heatmap. No build step — plain HTML/CSS/JS. All data stays on
the device (IndexedDB); nothing is sent over the network.

## Run it on your phone

Installing as an app **and** getting real offline support both require the
page to be served over `https://` or from `localhost` — this is a browser
security rule (secure contexts), not something this app can work around.
Serving it over plain HTTP from a LAN IP (e.g. `http://192.168.1.5:8000`) will
run fine while your phone has a network path to that server, but the offline
service worker will silently refuse to register, so the app will break the
moment the phone is offline and the browser tab needs to reload.

**Fastest way to get real offline support (no account needed):**

1. Go to `app.netlify.com/drop` in a browser and drag this whole
   `plant-health-tracker` folder onto the page. It gives you an instant public
   `https://` URL.
2. Open that URL in Chrome on your phone once, while online, so the service
   worker installs and caches everything.
3. Tap **"Add to Home Screen"** (or ⋮ menu → *Install app*). It now opens
   full-screen like a native app and keeps working with the phone fully
   offline (e.g. Airplane Mode) — including after the browser reloads the tab.

**For quick local iteration while developing** (no offline support, see
above):

```bash
python3 -m http.server 8000
```

Then open `http://<your-computer-ip>:8000` in Chrome on your phone (same
Wi-Fi network; find your computer's IP with `ipconfig` on Windows or
`ifconfig`/`ip addr` on Mac/Linux).

**For a permanent HTTPS home** instead of Netlify Drop's temporary link, push
this folder to GitHub Pages, Netlify (with an account), or Cloudflare Pages.

**For a fully offline native app** (no server, no HTTPS requirement at all),
this can be wrapped into an installable Android APK with
[Capacitor](https://capacitorjs.com/) — bundles the app directly into the
package. That needs the Android SDK/Gradle toolchain, which is a heavier
one-time setup; ask if you want this route.

## Using the app

- **+** on the fields screen creates a new field (name + grid size). Each
  field card shows a live summary once it has data, e.g. *"Latest Sep 7: avg
  3.2/5 · 🌱 2 · 🌼 1 · 🐛 1"*.
- **Plant mode**: tap a cell to place a plant there; tap an existing plant to
  remove it (with a 4s Undo toast).
- **Score mode**: tap a plant to open the scoring sheet, which auto-centers
  the grid on that plant above the sheet so you can see exactly where you are.
  - Type a note and/or set tags first, *then* tap a score 1-5 to save
    instantly (no separate Save step).
  - **Growth stage** — 🌱 Budding / 🌼 Flowering are mutually exclusive
    (picking one clears the other; tapping the active one clears it).
  - **🐛 Infected** is independent and can be combined with either growth
    stage, or with neither. It always renders as a small corner badge on the
    grid so it never collides with the stage icon.
  - The previous week's score/tags/note are shown for reference.
  - After saving, it automatically jumps to the next plant in the direction
    shown by the **→ Next** button in the sheet header — tap that button to
    cycle the direction (right / down / left / up) for fast row-by-row
    scoring.
  - **‹ Previous** steps back through the plants you've just scored in this
    session (re-centering and restoring their saved score/tags), in case you
    want to fix or add to one. It greys out once there's nothing to go back
    to.
- The **‹ Week of … ›** control moves between weeks one at a time; tap the
  date label itself to open a date picker and jump straight to any week. The
  grid recolors as a heatmap of that week's scores (grey = planted but not
  yet scored that week).
- Pinch to zoom / drag to pan — built for grids with thousands of cells.
- **⋮ menu** on a field: export JSON (full backup) or CSV (scores + stage +
  infected + notes, for spreadsheet analysis), import JSON (replaces all
  on-device data), rename or delete the field.

## Backing up / moving to another phone

Use **⋮ → Export field data (JSON)** to download a backup, then **⋮ → Import
JSON** on the target device. Import replaces all locally stored data, so
export from every field you care about first.
