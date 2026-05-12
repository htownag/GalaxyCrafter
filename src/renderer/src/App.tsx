import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { Character, SnapshotIngestEvent, SnapshotSummary } from "@shared/ipc-types";
import { ActiveCharacterContext } from "./hooks/useActiveCharacter";

const TABS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/resources", label: "Resources" },
  { to: "/schematics", label: "Schematics" },
  { to: "/active", label: "Active" },
  { to: "/inventory", label: "Crates" },
  { to: "/finder", label: "Finder" },
  { to: "/planner", label: "Planner" },
  // Simulator shelved 2026-05-11 pending UX rework. Code, data, IPC, math
  // core + 95 tests, migration 0005, and reference-data/schematic-
  // experimental-ranges.json all remain in place. Re-enable by restoring
  // this line + the route + import in main.tsx.
  // { to: "/simulator", label: "Simulator" },
  { to: "/character", label: "Character" },
  { to: "/settings", label: "Settings" },
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
  const [ingestToast, setIngestToast] = useState<SnapshotIngestEvent | null>(null);
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

  // Subscribe to the live snapshot-ingest event. Pop a non-disruptive toast
  // ("N new spawns · K CHASE for you"), refresh the snapshot summary in the
  // header. Toast auto-dismisses after 6s; click to dismiss sooner.
  useEffect(() => {
    const off = window.api.onSnapshotIngestComplete((payload) => {
      setIngestToast(payload);
      void refreshSnapshotInfo();
    });
    return off;
  }, [refreshSnapshotInfo]);

  useEffect(() => {
    if (!ingestToast) return;
    const t = setTimeout(() => setIngestToast(null), 6000);
    return () => clearTimeout(t);
  }, [ingestToast]);

  return (
    <ActiveCharacterContext.Provider
      value={{ character: activeCharacter, refresh: refreshActiveCharacter }}
    >
      <div className="min-h-screen flex flex-col">
        <header className="border-b border-slate-700 bg-slate-900 sticky top-0 z-10">
          <div className="flex items-center justify-between px-6 py-3">
            <div className="flex items-center gap-6">
              <div>
                <h1 className="text-lg font-semibold text-slate-100">GalaxyCrafter</h1>
                <p className="text-[10px] text-slate-600 leading-none">Phase 2 — reference data</p>
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
                          ? "bg-slate-800 text-slate-100"
                          : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                      }`
                    }
                  >
                    {t.label}
                  </NavLink>
                ))}
              </nav>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-400">
              {activeCharacter && (
                <span className="text-right leading-tight">
                  <span className="block text-slate-300">{activeCharacter.name}</span>
                  <span className="block text-[10px]">galaxy {activeCharacter.galaxyId}</span>
                </span>
              )}
              {latestSnapshot && (
                <span
                  className="text-right leading-tight"
                  title={new Date(latestSnapshot.fetchedAt).toLocaleString()}
                >
                  <span className="block text-slate-300">{relativeAge(latestSnapshot.fetchedAt)}</span>
                  <span className="block text-[10px]">{latestSnapshot.resourceCount} spawns</span>
                </span>
              )}
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
        {ingestToast && (
          <IngestToast event={ingestToast} onDismiss={() => setIngestToast(null)} />
        )}
      </div>
    </ActiveCharacterContext.Provider>
  );
}

function IngestToast({
  event,
  onDismiss,
}: {
  event: SnapshotIngestEvent;
  onDismiss: () => void;
}): JSX.Element {
  // Compose the headline from whatever's most interesting on this ingest.
  // Order of priority: new CHASE-worthy resources > new spawns > despawns >
  // generic "snapshot refreshed."
  const parts: string[] = [];
  if (event.newResourceCount > 0) {
    parts.push(`${event.newResourceCount} new spawn${event.newResourceCount === 1 ? "" : "s"}`);
  }
  if (event.despawnedResourceCount > 0) {
    parts.push(
      `${event.despawnedResourceCount} despawned`,
    );
  }
  const verdictLine =
    event.charactersScored > 0
      ? `${event.totalChase} CHASE · ${event.totalMaybe} MAYBE`
      : null;

  return (
    <div
      className="fixed bottom-6 right-6 z-50 w-96 max-w-[90vw] rounded-lg border border-emerald-700 bg-slate-900 shadow-xl shadow-emerald-950/60 p-5 animate-in fade-in"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-emerald-300 font-semibold text-lg leading-tight mb-1">
            Snapshot refreshed
          </div>
          <div className="text-slate-200 text-sm leading-snug">
            {parts.length > 0 ? parts.join(" · ") : `${event.resourceCount} resources`}
          </div>
          {verdictLine && (
            <div className="text-slate-400 text-sm mt-1.5">{verdictLine}</div>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-slate-500 hover:text-slate-200 text-2xl leading-none flex-shrink-0 -mr-1 -mt-1 px-2 py-1 rounded hover:bg-slate-800"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
