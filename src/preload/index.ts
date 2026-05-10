import { contextBridge, ipcRenderer } from "electron";
import type { IpcApi } from "../shared/ipc-types";

const api: IpcApi = {
  // Phase 1
  refreshSnapshot: (galaxyKey) => ipcRenderer.invoke("snapshot:refresh", galaxyKey),
  getLatestSnapshot: () => ipcRenderer.invoke("snapshot:latest"),
  listResources: (snapshotId) => ipcRenderer.invoke("resources:list", snapshotId),

  // Phase 2 — characters
  listCharacters: () => ipcRenderer.invoke("characters:list"),
  getActiveCharacter: () => ipcRenderer.invoke("characters:active"),
  createCharacter: (input) => ipcRenderer.invoke("characters:create", input),
  setActiveCharacter: (id) => ipcRenderer.invoke("characters:setActive", id),
  getProfessionPriorities: (characterId) =>
    ipcRenderer.invoke("characters:priorities", characterId),

  // Phase 2 — schematics
  listSchematics: (filter) => ipcRenderer.invoke("schematics:list", filter),
  getSchematicDetail: (id) => ipcRenderer.invoke("schematics:detail", id),
  listActiveSchematics: (characterId) =>
    ipcRenderer.invoke("schematics:listActive", characterId),
  addActiveSchematic: (characterId, schematicId, withSubcomponents) =>
    ipcRenderer.invoke("schematics:addActive", characterId, schematicId, withSubcomponents),
  removeActiveSchematic: (characterId, schematicId) =>
    ipcRenderer.invoke("schematics:removeActive", characterId, schematicId),

  // Phase 2 — resource types
  getResourceType: (id) => ipcRenderer.invoke("resourceTypes:get", id),
};

contextBridge.exposeInMainWorld("api", api);
