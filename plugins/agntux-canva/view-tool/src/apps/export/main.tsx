import React from "react";
import { createRoot } from "react-dom/client";
import { AppsProvider } from "../../lib/apps-react/index.js";
import { ExportApp } from "./App.js";
import "../../globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("No #root element found");

createRoot(root).render(
  <React.StrictMode>
    <AppsProvider>
      <ExportApp />
    </AppsProvider>
  </React.StrictMode>,
);
