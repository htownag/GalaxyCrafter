import { createContext, useContext } from "react";
import type { Character } from "@shared/ipc-types";

interface ActiveCharacterCtx {
  character: Character | null;
  refresh: () => Promise<void>;
}

export const ActiveCharacterContext = createContext<ActiveCharacterCtx>({
  character: null,
  refresh: async () => {},
});

export function useActiveCharacter(): ActiveCharacterCtx {
  return useContext(ActiveCharacterContext);
}
