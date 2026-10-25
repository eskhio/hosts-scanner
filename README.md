# Hosts-scanner

Lists a website's URLs from its pages, sitemaps, feeds, and public third-party sources. It uses the [Obscura](https://github.com/h4ckf0r0day/obscura) headless browser, driven by Playwright over CDP.

## How it works

Each source is a provider, in `providers/`:

| Provider | Type | Source | Notes |
|---|---|---|---|
| [`internal/crawl.ts`](providers/internal/crawl.ts) | internal | Links on visited pages | Follows links on the starting host, capped at 500 pages by default (`--crawling-max-pages`); reports progress |
| [`internal/sitemaps.ts`](providers/internal/sitemaps.ts) | internal | `robots.txt` and sitemaps | Follows sitemap indexes and `.xml.gz`, max 200 files |
| [`internal/feeds.ts`](providers/internal/feeds.ts) | internal | RSS/Atom feeds linked from the home page | Reads `<link rel="alternate">` |
| [`external/wayback.ts`](providers/external/wayback.ts) | external | Wayback Machine CDX index | Historical URLs; the service is intermittent, so failures return `[]` |
| [`external/crt.ts`](providers/external/crt.ts) | external | [crt.sh](https://crt.sh) Certificate Transparency logs | Finds subdomains; up to 2 retries |

- **Internal** providers query the target site itself, through Obscura.
- **External** providers query third-party services.

[`host-scanner.ts`](host-scanner.ts) runs the providers, normalizes the URLs (drops `#fragments`, keeps only targeted hosts), deduplicates and sorts them, and writes `urls.json`.

Shared helpers are in `lib/`:
- [`obscura.ts`](lib/obscura.ts) spawns Obscura and connects Playwright.
- [`xml.ts`](lib/xml.ts) extracts values from sitemap and feed XML.

## Requirements

- Node.js 22 or later
- The Obscura browser binary for your platform. It is not included in this repository.

### macOS setup

Download the Obscura release matching your Mac:

```sh
# Apple Silicon (M1/M2/M3/M4)
curl -LO https://github.com/h4ckf0r0day/obscura/releases/latest/download/obscura-aarch64-macos.tar.gz
tar -xzf obscura-aarch64-macos.tar.gz

# Intel Macs: use this instead of the Apple Silicon download
# curl -LO https://github.com/h4ckf0r0day/obscura/releases/latest/download/obscura-x86_64-macos.tar.gz
# tar -xzf obscura-x86_64-macos.tar.gz
```

Put the extracted `obscura` and `obscura-worker` files in this project's `bin/` directory, then make them executable if needed:

```sh
chmod +x bin/obscura bin/obscura-worker
```

Install the Node.js dependencies with `npm install`, then run the scanner as usual:

```sh
npm run scanUrl https://example.com
```

On first launch, macOS may block the downloaded binary. If so, allow it in **System Settings > Privacy & Security**, then retry.

### Windows setup

Place `obscura.exe` and `obscura-worker.exe` in `bin/`.

## Setup

```
npm install
```

## Usage

```
npm run scanUrl [url] [--subdomains] [--crawling-max-pages=N]
```

| Argument | Description |
|---|---|
| `url` | Site to scan. Defaults to `https://www.lemonde.fr` |
| `--subdomains` | Also looks up subdomains on crt.sh, probes each one, and queries Wayback for the whole root domain |
| `--crawling-max-pages=N` | Maximum pages the crawler visits. Defaults to `500`; use `0` to skip crawling. `--crawling_max_pages` also works |

Example:

```
npm run scanUrl https://www.agencesbancaires.fr/ --subdomains --crawling-max-pages=50
```

Sample output:

```
crt.sh: 2 hostnames
sitemaps: 3167 URLs
feeds: 0 URLs
wayback: 1672 URLs
4798 unique URLs -> urls.json
```

> On Windows PowerShell, `npm run` may not forward `--subdomains`. Run `node_modules\.bin\tsx host-scanner.ts <url> --subdomains` instead.

## Output

`urls.json` is a sorted JSON array of unique absolute URLs.

## Scripts

| Script | Purpose |
|---|---|
| `npm run scanUrl` | Run the URL collector |
| `npm run typecheck` | Type-check with `tsc` |
| `npm run docs` | Generate API docs with TypeDoc into `docs/` |

## Adding a provider

1. Create `providers/internal/<name>.ts` or `providers/external/<name>.ts`. Export an async function that returns `string[]`.
2. Document it with TSDoc.
3. Import it in `host-scanner.ts`, add its key to `sources`, and call it.

## Notes

- Only collect URLs from sites you are allowed to scan, and respect their terms and `robots.txt`.
- Sites can have hundreds of thousands of URLs. For example, `www.lemonde.fr` returns over 140,000 from its sitemaps alone.
