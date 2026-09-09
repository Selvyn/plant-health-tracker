# Plant Health Tracker

Offline PWA for scoring plant health (1-5) on a field grid and tracking it week
over week as a heatmap. No build step — plain HTML/CSS/JS. All data stays on
the device (IndexedDB); nothing is sent over the network.

## Run it on your phone

1. Serve this folder over HTTP (installing as an app requires `https://` or
   `localhost` — `file://` won't let the service worker register):
   ```
   python3 -m http.server 8000
   ```
2. On your Android phone (same Wi-Fi network), open Chrome and go to
   `http://<your-computer-ip>:8000`. Find your computer's IP with `ipconfig`
   (Windows) or `ifconfig`/`ip addr` (Mac/Linux).
3. Chrome will offer **"Add to Home Screen"** (or use the ⋮ menu → *Install
   app*). Once installed it opens full-screen like a native app, and works
   offline after the first load.

For permanent use without keeping your computer's server running, push this
folder to a static host with HTTPS (e.g. GitHub Pages, Netlify, Cloudflare
Pages) and open that URL on the phone instead.

## Using the app

- **+** on the fields screen creates a new field (name + grid size).
- **Plant mode**: tap a cell to place a plant there; tap an existing plant to
  remove it (with a 4s Undo toast).
- **Score mode**: tap a plant to open the scoring sheet — pick 1-5 and
  optionally add a note for the currently selected week. The previous week's
  score/note is shown for reference.
- The **‹ Week of … ›** control moves between weeks; the grid recolors as a
  heatmap of that week's scores (grey = planted but not yet scored that week).
- Pinch to zoom / drag to pan — built for grids with thousands of cells.
- **⋮ menu** on a field: export JSON (full backup) or CSV (scores, for
  spreadsheet analysis), import JSON (replaces all on-device data), rename or
  delete the field.

## Backing up / moving to another phone

Use **⋮ → Export field data (JSON)** to download a backup, then **⋮ → Import
JSON** on the target device. Import replaces all locally stored data, so
export from every field you care about first.
