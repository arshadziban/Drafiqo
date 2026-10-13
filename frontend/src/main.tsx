import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { PresentationWindow } from "./components/Presentation";
import { watchCulling } from "./canvas/culling";
import { createCanvasMeasurer } from "./canvas/measure";
import { setTextMeasurer } from "./document/textLayout";
import { watchDocumentFonts } from "./fonts/documentFonts";
import { connectMcpBridge } from "./mcp/bridge";
import "@fontsource-variable/inter";
import "./index.css";

setTextMeasurer(createCanvasMeasurer());
watchDocumentFonts();

// A slideshow window is this same app started with `?present=<token>`: it shows slides, not the editor.
const slideshow = new URLSearchParams(window.location.search).get("present");

// Only the editor answers an AI assistant; a slideshow window just shows slides.
if (!slideshow) connectMcpBridge();
if (!slideshow) watchCulling();

createRoot(document.getElementById("root")!).render(<StrictMode>{slideshow ? <PresentationWindow token={slideshow} /> : <App />}</StrictMode>);
