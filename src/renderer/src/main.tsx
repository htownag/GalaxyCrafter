import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import { App } from "./App";
import { ActiveSchematics } from "./routes/ActiveSchematics";
import { Character } from "./routes/Character";
import { Inventory } from "./routes/Inventory";
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
