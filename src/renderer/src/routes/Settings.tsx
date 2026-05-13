import { useCallback, useEffect, useState } from "react";
import type {
  SettingsExportResult,
  SettingsSnapshot,
  UpdaterCheckResult,
  VerdictThresholdsView,
} from "@shared/ipc-types";

// Phase 9c — Settings.
//
// What's editable today:
//   - Verdict thresholds (6 tunables driving the CHASE/MAYBE/SKIP classifier).
//     Saving triggers a recompute across all characters and a UI refresh.
//   - Data export — JSON dump of user state (characters, profession priorities,
//     active schematics, inventory, settings). Reference data + resources +
//     snapshots are intentionally excluded; rehydrate via the app's normal
//     refresh on a new install.
//
// Deferred (placeholders shown so the player knows they're coming):
//   - Theme override (entire UI is dark-only today; full light-mode pass
//     would mean restyling every component).
//   - Cards-vs-rows toggle (per-page concern, slated for a future iteration).
//   - Snapshot cadence (needs a background scheduler in the main process).

export function Settings(): JSX.Element {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [draft, setDraft] = useState<VerdictThresholdsView | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusKind, setStatusKind] = useState<"ok" | "err" | null>(null);

  const load = useCallback(async () => {
    const s = await window.api.getSettings();
    setSnapshot(s);
    setDraft(s.thresholds);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function flashStatus(msg: string, kind: "ok" | "err" = "ok"): void {
    setStatusMsg(msg);
    setStatusKind(kind);
    setTimeout(() => {
      setStatusMsg(null);
      setStatusKind(null);
    }, 4000);
  }

  async function save(): Promise<void> {
    if (!draft) return;
    setSaving(true);
    try {
      const result = await window.api.saveVerdictThresholds(draft);
      setSnapshot(result);
      setDraft(result.thresholds);
      flashStatus("Thresholds saved · verdicts recomputed");
    } catch (e) {
      flashStatus(`Save failed: ${e}`, "err");
    } finally {
      setSaving(false);
    }
  }

  async function reset(): Promise<void> {
    setSaving(true);
    try {
      const result = await window.api.resetVerdictThresholds();
      setSnapshot(result);
      setDraft(result.thresholds);
      flashStatus("Thresholds reset to defaults");
    } catch (e) {
      flashStatus(`Reset failed: ${e}`, "err");
    } finally {
      setSaving(false);
    }
  }

  async function exportData(): Promise<void> {
    setExporting(true);
    try {
      const result: SettingsExportResult = await window.api.exportUserData();
      if (result.path === null) {
        flashStatus("Export cancelled");
      } else {
        const rows = Object.entries(result.rowCounts)
          .map(([k, v]) => `${v} ${k}`)
          .join(" · ");
        flashStatus(
          `Saved ${(result.bytes ?? 0).toLocaleString()} bytes to ${result.path} (${rows})`,
        );
      }
    } catch (e) {
      flashStatus(`Export failed: ${e}`, "err");
    } finally {
      setExporting(false);
    }
  }

  if (!snapshot || !draft) {
    return <div className="p-6 text-slate-400">Loading…</div>;
  }

  const dirty = THRESHOLD_KEYS.some(
    (k) => draft[k] !== snapshot.thresholds[k],
  );

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-xl font-semibold text-slate-100 mb-1">Settings</h2>
      <p className="text-xs text-slate-400 mb-6">
        Tune the verdict engine's classification thresholds, export your local data, or
        manage app preferences.
      </p>

      {statusMsg && (
        <div
          className={`mb-4 p-3 rounded-md border text-sm ${
            statusKind === "err"
              ? "border-red-900 bg-red-950 text-red-200"
              : "border-emerald-900 bg-emerald-950/60 text-emerald-200"
          }`}
        >
          {statusMsg}
        </div>
      )}

      <section className="mb-8">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-sm font-medium text-slate-200">Verdict thresholds</h3>
          {snapshot.thresholdsCustomised && (
            <span className="text-[11px] text-amber-400">customised</span>
          )}
        </div>
        <p className="text-xs text-slate-400 mb-4 leading-snug">
          The 6 numbers that drive whether a resource lands as{" "}
          <span className="text-emerald-300">CHASE</span>,{" "}
          <span className="text-amber-300">MAYBE</span>, or{" "}
          <span className="text-slate-500">SKIP</span>. Defaults preserve the Phase 3
          baseline (the regression contract; changing these CAN make the engine give
          different answers from the worked examples in the design doc). Saving
          triggers an immediate recompute across all characters.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ThresholdField
            label="Absolute CHASE floor"
            tip="Empty-inventory path: any score ≥ this lands as CHASE."
            value={draft.absChase}
            defaultValue={85}
            onChange={(v) => setDraft({ ...draft, absChase: v })}
          />
          <ThresholdField
            label="Absolute MAYBE floor"
            tip="Empty-inventory path: any score ≥ this (but < CHASE) lands as MAYBE."
            value={draft.absMaybe}
            defaultValue={65}
            onChange={(v) => setDraft({ ...draft, absMaybe: v })}
          />
          <ThresholdField
            label="Delta CHASE floor"
            tip="Owned-inventory path: delta (new score − best-owned) ≥ this → CHASE."
            value={draft.deltaChase}
            defaultValue={8}
            onChange={(v) => setDraft({ ...draft, deltaChase: v })}
          />
          <ThresholdField
            label="Delta MAYBE floor"
            tip="Owned-inventory path: delta ≥ this (but < CHASE) → MAYBE."
            value={draft.deltaMaybe}
            defaultValue={3}
            onChange={(v) => setDraft({ ...draft, deltaMaybe: v })}
          />
          <ThresholdField
            label="High-score CHASE floor"
            tip="Owned-inventory path: when score ≥ this AND delta ≥ MAYBE-floor → CHASE."
            value={draft.highScoreChase}
            defaultValue={90}
            onChange={(v) => setDraft({ ...draft, highScoreChase: v })}
          />
          <ThresholdField
            label="High-score MAYBE floor"
            tip="Owned-inventory path: when score ≥ this regardless of delta → at least MAYBE."
            value={draft.highScoreMaybe}
            defaultValue={85}
            onChange={(v) => setDraft({ ...draft, highScoreMaybe: v })}
          />
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-sm"
          >
            {saving ? "Saving…" : "Save & recompute"}
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={saving || !snapshot.thresholdsCustomised}
            className="px-4 py-2 rounded-md border border-slate-700 text-slate-300 hover:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-sm"
          >
            Reset to defaults
          </button>
        </div>
      </section>

      <section className="mb-8">
        <h3 className="text-sm font-medium text-slate-200 mb-2">Data export</h3>
        <p className="text-xs text-slate-400 mb-3 leading-snug">
          Download a JSON backup of your characters, profession priorities, active
          schematics, inventory (Crates), and app settings. Resources, snapshots, and
          reference data are NOT included — they re-hydrate from GalaxyHarvester and
          the bundled reference files on the next refresh after a restore.
        </p>
        <button
          type="button"
          onClick={exportData}
          disabled={exporting}
          className="px-4 py-2 rounded-md bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-100 text-sm"
        >
          {exporting ? "Saving…" : "Export user data…"}
        </button>
      </section>

      <section className="mb-8">
        <h3 className="text-sm font-medium text-slate-200 mb-2">Updates</h3>
        <p className="text-xs text-slate-400 mb-3 leading-snug">
          GalaxyCrafter checks for updates on launch and downloads them in the
          background. A toast appears when an update is ready to install. Click
          below to check manually.
        </p>
        <UpdateChecker />
      </section>

      <section className="mb-2">
        <h3 className="text-sm font-medium text-slate-200 mb-2">Coming later</h3>
        <ul className="space-y-2 text-xs text-slate-500">
          <li>
            <strong className="text-slate-400">Theme override</strong> — full
            light-mode pass requires restyling every component; deferred until the dark
            theme stabilises.
          </li>
          <li>
            <strong className="text-slate-400">Cards vs rows toggle</strong> — per-page
            view preference for list views.
          </li>
          <li>
            <strong className="text-slate-400">Snapshot cadence</strong> — automatic
            background refresh every N hours. Manual refresh on the Resources tab
            remains the only path for now.
          </li>
        </ul>
      </section>
    </div>
  );
}

function UpdateChecker(): JSX.Element {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdaterCheckResult | null>(null);

  async function check(): Promise<void> {
    setChecking(true);
    setResult(null);
    try {
      const r = await window.api.checkForUpdates();
      setResult(r);
    } catch (e) {
      setResult({ status: "error", message: String(e) });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={check}
        disabled={checking}
        className="px-4 py-2 rounded-md bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-100 text-sm"
      >
        {checking ? "Checking…" : "Check for updates"}
      </button>
      {result && (
        <span className="text-xs text-slate-400 leading-tight">
          {result.status === "current" && (
            <>
              You're on the latest version (
              <span className="font-mono">v{result.version}</span>).
            </>
          )}
          {result.status === "available" && (
            <span className="text-cyan-300">
              Update available: v{result.latestVersion} (you're on v{result.currentVersion}).
              Downloading in the background — toast will appear when ready.
            </span>
          )}
          {result.status === "unavailable" && (
            <>No update info returned. May be offline or the publish provider is unreachable.</>
          )}
          {result.status === "error" && (
            <span className="text-red-300">Check failed: {result.message}</span>
          )}
        </span>
      )}
    </div>
  );
}

const THRESHOLD_KEYS: Array<keyof VerdictThresholdsView> = [
  "absChase",
  "absMaybe",
  "deltaChase",
  "deltaMaybe",
  "highScoreChase",
  "highScoreMaybe",
];

function ThresholdField({
  label,
  tip,
  value,
  defaultValue,
  onChange,
}: {
  label: string;
  tip: string;
  value: number;
  defaultValue: number;
  onChange: (v: number) => void;
}): JSX.Element {
  const isDefault = value === defaultValue;
  return (
    <label className="block">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-xs text-slate-300">{label}</span>
        {!isDefault && (
          <span
            className="text-[10px] text-amber-400 font-mono"
            title={`Default: ${defaultValue}`}
          >
            (default {defaultValue})
          </span>
        )}
      </div>
      <input
        type="number"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-100 text-sm"
      />
      <p className="text-[10px] text-slate-500 mt-1 leading-tight">{tip}</p>
    </label>
  );
}
