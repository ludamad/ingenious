import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initAudio } from "./sound";
import "./styles.css";

initAudio();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
