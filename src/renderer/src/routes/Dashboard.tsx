import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type {
  DashboardData,
  DashboardSbCard,
  DashboardSchematicReadiness,
  DashboardUnlockCard,
  DashboardVerdictCard,
} from "@shared/ipc-types";
import { PROFESSIONS } from "@shared/professions";
import { useActiveCharacter } from "../hooks/useActiveCharacter";

// Phase 9 — Dashboard.
//
// The design's §5.1 "killer organizing screen." Four lanes pulling Verdict +
// SB + Inventory into one home view:
//
//   Right Now      — top 5 CHASE-tier resources
//   On Watch       — top 10 MAYBE-tier resources
//   SB Collection  — top 10 SB-flagged resources for char's professions
//   Inventory Health — schematic readiness gauges + top-5 closest-to-ready
//
// Replaces /resources as the app's index route.

const TIER_COLOR: Record<string, string> = {
  CHASE: "bg-emerald-900/40 border-emerald-700 text-emerald-200",
  MAYBE: "bg-amber-900/40 border-amber-700 text-amber-200",
  SKIP: "bg-slate-800 border-slate-700 text-slate-400",
  SB_TOP: "bg-fuchsia-900/40 border-fuchsia-700 text-fuchsia-200",
  SB_NEAR: "bg-purple-900/40 border-purple-700 text-purple-200",
};

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

export function Dashboard(): JSX.Element {
  const { character } = useActiveCharacter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!character) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await window.api.fetchDashboard(character.id);
      setData(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [character]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-refresh dashboard when verdicts update (snapshot ingest, profession
  // priority change, active-list mutation).
  useEffect(() => {
    if (!character) return;
    const off = window.api.onVerdictsUpdated((payload) => {
      if (payload.characterId === character.id) void load();
    });
    return off;
  }, [character, load]);

  if (!character) {
    return (
      <div className="p-6 text-slate-400">
        No active character.{" "}
        <Link to="/character" className="text-emerald-400 hover:text-emerald-300">
          Create one
        </Link>{" "}
        to use the dashboard.
      </div>
    );
  }

  if (loading && !data) {
    return <div className="p-6 text-slate-400">Loading…</div>;
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="p-3 rounded-md border border-red-900 bg-red-950 text-red-200 text-sm">
          {error}
        </div>
      </div>
    );
  }

  if (!data) return <div className="p-6 text-slate-400">No data.</div>;

  const isNewPlayer =
    data.inventoryHealth.liveInventoryCount < 5 && data.rightNow.length === 0;
  const noActiveSchematics = data.inventoryHealth.activeSchematicCount === 0;
  const noSnapshot = data.snapshotFetchedAt === null;

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">
            {data.characterName}'s dashboard
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Galaxy {data.galaxyId}
            {data.snapshotFetchedAt && (
              <>
                {" · "}
                <span title={new Date(data.snapshotFetchedAt).toLocaleString()}>
                  snapshot {relativeAge(data.snapshotFetchedAt)}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="text-xs text-slate-500">
          {data.rightNow.length} CHASE · {data.unlocksNeeded.length} UNLOCK ·{" "}
          {data.onWatch.length} MAYBE · {data.sbCollection.length} SB ·{" "}
          {data.inventoryHealth.craftableNow}/{data.inventoryHealth.activeSchematicCount} craftable
        </div>
      </header>

      {isNewPlayer && (
        <div className="mb-6 p-4 rounded-md border border-cyan-800 bg-cyan-950/30 text-cyan-200 text-sm">
          <strong className="font-semibold block mb-2">
            Welcome to GalaxyCrafter
            {data.characterName ? `, ${data.characterName}` : ""}.
          </strong>
          <p className="mb-2 leading-relaxed">
            Nothing's on this dashboard yet because the app doesn't know what you
            craft, what you own, or what's currently spawning. Three quick steps:
          </p>
          <ol className="list-decimal list-inside space-y-1 mb-2 leading-relaxed">
            {noActiveSchematics && (
              <li>
                <Link to="/schematics" className="underline hover:text-cyan-100">
                  Browse Schematics
                </Link>{" "}
                and add the recipes you actually craft to your Active list.
                Sub-components inherit automatically.
              </li>
            )}
            {noSnapshot && (
              <li>
                <Link to="/resources" className="underline hover:text-cyan-100">
                  Open Resources
                </Link>{" "}
                and click <strong>Refresh</strong> to pull SR2's current resource
                snapshot from GalaxyHarvester.
              </li>
            )}
            <li>
              (Optional)
              {" "}
              <Link to="/inventory" className="underline hover:text-cyan-100">
                List what you own
              </Link>{" "}
              on the Crates tab — verdicts will switch to "is this an upgrade over
              what I have?" scoring once you do.
            </li>
            <li>
              Brand-new character with 10 free lots? The{" "}
              <Link to="/planner" className="underline hover:text-cyan-100">
                Harvester Planner
              </Link>{" "}
              picks your first 10 deployments.
            </li>
          </ol>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
        <Lane
          title="Right Now"
          subtitle={`${data.rightNow.length} CHASE-tier`}
          empty="No CHASE resources on the latest snapshot."
        >
          {data.rightNow.map((c) => (
            <VerdictCard key={c.resourceId} card={c} />
          ))}
        </Lane>

        {/* v0.1.6 UNLOCK lane — stockpile-builder spawns for slots you don't
            yet cover. Quality is secondary here; "doesn't matter if it
            sucks, it's my first." Sits next to Right Now because UNLOCK +
            CHASE is the strictly-best card (top of the priority order). */}
        <Lane
          title="Unlocks needed"
          subtitle={
            data.unlocksNeeded.length === 0
              ? "all slots covered"
              : `${data.unlocksNeeded.length} stockpile builder${data.unlocksNeeded.length === 1 ? "" : "s"}`
          }
          empty="All your tracked schematics have at least one covering resource (live or reserved). Despawned-only stashes still trigger UNLOCK when a fresh spawn appears."
        >
          {data.unlocksNeeded.map((c) => (
            <UnlockCard key={c.resourceId} card={c} />
          ))}
        </Lane>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
        <Lane
          title="On Watch"
          subtitle={`${data.onWatch.length} MAYBE-tier`}
          empty="No MAYBE resources on the latest snapshot."
        >
          {data.onWatch.map((c) => (
            <VerdictCard key={c.resourceId} card={c} compact />
          ))}
        </Lane>

        <Lane
          title="SB Collection"
          subtitle={`${data.sbCollection.length} flagged for your profession`}
          empty="No Server-Best resources for your profession on this snapshot."
        >
          {data.sbCollection.map((c) => (
            <SbCard key={c.resourceId} card={c} />
          ))}
        </Lane>
      </div>

      <InventoryHealthPanel
        data={data.inventoryHealth}
        characterId={character.id}
      />
    </div>
  );
}

function Lane({
  title,
  subtitle,
  empty,
  children,
}: {
  title: string;
  subtitle: string;
  empty: string;
  children: React.ReactNode;
}): JSX.Element {
  const childArray = Array.isArray(children) ? children : [children];
  const hasChildren = childArray.some((c) => c !== null && c !== undefined && c !== false);

  return (
    <div className="rounded-md border border-slate-700 bg-slate-900 flex flex-col min-h-0">
      <div className="px-3 py-2 border-b border-slate-800 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
        <span className="text-[11px] text-slate-500">{subtitle}</span>
      </div>
      <div className="p-2 space-y-2 overflow-y-auto">
        {hasChildren ? children : <p className="text-xs text-slate-500 p-2">{empty}</p>}
      </div>
    </div>
  );
}

function VerdictCard({
  card,
  compact = false,
}: {
  card: DashboardVerdictCard;
  compact?: boolean;
}): JSX.Element {
  return (
    <Link
      to={`/resources/${card.resourceId}`}
      className="block rounded-md border border-slate-700 bg-slate-950 hover:border-emerald-700 transition-colors p-2"
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-sm text-emerald-300 font-medium truncate">
          {card.resourceName}
        </span>
        <span
          className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${TIER_COLOR[card.tier]}`}
        >
          {Math.round(card.topScore)}
        </span>
      </div>
      <div className="text-[11px] text-slate-400 truncate mb-1">
        {card.typeDisplayName}
        {card.owned && <span className="ml-1 text-cyan-400">· owned</span>}
      </div>
      {!compact && (
        <div className="flex items-center gap-2 mb-1">
          {card.topStats.map((s) => (
            <StatBar key={s.stat} stat={s.stat} value={s.value} />
          ))}
        </div>
      )}
      {compact && card.topStats.length > 0 && (
        <div className="text-[11px] text-slate-300 mb-1 font-mono">
          {card.topStats.map((s) => `${s.stat} ${s.value}`).join(" · ")}
        </div>
      )}
      <div className="text-[10px] text-slate-500 truncate" title={card.reason}>
        {card.reason}
      </div>
      <div className="text-[10px] text-slate-600 mt-0.5 truncate">
        {card.planets.join(", ")}
      </div>
    </Link>
  );
}

function UnlockCard({ card }: { card: DashboardUnlockCard }): JSX.Element {
  // Yellow / amber family — distinct from emerald CHASE and purple SB.
  // The badge cluster shows tier (CHASE/MAYBE/SKIP for context, optional)
  // alongside the prominent UNLOCK marker. Tooltip lists the schematic+slot
  // tuples this resource would cover.
  const tierColor = TIER_COLOR[card.tier] ?? TIER_COLOR.SKIP;
  return (
    <Link
      to={`/resources/${card.resourceId}`}
      className="block rounded-md border border-yellow-900/60 bg-yellow-950/10 hover:border-yellow-700 transition-colors p-2"
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-sm text-yellow-200 font-medium truncate">
          {card.resourceName}
        </span>
        <span className="px-1.5 py-0.5 rounded border text-[10px] font-mono bg-yellow-900/50 border-yellow-700 text-yellow-200">
          UNLOCK ×{card.unlocksCount}
        </span>
      </div>
      <div className="text-[11px] text-slate-400 truncate mb-1">
        {card.typeDisplayName}
        <span
          className={`ml-2 px-1 py-0.5 rounded border text-[9px] font-mono ${tierColor}`}
        >
          {card.tier} {Math.round(card.topScore)}
        </span>
      </div>
      {card.topStats.length > 0 && (
        <div className="text-[11px] text-slate-300 mb-1 font-mono">
          {card.topStats.map((s) => `${s.stat} ${s.value}`).join(" · ")}
        </div>
      )}
      <div
        className="text-[10px] text-yellow-300/80 truncate"
        title={card.unlocksPreview
          .map((u) => `${u.schematicName} — ${u.slotName}`)
          .join("\n")}
      >
        {card.unlocksPreview.length > 0 ? (
          <>
            unlocks: {card.unlocksPreview.map((u) => u.schematicName).join(", ")}
            {card.unlocksCount > card.unlocksPreview.length &&
              ` + ${card.unlocksCount - card.unlocksPreview.length} more`}
          </>
        ) : (
          <>— uncovered slots —</>
        )}
      </div>
      <div className="text-[10px] text-slate-600 mt-0.5 truncate">
        {card.planets.join(", ")}
      </div>
    </Link>
  );
}

function SbCard({ card }: { card: DashboardSbCard }): JSX.Element {
  const def = PROFESSIONS.find((p) => p.id === card.forProfession);
  return (
    <Link
      to={`/resources/${card.resourceId}`}
      className="block rounded-md border border-slate-700 bg-slate-950 hover:border-purple-700 transition-colors p-2"
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-sm text-purple-300 font-medium truncate">
          {card.resourceName}
        </span>
        <span
          className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${TIER_COLOR[card.sbTier]}`}
        >
          {card.sbTier === "SB_TOP" ? "★" : "☆"} {Math.round(card.score)}
        </span>
      </div>
      <div className="text-[11px] text-slate-400 truncate mb-1">
        {card.typeDisplayName}
        {card.owned && <span className="ml-1 text-cyan-400">· owned</span>}
      </div>
      <div className="flex items-center gap-2 mb-1">
        {card.topStats.map((s) => (
          <StatBar key={s.stat} stat={s.stat} value={s.value} />
        ))}
      </div>
      <div className="text-[10px] text-slate-500 truncate">
        {def?.name ?? card.forProfession}
        {card.professionTier !== "primary" && card.professionTier === "secondary" && (
          <span className="text-slate-600"> · secondary</span>
        )}
      </div>
      <div className="text-[10px] text-slate-600 mt-0.5 truncate">
        {card.planets.join(", ")}
      </div>
    </Link>
  );
}

/** Tiny progress bar for a single stat. Universal 0-1000 scale per the
 * verdict engine. */
function StatBar({ stat, value }: { stat: string; value: number }): JSX.Element {
  const pct = Math.max(0, Math.min(100, (value / 1000) * 100));
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-baseline justify-between text-[10px] font-mono">
        <span className="text-slate-500">{stat}</span>
        <span className="text-slate-300 tabular-nums">{value}</span>
      </div>
      <div className="h-1 rounded-full bg-slate-800 overflow-hidden">
        <div
          className="h-full bg-emerald-700"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function InventoryHealthPanel({
  data,
  characterId: _characterId,
}: {
  data: DashboardData["inventoryHealth"];
  characterId: string;
}): JSX.Element {
  const readinessPct =
    data.activeSchematicCount > 0
      ? (data.craftableNow / data.activeSchematicCount) * 100
      : 0;

  return (
    <div className="rounded-md border border-slate-700 bg-slate-900">
      <div className="px-3 py-2 border-b border-slate-800 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-slate-100">Inventory health</h3>
        <span className="text-[11px] text-slate-500">
          Counts which active schematics could be crafted from your current{" "}
          <Link to="/inventory" className="underline hover:text-slate-300">
            Crates
          </Link>
        </span>
      </div>
      <div className="p-3 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        <div className="space-y-2">
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-xs text-slate-400">Schematic readiness</span>
              <span className="text-xs text-slate-200 tabular-nums">
                {data.craftableNow} / {data.activeSchematicCount}
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-emerald-700"
                style={{ width: `${readinessPct}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-600 mt-1 leading-tight">
              Slot-fit check — does at least one live inventory resource fit each
              raw slot? (Doesn't yet check units-on-hand.)
            </p>
          </div>
          <div className="pt-2 border-t border-slate-800">
            <div className="text-xs text-slate-400 mb-1">Live inventory</div>
            <div className="text-xl text-slate-100 font-medium tabular-nums">
              {data.liveInventoryCount}
            </div>
            <p className="text-[10px] text-slate-600 leading-tight">
              Resources currently spawning that you have in your Crates.
            </p>
          </div>
        </div>

        <SchematicReadinessList rows={data.topSchematics} />
      </div>
    </div>
  );
}

function SchematicReadinessList({
  rows,
}: {
  rows: DashboardSchematicReadiness[];
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [limit, setLimit] = useState(5);

  const total = rows.length;
  const shownRows = expanded ? rows.slice(0, limit) : rows.slice(0, 5);

  // Step limits: 5 -> 10 -> 25 -> all. Stops cleanly at total.
  function nextLimit(): number {
    if (!expanded) return 10;
    if (limit === 10 && total > 10) return 25;
    if (limit === 25 && total > 25) return total;
    return total;
  }
  function showMore(): void {
    if (!expanded) {
      setExpanded(true);
      setLimit(10);
    } else {
      setLimit(nextLimit());
    }
  }
  function collapse(): void {
    setExpanded(false);
    setLimit(5);
  }

  const hasMore = total > shownRows.length;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h4 className="text-xs font-medium text-slate-300">
          {expanded
            ? `Top ${shownRows.length} closest to craftable`
            : "Top 5 closest to craftable"}
        </h4>
        <span className="text-[10px] text-slate-500">
          {total} active schematic{total === 1 ? "" : "s"} with raw slots
        </span>
      </div>
      {rows.length === 0 && (
        <p className="text-xs text-slate-500">
          No active schematics with raw slots.{" "}
          <Link
            to="/schematics"
            className="underline text-emerald-400 hover:text-emerald-300"
          >
            Add some
          </Link>
          .
        </p>
      )}
      {shownRows.map((s) => (
        <SchematicReadinessRow key={s.schematicId} row={s} />
      ))}
      {(hasMore || expanded) && (
        <div className="flex items-center gap-2 mt-3 pt-2 border-t border-slate-800">
          {hasMore && (
            <button
              type="button"
              onClick={showMore}
              className="px-2.5 py-1 rounded border border-slate-700 text-xs text-slate-300 hover:border-emerald-700 hover:text-emerald-300"
            >
              {!expanded && "Show 10"}
              {expanded && limit === 10 && total > 10 && `Show 25`}
              {expanded && limit === 25 && total > 25 && `Show all (${total})`}
              {expanded && limit > 25 && limit < total && `Show all (${total})`}
            </button>
          )}
          {expanded && (
            <button
              type="button"
              onClick={collapse}
              className="px-2.5 py-1 rounded border border-slate-700 text-xs text-slate-400 hover:border-slate-600 hover:text-slate-200"
            >
              Show top 5
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SchematicReadinessRow({
  row,
}: {
  row: DashboardSchematicReadiness;
}): JSX.Element {
  const ratio = row.totalSlots > 0 ? row.filledSlots / row.totalSlots : 0;
  const profession = PROFESSIONS.find((p) => p.id === row.profession);

  return (
    <div className="py-1.5 border-b border-slate-800 last:border-b-0">
      <div className="flex items-baseline justify-between gap-2">
        <Link
          to={`/schematics/${row.schematicId}`}
          className="text-sm text-emerald-400 hover:text-emerald-300 truncate flex-1"
        >
          {row.schematicName}
        </Link>
        <span
          className={`text-xs tabular-nums ${
            row.craftableNow ? "text-emerald-300 font-medium" : "text-slate-400"
          }`}
        >
          {row.filledSlots}/{row.totalSlots}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        <div className="flex-1 h-1 rounded-full bg-slate-800 overflow-hidden">
          <div
            className={`h-full ${
              row.craftableNow ? "bg-emerald-700" : "bg-amber-700"
            }`}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
        <span className="text-[10px] text-slate-500 w-24 truncate">
          {profession?.name ?? "—"}
        </span>
      </div>
      {!row.craftableNow && row.missingSlots.length > 0 && (
        <div
          className="text-[10px] text-slate-500 mt-1 leading-tight truncate"
          title={row.missingSlots
            .map((m) => `${m.slotName}: needs ${m.unitsRequired}u ${m.ingredientObject}`)
            .join("\n")}
        >
          missing:{" "}
          {row.missingSlots
            .slice(0, 3)
            .map((m) => m.ingredientObject)
            .join(", ")}
          {row.missingSlots.length > 3 && ` +${row.missingSlots.length - 3} more`}
        </div>
      )}
    </div>
  );
}
