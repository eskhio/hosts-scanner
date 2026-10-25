import { parseArgs } from "./helpers/cli.ts";
import { scanHost } from "./scanner.ts";

await scanHost(parseArgs(process.argv.slice(2), process.env));
