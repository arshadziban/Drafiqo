import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { createCanvasMeasurer } from "./canvas/measure";
import { setTextMeasurer } from "./document/textLayout";
import "@fontsource-variable/inter";
import "./index.css";

setTextMeasurer(createCanvasMeasurer());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
