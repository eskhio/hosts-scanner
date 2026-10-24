import type { Page } from "playwright-core";
import type { GetText } from "../../lib/obscura.ts";
import { locs } from "../../lib/xml.ts";

/**
 * Finds RSS/Atom feeds declared via `<link rel="alternate">` on the current page and returns
 * the article URLs they contain (RSS `<link>` text and Atom `<link href>`).
 * The page must already be on the target origin.
 * @param ctx.page - Page currently showing the site's home page.
 * @param ctx.getText - Page-based fetch helper.
 * @returns Article URLs; may contain duplicates, including the feed's own site link.
 */
export async function feeds(ctx: { page: Page; getText: GetText }): Promise<string[]> {
  const { page, getText } = ctx;
  const feedLinks = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLLinkElement>('link[rel="alternate"][type*="rss"], link[rel="alternate"][type*="atom"]')].map((l) => l.href),
  );
  const urls: string[] = [];
  for (const f of feedLinks) {
    const xml = await getText(f);
    if (xml) urls.push(...locs(xml, "link"), ...[...xml.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]));
  }
  return urls;
}
