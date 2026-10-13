import { useCanvasUi } from "../canvas/uiStore";
import { handleRequest } from "./handlers";

// The link to the MCP server (/mcp/server.mjs), which an AI assistant such as
// Claude starts on this computer. The server listens on a local port and the
// editor calls in, so the app itself never accepts connections.

export const MCP_PORT = 4725;
const RETRY_MS = 4000;

const toast = (title: string, detail?: string) => useCanvasUi.setState({ toast: { id: Date.now(), title, detail } });

/** Keeps trying to reach the server, and answers its requests while connected. */
export function connectMcpBridge(): void {
  const connect = () => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(`ws://127.0.0.1:${MCP_PORT}`);
    } catch {
      window.setTimeout(connect, RETRY_MS);
      return;
    }
    let opened = false;
    // With several Drafiqo windows open, the assistant works in the one the user is in.
    const claim = () => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ event: "active" }));
    window.addEventListener("focus", claim);
    socket.onopen = () => {
      opened = true;
      if (document.hasFocus()) claim();
      toast("Claude connected", "It can now read and edit this document.");
    };
    socket.onmessage = async (event) => {
      let request: { id?: unknown; method?: unknown; params?: Record<string, unknown> };
      try {
        request = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (typeof request.method !== "string") return;
      const reply = await handleRequest(request.method, request.params ?? {});
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: request.id, ...reply }));
    };
    socket.onclose = () => {
      window.removeEventListener("focus", claim);
      if (opened) toast("Claude disconnected");
      window.setTimeout(connect, RETRY_MS);
    };
  };
  connect();
}
