const RETRIES = 2;

/**
 * Hostnames under `rootDomain` seen in Certificate Transparency logs (crt.sh).
 * Makes up to 3 attempts (1 + 2 retries) with a growing delay; wildcard entries are dropped.
 * Never throws: failures are logged and an empty Set is returned.
 * @param opts.rootDomain - Registrable domain, e.g. "example.com".
 * @returns Lowercased hostnames, including `rootDomain` itself if present.
 */
export async function crtHosts(opts: { rootDomain: string }): Promise<Set<string>> {
  const { rootDomain } = opts;
  const api = `https://crt.sh/?q=%25.${rootDomain}&output=json`;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(api, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as { name_value: string }[];
      return new Set(
        rows
          .flatMap((r) => r.name_value.split("\n"))
          .map((h) => h.trim().toLowerCase())
          .filter((h) => h && !h.includes("*") && (h === rootDomain || h.endsWith(`.${rootDomain}`))),
      );
    } catch (e) {
      console.warn(`crt.sh attempt ${attempt + 1}/${RETRIES + 1} failed: ${(e as Error).message}`);
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  console.warn("crt.sh unavailable; continuing without subdomains");
  return new Set();
}
