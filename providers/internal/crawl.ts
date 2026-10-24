import type { Page } from "playwright-core";

const MAX_PAGES = 500;

/**
 * Crawls links on the starting host, visiting at most 500 pages.
 * @param ctx.page - Browser page used to visit links.
 * @param ctx.startUrl - URL to begin crawling from.
 * @param ctx.maxPages - Maximum number of pages to visit; 0 skips crawling.
 * @returns Same-host links found on visited pages, including pages not visited due to the cap.
 */
export async function crawl(ctx: { page: Page; startUrl: string; maxPages: number }): Promise<string[]> {
  const { page, startUrl, maxPages } = ctx;
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
      console.warn(`crawl skipped ${current}: ${(e as Error).message.split("\n")[0]}`);
    }
  }

  if (queue.length) console.warn(`crawl stopped at ${MAX_PAGES} pages`);
  return [...urls];
}
