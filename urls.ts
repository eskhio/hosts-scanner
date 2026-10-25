// Lists a site's URLs. Sources live in providers/:
//   internal/ (queried on the site itself): crawl, sitemaps, feeds (RSS/Atom)
//   external/ (third-party services): wayback (CDX index), crt (subdomains via crt.sh)
// With --subdomains, hostnames found on crt.sh are probed too.
// Usage: npm run urls -- [https://www.lemonde.fr] [--subdomains] [--crawling-max-pages=500]
import { writeFile } from "node:fs/promises";
import { startObscura } from "./lib/obscura.ts";
import { crtHosts } from "./providers/external/crt.ts";
import { wayback } from "./providers/external/wayback.ts";
import { feeds } from "./providers/internal/feeds.ts";
import { sitemaps } from "./providers/internal/sitemaps.ts";
import { crawl } from "./providers/internal/crawl.ts";
import { parseArgs } from "./helpers/cli.ts";
import { color } from "./helpers/colors.ts";
import { progress, withProgress } from "./helpers/progress.ts";
import { normalizeUrl } from "./helpers/url.ts";

const { base: BASE, subdomains: SUBDOMAINS, crawlingMaxPages: CRAWLING_MAX_PAGES } = parseArgs(
  process.argv.slice(2),
  process.env,
);
const ORIGIN = new URL(BASE).origin;
const HOST = new URL(BASE).hostname;
const ROOT_DOMAIN = HOST.replace(/^www\./, "");
const HOSTS = new Set([HOST]);

const { page, getText, close } = await withProgress("Starting browser", () => startObscura());
progress("Browser ready.");
try {
  if (SUBDOMAINS) {
    const hosts = await withProgress(`Finding subdomains for ${ROOT_DOMAIN}`, () =>
      crtHosts({ rootDomain: ROOT_DOMAIN }),
    );
    hosts.forEach((h) => HOSTS.add(h));
    console.log(`${color.green("Found")} ${color.bold(String(hosts.size))} hostnames`);
  }

  const sources: Record<"crawl" | "sitemaps" | "feeds" | "wayback", string[]> = {
    crawl: [],
    sitemaps: [],
    feeds: [],
    wayback: [],
  };
  for (const host of HOSTS) {
    const origin = host === HOST ? ORIGIN : `https://${host}`;
    const opened = await withProgress(`Opening ${origin}`, async () => {
      try {
        await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 15_000 });
        return true;
      } catch (e) {
        console.warn(color.yellow(`skipping ${origin}: ${(e as Error).message.split("\n")[0]}`));
        return false;
      }
    });
    if (!opened) continue;
    sources.sitemaps = sources.sitemaps.concat(
      await withProgress(`Reading sitemaps from ${origin}`, () => sitemaps({ origin, getText })),
    );
    sources.feeds = sources.feeds.concat(
      await withProgress(`Reading feeds from ${origin}`, () => feeds({ page, getText })),
    );
  }
  progress(`Crawling pages on ${HOST}...`);
  sources.crawl = await crawl({ page, startUrl: BASE, maxPages: CRAWLING_MAX_PAGES });
  if (process.stdout.isTTY) process.stdout.write("\n");
    console.log(`${color.green("Crawl complete:")} ${sources.crawl.length} links found.`);
  sources.wayback = await withProgress("Querying Wayback Machine", () =>
    wayback({ host: HOST, rootDomain: ROOT_DOMAIN, subdomains: SUBDOMAINS }),
  );

  const all = new Set<string>();
  for (const [name, list] of Object.entries(sources)) {
    const n = new Set(list.map((u) => normalizeUrl(u, HOSTS)).filter((u): u is string => u !== null));
    console.log(`${color.cyan(name)}: ${color.bold(String(n.size))} URLs`);
    n.forEach((u) => all.add(u));
  }
  const result = [...all].sort();
  await writeFile("urls.json", JSON.stringify(result, null, 2));
  console.log(`\n${color.bold(color.green(`${result.length} unique URLs`))} -> urls.json`);
} finally {
  await close();
}
