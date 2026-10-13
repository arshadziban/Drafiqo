// Reads a Figma .fig file into plain objects. The file is a zip holding the
// pictures and `canvas.fig`; that in turn is two compressed chunks: a Kiwi
// schema describing Figma's node format, and one message written with it. The
// schema travels with the file, so the reader follows whatever fields the
// file's own version of Figma knew.

import { inflateSync, unzipSync } from "fflate";
import { decompress as unzstd } from "fzstd";
import { ByteBuffer, decodeBinarySchema, type Schema } from "kiwi-schema";

export interface FigGuid {
  sessionID: number;
  localID: number;
}

/** One layer as Figma stores it. Only the fields the importer reads are spelled out. */
export interface FigNode {
  guid: FigGuid;
  phase?: string;
  parentIndex?: { guid: FigGuid; position: string };
  type: string;
  name?: string;
  [field: string]: unknown;
}

export interface FigFile {
  nodes: Map<string, FigNode>;
  /** Children of each node, back to front. */
  children: Map<string, FigNode[]>;
  /** The pages a user sees (Figma's internal page is left out). */
  pages: FigNode[];
  blobs: Uint8Array[];
  /** Pictures by their hash, as raw file bytes. */
  images: Map<string, Uint8Array>;
}

export class FigFileError extends Error {}

export const figKey = (guid: FigGuid): string => `${guid.sessionID}:${guid.localID}`;

const MAGIC = "fig-kiwi";
const ascii = (bytes: Uint8Array) => String.fromCharCode(...bytes);

/**
 * Decodes one Kiwi message by walking the schema. (The library's own decoder
 * builds JavaScript at run time, which the app's content security policy forbids.)
 */
function decodeWith(schema: Schema, bytes: Uint8Array, root: string): unknown {
  const definitions = new Map(schema.definitions.map((definition) => [definition.name, definition]));
  const buffer = new ByteBuffer(bytes);

  const value = (type: string): unknown => {
    switch (type) {
      case "bool":
        return !!buffer.readByte();
      case "byte":
        return buffer.readByte();
      case "int":
        return buffer.readVarInt();
      case "uint":
        return buffer.readVarUint();
      case "float":
        return buffer.readVarFloat();
      case "string":
        return buffer.readString();
      case "int64":
        return buffer.readVarInt64();
      case "uint64":
        return buffer.readVarUint64();
    }
    const definition = definitions.get(type);
    if (!definition) throw new FigFileError(`This file uses a data type (${type}) that could not be read.`);
    if (definition.kind === "ENUM") {
      const number = buffer.readVarUint();
      return definition.fields.find((field) => field.value === number)?.name ?? number;
    }
    const out: Record<string, unknown> = {};
    if (definition.kind === "STRUCT") {
      for (const field of definition.fields) out[field.name] = fieldValue(field.type!, field.isArray);
      return out;
    }
    // A message lists only the fields it has, each announced by its number, and ends with 0.
    const byNumber = new Map(definition.fields.map((field) => [field.value, field]));
    for (;;) {
      const number = buffer.readVarUint();
      if (number === 0) return out;
      const field = byNumber.get(number);
      if (!field) throw new FigFileError("This file is damaged, or was written by a newer Figma than this importer understands.");
      out[field.name] = fieldValue(field.type!, field.isArray);
    }
  };

  const fieldValue = (type: string, isArray: boolean): unknown => {
    if (!isArray) return value(type);
    if (type === "byte") return buffer.readByteArray();
    const length = buffer.readVarUint();
    const list = new Array<unknown>(length);
    for (let i = 0; i < length; i++) list[i] = value(type);
    return list;
  };

  return value(root);
}

/** Either compression Figma has used for the chunks. */
function decompress(chunk: Uint8Array): Uint8Array {
  const zstd = chunk[0] === 0x28 && chunk[1] === 0xb5 && chunk[2] === 0x2f && chunk[3] === 0xfd;
  return zstd ? unzstd(chunk) : inflateSync(chunk);
}

/** The schema and message of a `canvas.fig`, decoded. */
export function decodeCanvas(canvas: Uint8Array): { nodeChanges?: FigNode[]; blobs?: { bytes: Uint8Array }[] } {
  if (ascii(canvas.subarray(0, MAGIC.length)) !== MAGIC) throw new FigFileError("This is not a Figma design file.");
  const view = new DataView(canvas.buffer, canvas.byteOffset, canvas.byteLength);
  const chunks: Uint8Array[] = [];
  // After the magic word and a version number come the chunks, each with its length in front.
  for (let offset = MAGIC.length + 4; offset + 4 <= canvas.length; ) {
    const length = view.getUint32(offset, true);
    chunks.push(canvas.subarray(offset + 4, offset + 4 + length));
    offset += 4 + length;
  }
  if (chunks.length < 2) throw new FigFileError("This Figma file is incomplete.");
  try {
    const schema = decodeBinarySchema(decompress(chunks[0]!));
    return decodeWith(schema, decompress(chunks[1]!), "Message") as { nodeChanges?: FigNode[]; blobs?: { bytes: Uint8Array }[] };
  } catch (error) {
    if (error instanceof FigFileError) throw error;
    throw new FigFileError("This Figma file could not be read. It may be damaged, or saved in a format this importer does not know.");
  }
}

export function readFigFile(bytes: Uint8Array): FigFile {
  let canvas = bytes;
  const images = new Map<string, Uint8Array>();
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    // Only the design and its pictures are needed; the thumbnail stays packed.
    const entries = unzipSync(bytes, { filter: (entry) => entry.name === "canvas.fig" || (entry.name.startsWith("images/") && entry.originalSize > 0) });
    const found = entries["canvas.fig"];
    if (!found) throw new FigFileError("This file has no Figma design in it. FigJam boards and Figma Slides are not supported.");
    canvas = found;
    for (const [name, data] of Object.entries(entries)) if (name.startsWith("images/")) images.set(name.slice("images/".length), data);
  }

  const message = decodeCanvas(canvas);
  const nodes = new Map<string, FigNode>();
  const children = new Map<string, FigNode[]>();
  for (const node of message.nodeChanges ?? []) {
    if (!node.guid || node.phase === "REMOVED") continue;
    nodes.set(figKey(node.guid), node);
  }
  for (const node of nodes.values()) {
    if (!node.parentIndex) continue;
    const parent = figKey(node.parentIndex.guid);
    const list = children.get(parent);
    if (list) list.push(node);
    else children.set(parent, [node]);
  }
  // Siblings are ordered by a sortable string; plain code-unit order is what Figma uses.
  const position = (node: FigNode) => node.parentIndex?.position ?? "";
  for (const list of children.values()) list.sort((a, b) => (position(a) < position(b) ? -1 : position(a) > position(b) ? 1 : 0));

  const pages = [...nodes.values()].filter((node) => node.type === "CANVAS" && node.internalOnly !== true);
  pages.sort((a, b) => (position(a) < position(b) ? -1 : position(a) > position(b) ? 1 : 0));
  if (pages.length === 0) throw new FigFileError("This Figma file has no pages.");
  return { nodes, children, pages, blobs: (message.blobs ?? []).map((blob) => blob.bytes), images };
}

/** How many layers a node holds, itself included. */
export function countLayers(file: FigFile, node: FigNode): number {
  let total = 0;
  const stack = [node];
  while (stack.length > 0) {
    const next = stack.pop()!;
    total++;
    const below = file.children.get(figKey(next.guid));
    if (below) stack.push(...below);
  }
  return total;
}
