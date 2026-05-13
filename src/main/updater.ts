// Auto-updater wiring.
//
// `electron-updater` reads the publish provider config from electron-builder.yml
// (we set provider=github, owner=htownag, repo=GalaxyCrafter). At runtime it
// fetches latest.yml from the GitHub Releases tag, compares against the running
// app's package.json version, and downloads the new installer in the background
// if a newer release exists. When the download finishes we surface a toast in
// the renderer with a "Restart now" / "Later" choice.
//
// Behaviour:
//   - Only runs when `app.isPackaged` is true. Dev (electron-vite) is a no-op.
//   - Silent failure on any network / verification error — next launch retries.
//   - Update download is automatic. UI only appears at the "ready to install"
//     step, so the user is never surprised mid-launch.
//   - If the user dismisses the toast (Later), the update applies automatically
//     when they next quit the app (autoInstallOnAppQuit = default true).
//
// Manual "Check for updates" trigger exposed via the `updater:check` IPC for
// the Settings page button.

import { BrowserWindow, app, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateDownloadedEvent } from "../shared/ipc-types";

/** Track whether the toast has fired this session so a manual re-check doesn't
 * spam the renderer. */
let alreadyAnnouncedThisSession = false;

export function initAutoUpdater(): void {
  // Skip entirely in dev — there's no packaged installer for the updater to
  // diff against, and the latest.yml fetch would either fail or spuriously
  // report 'update available' against a placeholder version.
  if (!app.isPackaged) {
    console.log("[updater] dev mode — skipping auto-updater init");
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Logger pipe — electron-updater writes detailed progress to whatever it's
  // pointed at. console.log surfaces in the packaged app's stderr (visible
  // when launched with --enable-logging) which is what we used to debug the
  // v0.1.0 crash.
  autoUpdater.logger = {
    info: (m: unknown) => console.log("[updater]", m),
    warn: (m: unknown) => console.warn("[updater]", m),
    error: (m: unknown) => console.error("[updater]", m),
    debug: (m: unknown) => console.log("[updater:debug]", m),
  };

  autoUpdater.on("checking-for-update", () => {
    console.log("[updater] checking for update");
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`[updater] available: v${info.version}`);
  });

  autoUpdater.on("update-not-available", (info) => {
    console.log(`[updater] up to date (v${info.version})`);
  });

  autoUpdater.on("download-progress", (p) => {
    console.log(
      `[updater] downloading ${p.percent.toFixed(1)}% (${p.transferred}/${p.total})`,
    );
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log(`[updater] downloaded v${info.version}`);
    if (alreadyAnnouncedThisSession) return;
    alreadyAnnouncedThisSession = true;
    const payload: UpdateDownloadedEvent = {
      version: info.version,
      releaseNotes:
        typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
    };
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send("updater:downloaded", payload);
    }
  });

  autoUpdater.on("error", (err) => {
    console.error("[updater] error:", err);
    // Don't surface to user — every check failure would otherwise pop a
    // 'something broke' toast. Silent retry next launch is friendlier.
  });

  // Renderer triggers final restart+install when the user clicks the toast's
  // Restart button.
  ipcMain.handle("updater:restartAndInstall", () => {
    autoUpdater.quitAndInstall();
  });

  // Manual check-for-updates trigger from the Settings page. Returns the
  // raw event-loop status; renderer maps it to a status message.
  ipcMain.handle("updater:check", async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result) return { status: "unavailable" as const };
      const cur = app.getVersion();
      const latest = result.updateInfo.version;
      if (latest === cur) return { status: "current" as const, version: cur };
      return {
        status: "available" as const,
        currentVersion: cur,
        latestVersion: latest,
      };
    } catch (e) {
      return { status: "error" as const, message: String(e) };
    }
  });

  // Initial background check, delayed 5s to let the app finish booting +
  // first paint. checkForUpdatesAndNotify includes download-on-find when
  // autoDownload is true.
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error("[updater] initial check failed:", err);
    });
  }, 5000);
}
