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
  setProfessionPriorities: (characterId, priorities) =>
    ipcRenderer.invoke("characters:setPriorities", characterId, priorities),

  // Phase 2 — schematics
  listSchematics: (filter) => ipcRenderer.invoke("schematics:list", filter),
  getSchematicDetail: (id) => ipcRenderer.invoke("schematics:detail", id),
  listActiveSchematics: (characterId) => ipcRenderer.invoke("schematics:listActive", characterId),
  addActiveSchematic: (characterId, schematicId, withSubcomponents) =>
    ipcRenderer.invoke("schematics:addActive", characterId, schematicId, withSubcomponents),
  removeActiveSchematic: (characterId, schematicId) =>
    ipcRenderer.invoke("schematics:removeActive", characterId, schematicId),

  // Phase 2 — resource types
  getResourceType: (id) => ipcRenderer.invoke("resourceTypes:get", id),

  // Phase 3 — verdicts
  listVerdicts: (characterId) => ipcRenderer.invoke("verdicts:list", characterId),
  getResourceDetail: (resourceId) => ipcRenderer.invoke("resources:detail", resourceId),

  // Phase 8a — server-best flags
  listSbFlags: (galaxyId) => ipcRenderer.invoke("sbFlags:list", galaxyId),

  // Phase 4 — inventory
  listInventory: (characterId) => ipcRenderer.invoke("inventory:list", characterId),
  upsertInventory: (input) => ipcRenderer.invoke("inventory:upsert", input),
  removeInventory: (characterId, resourceId) =>
    ipcRenderer.invoke("inventory:remove", characterId, resourceId),

  // Phase 5 — Resource Finder
  rankResourcesForSchematic: (input) => ipcRenderer.invoke("finder:rank", input),

  // Phase 4E — GH single-resource lookup
  lookupGhResource: (input) => ipcRenderer.invoke("gh:lookupResource", input),
  onVerdictsUpdated: (listener) => {
    const wrapped = (_evt: Electron.IpcRendererEvent, payload: { characterId: string }): void =>
      listener(payload);
    ipcRenderer.on("verdicts:updated", wrapped);
    return () => ipcRenderer.removeListener("verdicts:updated", wrapped);
  },
};

contextBridge.exposeInMainWorld("api", api);
