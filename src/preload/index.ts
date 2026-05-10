import { contextBridge, ipcRenderer } from "electron";
import type { IpcApi } from "../shared/ipc-types";

const api: IpcApi = {
  refreshSnapshot: (galaxyKey) => ipcRenderer.invoke("snapshot:refresh", galaxyKey),
  getLatestSnapshot: () => ipcRenderer.invoke("snapshot:latest"),
  listResources: (snapshotId) => ipcRenderer.invoke("resources:list", snapshotId),
};

contextBridge.exposeInMainWorld("api", api);
