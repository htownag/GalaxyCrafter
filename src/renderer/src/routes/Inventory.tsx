import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { InventoryEntry, InventoryStatus, Resource } from "@shared/ipc-types";
import { useActiveCharacter } from "../hooks/useActiveCharacter";

const STATUS_OPTIONS: InventoryStatus[] = ["live", "banked", "reserved"];

const STATUS_PILL: Record<InventoryStatus, string> = {
  live: "bg-emerald-900/40 border-emerald-700 text-emerald-200",
  banked: "bg-slate-800 border-slate-700 text-slate-300",
  reserved: "bg-amber-900/40 border-amber-700 text-amber-200",
};

const STATUS_HELP: Record<InventoryStatus, string> = {
  live: "still spawning — harvesters can keep extracting",
  banked: "despawned — what's in your crate is all you'll ever have",
  reserved: "earmarked for a specific schematic build",
};

function relativeAge(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return "future";
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// Small Add-Resource form. Searches the current snapshot by name/type;
// click a result to lock in the resource, then enter units + status +
// optional notes and Add.
function AddResourcePanel({
  characterId,
  snapshotResources,
  onAdded,
  existingIds,
}: {
  characterId: string;
  snapshotResources: Resource[];
  onAdded: () => void;
  existingIds: Set<string>;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Resource | null>(null);
  const [units, setUnits] = useState("");
  const [status, setStatus] = useState<InventoryStatus>("live");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter snapshot by query. Type 2+ chars to populate; cap at 12 results
  // to keep the dropdown one-glance-readable.
  const matches = useMemo(() => {
    if (query.trim().length < 2) return [];
    const q = query.trim().toLowerCase();
    return snapshotResources
      .filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.typeDisplayName.toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [query, snapshotResources]);

  function reset(): void {
    setQuery("");
    setPicked(null);
    setUnits("");
    setStatus("live");
    setNotes("");
    setError(null);
  }

  async function submit(): Promise<void> {
    if (!picked) {
      setError("Pick a resource first.");
      return;
    }
    const n = Number.parseInt(units, 10);
    if (!Number.isFinite(n) || n < 0) {
      setError("Units must be a non-negative integer.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await window.api.upsertInventory({
        characterId,
        resourceId: picked.id,
        units: n,
        status,
        notes: notes.trim() || null,
      });
      reset();
      onAdded();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-slate-700 bg-slate-900 p-4 mb-6">
      <h3 className="text-sm font-medium text-slate-300 mb-3">Add a resource</h3>

      {picked ? (
        <div className="flex items-center gap-3 mb-3 px-3 py-2 rounded-md bg-slate-800 border border-slate-700">
          <div className="flex-1">
            <div className="font-mono text-slate-100">{picked.name}</div>
            <div className="text-xs text-slate-400">{picked.typeDisplayName}</div>
            <div className="text-[10px] text-slate-600">
              {picked.planets.length > 0 ? picked.planets.join(", ") : "no planets in snapshot"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPicked(null)}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            change
          </button>
        </div>
      ) : (
        <div className="relative mb-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type ≥2 chars of a resource name or type… (e.g. 'aaku' or 'steel')"
            className="w-full px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 focus:border-emerald-600 text-sm"
          />
          {matches.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 rounded-md border border-slate-700 bg-slate-900 shadow-lg max-h-72 overflow-y-auto">
              {matches.map((r) => {
                const already = existingIds.has(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    disabled={already}
                    onClick={() => {
                      setPicked(r);
                      setQuery("");
                    }}
                    className={`w-full text-left px-3 py-2 border-b border-slate-800 last:border-b-0 ${
                      already
                        ? "opacity-50 cursor-not-allowed"
                        : "hover:bg-slate-800 cursor-pointer"
                    }`}
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-slate-100 text-sm">{r.name}</span>
                      <span className="text-xs text-slate-400 ml-3">{r.typeDisplayName}</span>
                    </div>
                    <div className="text-[10px] text-slate-600 mt-0.5">
                      {r.planets.join(", ") || "—"}
                      {already && (
                        <span className="ml-2 text-amber-400">— already in inventory</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {query.trim().length >= 2 && matches.length === 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-500">
              No matches in current snapshot. (The resource may have despawned — record it as
              `banked` once we add free-form entry. For now, only currently-spawning resources can
              be added.)
            </div>
          )}
        </div>
      )}

      <div className="flex items-end gap-3 mb-3">
        <div>
          <label htmlFor="inv-units" className="block text-xs text-slate-400 mb-1">
            Units
          </label>
          <input
            id="inv-units"
            type="number"
            min={0}
            step={1}
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            placeholder="0"
            className="w-32 px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 focus:border-emerald-600 text-sm tabular-nums"
          />
        </div>
        <div>
          <label htmlFor="inv-status" className="block text-xs text-slate-400 mb-1">
            Status
          </label>
          <select
            id="inv-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as InventoryStatus)}
            className="px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-slate-100 text-sm"
            title={STATUS_HELP[status]}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label htmlFor="inv-notes" className="block text-xs text-slate-400 mb-1">
            Notes (optional)
          </label>
          <input
            id="inv-notes"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="where it's stashed, or what build it's earmarked for"
            className="w-full px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 focus:border-emerald-600 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !picked}
          className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm"
        >
          {busy ? "…" : "Add"}
        </button>
      </div>

      {error && <div className="text-xs text-red-300">{error}</div>}
    </div>
  );
}

// Per-row inline editor. Tracks dirty state vs the loaded entry so Save
// is gated on actual changes.
function InventoryRow({
  entry,
  characterId,
  onChanged,
}: {
  entry: InventoryEntry;
  characterId: string;
  onChanged: () => void;
}): JSX.Element {
  const [units, setUnits] = useState(String(entry.units));
  const [status, setStatus] = useState<InventoryStatus>(entry.status);
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset local state if the underlying entry changes from outside (e.g.
  // after a save round-trip with new updatedAt). Compare on stable keys.
  useEffect(() => {
    setUnits(String(entry.units));
    setStatus(entry.status);
    setNotes(entry.notes ?? "");
  }, [entry.units, entry.status, entry.notes]);

  const dirty =
    units !== String(entry.units) || status !== entry.status || notes !== (entry.notes ?? "");

  async function save(): Promise<void> {
    const n = Number.parseInt(units, 10);
    if (!Number.isFinite(n) || n < 0) {
      setError("invalid units");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await window.api.upsertInventory({
        characterId,
        resourceId: entry.resourceId,
        units: n,
        status,
        notes: notes.trim() || null,
      });
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await window.api.removeInventory(characterId, entry.resourceId);
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-t border-slate-700">
      <td className="px-3 py-2">
        <Link
          to={`/resources/${encodeURIComponent(entry.resourceId)}`}
          className="text-emerald-400 hover:text-emerald-300 font-mono"
        >
          {entry.resourceName}
        </Link>
        <div className="text-[10px] text-slate-500">{entry.typeDisplayName}</div>
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min={0}
          step={1}
          value={units}
          onChange={(e) => setUnits(e.target.value)}
          className="w-28 px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-100 text-sm tabular-nums text-right focus:outline-none focus:ring-1 focus:ring-emerald-600 focus:border-emerald-600"
        />
      </td>
      <td className="px-3 py-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as InventoryStatus)}
          className={`px-2 py-1 rounded border text-xs font-medium ${STATUS_PILL[status]}`}
          title={STATUS_HELP[status]}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s} className="bg-slate-900 text-slate-100">
              {s}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="—"
          className="w-full min-w-[16rem] px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-200 text-xs placeholder:text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-600 focus:border-emerald-600"
        />
      </td>
      <td
        className="px-3 py-2 text-xs text-slate-500 tabular-nums"
        title={new Date(entry.updatedAt).toLocaleString()}
      >
        {relativeAge(entry.updatedAt)}
      </td>
      <td className="px-3 py-2 w-0 whitespace-nowrap">
        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty}
          className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed text-white"
        >
          {busy ? "…" : "save"}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="ml-2 text-xs text-slate-400 hover:text-red-400 disabled:opacity-30"
        >
          remove
        </button>
        {error && <div className="text-[10px] text-red-300 mt-1">{error}</div>}
      </td>
    </tr>
  );
}

export function Inventory(): JSX.Element {
  const { character } = useActiveCharacter();
  const [entries, setEntries] = useState<InventoryEntry[]>([]);
  const [snapshotResources, setSnapshotResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!character) {
      setEntries([]);
      setSnapshotResources([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [inv, snap] = await Promise.all([
      window.api.listInventory(character.id),
      window.api.listResources(),
    ]);
    setEntries(inv);
    setSnapshotResources(snap);
    setLoading(false);
  }, [character]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!character) {
    return (
      <div className="p-6 text-slate-400">
        No active character. Create one in{" "}
        <Link to="/character" className="text-emerald-400 hover:text-emerald-300">
          Character
        </Link>
        .
      </div>
    );
  }

  const totalUnits = entries.reduce((s, e) => s + e.units, 0);
  const existingIds = new Set(entries.map((e) => e.resourceId));

  // Group by status for at-a-glance counts in the header.
  const counts: Record<InventoryStatus, { rows: number; units: number }> = {
    live: { rows: 0, units: 0 },
    banked: { rows: 0, units: 0 },
    reserved: { rows: 0, units: 0 },
  };
  for (const e of entries) {
    counts[e.status].rows++;
    counts[e.status].units += e.units;
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-100">Crates</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          What {character.name} owns. {entries.length} resource
          {entries.length === 1 ? "" : "s"} · {totalUnits.toLocaleString()} total units.
          {entries.length > 0 && (
            <>
              {" · "}
              <span className="text-emerald-300">{counts.live.rows} live</span>{" · "}
              <span className="text-slate-400">{counts.banked.rows} banked</span>{" · "}
              <span className="text-amber-300">{counts.reserved.rows} reserved</span>
            </>
          )}
        </p>
        <p className="text-[11px] text-slate-500 mt-2">
          Phase 4 Stage B — basic CRUD. Verdicts still use absolute thresholds; Stage C will wire
          this inventory into delta-vs-owned scoring.
        </p>
      </div>

      <AddResourcePanel
        characterId={character.id}
        snapshotResources={snapshotResources}
        onAdded={load}
        existingIds={existingIds}
      />

      {loading && <p className="text-slate-400">Loading…</p>}

      {!loading && entries.length === 0 && (
        <p className="text-slate-500 italic">
          No inventory yet. Use the form above to add a resource from the current snapshot.
        </p>
      )}

      {!loading && entries.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-slate-300">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Resource</th>
                <th className="px-3 py-2 text-left font-medium">Units</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Notes</th>
                <th className="px-3 py-2 text-left font-medium">Updated</th>
                <th className="px-3 py-2 w-0" />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <InventoryRow
                  key={`${e.characterId}-${e.resourceId}`}
                  entry={e}
                  characterId={character.id}
                  onChanged={load}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
