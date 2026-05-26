import type {
  InventoryEntry,
  Resource,
  SbFlagEntry,
  SnapshotSummary,
  StatKey,
  VerdictEntry,
} from "@shared/ipc-types";
import { STAT_KEYS } from "@shared/ipc-types";
import { PROFESSIONS } from "@shared/professions";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useActiveCharacter } from "../hooks/useActiveCharacter";

type SortKey = "verdict" | "name" | "type" | "group" | StatKey;
type SortDir = "asc" | "desc";
type VerdictFilter = "CHASE" | "UNLOCK" | "MAYBE" | "OWNED" | "NONE";
const ALL_FILTERS: VerdictFilter[] = ["CHASE", "UNLOCK", "MAYBE", "OWNED", "NONE"];

// Sort key for the verdict column. v0.1.6 priority order per Ryan's exact
// framing ("doesn't matter if it sucks, it's my first"):
// UNLOCK+CHASE > UNLOCK alone > CHASE alone > OWNED > MAYBE > none.
// Within a tier, higher topScore wins; OWNED rows sub-sort by units desc.
//
// Worth noting: a SKIP+UNLOCK with topScore=0 (4000) STILL outranks a
// CHASE-alone with topScore=95 (3095). This is deliberate — Ryan's
// instruction is that an uncovered slot trumps a quality upgrade, since
// you can't craft at all without coverage. Not a bug; matches the design
// doc decision and the release notes.
function verdictSortValue(v: VerdictEntry | undefined, inv: InventoryEntry | undefined): number {
  const isUnlock = v?.unlocksAny ?? false;
  if (v && v.tier === "CHASE" && isUnlock) return 5000 + v.topScore; // best of both
  if (isUnlock) return 4000 + (v?.topScore ?? 0); // UNLOCK alone — stockpile builder
  if (v && v.tier === "CHASE") return 3000 + v.topScore;
  if (v && v.tier === "MAYBE") return 2000 + v.topScore;
  if (inv) return 1000 + Math.min(999, Math.log10(Math.max(1, inv.units)) * 100);
  return 0;
}

function VerdictPill({ verdict }: { verdict: VerdictEntry }): JSX.Element {
  // 2026-modern UI: subtle filled chip with hover tooltip rather than a
  // pulsing badge. CHASE is the eye-magnet, MAYBE quieter.
  const cls =
    verdict.tier === "CHASE"
      ? "bg-emerald-900/60 border-emerald-700 text-emerald-200"
      : "bg-amber-900/50 border-amber-700 text-amber-200";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium ${cls}`}
      title={verdict.reason}
    >
      {verdict.tier}
    </span>
  );
}

// v0.1.6: UNLOCK badge — orthogonal to tier. Yellow/gold to stay distinct
// from emerald (CHASE), amber (MAYBE), and cyan (OWNED). Tooltip lists the
// schematics whose slot this resource would cover, so the player can see at
// a glance "this is the first chromium aluminum, fills T21 Stock + DH17."
function UnlockBadge({ verdict }: { verdict: VerdictEntry }): JSX.Element | null {
  if (!verdict.unlocksAny) return null;
  const lines = verdict.unlocks.map((u) => `${u.schematicName} — ${u.slotName}`);
  const title = `UNLOCKS ${verdict.unlocks.length} slot${verdict.unlocks.length === 1 ? "" : "s"}:\n${lines.join("\n")}`;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium bg-yellow-900/50 border-yellow-700 text-yellow-200"
      title={title}
    >
      UNLOCK
    </span>
  );
}

// Compact OWNED indicator. Always shown for inventory rows (per Ryan: "I
// already have this, but if nothing else can get more of it"). Supersedes
// the verdict pill — the chase signal is meaningless once you own the
// resource. Tooltip surfaces units + status + notes for context.
// Compact server-best cluster. A resource can have multiple flags
// (different professions). SB_TOP renders as a filled chip; SB_NEAR as
// outlined. Title surfaces full reasoning: "SB_TOP for Weaponsmith
// (94.2 vs server top 94.2 on weapon_rifle_t21)".
function SbBadgeCluster({ flags }: { flags: SbFlagEntry[] }): JSX.Element {
  if (flags.length === 0) return <span className="text-slate-700">—</span>;
  // Sort: TOP before NEAR, then by score descending. Best signal first.
  const sorted = [...flags].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier === "SB_TOP" ? -1 : 1;
    return b.score - a.score;
  });
  return (
    <span className="inline-flex flex-wrap gap-1">
      {sorted.map((f) => {
        const profName =
          PROFESSIONS.find((p) => p.id === f.forProfession)?.name ?? f.forProfession;
        const cls =
          f.tier === "SB_TOP"
            ? "bg-yellow-900/50 border-yellow-700 text-yellow-200"
            : "bg-transparent border-yellow-800 text-yellow-300/70";
        const title = `${f.tier} for ${profName}: ${f.score.toFixed(1)} vs server top ${f.topScoreOnSnapshot.toFixed(1)}${f.schematicId ? ` on ${f.schematicId}` : ""}`;
        // Profession initials — short label so the cluster fits in a row
        // without wrap-blowout. e.g. "WS" for Weaponsmith, "BE" for Bio-Engineer.
        const initials = profName
          .split(/[\s\-]/)
          .map((w) => w[0]?.toUpperCase() ?? "")
          .join("")
          .slice(0, 2);
        return (
          <span
            key={`${f.forProfession}|${f.tier}`}
            className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium font-mono ${cls}`}
            title={title}
          >
            <span className="text-[9px] mr-0.5 opacity-80">
              {f.tier === "SB_TOP" ? "★" : "☆"}
            </span>
            {initials}
          </span>
        );
      })}
    </span>
  );
}

function OwnedTag({ entry }: { entry: InventoryEntry }): JSX.Element {
  // Slate-cyan family — distinct from emerald (CHASE) / amber (MAYBE).
  // Status modulates the saturation: live = brighter, despawned = muted,
  // reserved = slight amber tint to remind it's committed.
  const cls =
    entry.status === "live"
      ? "bg-cyan-900/40 border-cyan-700 text-cyan-200"
      : entry.status === "reserved"
        ? "bg-cyan-900/30 border-cyan-800 text-cyan-300/80"
        : "bg-slate-800 border-slate-700 text-slate-300";
  return (
    <span
      className={`inline-flex flex-col items-start px-2 py-0.5 rounded-md border text-[11px] font-medium leading-tight ${cls}`}
      title={`${entry.units.toLocaleString()} units · ${entry.status}${entry.notes ? ` · ${entry.notes}` : ""}`}
    >
      <span>OWNED</span>
      <span className="text-[9px] tabular-nums opacity-80">
        {entry.units.toLocaleString()}u
      </span>
    </span>
  );
}

export function Resources(): JSX.Element {
  const { character } = useActiveCharacter();
  const [latest, setLatest] = useState<SnapshotSummary | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [verdictsById, setVerdictsById] = useState<Map<string, VerdictEntry>>(new Map());
  const [inventoryById, setInventoryById] = useState<Map<string, InventoryEntry>>(new Map());
  // SB flags are galaxy-wide (not character-specific). Map keyed by
  // resourceId to an array since a resource can have multiple flags
  // (e.g. SB_TOP_for_weaponsmith + SB_NEAR_for_armorsmith).
  const [sbByResource, setSbByResource] = useState<Map<string, SbFlagEntry[]>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  // Filter chips above the table. Default: all on. Setting any subset hides
  // the others. The `NONE` chip controls rows with no verdict and not owned.
  const [activeFilters, setActiveFilters] = useState<Set<VerdictFilter>>(
    new Set(ALL_FILTERS),
  );

  const load = useCallback(async () => {
    try {
      const snap = await window.api.getLatestSnapshot();
      setLatest(snap);
      if (snap) {
        const list = await window.api.listResources();
        setResources(list);

        // SB flags are galaxy-wide regardless of whether a character exists,
        // but only meaningful when we know which galaxy (use the snapshot's).
        const sbList = await window.api.listSbFlags(snap.galaxyId);
        const sbMap = new Map<string, SbFlagEntry[]>();
        for (const f of sbList) {
          const arr = sbMap.get(f.resourceId) ?? [];
          arr.push(f);
          sbMap.set(f.resourceId, arr);
        }
        setSbByResource(sbMap);

        if (character) {
          const [vs, inv] = await Promise.all([
            window.api.listVerdicts(character.id),
            window.api.listInventory(character.id),
          ]);
          setVerdictsById(new Map(vs.map((v) => [v.resourceId, v])));
          setInventoryById(new Map(inv.map((i) => [i.resourceId, i])));
        } else {
          setVerdictsById(new Map());
          setInventoryById(new Map());
        }
      } else {
        setResources([]);
        setVerdictsById(new Map());
        setInventoryById(new Map());
        setSbByResource(new Map());
      }
    } catch (e) {
      setError(String(e));
    }
  }, [character]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refetch verdicts whenever main signals a recompute. We refetch the
  // *whole* page because resource list may also have shifted (e.g. snapshot
  // refresh adds new spawns).
  useEffect(() => {
    if (!character) return;
    const unsub = window.api.onVerdictsUpdated((payload) => {
      if (payload.characterId === character.id) void load();
    });
    return unsub;
  }, [character, load]);

  async function refresh(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await window.api.refreshSnapshot();
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function toggleSort(key: SortKey): void {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      const isStat = (STAT_KEYS as readonly string[]).includes(key);
      setSortDir(isStat ? "desc" : "asc");
    }
  }

  // What primary chip category does each resource fall into? OWNED
  // supersedes verdict tier (an owned MAYBE is shown as OWNED, not MAYBE —
  // see D1A). UNLOCK is orthogonal — checked separately.
  function categoryFor(resourceId: string): VerdictFilter {
    if (inventoryById.has(resourceId)) return "OWNED";
    const v = verdictsById.get(resourceId);
    if (v?.tier === "CHASE") return "CHASE";
    if (v?.tier === "MAYBE") return "MAYBE";
    return "NONE";
  }

  const filtered = useMemo(() => {
    let list = resources;
    if (character) {
      // Apply chip filter only when there's a character (otherwise the
      // OWNED / verdict categories are meaningless). Filters are a UNION:
      // a row passes if it matches the active CHASE/MAYBE/OWNED/NONE
      // category OR (separately) if UNLOCK is toggled and the row has
      // unlocksAny=true. Lets a player toggle UNLOCK on/off independently
      // from "show only quality CHASE."
      list = list.filter((r) => {
        const v = verdictsById.get(r.id);
        const cat = categoryFor(r.id);
        const matchesCategory = activeFilters.has(cat);
        const matchesUnlock = activeFilters.has("UNLOCK") && v?.unlocksAny === true;
        return matchesCategory || matchesUnlock;
      });
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.typeDisplayName.toLowerCase().includes(q) ||
          r.typeId.toLowerCase().includes(q) ||
          r.groupId.toLowerCase().includes(q) ||
          r.planets.some((p) => p.toLowerCase().includes(q)),
      );
    }
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      list = [...list].sort((a, b) => {
        let av: string | number;
        let bv: string | number;
        if (sortKey === "name") {
          av = a.name;
          bv = b.name;
        } else if (sortKey === "type") {
          av = a.typeDisplayName;
          bv = b.typeDisplayName;
        } else if (sortKey === "group") {
          av = a.groupId;
          bv = b.groupId;
        } else if (sortKey === "verdict") {
          av = verdictSortValue(verdictsById.get(a.id), inventoryById.get(a.id));
          bv = verdictSortValue(verdictsById.get(b.id), inventoryById.get(b.id));
        } else {
          const aRaw = a.stats[sortKey];
          const bRaw = b.stats[sortKey];
          if (aRaw === null && bRaw === null) return 0;
          if (aRaw === null) return 1;
          if (bRaw === null) return -1;
          av = aRaw;
          bv = bRaw;
        }
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
    }
    return list;
  }, [resources, search, sortKey, sortDir, verdictsById, inventoryById, activeFilters, character]);

  const sortArrow = (key: SortKey): string => {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Current spawns</h2>
          <p className="text-xs text-slate-400 mt-0.5">SR2 resources from galaxyharvester.net</p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={busy}
          className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium"
        >
          {busy ? "Refreshing…" : latest ? "Refresh Now" : "Pull SR2 snapshot"}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-md border border-red-900 bg-red-950 text-red-200 text-sm">
          {error}
        </div>
      )}

      {resources.length === 0 && !busy && !error && (
        <p className="text-slate-400 mt-8">
          No snapshot yet. Click <strong className="text-slate-300">Pull SR2 snapshot</strong> to
          fetch the current spawn list.
        </p>
      )}

      {resources.length > 0 && (
        <>
          <div className="flex items-center gap-3 mb-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by name, type, group, or planet…"
              className="flex-1 max-w-md px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 focus:border-emerald-600 text-sm"
            />
            <span className="text-xs text-slate-400 tabular-nums">
              {search ? (
                <>
                  <span className="text-slate-300">{filtered.length}</span> of {resources.length}
                </>
              ) : (
                <>
                  <span className="text-slate-300">{resources.length}</span> resources
                </>
              )}
              {character && (verdictsById.size > 0 || inventoryById.size > 0) && (
                <>
                  {" · "}
                  <span className="text-emerald-300">
                    {Array.from(verdictsById.values()).filter(
                      (v) => v.tier === "CHASE" && !inventoryById.has(v.resourceId),
                    ).length}
                  </span>
                  {" CHASE / "}
                  <span className="text-yellow-300">
                    {Array.from(verdictsById.values()).filter(
                      (v) => v.unlocksAny && !inventoryById.has(v.resourceId),
                    ).length}
                  </span>
                  {" UNLOCK / "}
                  <span className="text-amber-300">
                    {Array.from(verdictsById.values()).filter(
                      (v) => v.tier === "MAYBE" && !inventoryById.has(v.resourceId),
                    ).length}
                  </span>
                  {" MAYBE / "}
                  <span className="text-cyan-300">{inventoryById.size}</span>
                  {" OWNED"}
                </>
              )}
              {sbByResource.size > 0 && (
                <>
                  {" · "}
                  <span className="text-yellow-300">
                    {
                      Array.from(sbByResource.values()).filter((flags) =>
                        flags.some((f) => f.tier === "SB_TOP"),
                      ).length
                    }
                  </span>
                  {" SB ★ / "}
                  <span className="text-yellow-400/70">
                    {
                      Array.from(sbByResource.values()).filter(
                        (flags) =>
                          !flags.some((f) => f.tier === "SB_TOP") &&
                          flags.some((f) => f.tier === "SB_NEAR"),
                      ).length
                    }
                  </span>
                  {" ☆"}
                </>
              )}
              {sortKey && (
                <>
                  {" · sorted by "}
                  <span className="text-slate-300">
                    {sortKey} {sortDir === "asc" ? "↑" : "↓"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSortKey(null)}
                    className="ml-2 text-slate-600 hover:text-slate-300"
                  >
                    clear
                  </button>
                </>
              )}
            </span>
          </div>

          {character && (
            <div className="flex items-center gap-2 mb-3 text-xs">
              <span className="text-slate-500">show:</span>
              {ALL_FILTERS.map((f) => {
                const on = activeFilters.has(f);
                const baseCls = on
                  ? f === "CHASE"
                    ? "bg-emerald-900/60 border-emerald-700 text-emerald-200"
                    : f === "UNLOCK"
                      ? "bg-yellow-900/50 border-yellow-700 text-yellow-200"
                      : f === "MAYBE"
                        ? "bg-amber-900/50 border-amber-700 text-amber-200"
                        : f === "OWNED"
                          ? "bg-cyan-900/40 border-cyan-700 text-cyan-200"
                          : "bg-slate-800 border-slate-700 text-slate-300"
                  : "bg-transparent border-slate-700 text-slate-500 hover:text-slate-300";
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => {
                      setActiveFilters((prev) => {
                        const next = new Set(prev);
                        if (next.has(f)) next.delete(f);
                        else next.add(f);
                        return next;
                      });
                    }}
                    className={`px-2 py-0.5 rounded-md border font-medium ${baseCls}`}
                  >
                    {f === "NONE" ? "no verdict" : f}
                  </button>
                );
              })}
              {activeFilters.size < ALL_FILTERS.length && (
                <button
                  type="button"
                  onClick={() => setActiveFilters(new Set(ALL_FILTERS))}
                  className="text-slate-500 hover:text-slate-300 ml-1"
                >
                  reset
                </button>
              )}
            </div>
          )}

          <div className="overflow-x-auto rounded-md border border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-slate-300 sticky top-0">
                <tr>
                  {character && (
                    <th
                      className="px-2 py-2 text-left font-medium cursor-pointer hover:bg-slate-800 select-none"
                      onClick={() => toggleSort("verdict")}
                      title="Your verdict for this resource"
                    >
                      Verdict{sortArrow("verdict")}
                    </th>
                  )}
                  <th
                    className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-slate-800 select-none"
                    onClick={() => toggleSort("name")}
                  >
                    Name{sortArrow("name")}
                  </th>
                  <th
                    className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-slate-800 select-none"
                    onClick={() => toggleSort("type")}
                  >
                    Type{sortArrow("type")}
                  </th>
                  <th
                    className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-slate-800 select-none"
                    onClick={() => toggleSort("group")}
                  >
                    Group{sortArrow("group")}
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Planets</th>
                  <th
                    className="px-2 py-2 text-left font-medium"
                    title="Server-best flags — rare/valuable across all professions, independent of your craft list"
                  >
                    SB
                  </th>
                  {STAT_KEYS.map((s) => (
                    <th
                      key={s}
                      className="px-2 py-2 text-right font-medium cursor-pointer hover:bg-slate-800 select-none"
                      onClick={() => toggleSort(s)}
                    >
                      {s}
                      {sortArrow(s)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5 + STAT_KEYS.length + (character ? 1 : 0)}
                      className="px-3 py-6 text-center text-slate-400"
                    >
                      No resources match <span className="text-slate-300">"{search}"</span>
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => {
                    const v = verdictsById.get(r.id);
                    const inv = inventoryById.get(r.id);
                    return (
                      <tr key={r.id} className="border-t border-slate-700 hover:bg-slate-800/50">
                        {character && (
                          <td className="px-2 py-2">
                            {/* OWNED supersedes verdict pill — Ryan's D1A: */}
                            {/* "already have this, but if nothing else can get */}
                            {/* more of it." */}
                            {/* UNLOCK is orthogonal — stacks below tier/owned. */}
                            <span className="inline-flex flex-col items-start gap-1">
                              {inv ? (
                                <OwnedTag entry={inv} />
                              ) : v ? (
                                <VerdictPill verdict={v} />
                              ) : !v?.unlocksAny ? (
                                <span className="text-slate-700">—</span>
                              ) : null}
                              {v && <UnlockBadge verdict={v} />}
                            </span>
                          </td>
                        )}
                        <td className="px-3 py-2 font-mono">
                          <Link
                            to={`/resources/${encodeURIComponent(r.id)}`}
                            className="text-slate-100 hover:text-emerald-300"
                          >
                            {r.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-slate-200">{r.typeDisplayName}</td>
                        <td className="px-3 py-2 text-slate-400 font-mono text-xs">{r.groupId}</td>
                        <td className="px-3 py-2 text-slate-400 text-xs">{r.planets.join(", ")}</td>
                        <td className="px-2 py-2">
                          <SbBadgeCluster flags={sbByResource.get(r.id) ?? []} />
                        </td>
                        {STAT_KEYS.map((s) => {
                          const stat = r.stats[s];
                          return (
                            <td key={s} className="px-2 py-2 text-right tabular-nums">
                              {stat === null ? (
                                <span className="text-slate-700">—</span>
                              ) : stat >= 900 ? (
                                <span className="text-emerald-400 font-semibold">{stat}</span>
                              ) : stat >= 800 ? (
                                <span className="text-emerald-200">{stat}</span>
                              ) : (
                                <span className="text-slate-300">{stat}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
