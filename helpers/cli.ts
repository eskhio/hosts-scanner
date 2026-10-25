import { color } from "./colors.ts";

const MAX_PAGES_FLAG = /^--crawling[-_]max[-_]pages=/;

/** Options read from the command line. */
export interface CliOptions {
  /** Site to scan. */
  baseURL: string;
  /** Whether to also look up subdomains. */
  subdomainsIncluded: boolean;
  /** Maximum pages the crawler visits; 0 skips crawling. */
  crawlingMaxPages: number;
}

/**
 * Parses the command line: `[url] [--subdomains] [--crawling-max-pages=N]`.
 * Without a `--` separator, `npm run` consumes unknown flags and exposes them as
 * `npm_config_*` variables, so those are used as a fallback.
 * Warns about unknown options and exits with code 1 on an invalid page limit.
 * @param argv - Arguments, without the node and script paths.
 * @param env - Environment variables.
 * @returns The parsed options.
 */
export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): CliOptions {
  const baseURL = argv.find((a) => !a.startsWith("--")) ?? "https://www.lemonde.fr";
  const subdomainsIncluded = argv.includes("--subdomains") || env.npm_config_subdomains === "true";
  const maxPagesArg = argv.find((a) => MAX_PAGES_FLAG.test(a))?.split("=")[1] ?? env.npm_config_crawling_max_pages;
  const crawlingMaxPages = maxPagesArg === undefined ? 500 : Number(maxPagesArg);

  for (const a of argv) {
    if (a.startsWith("--") && a !== "--subdomains" && !MAX_PAGES_FLAG.test(a)) {
      console.warn(color.yellow(`Unknown option ignored: ${a}`));
    }
  }
  if (maxPagesArg === "" || !Number.isInteger(crawlingMaxPages) || crawlingMaxPages < 0) {
    console.error(color.red("--crawling-max-pages must be a non-negative integer"));
    process.exit(1);
  }
  return { baseURL, subdomainsIncluded, crawlingMaxPages };
}
