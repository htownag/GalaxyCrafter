// Single-resource lookup against GH's getResourceByName.py endpoint.
//
// Use case (Phase 4E-B): existing SR2 crafters who have an inventory of
// resources from before this app existed — most are despawned, none are
// in our local snapshot table. The current.xml export only covers
// currently-spawning resources, and GH offers no public bulk-history
// export. But getResourceByName.py returns full XML detail for ANY
// resource by exact name, including despawned ones (the `<unavailable>`
// field is present when the resource has been retired).
//
// Endpoint (verified 2026-05-11):
//   GET https://galaxyharvester.net/getResourceByName.py?name=<n>&galaxy=<id>
//   → 200 with <result>...<resultText>found|new</resultText>...</result>
//   No auth required. ~300-500ms per lookup. No rate limit observed for
//   single-resource flow; bulk import (Phase 4E-C) should still throttle.

import { XMLParser } from "fast-xml-parser";
import type { Resource, ResourceStats } from "../shared/ipc-types";

const GH_BASE = "https://galaxyharvester.net";
const USER_AGENT = "GalaxyCrafter/0.0.1 (personal-use; +https://github.com/htownag/GalaxyCrafter)";

/** What we get back from a getResourceByName.py call. */
export interface GhLookupResult {
  /** Was the resource found in GH's DB at all? */
  found: boolean;
  /** Parsed resource record, populated only when found=true. */
  resource: Resource | null;
  /** Despawn marker — present only when GH marked the spawn unavailable. */
  unavailableAt: number | null;
  /** Despawn-attribution user (e.g. "SR2Updater") when present. */
  unavailableBy: string | null;
  /** Raw URL hit (for logging). */
  url: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: true,
  isArray: (name) => ["planet"].includes(name),
});

// "None" literal in GH's XML means the stat doesn't apply to this type.
// Parse "None" / null / undefined uniformly to JS null.
function statOrNull(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    if (v === "None" || v === "" || v === "null") return null;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v);
}

/**
 * Fetch + parse a single resource by exact name from GH. Returns
 * `found: false` if GH's `resultText` is "new" (not in their DB).
 * Throws on HTTP errors so the caller can surface them; transient
 * network failures should be retried by the caller if desired.
 */
export async function lookupResourceByName(
  name: string,
  galaxyId: number,
): Promise<GhLookupResult> {
  // GH expects the exact spawn name; trim whitespace defensively.
  const cleanName = name.trim();
  if (cleanName.length === 0) {
    throw new Error("lookupResourceByName: empty name");
  }
  const url = `${GH_BASE}/getResourceByName.py?name=${encodeURIComponent(cleanName)}&galaxy=${galaxyId}`;

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`GH lookup failed: HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  // GH's endpoint serves Content-Type: text/xml without an explicit charset;
  // its body is ASCII for the wire chars we care about. Plain text decode is fine.
  const xml = await res.text();

  const parsed = parser.parse(xml);
  const result = parsed.result ?? {};
  const resultText = asString(result.resultText);

  if (resultText !== "found") {
    return { found: false, resource: null, unavailableAt: null, unavailableBy: null, url };
  }

  // Parse the resource. Field naming and ordering match getResourceByName.py.
  const spawnName = asString(result.spawnName);
  const resourceType = asString(result.resourceType);
  const resourceTypeName = asString(result.resourceTypeName);
  const containerType = asString(result.containerType); // GH's group slug; e.g. "iron"
  const enteredRaw = asString(result.entered);
  const enteredBy = asString(result.enteredBy);
  const addedDate = Date.parse(enteredRaw) || 0;

  const stats: ResourceStats = {
    OQ: statOrNull(result.OQ),
    CR: statOrNull(result.CR),
    CD: statOrNull(result.CD),
    DR: statOrNull(result.DR),
    FL: statOrNull(result.FL),
    HR: statOrNull(result.HR),
    MA: statOrNull(result.MA),
    PE: statOrNull(result.PE),
    SR: statOrNull(result.SR),
    UT: statOrNull(result.UT),
    ER: statOrNull(result.ER),
  };

  // Planet entries are mixed shape — `<planet id="2" entered="..." enteredBy="...">Dantooine</planet>`
  // When parsed, fast-xml-parser gives `{ "@_id": 2, "@_entered": "...", "@_enteredBy": "...", "#text": "Dantooine" }`
  // or just the text node depending on attribute presence. Coerce uniformly.
  const planetEntries: Array<{ "#text"?: string; [k: string]: unknown } | string> =
    result.planet ?? [];
  const planets: string[] = planetEntries
    .map((p) => (typeof p === "string" ? p : asString(p["#text"])))
    .filter((s) => s.length > 0);

  const unavailableRaw = asString(result.unavailable);
  const unavailableAt = unavailableRaw ? Date.parse(unavailableRaw) || null : null;
  const unavailableBy = unavailableAt !== null ? asString(result.unavailableBy) || null : null;

  const resource: Resource = {
    id: spawnName,
    name: spawnName,
    typeId: resourceType,
    typeDisplayName: resourceTypeName,
    groupId: containerType,
    enteredBy,
    addedDate,
    galaxyId,
    stats,
    planets,
  };

  return { found: true, resource, unavailableAt, unavailableBy, url };
}
