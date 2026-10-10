import { FILE_FORMAT, SCHEMA_VERSION } from "./types";

type RawDocument = Record<string, unknown>;

/**
 * Migrations keyed by the schema version they upgrade *from*. Each returns a
 * document one version newer. Add an entry whenever SCHEMA_VERSION is bumped.
 */
const MIGRATIONS: Record<number, (doc: RawDocument) => RawDocument> = {
  // v4: corners have a radius each; every v3 frame and rectangle had one radius for all four.
  3: (doc) => {
    const pages = Array.isArray(doc.pages) ? doc.pages : [];
    return {
      ...doc,
      pages: pages.map((page: unknown) => {
        if (typeof page !== "object" || page === null) return page;
        const nodes = (page as { nodes?: unknown }).nodes;
        if (typeof nodes !== "object" || nodes === null) return page;
        const upgraded = Object.fromEntries(
          Object.entries(nodes).map(([id, node]) => {
            if (typeof node !== "object" || node === null || !("cornerRadius" in node)) return [id, node];
            const { cornerRadius, ...rest } = node as { cornerRadius: unknown };
            const r = typeof cornerRadius === "number" ? cornerRadius : 0;
            return [id, { ...rest, cornerRadii: [r, r, r, r] }];
          }),
        );
        return { ...(page as object), nodes: upgraded };
      }),
    };
  },
  // v3: documents can carry images; every v2 document has none.
  2: (doc) => ({ ...doc, assets: {} }),
  // v2: shadows gained `spread`; every v1 effect is a drop shadow, which had none.
  1: (doc) => {
    const pages = Array.isArray(doc.pages) ? doc.pages : [];
    return {
      ...doc,
      pages: pages.map((page: unknown) => {
        if (typeof page !== "object" || page === null) return page;
        const nodes = (page as { nodes?: unknown }).nodes;
        if (typeof nodes !== "object" || nodes === null) return page;
        const upgraded = Object.fromEntries(
          Object.entries(nodes).map(([id, node]) => {
            const effects = (node as { effects?: unknown }).effects;
            if (!Array.isArray(effects)) return [id, node];
            return [id, { ...(node as object), effects: effects.map((e) => (typeof e === "object" && e !== null && !("spread" in e) ? { ...e, spread: 0 } : e)) }];
          }),
        );
        return { ...(page as object), nodes: upgraded };
      }),
    };
  },
};

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
