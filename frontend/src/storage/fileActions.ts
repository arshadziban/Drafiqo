import { createDocument } from "../document/factory";
import { validateFileName } from "../export/exportValidation";
import { isDirty, useEditor } from "../editor/store";
import { platform } from "./platform";
import { fileBaseName, parseProject, serializeProject } from "./projectFile";
import { addRecent, removeRecent } from "./recent";

const state = () => useEditor.getState();

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Asks before throwing away unsaved work. Resolves true when it is safe to continue. */
export async function confirmDiscard(): Promise<boolean> {
  if (!isDirty(state())) return true;
  return platform.confirm(`"${state().doc.name}" has unsaved changes. Discard them?`, {
    title: "Unsaved changes",
    okLabel: "Discard",
  });
}

export async function newProject(): Promise<void> {
  if (!(await confirmDiscard())) return;
  state().loadDocument(createDocument(), null);
}

function load(contents: string, path: string | null, name: string): void {
  const parsed = parseProject(contents);
  // The file name on disk is the project's name.
  const doc = { ...parsed, name: fileBaseName(name) };
  state().loadDocument(doc, path);
  if (path) addRecent(path, doc.name);
}

export async function openProject(): Promise<void> {
  if (!(await confirmDiscard())) return;
  try {
    const file = await platform.openProject();
    if (file) load(file.contents, file.path, file.name);
  } catch (error) {
    await platform.alert(describe(error), "Could not open project");
  }
}

export async function openRecentProject(path: string): Promise<void> {
  if (!(await confirmDiscard())) return;
  try {
    load(await platform.readProject(path), path, path);
  } catch (error) {
    removeRecent(path);
    await platform.alert(describe(error), "Could not open project");
  }
}

// Saves run strictly one after another so an older write can never land on
// top of a newer one.
let queue: Promise<unknown> = Promise.resolve();

function writeCurrent(path: string): Promise<boolean> {
  const run = async () => {
    state().commit();
    // The project is named after its file.
    const name = fileBaseName(path);
    if (state().doc.name !== name) useEditor.setState({ doc: { ...state().doc, name } });
    // Capture exactly what is being written; edits made while the write is in
    // flight leave the document dirty.
    const doc = state().doc;
    useEditor.setState({ saveStatus: "saving", saveError: null });
    try {
      await platform.writeProject(path, serializeProject(doc));
    } catch (error) {
      useEditor.setState({ saveStatus: "error", saveError: describe(error) });
      return false;
    }
    useEditor.setState({ filePath: path, savedDoc: doc, saveStatus: "saved", saveError: null });
    if (platform.kind === "desktop") addRecent(path, name);
    return true;
  };
  const result = queue.then(run, run);
  queue = result;
  return result;
}

/**
 * Renames the project. If it has a file, the file is renamed with it, so the
 * name in the title bar always matches what is on disk.
 */
export function renameProject(requested: string): Promise<boolean> {
  const run = async () => {
    const name = requested.trim();
    if (name === state().doc.name) return true;
    const problem = validateFileName(name);
    if (problem) {
      await platform.alert(problem, "Could not rename project");
      return false;
    }
    const path = state().filePath;
    let renamedPath: string | null = null;
    if (path) {
      try {
        renamedPath = await platform.renameProject(path, name);
      } catch (error) {
        await platform.alert(describe(error), "Could not rename project");
        return false;
      }
      if (platform.kind === "desktop") {
        removeRecent(path);
        addRecent(renamedPath, name);
      }
    }
    // The name is not part of the editable content, so this is neither dirty nor undoable.
    useEditor.setState({ doc: { ...state().doc, name }, filePath: renamedPath });
    return true;
  };
  // Queued behind any save in flight, so a write never lands on the old name.
  const result = queue.then(run, run);
  queue = result;
  return result;
}

export async function saveProjectAs(): Promise<boolean> {
  const path = await platform.chooseSavePath(state().doc.name);
  return path ? writeCurrent(path) : false;
}

export async function saveProject(): Promise<boolean> {
  const path = state().filePath;
  return path ? writeCurrent(path) : saveProjectAs();
}
