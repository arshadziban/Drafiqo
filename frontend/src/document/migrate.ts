import { FILE_FORMAT, SCHEMA_VERSION } from "./types";

type RawDocument = Record<string, unknown>;

/**
 * Migrations keyed by the schema version they upgrade *from*. Each returns a
 * document one version newer. Add an entry whenever SCHEMA_VERSION is bumped.
 */
const MIGRATIONS: Record<number, (doc: RawDocument) => RawDocument> = {};

export class ProjectFormatError extends Error {}

export function migrateDocument(raw: unknown): RawDocument {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ProjectFormatError("This file is not a Drafiqo project.");
  }
  let doc = raw as RawDocument;
  if (doc.format !== FILE_FORMAT) throw new ProjectFormatError("This file is not a Drafiqo project.");
  const version = doc.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new ProjectFormatError("This project has no valid schema version.");
  }
  if (version > SCHEMA_VERSION) {
    throw new ProjectFormatError(
      `This project was saved by a newer version of Drafiqo (schema ${version}; this build supports up to ${SCHEMA_VERSION}).`,
    );
  }
  for (let v = version; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new ProjectFormatError(`No migration is available from schema version ${v}.`);
    doc = { ...step(doc), schemaVersion: v + 1 };
  }
  return doc;
}
