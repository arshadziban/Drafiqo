# Drafiqo

A local-first desktop design editor for Windows and macOS, built with Tauri 2, React, TypeScript and Tailwind CSS.

## Status

Built so far: the core editor, `.drafiqo` project files, images, and export (PNG, JPG and WebP at 1×–4× or a custom size, plus SVG and PDF). Autosave and crash recovery, auto layout, components and prototyping are not built yet.

## Running

```sh
npm install
npm run tauri dev      # desktop app with hot reload
npm run tauri build    # packaged desktop app
npm run dev            # editor in a browser (save = download, open = file picker)
```

Requires Node 20+ and a Rust toolchain. See the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for platform packages.

## Tests

```sh
npm run typecheck
npm test                          # unit tests (Vitest)
npx playwright install chromium webkit
npm run test:e2e                  # end-to-end tests against the browser build
cd src-tauri && cargo test        # file-writing tests
```

## Layout

| Path | Contents |
| --- | --- |
| `frontend/src/document/` | Document model, validation, schema migrations, geometry, text layout. No React or DOM. |
| `frontend/src/editor/` | Pure editing commands, the editor store, user-level actions. |
| `frontend/src/history/` | Undo/redo. |
| `frontend/src/canvas/` | SVG rendering, pointer interactions, selection overlay, snapping. |
| `frontend/src/components/` | Toolbar, pages and layers sidebar, properties panel. |
| `frontend/src/export/` | Export: size calculation, validation, SVG rendering from the document, raster/SVG/PDF writers. |
| `frontend/src/storage/` | `.drafiqo` serialisation, save/open, recent projects, desktop/browser adapter. |
| `src-tauri/` | Desktop shell and the Rust commands that read and atomically write project files. |
| `e2e/` | Playwright tests. |
| `assets/branding/` | Source logo files. `frontend/public/drafiqo.svg` (favicon, toolbar) is a copy of `logo.svg`. |

Tool and layer-type icons live as SVG files in `assets/icons/`. After adding or changing one, run `npm run icons` to regenerate `frontend/src/icons/icons.tsx` (a test fails if they drift apart).

To regenerate the desktop app icons after changing the logo: `npx tauri icon assets/branding/logo.svg`.

## Images

An image is a rectangle with an image fill, so it moves, resizes, rotates, takes corner radius and effects, and exports like any shape. Bring one in with **File ▸ Place image…** (Ctrl+Shift+K), by dragging files onto the canvas, by pasting from the clipboard, or from a fill's colour picker (**Image**). A picture placed over a frame goes inside it.

PNG, JPG, WebP, GIF, SVG, AVIF and BMP are supported, up to 25 MB each; pictures larger than 4096 px on a side are scaled down. Pictures are embedded in the `.drafiqo` file, once each however often they are used, and ones nothing uses any more are dropped when saving. A vector PDF cannot carry pictures (it says so); use its Image mode.

## Presenting

**Present** (the play button in the top bar, or Ctrl+Alt+Enter) shows the page as a slideshow. Each top-level frame is a slide, in reading order (rows from top to bottom, left to right); a page without frames is one slide. It opens in a separate window (a pop-up window in a browser) that you can move, resize and close like any other, and press F for full screen; the editor stays as it was and keeps working; if no window can be opened it covers the editor instead. It starts from the selected frame, or from the first slide; the arrow next to the button also offers **Present from start**. Arrow keys, Space, Page Up/Down or clicks (Shift+click goes back) move between slides, Home and End jump to the ends, and Esc closes the window. The slideshow is live: edits made in the editor appear in the window a moment later, on the slide you are viewing.

## Importing from Figma

**File ▸ Import Figma file…** (or dropping a `.fig` file on the canvas) opens a Figma design saved with *File ▸ Save local copy…*. A dialog lists the file's pages and the frames on them with their layer counts; what you tick is added to the open document as new pages, in one undo step. More than 5,000 layers at once makes the canvas slow, and more than 40,000 is refused, so bring a large file in by parts.

Frames, groups, components and their instances, rectangles, ellipses, lines, text, auto layout, solid fills, image fills, strokes, shadows and layer blur come across as the same thing here. Vectors, boolean shapes, stars and polygons come across as outlines that look the same, with the stroke already part of the shape. Not carried over, and said so after the import: gradients (one colour stands in), masks, mirroring, background blur, changes made on a component instance, and several text styles within one layer. Text keeps the box it had in Figma; fonts that are neither installed nor on Google Fonts are shown in a substitute.

## Designing with Claude (MCP)

`mcp/server.mjs` is an MCP server that lets an AI assistant design in the Drafiqo window you have open: it can read the page, add and change layers (auto layout, fonts and effects included) and look at a picture of the result. Changes appear on the canvas as they are made, and each one is a single undo step.

1. Open Drafiqo (`npm run tauri dev`).
2. Connect the assistant:
   - **Claude Code**: start it in this folder. The `drafiqo` server is declared in `.mcp.json`; approve it when asked.
   - **Claude Desktop**: add this to `claude_desktop_config.json`, with the path to your checkout, and restart it.

     ```json
     { "mcpServers": { "drafiqo": { "command": "node", "args": ["/path/to/Drafiqo/mcp/server.mjs"] } } }
     ```
3. Drafiqo shows "Claude connected" within a few seconds. Then ask, for example, "design a login screen for a phone in Drafiqo".

The server listens on `127.0.0.1:4725` only (set `DRAFIQO_MCP_PORT` to change it) and accepts no one but the Drafiqo app; the editor calls in to it. One assistant session can hold the port at a time.

## Project files

A `.drafiqo` file is JSON holding the full editable document: pages, the layer tree, and every object's geometry, style and text. It carries a `schemaVersion`; older versions are upgraded through `document/migrate.ts`, and files from a newer version are refused rather than misread.
