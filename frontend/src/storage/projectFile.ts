import { pruneAssets } from "../document/assets";
import { migrateDocument, ProjectFormatError } from "../document/migrate";
import type { DrafiqoDocument } from "../document/types";
import { validateDocument } from "../document/validate";

export const PROJECT_EXTENSION = "drafiqo";

/** Serializes a document as the contents of a `.drafiqo` file. */
export function serializeProject(doc: DrafiqoDocument, now = new Date()): string {
  return JSON.stringify({ ...pruneAssets(doc), updatedAt: now.toISOString() });
}

/**
 * Parses, migrates and validates the contents of a `.drafiqo` file. Throws a
 * ProjectFormatError describing the problem if the file cannot be trusted.
 */
export function parseProject(contents: string): DrafiqoDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch {
    throw new ProjectFormatError("This file is damaged or is not a Drafiqo project (it is not valid JSON).");
  }
  const result = validateDocument(migrateDocument(raw));
  if (!result.ok) {
    throw new ProjectFormatError(`This project file is invalid:\n${result.errors.join("\n")}`);
  }
  return result.document;
}

export function fileBaseName(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  return name.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`) ? name.slice(0, -(PROJECT_EXTENSION.length + 1)) : name;
}

export function withProjectExtension(path: string): string {
  return path.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`) ? path : `${path}.${PROJECT_EXTENSION}`;
}
