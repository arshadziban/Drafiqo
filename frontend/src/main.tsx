import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { PresentationWindow } from "./components/Presentation";
import { createCanvasMeasurer } from "./canvas/measure";
import { setTextMeasurer } from "./document/textLayout";
import "@fontsource-variable/inter";
import "./index.css";

setTextMeasurer(createCanvasMeasurer());

// A slideshow window is this same app started with `?present=<token>`: it shows slides, not the editor.
const slideshow = new URLSearchParams(window.location.search).get("present");

createRoot(document.getElementById("root")!).render(<StrictMode>{slideshow ? <PresentationWindow token={slideshow} /> : <App />}</StrictMode>);
