import { gunzipSync } from "node:zlib";
import type { GetText } from "../../lib/obscura.ts";
import { locs } from "../../lib/xml.ts";

const MAX_SITEMAPS = 200;

/**
 * Collects page URLs from the sitemaps listed in robots.txt (falls back to /sitemap.xml).
 * Follows sitemap indexes and gzipped sitemaps, capped at 200 sitemap files.
 * The page must already be on `origin`.
 * @param ctx.origin - Site origin, e.g. "https://www.example.com".
 * @param ctx.getText - Page-based fetch helper.
 * @returns Every `<loc>` URL found; may contain duplicates and other hosts.
 */
export async function sitemaps(ctx: { origin: string; getText: GetText }): Promise<string[]> {
  const { origin, getText } = ctx;
  const robots = (await getText(`${origin}/robots.txt`)) ?? "";
  const queue = [...robots.matchAll(/^Sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  if (!queue.length) queue.push(`${origin}/sitemap.xml`);

  const visited = new Set<string>();
  let urls: string[] = [];
  while (queue.length && visited.size < MAX_SITEMAPS) {
    const sm = queue.shift()!;
    if (visited.has(sm)) continue;
    visited.add(sm);

    let xml: string | null;
    if (sm.endsWith(".gz")) {
      try {
        xml = gunzipSync(Buffer.from(await (await fetch(sm)).arrayBuffer())).toString("utf8");
      } catch {
        continue;
      }
    } else {
      xml = await getText(sm);
    }
    if (!xml) continue;

    if (xml.includes("<sitemapindex")) queue.push(...locs(xml));
    else urls = urls.concat(locs(xml));
  }
  return urls;
}
