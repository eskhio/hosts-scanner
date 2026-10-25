import { writeFile } from "node:fs/promises";
import { startObscura, type GetText } from "./lib/obscura.ts";
import { crtHosts } from "./providers/external/crt.ts";
import { wayback } from "./providers/external/wayback.ts";
import { feeds } from "./providers/internal/feeds.ts";
import { sitemaps } from "./providers/internal/sitemaps.ts";
import { crawl } from "./providers/internal/crawl.ts";
import type { CliOptions } from "./helpers/cli.ts";
import { color } from "./helpers/colors.ts";
import { progress, withProgress } from "./helpers/progress.ts";
import { normalizeUrl } from "./helpers/url.ts";
import type { BrowserPage } from "./lib/browser-page.ts";

type Sources = Record<"crawl" | "sitemaps" | "feeds" | "wayback", string[]>;

/** Browser session shape consumed by the scanner workflow. */
export interface ScannerSession {
  page: BrowserPage;
  getText: GetText;
  close: () => Promise<void>;
}

/** External operations used by the scanner */
export interface ScannerDependencies {
  startBrowser: () => Promise<ScannerSession>;
  crtHosts: typeof crtHosts;
  sitemaps: typeof sitemaps;
  feeds: typeof feeds;
  crawl: typeof crawl;
  wayback: typeof wayback;
  writeUrls: (urls: string[]) => Promise<void>;
}

const defaultDependencies: ScannerDependencies = {
  startBrowser: startObscura,
  crtHosts,
  sitemaps,
  feeds,
  crawl,
  wayback,
  writeUrls: async (urls) => {
    await writeFile("urls.json", JSON.stringify(urls, null, 2));
    console.log(`\n${color.bold(color.green(`${urls.length} unique URLs`))} -> urls.json`);
  },
};

/**
 * Extracts the origin and host information needed to scan a starting URL.
 * Removes a leading `www.` from the hostname to form the root domain used by
 * external hostname discovery and archive lookups.
 * @param base - Starting URL for the scan.
 * @returns The URL origin, hostname, and derived root domain.
 */
function getHostUrlDetails(base: string) {
  const url = new URL(base);
  const host = url.hostname;
  return { origin: url.origin, host, rootDomain: host.replace(/^www\./, "") };
}

/**
 * Builds the set of hosts to scan, optionally adding hosts found by crt.sh.
 * @param host - Hostname from the starting URL, always included in the result.
 * @param rootDomain - Root domain used to query crt.sh when subdomains are included.
 * @param subdomainsIncluded - Whether to discover and scan additional hostnames.
 * @returns The unique hostnames to scan.
 */
async function getHostsSubdomains(
  host: string,
  rootDomain: string,
  subdomainsIncluded: boolean,
  dependencies: ScannerDependencies,
): Promise<Set<string>> {
  const hosts = new Set([host]);
  if (!subdomainsIncluded) return hosts;

  const foundHosts = await withProgress(`Finding subdomains for ${rootDomain}`, () =>
    dependencies.crtHosts({ rootDomain }),
  );

  console.log(`\t- ${color.green("Found")} ${color.bold(String(foundHosts.size))} hostnames:`);
  foundHosts.forEach((foundHost) => {
    console.log(`\t- ${foundHost}`);
    hosts.add(foundHost);
  });
  return hosts;
}

/**
 * Chooses the original URL origin for the starting host and HTTPS for other hosts.
 * @param host - Hostname whose origin is needed.
 * @param primaryHost - Hostname from the starting URL.
 * @param primaryOrigin - Full origin from the starting URL, preserving its scheme and port.
 * @returns The origin to use when opening the host.
 */
function getOrigin(host: string, primaryHost: string, primaryOrigin: string): string {
  return host === primaryHost ? primaryOrigin : `https://${host}`;
}

/**
 * Opens a host in the browser and reports navigation failures as a skipped host.
 * @param page - Browser page used to navigate.
 * @param origin - Origin to open.
 * @returns True if navigation completed, or false if it failed.
 */
async function openOrigin(page: BrowserPage, origin: string): Promise<boolean> {
  return withProgress(`Opening ${origin}`, async () => {
    try {
      await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 15_000 });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(color.yellow(`skipping ${origin}: ${message.split("\n")[0]}`));
      return false;
    }
  });
}

/**
 * Reads sitemap URLs for one origin while displaying provider progress.
 * @param origin - Site origin whose sitemap files should be read.
 * @param getText - Browser-backed fetch helper used by the sitemap provider.
 * @returns URLs discovered in the site's sitemaps.
 */
async function collectSitemaps(
  origin: string,
  getText: GetText,
  dependencies: ScannerDependencies,
): Promise<string[]> {
  return withProgress(`Reading sitemaps from ${origin}`, () => dependencies.sitemaps({ origin, getText }));
}

/**
 * Reads feed URLs from the currently opened page while displaying provider progress.
 * @param page - Browser page currently showing the site.
 * @param getText - Browser-backed fetch helper used by the feed provider.
 * @param origin - Site origin displayed in the progress message.
 * @returns URLs discovered in the site's RSS or Atom feeds.
 */
async function collectFeeds(
  page: BrowserPage,
  getText: GetText,
  origin: string,
  dependencies: ScannerDependencies,
): Promise<string[]> {
  return withProgress(`Reading feeds from ${origin}`, () => dependencies.feeds({ page, getText }));
}

/**
 * Visits each target host and gathers its sitemap and feed URLs.
 * Hosts that cannot be opened are skipped; both providers run only after a
 * successful navigation so they can use the current site's browser context.
 * @param hosts - Hostnames to inspect.
 * @param primaryHost - Hostname from the starting URL.
 * @param primaryOrigin - Original origin to preserve for the starting host.
 * @param page - Browser page used to open each host.
 * @param getText - Browser-backed fetch helper passed to the providers.
 * @returns Sitemap and feed URLs collected from all successfully opened hosts.
 */
async function collectUrlsFromHost(
  hosts: Set<string>,
  primaryHost: string,
  primaryOrigin: string,
  page: BrowserPage,
  getText: GetText,
  dependencies: ScannerDependencies,
): Promise<Pick<Sources, "sitemaps" | "feeds">> {
  const sources = { sitemaps: [] as string[], feeds: [] as string[] };
  for (const host of hosts) {
    console.log("-------------------------------------------------------");
    const origin = getOrigin(host, primaryHost, primaryOrigin);
    if (!(await openOrigin(page, origin))) continue;
    sources.sitemaps.push(...(await collectSitemaps(origin, getText, dependencies)));
    console.log(`\t- ${color.green("Found")} ${sources.sitemaps.length} URLs`);
    sources.feeds.push(...(await collectFeeds(page, getText, origin, dependencies)));
    console.log(`\t- ${color.green("Found")} ${sources.feeds.length} URLs`);
    console.log("-------------------------------------------------------\n");
  }
  return sources;
}

/**
 * Crawls pages starting from the requested URL and reports the number found.
 * Prints a newline after terminal-style crawl progress so the completion message
 * appears on its own line.
 * @param page - Browser page used by the crawler.
 * @param host - Starting hostname, used in the progress message.
 * @param base - URL from which crawling begins.
 * @param maxPages - Maximum number of pages the crawler may visit.
 * @returns URLs found by the crawler.
 */
async function collectUrlsFromCrawl(
  page: BrowserPage,
  host: string,
  base: string,
  maxPages: number,
  dependencies: ScannerDependencies,
): Promise<string[]> {
  progress(`Crawling pages on ${host}...`);
  const links = await dependencies.crawl({ page, startUrl: base, maxPages });
  if (process.stdout.isTTY) process.stdout.write("\n");
  console.log(`${color.green("Crawl complete:")} ${links.length} links found.`);
  return links;
}

/**
 * Queries the Wayback Machine for archived URLs matching the scan options.
 * @param host - Starting hostname used for the archive lookup.
 * @param rootDomain - Root domain used to include related subdomains.
 * @param subdomains - Whether the archive lookup should include subdomains.
 * @returns Archived URLs found by the Wayback provider.
 */
async function collectUrlsFromWayback(
  host: string,
  rootDomain: string,
  subdomains: boolean,
  dependencies: ScannerDependencies,
): Promise<string[]> {
  return withProgress("Querying Wayback Machine", () =>
    dependencies.wayback({ host, rootDomain, subdomains }),
  );
}

/**
 * Normalizes and combines provider results into a sorted, unique URL list.
 * URLs outside the targeted hosts or that cannot be normalized are excluded.
 * Logs the number of accepted URLs for each provider before deduplication
 * across providers.
 * @param sources - URLs grouped by their discovery provider.
 * @param hosts - Hostnames whose URLs should be retained.
 * @returns All accepted URLs, deduplicated and sorted lexicographically.
 */
function getUniqueUrls(sources: Sources, hosts: Set<string>): string[] {
  const all = new Set<string>();
  for (const [name, list] of Object.entries(sources)) {
    const normalized = new Set(list.map((url) => normalizeUrl(url, hosts)).filter((url) => url !== null));
    console.log(`${color.cyan(name)}: ${color.bold(String(normalized.size))} URLs`);
    normalized.forEach((url) => all.add(url));
  }
  return [...all].sort();
}

/**
 * Runs the URL collection workflow using already-parsed scan options.
 * Starts one browser session, discovers enabled hosts, gathers and combines
 * URLs from each provider, writes the result to `urls.json`, and closes the
 * session even if collection or writing fails.
 * @param options - Site URL, subdomain discovery setting, and crawl page limit.
 * @param overrides - Optional browser, provider, and writer replacements for tests.
 */
export async function scanHost(
  options: CliOptions,
  overrides: Partial<ScannerDependencies> = {},
): Promise<void> {
  const dependencies: ScannerDependencies = { ...defaultDependencies, ...overrides };
  const { baseURL, subdomainsIncluded, crawlingMaxPages } = options;
  const { origin, host, rootDomain } = getHostUrlDetails(baseURL);
  const sources: Sources = { crawl: [], sitemaps: [], feeds: [], wayback: [] };

  const session = await withProgress("Starting browser", () => dependencies.startBrowser());

  try {
    const hosts = await getHostsSubdomains(host, rootDomain, subdomainsIncluded, dependencies);
    Object.assign(
      sources,
      await collectUrlsFromHost(hosts, host, origin, session.page, session.getText, dependencies),
      {
        crawl: await collectUrlsFromCrawl(session.page, host, baseURL, crawlingMaxPages, dependencies),
        wayback: await collectUrlsFromWayback(host, rootDomain, subdomainsIncluded, dependencies),
      },
    );
    await dependencies.writeUrls(getUniqueUrls(sources, hosts));
  } finally {
    await session.close();
  }
}
