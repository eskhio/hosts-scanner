/**
 * Historical URLs (HTML, status 200, deduplicated, max 50k) from the Wayback Machine CDX index.
 * Never throws: failures are logged and an empty array is returned.
 * @param opts.host - Hostname to query, e.g. "www.example.com".
 * @param opts.rootDomain - Registrable domain, e.g. "example.com".
 * @param opts.subdomains - If true, query the whole root domain instead of `host` only.
 * @returns Archived URLs, or [] if the service fails or answers with non-JSON.
 */
export async function wayback(opts: { host: string; rootDomain: string; subdomains: boolean }): Promise<string[]> {
  const { host, rootDomain, subdomains } = opts;
  try {
    const target = subdomains ? `url=${rootDomain}&matchType=domain` : `url=${host}/*`;
    const api =
      `https://web.archive.org/cdx/search/cdx?${target}&output=json&fl=original` +
      `&collapse=urlkey&filter=statuscode:200&filter=mimetype:text/html&limit=50000`;
    const response = await fetch(api);
    const rows = (await response.json()) as string[][];
    return rows.slice(1).map((r) => r[0]);
  } catch (e) {
    console.warn(`Wayback lookup failed: ${(e as Error).message}`);
    return [];
  }
}
