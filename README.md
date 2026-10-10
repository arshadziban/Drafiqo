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

## Project files

A `.drafiqo` file is JSON holding the full editable document: pages, the layer tree, and every object's geometry, style and text. It carries a `schemaVersion`; older versions are upgraded through `document/migrate.ts`, and files from a newer version are refused rather than misread.
