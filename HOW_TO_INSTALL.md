# How to Install & Load Sprocket in Brave and Chrome

This guide provides step-by-step instructions to load **Sprocket** as an unpacked Manifest V3 extension in **Brave Browser** (and Google Chrome).

---

## Quick Overview

- **Location on disk**: `/home/adam/Projects/sprocket`
- **Manifest version**: Manifest V3
- **Primary Browser**: Brave Browser (Chromium engine)

---

## Step 1: Open the Extensions Page

1. Open **Brave**.
2. In the URL address bar, type:
   ```text
   brave://extensions
   ```
   *(If you are using Google Chrome, type `chrome://extensions` instead).*
3. Press **Enter**.

---

## Step 2: Enable "Developer Mode"

In the top-right corner of the Extensions page, you will see a toggle switch labeled **Developer mode**.

1. Toggle the switch to **ON** (it turns orange/blue depending on your theme).
2. Once enabled, three new buttons will appear in the top-left toolbar:
   - **Load unpacked**
   - **Pack extension**
   - **Update**

```
+-----------------------------------------------------------------------------------+
|  Extensions                                                 [Developer mode: ON]  |
|                                                                                   |
|  [ Load unpacked ]  [ Pack extension ]  [ Update ]                                |
+-----------------------------------------------------------------------------------+
```

---

## Step 3: Load the Sprocket Directory

1. Click the **Load unpacked** button in the top left.
2. A file selection dialog will appear.
3. Navigate to:
   ```text
   /home/adam/Projects/sprocket
   ```
4. Select the `sprocket` folder (do not select a subfolder inside it) and click **Select** or **Open**.
5. Sprocket is now loaded! You will see the **Sprocket — Precision Full-Page Screenshot** card appear with its custom mechanical aperture icon and `v1.0.0`.

---

## Step 4: Pin Sprocket to Your Browser Toolbar

For instant 1-click access:

1. Click the **Extensions menu icon** (the puzzle piece / jigsaw icon) on the top-right toolbar next to the address bar.
2. Find **Sprocket — Precision Full-Page Screenshot** in the list.
3. Click the **Pin** icon next to it.
4. The Sprocket mechanical icon will now sit directly on your toolbar.

---

## Step 5: Take Your First Full-Page Screenshot

1. Open any scrollable website (for example, [github.com](https://github.com) or [wikipedia.org](https://wikipedia.org)).
2. Click the **Sprocket** icon on your toolbar.
3. The popup opens with real-time telemetry:
   - **SOURCE**: Hostname of active page
   - **CANVAS SIZE**: Total document width × height
   - **FRAMES**: Number of vertical slices needed
   - **DPR**: Device pixel ratio (e.g. `2.0x` for high-DPI displays)
4. Click **FULL PAGE EXPOSURE** (or press `Alt + Shift + F`).
5. Sprocket will:
   - Freeze scrollbars to prevent them from appearing in the image.
   - Catalog sticky/fixed headers and smoothly hide them on subsequent slices so they don't repeat down the page.
   - Advance down the page frame by frame.
   - Stitch all slices into a continuous high-resolution canvas.
6. The **Sprocket Darkroom Studio** will open in a new tab:
   - **Copy to Clipboard**: Click `COPY TO CLIPBOARD` (or press `Ctrl+C`) to copy a lossless PNG directly to your system clipboard.
   - **Save PNG**: Click `SAVE PNG` (or press `Ctrl+S`) to download with a clean, timestamped filename.
   - **Save JPG**: Click `JPG` for a compact compressed version.
   - **Markup & Redaction**: Use the tool palette on the left to draw rectangles, arrows, notes, or use the **Redact tool** (`X`) to black out passwords or private information before sharing.

---

## Default Keyboard Shortcuts

| Shortcut (Linux / Windows) | Shortcut (macOS) | Action |
|:---|:---|:---|
| `Alt + Shift + S` | `Command + Shift + S` | Open Sprocket Popup Menu |
| `Alt + Shift + F` | `Command + Shift + F` | Trigger Full Page Screenshot |
| `Alt + Shift + V` | `Command + Shift + V` | Trigger Visible Viewport Screenshot |
| `Alt + Shift + A` | `Command + Shift + A` | Trigger Interactive Region Selector |

> **To customize keyboard shortcuts**: Navigate to `brave://extensions/shortcuts` in Brave anytime to assign your own custom hotkeys.

---

## Optional: Enable Access to Local File URLs

If you ever want to take full-page screenshots of local HTML files or local preview builds (`file:///...`):

1. Go to `brave://extensions`.
2. Find the Sprocket card and click **Details**.
3. Scroll down and toggle **Allow access to file URLs** to **ON**.

---

## Updating After Code Edits

Because Sprocket is loaded unpacked in developer mode, whenever you make a code edit:

1. Go to `brave://extensions`.
2. Click the circular **Reload** icon on the Sprocket extension card.
3. Your updates take effect immediately without restarting the browser!
