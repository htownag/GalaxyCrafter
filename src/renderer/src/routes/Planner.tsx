import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  HarvesterBucket,
  PlannerRecommendation,
  PlannerResult,
} from "@shared/ipc-types";
import { PROFESSIONS } from "@shared/professions";
import { useActiveCharacter } from "../hooks/useActiveCharacter";

// Phase 7 — New-player harvester planner.
//
// One question: "you have N lot slots, what should you put on them right now?"
// Output: ranked list of (resource × planet × harvester size) recommendations
// driven by the verdict engine (or SB-flag fallback when active list is empty).

const BUCKET_COLOR: Record<HarvesterBucket, string> = {
  mineral: "bg-amber-900/40 border-amber-700 text-amber-200",
  chemical: "bg-cyan-900/40 border-cyan-700 text-cyan-200",
  energy: "bg-purple-900/40 border-purple-700 text-purple-200",
};

const BUCKET_LABEL: Record<HarvesterBucket, string> = {
  mineral: "Mineral",
  chemical: "Chemical",
  energy: "Energy",
};

const SIZE_BADGE: Record<string, string> = {
  personal: "P",
  medium: "M",
  heavy: "H",
};

export function Planner(): JSX.Element {
  const { character } = useActiveCharacter();

  const [lotsAvailable, setLotsAvailable] = useState(10);
  const [planetBias, setPlanetBias] = useState<string>("any");
  const [diversity, setDiversity] = useState(true);
  const [includeSbLane, setIncludeSbLane] = useState(false);
  const [buildPowerReserves, setBuildPowerReserves] = useState(false);
  const [result, setResult] = useState<PlannerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!character) return;
    setLoading(true);
    setError(null);
    try {
      const res = await window.api.recommendHarvesters({
        characterId: character.id,
        lotsAvailable,
        planetBias: planetBias === "any" ? undefined : planetBias,
        diversity,
        includeSbLane,
        buildPowerReserves,
      });
      setResult(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [character, lotsAvailable, planetBias, diversity, includeSbLane, buildPowerReserves]);

  // 250ms debounce on input changes so the page feels live without thrashing.
  useEffect(() => {
    const t = setTimeout(() => {
      void run();
    }, 250);
    return () => clearTimeout(t);
  }, [run]);

  if (!character) {
    return (
      <div className="p-6 text-slate-400">
        No active character.{" "}
        <Link to="/character" className="text-emerald-400 hover:text-emerald-300">
          Create one
        </Link>{" "}
        to use the planner.
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-100">Harvester planner</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Pick the top {lotsAvailable} harvest deployments for {character.name} on this snapshot.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-md border border-red-900 bg-red-950 text-red-200 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* Left pane: inputs */}
        <div className="space-y-4">
          <InputCard title="Lots available for harvesters" hint="Max 10 (SWG lot rule). Lower this if some lots are used for houses, factories, or vendors.">
            <input
              type="number"
              min={0}
              max={10}
              value={lotsAvailable}
              onChange={(e) =>
                setLotsAvailable(Math.max(0, Math.min(10, Number(e.target.value) || 0)))
              }
              className="w-20 px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-100 text-sm"
            />
          </InputCard>

          <InputCard title="Planet bias" hint="Limit recommendations to one planet if you've committed to a home base.">
            <PlanetSelect value={planetBias} onChange={setPlanetBias} result={result} />
          </InputCard>

          <InputCard title="Options">
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={diversity}
                onChange={(e) => setDiversity(e.target.checked)}
                className="rounded border-slate-600 bg-slate-800"
              />
              Bucket diversity (max 60% per bucket)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer mt-2">
              <input
                type="checkbox"
                checked={includeSbLane}
                onChange={(e) => setIncludeSbLane(e.target.checked)}
                disabled={buildPowerReserves}
                className="rounded border-slate-600 bg-slate-800 disabled:opacity-40"
              />
              <span className={buildPowerReserves ? "opacity-40" : ""}>
                Include market-value flagged resources
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer mt-2 pt-2 border-t border-slate-800">
              <input
                type="checkbox"
                checked={buildPowerReserves}
                onChange={(e) => setBuildPowerReserves(e.target.checked)}
                className="rounded border-slate-600 bg-slate-800"
              />
              Build power reserves (rank by PE)
            </label>
            <p className="text-[11px] text-slate-500 mt-1 ml-6 leading-tight">
              Surfaces high-Potential-Energy resources for fueling power generators
              (radioactives, petrochem fuels, solar/wind). Overrides profession scoring.
            </p>
          </InputCard>

          {result && (
            <InputCard title="Summary">
              <div className="space-y-1 text-xs text-slate-300">
                <div>
                  <span className="text-slate-500">Used:</span>{" "}
                  <span className="tabular-nums text-slate-100">
                    {result.summary.lotsUsed} / {lotsAvailable} lots
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Projected value:</span>{" "}
                  <span className="tabular-nums text-slate-100">
                    {Math.round(result.summary.totalDeploymentValue).toLocaleString()}
                  </span>
                </div>
                <div className="pt-1">
                  <span className="text-slate-500">Bucket split:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(["mineral", "chemical", "energy"] as HarvesterBucket[]).map(
                      (b) =>
                        result.summary.bucketBreakdown[b] > 0 && (
                          <span
                            key={b}
                            className={`px-2 py-0.5 rounded border text-[11px] ${BUCKET_COLOR[b]}`}
                          >
                            {BUCKET_LABEL[b]} {result.summary.bucketBreakdown[b]}
                          </span>
                        ),
                    )}
                  </div>
                </div>
              </div>
            </InputCard>
          )}

          <InputCard title="Profession context">
            <div className="text-xs text-slate-300 space-y-1">
              <ProfessionList label="Primary" ids={result?.characterProfessions.primary ?? []} />
              <ProfessionList label="Secondary" ids={result?.characterProfessions.secondary ?? []} />
              <Link
                to="/character"
                className="block text-emerald-400 hover:text-emerald-300 mt-2"
              >
                Edit professions →
              </Link>
            </div>
          </InputCard>
        </div>

        {/* Right pane: recommendations */}
        <div>
          {result?.fallbackMode === "no-active-schematics" && (
            <div className="mb-4 p-3 rounded-md border border-amber-800 bg-amber-950/30 text-amber-200 text-sm">
              <strong className="font-semibold">No active schematics.</strong> The planner is using{" "}
              <em>current chase resources</em> for your profession (Server-Best lane). For tighter
              recommendations,{" "}
              <Link to="/schematics" className="underline hover:text-amber-100">
                add the schematics you craft
              </Link>
              .
            </div>
          )}

          {result?.fallbackMode === "power-reserves" && (
            <div className="mb-4 p-3 rounded-md border border-purple-800 bg-purple-950/30 text-purple-200 text-sm">
              <strong className="font-semibold">Power-reserves mode.</strong> Ranked by PE
              (Potential Energy) instead of profession scoring. Pick a Heavy Mineral Extractor on
              radioactives, Heavy Chemical Extractor on petrochem fuels, or Solar/Wind Generator on
              high-PE energy spawns — these resources feed your fusion / photo-bio generators or
              run wind/solar power directly.
            </div>
          )}

          {loading && !result && <p className="text-slate-400">Loading…</p>}

          {result && result.recommendations.length === 0 && !loading && (
            <p className="text-slate-400">
              No recommendations. Either no resources scored above 0 for your profession on this
              snapshot, or no spawning resources have concentration &gt; 50% on the planets searched.
              Try toggling planet bias or the SB-lane option.
            </p>
          )}

          {result && result.recommendations.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-800 text-slate-300">
                  <tr>
                    <th className="px-2 py-2 text-right font-medium w-10">#</th>
                    <th className="px-2 py-2 text-left font-medium w-12">Size</th>
                    <th className="px-2 py-2 text-left font-medium">Resource</th>
                    <th className="px-2 py-2 text-left font-medium">Bucket</th>
                    <th className="px-2 py-2 text-left font-medium">Planet</th>
                    <th className="px-2 py-2 text-right font-medium">Conc.</th>
                    <th className="px-2 py-2 text-right font-medium">Score</th>
                    <th className="px-2 py-2 text-right font-medium">Est. daily</th>
                  </tr>
                </thead>
                <tbody>
                  {result.recommendations.map((r) => (
                    <PlannerRow key={`${r.resourceId}-${r.planet}`} row={r} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-6 text-[11px] text-slate-600">
            Recommendations refresh on the next resource snapshot. Run Resources → Refresh to update.
          </p>
        </div>
      </div>
    </div>
  );
}

function PlannerRow({ row }: { row: PlannerRecommendation }): JSX.Element {
  return (
    <tr className="border-t border-slate-700 hover:bg-slate-900/50">
      <td className="px-2 py-1.5 text-right text-slate-500 tabular-nums">{row.rank}</td>
      <td className="px-2 py-1.5">
        <span className="inline-flex w-6 h-6 items-center justify-center rounded border border-slate-700 bg-slate-800 text-slate-200 font-mono text-xs">
          {SIZE_BADGE[row.size] ?? "?"}
        </span>
      </td>
      <td className="px-2 py-1.5">
        <Link
          to={`/resources/${row.resourceId}`}
          className="text-emerald-400 hover:text-emerald-300"
        >
          {row.resourceName}
        </Link>
      </td>
      <td className="px-2 py-1.5">
        <span
          className={`px-2 py-0.5 rounded border text-[11px] ${BUCKET_COLOR[row.bucket]}`}
        >
          {BUCKET_LABEL[row.bucket]}
        </span>
      </td>
      <td className="px-2 py-1.5 text-slate-300 capitalize">{row.planet}</td>
      <td className="px-2 py-1.5 text-right text-slate-300 tabular-nums">
        {row.concentrationPct}%
      </td>
      <td className="px-2 py-1.5 text-right text-slate-100 tabular-nums">
        {Math.round(row.resourceScore)}
      </td>
      <td className="px-2 py-1.5 text-right text-slate-400 tabular-nums">
        {Math.round(row.estDailyYield).toLocaleString()}
      </td>
    </tr>
  );
}

function InputCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="rounded-md border border-slate-700 bg-slate-900 p-3">
      <h3 className="text-xs font-medium text-slate-300 mb-2">{title}</h3>
      {children}
      {hint && <p className="text-[11px] text-slate-500 mt-2 leading-tight">{hint}</p>}
    </div>
  );
}

function ProfessionList({ label, ids }: { label: string; ids: string[] }): JSX.Element {
  if (ids.length === 0) {
    return (
      <div>
        <span className="text-slate-500">{label}:</span>{" "}
        <span className="text-slate-600">— none —</span>
      </div>
    );
  }
  return (
    <div>
      <span className="text-slate-500">{label}:</span>{" "}
      <span className="text-slate-200">
        {ids
          .map((id) => PROFESSIONS.find((p) => p.id === id)?.name ?? id)
          .join(", ")}
      </span>
    </div>
  );
}

function PlanetSelect({
  value,
  onChange,
  result,
}: {
  value: string;
  onChange: (v: string) => void;
  result: PlannerResult | null;
}): JSX.Element {
  // Build the dropdown options from whatever planets appear in the current
  // recommendation list — plus the always-available "any" sentinel. Keeps
  // the planner from offering planets that don't actually have any candidates.
  const planets = useMemo(() => {
    const set = new Set<string>();
    for (const r of result?.recommendations ?? []) set.add(r.planet);
    return Array.from(set).sort();
  }, [result]);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-100 text-sm capitalize"
    >
      <option value="any">Any planet</option>
      {planets.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </select>
  );
}
