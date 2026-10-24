/**
 * Normalizes a discovered URL and keeps it only if it belongs to a targeted host.
 * @param raw - Absolute URL as found by a provider.
 * @param hosts - Hostnames to keep.
 * @returns The URL without its `#fragment`, or null if it is invalid or
 *   its hostname is not in `hosts`.
 */
export function normalizeUrl(raw: string, hosts: Set<string>): string | null {
  try {
    const u = new URL(raw);
    if (!hosts.has(u.hostname)) return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}
