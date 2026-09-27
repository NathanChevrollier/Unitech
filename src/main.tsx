import "@fontsource-variable/inter";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "./styles/app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

// Le menu contextuel du navigateur n'a pas de sens dans l'application.
window.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement;
  if (!(t.tagName === "INPUT" || t.tagName === "TEXTAREA")) e.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
