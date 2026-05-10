// Parses GH's daily resource XML into our canonical Resource type.
//
// Format reference (verified 2026-05-10 on current151.xml):
//   <resources as_of_date="...">
//     <resource>
//       <name>aewauian</name>
//       <galaxy id="151">Sentinels Republic 2</galaxy>
//       <enter_date>Thu, 30 Apr 2026 03:09:54 -0800</enter_date>
//       <resource_type id="iron_axidite">Axidite Iron</resource_type>
//       <group_id>iron</group_id>
//       <stats><CR>179</CR>...</stats>           ← variable subset per type
//       <planets><planet>Dathomir</planet>...</planets>
//     </resource>
//     ...
//   </resources>

import { XMLParser } from "fast-xml-parser";
import type { Resource, ResourceStats } from "../shared/ipc-types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: true,
  // Force these tags to always parse as arrays even when there's only one of them.
  isArray: (name) => ["resource", "planet"].includes(name),
});

interface GhStats {
  OQ?: number;
  CR?: number;
  CD?: number;
  DR?: number;
  FL?: number;
  HR?: number;
  MA?: number;
  PE?: number;
  SR?: number;
  UT?: number;
  ER?: number;
}

interface GhResource {
  name: string;
  galaxy: { "@_id": number; "#text": string };
  enter_date: string;
  resource_type: { "@_id": string; "#text": string };
  group_id: string;
  stats?: GhStats;
  planets?: { planet: string[] };
}

export interface ParsedSnapshot {
  asOfDate: number;
  galaxyId: number | null;
  resources: Resource[];
}

function statOrNull(v: number | undefined): number | null {
  return typeof v === "number" ? v : null;
}

export function parseSnapshot(xml: string): ParsedSnapshot {
  const parsed = parser.parse(xml);
  const root = parsed.resources ?? {};
  const asOfDate = Date.parse(root["@_as_of_date"] ?? "") || 0;
  const rawList: GhResource[] = root.resource ?? [];

  let galaxyId: number | null = null;

  const resources: Resource[] = rawList.map((r) => {
    if (galaxyId === null && r.galaxy?.["@_id"] !== undefined) {
      galaxyId = Number(r.galaxy["@_id"]);
    }
    const stats: ResourceStats = {
      OQ: statOrNull(r.stats?.OQ),
      CR: statOrNull(r.stats?.CR),
      CD: statOrNull(r.stats?.CD),
      DR: statOrNull(r.stats?.DR),
      FL: statOrNull(r.stats?.FL),
      HR: statOrNull(r.stats?.HR),
      MA: statOrNull(r.stats?.MA),
      PE: statOrNull(r.stats?.PE),
      SR: statOrNull(r.stats?.SR),
      UT: statOrNull(r.stats?.UT),
      ER: statOrNull(r.stats?.ER),
    };
    return {
      id: r.name,
      name: r.name,
      typeId: r.resource_type["@_id"],
      typeDisplayName: r.resource_type["#text"],
      groupId: r.group_id,
      enteredBy: "",
      addedDate: Date.parse(r.enter_date) || 0,
      galaxyId: Number(r.galaxy["@_id"]),
      stats,
      planets: r.planets?.planet ?? [],
    };
  });

  return { asOfDate, galaxyId, resources };
}
