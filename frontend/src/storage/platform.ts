// Everything that touches the host system goes through this adapter. The
// desktop build uses native dialogs and Rust file commands; in a plain browser
// (development and end-to-end tests) it falls back to downloads and file inputs.

import { PROJECT_EXTENSION, withProjectExtension } from "./projectFile";

export interface OpenedFile {
  /** Absolute path on desktop; null when the host cannot reopen the file by path. */
  path: string | null;
  name: string;
  contents: string;
}

export type ExportWriteResult = { status: "written" | "exists"; location: string };

export interface StoragePlatform {
  kind: "desktop" | "browser";
  /** Lets the user pick a project and returns its contents, or null if cancelled. */
  openProject(): Promise<OpenedFile | null>;
  /** Reads a project from a known path (recent projects). */
  readProject(path: string): Promise<string>;
  /** Asks where to save. Returns the destination, or null if cancelled. */
  chooseSavePath(suggestedName: string): Promise<string | null>;
  /** Resolves only once the contents are safely written. */
  writeProject(path: string, contents: string): Promise<void>;
  /** Renames the project file in its folder and returns its new location. */
  renameProject(path: string, name: string): Promise<string>;
  /** Whether exports go to a folder the user picks (desktop) or to the browser's downloads. */
  canChooseFolder: boolean;
  chooseFolder(startIn: string | null): Promise<string | null>;
  /**
   * Saves an exported file. Resolves "exists" without writing when the file is
   * already there and `overwrite` is false; resolves "written" only once the
   * data is on disk.
   */
  writeExport(file: { folder: string | null; name: string; bytes: Uint8Array; mime: string; overwrite: boolean }): Promise<ExportWriteResult>;
  confirm(message: string, options: { title: string; okLabel: string }): Promise<boolean>;
  alert(message: string, title: string): Promise<void>;
  setTitle(title: string): void;
  /** Window frame controls; the desktop window has no native title bar. No-ops in a browser. */
  minimizeWindow(): void;
  toggleMaximizeWindow(): void;
  closeWindow(): void;
  /** Calls `handler` before the window closes; return false to keep it open. */
  onCloseRequested(handler: () => Promise<boolean>): void;
}

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function desktopPlatform(): StoragePlatform {
  const core = () => import("@tauri-apps/api/core");
  const dialog = () => import("@tauri-apps/plugin-dialog");
  const filters = [{ name: "Drafiqo project", extensions: [PROJECT_EXTENSION] }];
  return {
    kind: "desktop",
    async openProject() {
      const { open } = await dialog();
      const path = await open({ multiple: false, directory: false, filters });
      if (typeof path !== "string") return null;
      return { path, name: path, contents: await this.readProject(path) };
    },
    async readProject(path) {
      const { invoke } = await core();
      return invoke<string>("load_project_file", { path });
    },
    async chooseSavePath(suggestedName) {
      const { save } = await dialog();
      const path = await save({ defaultPath: withProjectExtension(suggestedName), filters });
      return path ? withProjectExtension(path) : null;
    },
    async writeProject(path, contents) {
      const { invoke } = await core();
      await invoke("save_project_file", { path, contents });
    },
    async renameProject(path, name) {
      const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
      const to = `${path.slice(0, cut + 1)}${withProjectExtension(name)}`;
      const { invoke } = await core();
      try {
        await invoke("rename_project_file", { from: path, to });
      } catch (error) {
        throw new Error(typeof error === "string" ? error : "The project could not be renamed.");
      }
      return to;
    },
    canChooseFolder: true,
    async chooseFolder(startIn) {
      const { open } = await dialog();
      const folder = await open({ directory: true, multiple: false, defaultPath: startIn ?? undefined, title: "Choose export folder" });
      return typeof folder === "string" ? folder : null;
    },
    async writeExport({ folder, name, bytes, overwrite }) {
      if (!folder) throw new Error("Choose a folder to export to.");
      const separator = folder.includes("\\") && !folder.includes("/") ? "\\" : "/";
      const location = folder.endsWith(separator) ? `${folder}${name}` : `${folder}${separator}${name}`;
      const { invoke } = await core();
      try {
        await invoke("write_export_file", bytes, {
          headers: { "x-export-path": encodeURIComponent(location), "x-export-overwrite": overwrite ? "1" : "0" },
        });
      } catch (error) {
        if (error === "EXISTS") return { status: "exists", location };
        throw new Error(typeof error === "string" ? error : "The file could not be written.");
      }
      return { status: "written", location };
    },
    async confirm(message, options) {
      const { confirm } = await dialog();
      return confirm(message, { title: options.title, kind: "warning", okLabel: options.okLabel, cancelLabel: "Cancel" });
    },
    async alert(message, title) {
      const { message: show } = await dialog();
      await show(message, { title, kind: "error" });
    },
    setTitle(title) {
      void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title));
    },
    minimizeWindow() {
      void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().minimize());
    },
    toggleMaximizeWindow() {
      void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().toggleMaximize());
    },
    closeWindow() {
      void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().close());
    },
    onCloseRequested(handler) {
      void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
        getCurrentWindow().onCloseRequested(async (event) => {
          if (!(await handler())) event.preventDefault();
        }),
      );
    },
  };
}

function browserPlatform(): StoragePlatform {
  return {
    kind: "browser",
    openProject() {
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = `.${PROJECT_EXTENSION}`;
        input.addEventListener("cancel", () => resolve(null));
        input.addEventListener("change", async () => {
          const file = input.files?.[0];
          resolve(file ? { path: null, name: file.name, contents: await file.text() } : null);
        });
        input.click();
      });
    },
    async readProject() {
      throw new Error("Reopening a project by path is only available in the desktop app.");
    },
    async chooseSavePath(suggestedName) {
      return withProjectExtension(suggestedName);
    },
    async writeProject(path, contents) {
      const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = path;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    async renameProject(_path, name) {
      // There is no file to rename in a browser; the next save downloads under the new name.
      return withProjectExtension(name);
    },
    canChooseFolder: false,
    async chooseFolder() {
      return null;
    },
    async writeExport({ name, bytes, mime }) {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { status: "written", location: `Downloads/${name}` };
    },
    async confirm(message) {
      return window.confirm(message);
    },
    async alert(message) {
      window.alert(message);
    },
    setTitle(title) {
      document.title = title;
    },
    minimizeWindow() {},
    toggleMaximizeWindow() {},
    closeWindow() {},
    onCloseRequested() {
      window.addEventListener("beforeunload", (event) => {
        // The browser shows its own generic prompt; the handler result cannot be awaited here.
        if (window.__drafiqoDirty?.()) event.preventDefault();
      });
    },
  };
}

declare global {
  interface Window {
    __drafiqoDirty?: () => boolean;
  }
}

export const platform: StoragePlatform = isTauri() ? desktopPlatform() : browserPlatform();
