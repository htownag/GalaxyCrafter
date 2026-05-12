import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import { App } from "./App";
import { ActiveSchematics } from "./routes/ActiveSchematics";
import { Character } from "./routes/Character";
import { Finder } from "./routes/Finder";
import { Inventory } from "./routes/Inventory";
import { Planner } from "./routes/Planner";
// Simulator route shelved 2026-05-11 — see App.tsx note.
// import { Simulator } from "./routes/Simulator";
import { ResourceDetail } from "./routes/ResourceDetail";
import { Resources } from "./routes/Resources";
import { SchematicDetail } from "./routes/SchematicDetail";
import { Schematics } from "./routes/Schematics";
import "./index.css";

const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Resources /> },
      { path: "resources", element: <Resources /> },
      { path: "resources/:id", element: <ResourceDetail /> },
      { path: "schematics", element: <Schematics /> },
      { path: "schematics/:id", element: <SchematicDetail /> },
      { path: "active", element: <ActiveSchematics /> },
      { path: "inventory", element: <Inventory /> },
      { path: "finder", element: <Finder /> },
      { path: "finder/:schematicId", element: <Finder /> },
      { path: "planner", element: <Planner /> },
      // { path: "simulator", element: <Simulator /> },
      { path: "character", element: <Character /> },
    ],
  },
]);

const root = document.getElementById("root");
if (!root) throw new Error("Could not find #root element");

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
