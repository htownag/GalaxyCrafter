import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { Character, SnapshotSummary } from "@shared/ipc-types";
import { ActiveCharacterContext } from "./hooks/useActiveCharacter";

const TABS = [
  { to: "/resources", label: "Resources" },
  { to: "/schematics", label: "Schematics" },
  { to: "/active", label: "Active" },
  { to: "/character", label: "Character" },
];

function relativeAge(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return "in the future";
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function App(): JSX.Element {
  const [activeCharacter, setActiveCharacter] = useState<Character | null>(null);
  const [latestSnapshot, setLatestSnapshot] = useState<SnapshotSummary | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const refreshActiveCharacter = useCallback(async () => {
    const ch = await window.api.getActiveCharacter();
    setActiveCharacter(ch);
    if (!ch && location.pathname !== "/character") {
      navigate("/character", { replace: true });
    }
  }, [location.pathname, navigate]);

  const refreshSnapshotInfo = useCallback(async () => {
    setLatestSnapshot(await window.api.getLatestSnapshot());
  }, []);

  useEffect(() => {
    void refreshActiveCharacter();
    void refreshSnapshotInfo();
  }, [refreshActiveCharacter, refreshSnapshotInfo]);

  return (
    <ActiveCharacterContext.Provider
      value={{ character: activeCharacter, refresh: refreshActiveCharacter }}
    >
      <div className="min-h-screen flex flex-col">
        <header className="border-b border-zinc-800 bg-zinc-950 sticky top-0 z-10">
          <div className="flex items-center justify-between px-6 py-3">
            <div className="flex items-center gap-6">
              <div>
                <h1 className="text-lg font-semibold text-zinc-100">GalaxyCrafter</h1>
                <p className="text-[10px] text-zinc-600 leading-none">Phase 2 — reference data</p>
              </div>
              <nav className="flex items-center gap-1">
                {TABS.map((t) => (
                  <NavLink
                    key={t.to}
                    to={t.to}
                    end={t.to === "/"}
                    className={({ isActive }) =>
                      `px-3 py-1.5 rounded-md text-sm transition-colors ${
                        isActive
                          ? "bg-zinc-800 text-zinc-100"
                          : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
                      }`
                    }
                  >
                    {t.label}
                  </NavLink>
                ))}
              </nav>
            </div>
            <div className="flex items-center gap-4 text-xs text-zinc-500">
              {activeCharacter && (
                <span className="text-right leading-tight">
                  <span className="block text-zinc-300">{activeCharacter.name}</span>
                  <span className="block text-[10px]">galaxy {activeCharacter.galaxyId}</span>
                </span>
              )}
              {latestSnapshot && (
                <span
                  className="text-right leading-tight"
                  title={new Date(latestSnapshot.fetchedAt).toLocaleString()}
                >
                  <span className="block text-zinc-300">{relativeAge(latestSnapshot.fetchedAt)}</span>
                  <span className="block text-[10px]">{latestSnapshot.resourceCount} spawns</span>
                </span>
              )}
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </ActiveCharacterContext.Provider>
  );
}
