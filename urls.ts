// Lists a site's URLs without following page links. Sources live in providers/:
//   internal/ (queried on the site itself): sitemaps (robots.txt + sitemaps), feeds (RSS/Atom)
//   external/ (third-party services): wayback (CDX index), crt (subdomains via crt.sh)
// With --subdomains, hostnames found on crt.sh are probed too.
// Usage: npm run urls -- [https://www.lemonde.fr] [--subdomains]
import { writeFile } from "node:fs/promises";
import { startObscura } from "./lib/obscura.ts";
import { crtHosts } from "./providers/external/crt.ts";
import { wayback } from "./providers/external/wayback.ts";
import { feeds } from "./providers/internal/feeds.ts";
import { sitemaps } from "./providers/internal/sitemaps.ts";

const args = process.argv.slice(2);
const BASE = args.find((a) => !a.startsWith("--")) ?? "https://www.lemonde.fr";
const SUBDOMAINS = args.includes("--subdomains");
const ORIGIN = new URL(BASE).origin;
const HOST = new URL(BASE).hostname;
const ROOT_DOMAIN = HOST.replace(/^www\./, "");
const HOSTS = new Set([HOST]);

/**
 * Normalizes a discovered URL and keeps it only if it belongs to a targeted host.
 * @param raw - Absolute URL as found by a provider.
 * @returns The URL without its `#fragment`, or null if it is invalid or
 *   its hostname is not in `HOSTS`.
 */
function normalize(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (!HOSTS.has(u.hostname)) return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

const { page, getText, close } = await startObscura();
try {
  if (SUBDOMAINS) {
    const hosts = await crtHosts({ rootDomain: ROOT_DOMAIN });
    hosts.forEach((h) => HOSTS.add(h));
    console.log(`crt.sh: ${hosts.size} hostnames`);
  }

  const sources: Record<"sitemaps" | "feeds" | "wayback", string[]> = { sitemaps: [], feeds: [], wayback: [] };
  for (const host of HOSTS) {
    const origin = host === HOST ? ORIGIN : `https://${host}`;
    try {
      await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 15_000 });
    } catch (e) {
      console.warn(`skipping ${origin}: ${(e as Error).message.split("\n")[0]}`);
      continue;
    }
    sources.sitemaps = sources.sitemaps.concat(await sitemaps({ origin, getText }));
    sources.feeds = sources.feeds.concat(await feeds({ page, getText }));
  }
  sources.wayback = await wayback({ host: HOST, rootDomain: ROOT_DOMAIN, subdomains: SUBDOMAINS });

  const all = new Set<string>();
  for (const [name, list] of Object.entries(sources)) {
    const n = new Set(list.map(normalize).filter((u): u is string => u !== null));
    console.log(`${name}: ${n.size} URLs`);
    n.forEach((u) => all.add(u));
  }
  const result = [...all].sort();
  await writeFile("urls.json", JSON.stringify(result, null, 2));
  console.log(`${result.length} unique URLs -> urls.json`);
} finally {
  await close();
}
