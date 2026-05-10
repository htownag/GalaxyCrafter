import path from "node:path";
import { BrowserWindow, app } from "electron";
import { closeDb, openDb } from "../db";
import { loadReferenceData } from "../db/reference-loader";
import { registerIpc } from "./ipc";

function initDb(): void {
  const dbPath = path.join(app.getPath("userData"), "galaxycrafter.sqlite");
  const migrationsFolder = path.join(app.getAppPath(), "drizzle", "migrations");
  openDb(dbPath, migrationsFolder);
  loadReferenceData(app.getAppPath());
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#09090b",
    title: "GalaxyCrafter",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // electron-vite sets ELECTRON_RENDERER_URL in dev mode (Vite dev server URL).
  // In production builds, fall back to the bundled renderer HTML.
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
    win.webContents.openDevTools({ mode: "right" });
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  initDb();
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  closeDb();
  if (process.platform !== "darwin") app.quit();
});
