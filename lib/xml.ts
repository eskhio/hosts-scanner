/**
 * Extracts the text of every `<tag>` element, unwrapping CDATA and unescaping `&amp;`.
 * Regex based: meant for simple sitemap/feed values, not general XML parsing.
 * @param xml - Raw XML document.
 * @param tag - Element name to extract.
 * @returns The values, in document order.
 */
export const locs = (xml: string, tag = "loc"): string[] =>
  [...xml.matchAll(new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[)?\\s*([^<\\s\\]]+)`, "g"))].map((m) => m[1].replaceAll("&amp;", "&"));
