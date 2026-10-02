# SPROCKET // Precision Full-Page Screenshot

<p align="left">
  <img src="icons/icon-128.png" width="96" height="96" alt="Sprocket Logo" />
</p>

> **Tactile, mechanical-precision full-page and viewport screenshot extension for Brave & Chrome.**  
> Zero AI gimmicks. Zero cloud telemetry. Zero bloated frameworks. Pure optical craft.

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-10b981?style=flat-square&labelColor=16181f)](manifest.json)
[![Platform](https://img.shields.io/badge/Browser-Brave%20%7C%20Chrome-ff6b35?style=flat-square&labelColor=16181f)](HOW_TO_INSTALL.md)
[![Tests](https://img.shields.io/badge/Tests-15%20Passing-10b981?style=flat-square&labelColor=16181f)](tests/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square&labelColor=16181f)](LICENSE)
[![Design](https://img.shields.io/badge/Aesthetic-Tactile%20Darkroom-f59e0b?style=flat-square&labelColor=16181f)](#design-ethos)

---

## The Philosophy

Most modern screenshot extensions have degraded into generic corporate bloat: glowing purple AI gradients, star/sparkle icons, slow cloud logins, and noisy marketing copy.

**Sprocket is built differently.** Inspired by vintage mechanical rangefinders, SLR focal-plane shutters, and darkroom drafting tables, Sprocket treats web capture as an exact craft:

- **100% Client-Side & Offline**: Your screenshots never leave your browser memory.
- **Pixel-Accurate Vertical Stitching**: Accurately computes remaining viewport fractions so not a single pixel row is duplicated or lost at the bottom.
- **Smart Sticky Header De-duplication**: Catalogs elements with `position: fixed` or `position: sticky` and temporarily suppresses them on slices after the initial frame, preventing sticky navbars from being stamped 10 times across your image.
- **Retina & HiDPI Native**: Scales every canvas operation to `window.devicePixelRatio` for razor-sharp rendering on 4K, 5K, and Retina displays.
- **Mechanical Shutter Synthesizer**: Features a Web Audio focal-plane shutter acoustic feedback click (synthesized offline, zero audio files required, toggleable).

---

## Features

### 1. Three Precision Exposure Modes
- **Full Page Exposure (`Alt + Shift + F`)**: Automatically scrolls through the entire document top-to-bottom, hides scrollbars, suppresses duplicate sticky headers, and stitches slices into a single continuous high-resolution image.
- **Visible Viewport (`Alt + Shift + V`)**: Instant single-frame capture of whatever is currently on screen.
- **Selected Region (`Alt + Shift + A`)**: Injects an interactive crosshair viewfinder overlay directly onto the webpage with live pixel dimensions (`W × H`). Drag, release, and capture.

### 2. Real-Time Viewport Telemetry
The popup interface calculates and displays real-time page telemetry before you capture:
- Document canvas size in pixels (`W × H`)
- Frame slice count
- Viewport size and Device Pixel Ratio (`DPR`)
- Active domain and page title

### 3. Darkroom Studio & Annotation Suite
Immediately after capture, Sprocket opens the **Darkroom Studio**:
- **Lossless Clipboard Copy**: One-click copy (`Ctrl + C`) creates a raw PNG blob and writes it directly to the system clipboard, ready to paste straight into Slack, Discord, Telegram, Figma, or Notion.
- **Save PNG / Save JPG**: Download with clean, Unix-safe filenames:  
  `sprocket_full_github-com_Adams-404-sprocket_20261002_131045.png`
- **Annotation Tools**:
  - **Redact Tool (`X`)**: Solid blackout tool to censor passwords, tokens, API keys, and sensitive data before sharing.
  - **Rectangle Frame (`R`)**: Box important sections.
  - **Pointer Arrow (`A`)**: Direct attention with crisp arrowheads.
  - **Markup Pen (`P`)**: Smooth freehand drafting.
  - **Text Tool (`T`)**: Insert technical callout notes.
  - **Color Palette**: Safety Orange (`#ff6b35`), Warning Amber (`#f59e0b`), Signal White (`#ffffff`), Calibration Cyan (`#06b6d4`), and Deep Black (`#000000`).
  - **Multi-Level Undo (`Ctrl + Z`)**: Reversible markup history.
  - **Zoom & Pan Engine**: Smooth viewport scaling from 10% to 300%, plus `100% (1:1)` and `FIT` modes.

---

## Project Structure

```text
sprocket/
├── manifest.json              # Manifest V3 extension configuration
├── package.json               # Node test scripts and metadata
├── HOW_TO_INSTALL.md          # Step-by-step loading guide for Brave & Chrome
├── icons/                     # Vector-precise mechanical aperture PNG icons
│   ├── icon-16.png
│   ├── icon-32.png
│   ├── icon-48.png
│   └── icon-128.png
├── src/
│   ├── background/
│   │   └── service-worker.js  # Orchestrates captures, hotkeys, and storage
│   ├── content/
│   │   ├── content.js         # Telemetry, sticky header suppressor, scroll driver
│   │   └── selector.js        # Interactive drag-to-crop crosshair overlay
│   ├── popup/
│   │   ├── popup.html         # Tactile hardware popup interface
│   │   ├── popup.css          # Darkroom matte styling
│   │   └── popup.js           # Telemetry updater and trigger controller
│   ├── viewer/
│   │   ├── viewer.html        # Darkroom studio workspace
│   │   ├── viewer.css         # Full-screen drafting table layout
│   │   └── viewer.js          # Canvas stitcher, annotations, and clipboard exporter
│   └── utils/
│       ├── audio.js           # Web Audio API mechanical shutter synthesizer
│       ├── format.js          # Filename sanitization, telemetry & byte formatting
│       └── stitch.js          # Mathematical slice geometry & remainder logic
├── tests/
│   ├── format.test.js         # Tests for filename sanitization and byte logic
│   ├── stitch.test.js         # Tests for slice math, remainders, and DPR
│   └── edge-cases.test.js     # Tests for 15,000px ultra-tall pages and edge URLs
└── scripts/
    ├── generate-icons.js      # Pure Node.js script generating PNG icon assets
    └── pack.js                # Extension verification and zip bundler
```

---

## Installation (Brave & Chrome)

Read the full [HOW_TO_INSTALL.md](HOW_TO_INSTALL.md) for detailed screenshots and troubleshooting.

1. Open Brave and navigate to `brave://extensions` (or `chrome://extensions`).
2. Toggle **Developer mode** in the top-right corner to **ON**.
3. Click the **Load unpacked** button in the top-left corner.
4. Select the directory:
   ```text
   /home/adam/Projects/sprocket
   ```
5. Pin the Sprocket icon to your toolbar from the extension puzzle menu.

---

## Keyboard Shortcuts

| Shortcut (Linux / Windows) | Shortcut (macOS) | Action |
|:---|:---|:---|
| `Alt + Shift + S` | `Command + Shift + S` | Open Sprocket Menu |
| `Alt + Shift + F` | `Command + Shift + F` | Full Page Capture |
| `Alt + Shift + V` | `Command + Shift + V` | Visible Viewport Capture |
| `Alt + Shift + A` | `Command + Shift + A` | Custom Region Selector |

---

## Development & Verification

Sprocket uses native Node.js tooling with **zero runtime dependencies**.

```bash
# Run the unit test suite (15 tests)
npm test

# Regenerate pixel-perfect mechanical icons
npm run generate-icons

# Verify extension integrity and build zip bundle
npm run pack
```

---

## Design Ethos

```
+-------------------------------------------------------------+
|  SPROCKET MK-I // TACTILE SPECIFICATION                     |
|                                                             |
|  * Surface:    Deep Carbon Matte (#0e1014 / #15181f)        |
|  * Accent:     Safety Orange (#ff6b35) / Amber (#f59e0b)    |
|  * Typography: Clean Monospaced Telemetry (SF Mono / Menlo) |
|  * Audio:      Focal-Plane Shutter Synthesizer (Web Audio)  |
|  * AI Badges:  None. Zero AI copy. Pure utility.            |
+-------------------------------------------------------------+
```

---

## License

MIT © [Adams-404](https://github.com/Adams-404)
