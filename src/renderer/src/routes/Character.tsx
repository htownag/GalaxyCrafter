import { useEffect, useState } from "react";
import type { ProfessionPriority, ProfessionTier } from "@shared/ipc-types";
import { useActiveCharacter } from "../hooks/useActiveCharacter";
import { PROFESSIONS } from "@shared/professions";

const TIER_ORDER: ProfessionTier[] = ["primary", "secondary", "ignored"];

const TIER_LABEL: Record<ProfessionTier, string> = {
  primary: "Primary",
  secondary: "Secondary",
  ignored: "Ignored",
};

const TIER_CLASS: Record<ProfessionTier, string> = {
  primary: "bg-emerald-900/40 border-emerald-700 text-emerald-200",
  secondary: "bg-amber-900/40 border-amber-700 text-amber-200",
  ignored: "bg-slate-800 border-slate-700 text-slate-400",
};

export function Character(): JSX.Element {
  const { character, refresh } = useActiveCharacter();
  const [name, setName] = useState("");
  const [galaxyKey, setGalaxyKey] = useState<"sr2">("sr2"); // only SR2 for now
  const [priorities, setPriorities] = useState<Record<string, ProfessionTier>>(() => {
    const obj: Record<string, ProfessionTier> = {};
    for (const p of PROFESSIONS) obj[p.id] = "ignored";
    return obj;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stored, setStored] = useState<ProfessionPriority[] | null>(null);

  useEffect(() => {
    if (character) {
      void window.api.getProfessionPriorities(character.id).then(setStored);
    } else {
      setStored(null);
    }
  }, [character]);

  function setTier(profession: string, tier: ProfessionTier): void {
    setPriorities((prev) => ({ ...prev, [profession]: tier }));
  }

  async function submit(): Promise<void> {
    setError(null);
    if (!name.trim()) {
      setError("Character name required.");
      return;
    }
    const priorityList: ProfessionPriority[] = PROFESSIONS.map((p, idx) => ({
      profession: p.id,
      tier: priorities[p.id] ?? "ignored",
      rank: idx,
    }));
    const galaxyIds: Record<string, number> = { sr2: 151 };
    setBusy(true);
    try {
      await window.api.createCharacter({
        name: name.trim(),
        galaxyId: galaxyIds[galaxyKey],
        priorities: priorityList,
      });
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (character && stored) {
    // Existing character view
    const grouped: Record<ProfessionTier, ProfessionPriority[]> = {
      primary: [],
      secondary: [],
      ignored: [],
    };
    for (const p of stored) grouped[p.tier as ProfessionTier].push(p);

    return (
      <div className="p-6 max-w-3xl">
        <h2 className="text-xl font-semibold text-slate-100 mb-1">{character.name}</h2>
        <p className="text-xs text-slate-400 mb-6">
          Galaxy {character.galaxyId} · created {new Date(character.createdAt).toLocaleDateString()}
        </p>

        <div className="space-y-4">
          {TIER_ORDER.map((tier) => (
            <div key={tier}>
              <h3 className="text-sm font-medium text-slate-300 mb-2">{TIER_LABEL[tier]}</h3>
              <div className="flex flex-wrap gap-2">
                {grouped[tier].length === 0 ? (
                  <span className="text-xs text-slate-600">— none —</span>
                ) : (
                  grouped[tier].map((p) => {
                    const def = PROFESSIONS.find((d) => d.id === p.profession);
                    return (
                      <span
                        key={p.profession}
                        className={`px-3 py-1 rounded-md border text-sm ${TIER_CLASS[tier]}`}
                      >
                        {def?.name ?? p.profession}
                      </span>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-8 text-xs text-slate-600">
          Character editing isn't in Phase 2; recreate by deleting <code>%APPDATA%\galaxycrafter\galaxycrafter.sqlite</code>
          and restarting if you need to change priorities. Multi-character + edit flows come later.
        </p>
      </div>
    );
  }

  // Create form
  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-xl font-semibold text-slate-100 mb-1">Create character</h2>
      <p className="text-xs text-slate-400 mb-6">
        GalaxyCrafter needs a character profile to drive verdicts and the schematic active list. Set
        your craft priorities once; you can change them later.
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-md border border-red-900 bg-red-950 text-red-200 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-4 mb-6">
        <div>
          <label htmlFor="char-name" className="block text-sm font-medium text-slate-300 mb-1">
            Name
          </label>
          <input
            id="char-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Atleer"
            className="w-full max-w-sm px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 focus:border-emerald-600 text-sm"
          />
        </div>

        <div>
          <label htmlFor="char-galaxy" className="block text-sm font-medium text-slate-300 mb-1">
            Galaxy
          </label>
          <select
            id="char-galaxy"
            value={galaxyKey}
            onChange={(e) => setGalaxyKey(e.target.value as "sr2")}
            className="px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-slate-100 text-sm"
          >
            <option value="sr2">Sentinels Republic 2 (id 151)</option>
          </select>
        </div>
      </div>

      <h3 className="text-sm font-medium text-slate-300 mb-2">Profession priorities</h3>
      <p className="text-xs text-slate-400 mb-3">
        Pick <strong className="text-emerald-300">Primary</strong> for the craft you focus on,{" "}
        <strong className="text-amber-300">Secondary</strong> for adjacent crafts, leave others{" "}
        <strong className="text-slate-400">Ignored</strong>. The verdict engine (Phase 3) will weight
        spawning resources accordingly.
      </p>

      <div className="space-y-2 mb-8">
        {PROFESSIONS.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between gap-4 px-3 py-2 rounded-md border border-slate-700 bg-slate-900"
          >
            <div className="flex-1">
              <div className="text-sm text-slate-200">{p.name}</div>
              {p.description && <div className="text-xs text-slate-400">{p.description}</div>}
            </div>
            <div className="flex items-center gap-1">
              {TIER_ORDER.map((tier) => (
                <button
                  key={tier}
                  type="button"
                  onClick={() => setTier(p.id, tier)}
                  className={`px-3 py-1 rounded-md border text-xs transition-colors ${
                    priorities[p.id] === tier
                      ? TIER_CLASS[tier]
                      : "border-slate-700 text-slate-400 hover:border-slate-700"
                  }`}
                >
                  {TIER_LABEL[tier]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={busy || !name.trim()}
        className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium"
      >
        {busy ? "Creating…" : "Create character"}
      </button>
    </div>
  );
}
