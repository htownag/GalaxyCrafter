// Downloads the current SR2 (or any galaxy) resource snapshot from
// galaxyharvester.net. GH refreshes the export daily at 5pm UTC; polling
// more than ~twice a day buys nothing.
//
// `all<id>.xml` is 404 publicly (see research-notes.md §7.1); only
// `current<id>.xml` is served. We accumulate our own history by appending
// each refresh to the local `resources` lifetime-union table.

const GH_BASE = "https://galaxyharvester.net/exports";
const USER_AGENT = "GalaxyCrafter/0.0.1 (personal-use; +https://github.com/htownag/GalaxyCrafter)";

export interface FetchResult {
  xml: string;
  bytes: number;
  url: string;
}

export async function fetchCurrentSnapshot(galaxyId: number): Promise<FetchResult> {
  const url = `${GH_BASE}/current${galaxyId}.xml`;
  console.log("[fetch]", url);

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`GH fetch failed: HTTP ${res.status} ${res.statusText} for ${url}`);
  }

  // GH serves ISO-8859-15. fetch() defaults to UTF-8 in TextDecoder; decode
  // explicitly so non-ASCII characters in resource names survive.
  const buf = await res.arrayBuffer();
  const xml = new TextDecoder("iso-8859-15").decode(buf);

  return { xml, bytes: buf.byteLength, url };
}
