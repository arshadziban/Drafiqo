#!/usr/bin/env node
// The Drafiqo MCP server. An AI assistant (Claude Code, Claude Desktop, …)
// starts this over stdio and gets tools for designing in the Drafiqo window
// that is open on this computer.
//
// The assistant talks MCP to this process; this process passes each request to
// the editor over a local WebSocket the editor connects to, and hands back the
// answer. Nothing leaves the machine, and the editor does the actual work, so
// every change shows up on the canvas and can be undone there.
//
//   node mcp/server.mjs            (DRAFIQO_MCP_PORT overrides port 4725)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer } from "ws";
import { z } from "zod";

const PORT = Number(process.env.DRAFIQO_MCP_PORT) || 4725;
const TIMEOUT_MS = 60_000;
// Only the Drafiqo app may be on the other end: the desktop build, or its dev server.
const APP_ORIGINS = /^(tauri:\/\/localhost|https?:\/\/tauri\.localhost|http:\/\/(localhost|127\.0\.0\.1):\d+)$/;

/** stdout carries the MCP protocol, so anything for a human goes to stderr. */
const log = (...parts) => console.error("[drafiqo-mcp]", ...parts);

let app = null;
let portError = null;
let nextId = 1;
const waiting = new Map();

const sockets = new WebSocketServer({ host: "127.0.0.1", port: PORT, verifyClient: ({ origin }) => APP_ORIGINS.test(origin ?? "") });
sockets.on("error", (error) => {
  portError = error.code === "EADDRINUSE" ? `Port ${PORT} is already in use, most likely by another Drafiqo MCP session. Close that session, or set DRAFIQO_MCP_PORT.` : String(error.message ?? error);
  log(portError);
});
sockets.on("connection", (socket) => {
  // Several Drafiqo windows may be open: the one the user was last in is the one that is designed in.
  app ??= socket;
  log("Drafiqo connected");
  socket.on("message", (data) => {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    if (message.event === "active") {
      app = socket;
      return;
    }
    const pending = waiting.get(message.id);
    if (!pending || pending.socket !== socket) return;
    waiting.delete(message.id);
    clearTimeout(pending.timer);
    if (typeof message.error === "string") pending.reject(new Error(message.error));
    else pending.resolve(message.result);
  });
  socket.on("close", () => {
    if (app === socket) app = [...sockets.clients].find((other) => other !== socket && other.readyState === other.OPEN) ?? null;
    for (const [id, pending] of waiting) {
      if (pending.socket !== socket) continue;
      waiting.delete(id);
      clearTimeout(pending.timer);
      pending.reject(new Error("The Drafiqo window was closed before it answered."));
    }
    log("Drafiqo disconnected");
  });
});

/** Asks the editor to do something and waits for its answer. */
function ask(method, params) {
  if (portError) return Promise.reject(new Error(portError));
  if (!app) return Promise.reject(new Error("Drafiqo is not connected. Ask the user to open the Drafiqo app; it connects by itself within a few seconds."));
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error("Drafiqo did not answer in time."));
    }, TIMEOUT_MS);
    waiting.set(id, { resolve, reject, timer, socket: app });
    app.send(JSON.stringify({ id, method, params }));
  });
}

const asText = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 1) }] });
const failed = (error) => ({ isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] });
/** A tool that passes its arguments straight to the editor and returns the answer as JSON. */
const forward = (method) => async (params) => {
  try {
    return asText(await ask(method, params));
  } catch (error) {
    return failed(error);
  }
};

// ---------------------------------------------------------------------------
// What a layer can be given. The same properties create a layer and change one.
// ---------------------------------------------------------------------------

const hex = z.string().describe('Hex colour, e.g. "#1a73e8".');
const layerProps = {
  name: z.string().optional().describe("Layer name shown in the layers panel."),
  x: z.number().optional().describe("Left edge, in the parent's coordinates (ignored inside an auto layout frame)."),
  y: z.number().optional().describe("Top edge, in the parent's coordinates (ignored inside an auto layout frame)."),
  width: z.number().optional(),
  height: z.number().optional(),
  rotation: z.number().optional().describe("Degrees, clockwise, about the centre."),
  opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(),
  fill: hex.nullable().optional().describe("Fill colour; null for no fill. For text, the text colour."),
  fillOpacity: z.number().min(0).max(1).optional(),
  stroke: hex.nullable().optional().describe("Outline colour; null for none."),
  strokeWidth: z.number().min(0).optional(),
  cornerRadius: z.union([z.number(), z.array(z.number()).length(4)]).optional().describe("Frames and rectangles: one radius, or four (top-left, top-right, bottom-right, bottom-left)."),
  shadow: z
    .object({ color: hex.optional(), opacity: z.number().optional(), x: z.number().optional(), y: z.number().optional(), blur: z.number().optional(), spread: z.number().optional(), inner: z.boolean().optional() })
    .nullable()
    .optional()
    .describe("Drop shadow (or inner shadow with inner: true); null removes it."),
  blur: z.number().optional().describe("Layer blur radius."),
  clipContent: z.boolean().optional().describe("Frames: hide what sticks out of the frame."),
  text: z.string().optional().describe("Text layers: the words. Use \\n for line breaks."),
  fontFamily: z.string().optional().describe("Any installed font or Google Fonts family (see search_fonts)."),
  fontSize: z.number().optional(),
  fontWeight: z.number().optional().describe("100–900; 400 regular, 700 bold."),
  lineHeight: z.number().optional().describe("Multiple of the font size, e.g. 1.4."),
  letterSpacing: z.number().optional().describe("Pixels."),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  sides: z.number().optional().describe("Polygons: number of sides."),
  points: z.number().optional().describe("Stars: number of points."),
  innerRatio: z.number().optional().describe("Stars: inner radius as a fraction of the outer (0–1)."),
  layout: z
    .union([
      z.enum(["horizontal", "vertical"]),
      z.object({
        mode: z.enum(["horizontal", "vertical"]).optional(),
        gap: z.number().optional(),
        padding: z.number().optional().describe("All four sides."),
        paddingX: z.number().optional(),
        paddingY: z.number().optional(),
        paddingTop: z.number().optional(),
        paddingRight: z.number().optional(),
        paddingBottom: z.number().optional(),
        paddingLeft: z.number().optional(),
        align: z.enum(["start", "center", "end", "space-between"]).optional().describe("Along the layout direction."),
        crossAlign: z.enum(["start", "center", "end"]).optional().describe("Across the layout direction."),
        wrap: z.boolean().optional(),
      }),
    ])
    .nullable()
    .optional()
    .describe("Frames: auto layout. The frame places its children in a row or column, so they need no x/y. null turns it off."),
  widthSizing: z.enum(["fixed", "hug", "fill"]).optional().describe('"hug" (auto layout frames) fits the content; "fill" (children of auto layout frames) takes the room the parent has.'),
  heightSizing: z.enum(["fixed", "hug", "fill"]).optional(),
  absolute: z.boolean().optional().describe("Child of an auto layout frame: leave the flow and use x/y."),
  minWidth: z.number().optional(),
  maxWidth: z.number().optional(),
  minHeight: z.number().optional(),
  maxHeight: z.number().optional(),
};

const newLayer = z.object({
  type: z.enum(["frame", "rectangle", "ellipse", "line", "polygon", "star", "text"]),
  ...layerProps,
  x2: z.number().optional().describe("Lines: end point x (start point is x/y)."),
  y2: z.number().optional().describe("Lines: end point y."),
  children: z.array(z.record(z.string(), z.any())).optional().describe("Frames only: layers inside this one, each with this same shape (and their own children). Listed back to front, and in reading order for auto layout."),
});

const server = new McpServer(
  { name: "drafiqo", version: "0.1.0" },
  {
    instructions: [
      "Tools for designing in Drafiqo, a desktop design editor, in the window the user has open. Changes appear on their canvas at once and each call is one undo step.",
      "Workflow: get_document / get_nodes to see what is there; create_nodes to build (nest children inside frames, and prefer auto layout frames over hand-placed x/y); export_image to look at the result and check spacing, alignment and contrast; update_nodes to refine.",
      "Coordinates are pixels, y grows downward, and a child's x/y are relative to its parent frame. Start a screen with one top-level frame (e.g. 1440×900 desktop, 390×844 phone) and put everything inside it.",
      "A new text layer is black and a new shape is light grey unless you give a fill. A text given a width wraps inside it; without one its box hugs the words.",
    ].join("\n"),
  },
);

server.registerTool("get_document", { description: "The open document: its pages, which page is current, and the selected layer ids.", inputSchema: {} }, forward("get_document"));

server.registerTool(
  "get_nodes",
  {
    description: "Reads the layers of the current page as a tree (ids, types, geometry, colours, text, auto layout). Give nodeId to read one layer and what is inside it.",
    inputSchema: { nodeId: z.string().optional(), depth: z.number().int().min(0).optional().describe("How many levels of children to include (default 6).") },
  },
  forward("get_nodes"),
);

server.registerTool(
  "create_nodes",
  {
    description: "Adds layers to the current page, nested as given. Returns the new layers with their ids. Build a whole screen or component in one call by nesting children inside frames.",
    inputSchema: { parentId: z.string().optional().describe("Frame to add into; omit to add at the top level of the page."), nodes: z.array(newLayer).min(1) },
  },
  forward("create_nodes"),
);

server.registerTool(
  "update_nodes",
  {
    description: "Changes existing layers. Each update names a layer by id and gives only the properties to change. parentId moves the layer into another frame (null for the top level).",
    inputSchema: { updates: z.array(z.object({ id: z.string(), parentId: z.string().nullable().optional(), ...layerProps })).min(1) },
  },
  forward("update_nodes"),
);

server.registerTool("delete_nodes", { description: "Deletes layers, and everything inside them, by id.", inputSchema: { ids: z.array(z.string()).min(1) } }, forward("delete_nodes"));

server.registerTool("select_nodes", { description: "Selects layers and zooms the user's view to them, to show them what was made. An empty list shows the whole page.", inputSchema: { ids: z.array(z.string()) } }, forward("select_nodes"));

server.registerTool(
  "set_page",
  {
    description: "Works with pages: create a new one (create: its name), switch to one (pageId), or rename / recolour the current one.",
    inputSchema: { create: z.string().optional(), pageId: z.string().optional(), name: z.string().optional(), background: hex.optional().describe("Canvas colour behind the frames.") },
  },
  forward("set_page"),
);

server.registerTool(
  "search_fonts",
  { description: "Finds font families by name among the fonts installed on the user's computer and all of Google Fonts. Any of them can be used as fontFamily.", inputSchema: { query: z.string().describe('Part of a name, e.g. "inter"; empty lists the first of each.') } },
  forward("search_fonts"),
);

server.registerTool(
  "export_image",
  {
    description: "Renders a layer (or the whole current page) to a PNG and returns it, so you can see the design. Use it after building or changing something to check your work.",
    inputSchema: { nodeId: z.string().optional().describe("Layer to picture; omit for the whole page."), scale: z.number().optional().describe("1 = actual size (default). The longest side is capped at 1600 px.") },
  },
  async (params) => {
    try {
      const picture = await ask("export_image", params);
      return { content: [{ type: "image", data: picture.image, mimeType: picture.mimeType }, { type: "text", text: `${picture.width} × ${picture.height} px` }] };
    } catch (error) {
      return failed(error);
    }
  },
);

await server.connect(new StdioServerTransport());
// The assistant going away ends this process, so the port is free for its next session.
const quit = () => process.exit(0);
process.stdin.on("end", quit);
process.stdin.on("close", quit);
process.on("SIGINT", quit);
process.on("SIGTERM", quit);
log(`ready; waiting for Drafiqo on ws://127.0.0.1:${PORT}`);
