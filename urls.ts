// Lists a site's URLs. Sources live in providers/:
//   internal/ (queried on the site itself): crawl, sitemaps, feeds (RSS/Atom)
//   external/ (third-party services): wayback (CDX index), crt (subdomains via crt.sh)
// With --subdomains, hostnames found on crt.sh are probed too.
// Usage: npm run urls -- [https://www.lemonde.fr] [--subdomains]
import { writeFile } from "node:fs/promises";
import { startObscura } from "./lib/obscura.ts";
import { crtHosts } from "./providers/external/crt.ts";
import { wayback } from "./providers/external/wayback.ts";
import { feeds } from "./providers/internal/feeds.ts";
import { sitemaps } from "./providers/internal/sitemaps.ts";
import { crawl } from "./providers/internal/crawl.ts";

const args = process.argv.slice(2);
const BASE = args.find((a) => !a.startsWith("--")) ?? "https://www.lemonde.fr";
const MAX_PAGES_FLAG = /^--crawling[-_]max[-_]pages=/;
// Without a `--` separator, `npm run` consumes unknown flags and exposes them as npm_config_* variables.
const SUBDOMAINS = args.includes("--subdomains") || process.env.npm_config_subdomains === "true";
const CrawlingMaxPagesArg =
  args.find((a) => MAX_PAGES_FLAG.test(a))?.split("=")[1] ?? process.env.npm_config_crawling_max_pages;
const CRAWLING_MAX_PAGES = CrawlingMaxPagesArg === undefined ? 500 : Number(CrawlingMaxPagesArg);
for (const a of args) {
  if (a.startsWith("--") && a !== "--subdomains" && !MAX_PAGES_FLAG.test(a)) {
    console.warn(`Unknown option ignored: ${a}`);
  }
}
if (CrawlingMaxPagesArg === "" || !Number.isInteger(CRAWLING_MAX_PAGES) || CRAWLING_MAX_PAGES < 0) {
  console.error("--crawling-max-pages must be a non-negative integer");
  process.exit(1);
}
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

  const sources: Record<"crawl" | "sitemaps" | "feeds" | "wayback", string[]> = {
    crawl: [],
    sitemaps: [],
    feeds: [],
    wayback: [],
  };
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
  sources.crawl = await crawl({ page, startUrl: BASE, maxPages: CRAWLING_MAX_PAGES });
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
