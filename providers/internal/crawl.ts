import { color } from "../../helpers/colors.ts";
import type { BrowserPage } from "../../lib/browser-page.ts";

const BAR_WIDTH = 20;

/**
 * Crawls links on the starting host, visiting at most `maxPages` pages.
 * Prints progress as pages scraped / pages to scrape (discovered so far, capped at `maxPages`):
 * an in-place bar in a terminal, a line every 10 pages otherwise.
 * @param ctx.page - Browser page used to visit links.
 * @param ctx.startUrl - URL to begin crawling from.
 * @param ctx.maxPages - Maximum number of pages to visit; 0 skips crawling.
 * @returns Same-host links found on visited pages, including pages not visited due to the cap.
 */
export async function crawl(ctx: { page: BrowserPage; startUrl: string; maxPages: number }): Promise<string[]> {
  const { page, startUrl, maxPages } = ctx;
  if (maxPages <= 0) return [];

  const showProgress = (scraped: number, toScrape: number, linksFound: number) => {
    if (process.stdout.isTTY) {
      const filled = Math.round((scraped / toScrape) * BAR_WIDTH);
      const bar = `${color.green("#".repeat(filled))}${color.dim("-".repeat(BAR_WIDTH - filled))}`;
      process.stdout.write(
        `\r${color.cyan("Crawling")} [${bar}] ${color.bold(`${scraped}/${toScrape}`)} pages, ${color.green(String(linksFound))} links found`,
      );
    } else if (scraped % 10 === 0 || scraped === toScrape) {
      console.log(`Crawling: ${scraped}/${toScrape} pages scraped, ${linksFound} links found`);
    }
  };

  const start = new URL(startUrl);
  const queue = [start.href];
  const queued = new Set(queue);
  const urls = new Set<string>();
  let visited = 0;

  while (queue.length && visited < maxPages) {
    const current = queue.shift()!;
    visited++;

    try {
      await page.goto(current, { waitUntil: "domcontentloaded", timeout: 15_000 });
      if (new URL(page.url()).hostname === start.hostname) {
        const visitedUrl = new URL(page.url());
        visitedUrl.hash = "";
        urls.add(visitedUrl.href);

        const links: string[] = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].map((a) => a.href),
        );

        for (const raw of links) {
          const link = new URL(raw);
          if (!["http:", "https:"].includes(link.protocol) || link.hostname !== start.hostname) continue;
          link.hash = "";
          const url = link.href;
          urls.add(url);
          if (!queued.has(url)) {
            queued.add(url);
            queue.push(url);
          }
        }
      }
    } catch (e) {
      console.warn(
        `${process.stdout.isTTY ? "\n" : ""}${color.yellow(`Crawl skipped ${current}: ${(e as Error).message.split("\n")[0]}`)}`,
      );
    }
    showProgress(visited, Math.min(maxPages, visited + queue.length), urls.size);
  }

  if (queue.length) console.warn(color.yellow(`\nCrawl stopped at ${maxPages} pages`));
  return [...urls];
}
