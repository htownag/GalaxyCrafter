// Augments the renderer's `window` so TypeScript knows about `window.api`.

import type { IpcApi } from "../shared/ipc-types";

declare global {
  interface Window {
    api: IpcApi;
  }
}

export {};
