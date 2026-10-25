import assert from "node:assert/strict";
import test from "node:test";
import type { CliOptions } from "../helpers/cli.ts";
import type { BrowserPage } from "../lib/browser-page.ts";
import type { ScannerDependencies, ScannerSession } from "../scanner.ts";
import { scanHost } from "../scanner.ts";

const options: CliOptions = {
  baseURL: "https://www.example.com/start",
  subdomainsIncluded: true,
  crawlingMaxPages: 25,
};

function createDependencies(overrides: Partial<ScannerDependencies> = {}) {
  const openedOrigins: string[] = [];
  const sitemapOrigins: string[] = [];
  const savedUrls: string[][] = [];
  let closed = false;
  let currentUrl = "";

  const page: BrowserPage = {
    async goto(url) {
      openedOrigins.push(url);
      if (url === "https://broken.example.com") throw new Error("unavailable");
      currentUrl = url;
    },
    url: () => currentUrl,
    async evaluate() {
      return [];
    },
  };

  const session: ScannerSession = {
    page,
    getText: async () => null,
    close: async () => {
      closed = true;
    },
  };

  const dependencies: ScannerDependencies = {
    startBrowser: async () => session,
    crtHosts: async ({ rootDomain }) => {
      assert.equal(rootDomain, "example.com");
      return new Set(["www.example.com", "shop.example.com", "broken.example.com"]);
    },
    sitemaps: async ({ origin }) => {
      sitemapOrigins.push(origin);
      return [`${origin}/from-sitemap#fragment`, "https://outside.example/ignored"];
    },
    feeds: async () => ["https://www.example.com/from-feed"],
    crawl: async ({ startUrl, maxPages }) => {
      assert.equal(startUrl, options.baseURL);
      assert.equal(maxPages, options.crawlingMaxPages);
      return ["https://www.example.com/from-crawl"];
    },
    wayback: async ({ host, rootDomain, subdomains }) => {
      assert.equal(host, "www.example.com");
      assert.equal(rootDomain, "example.com");
      assert.equal(subdomains, true);
      return ["https://shop.example.com/from-wayback", "https://outside.example/ignored"];
    },
    writeUrls: async (urls) => {
      savedUrls.push(urls);
    },
    ...overrides,
  };

  return {
    dependencies,
    openedOrigins,
    sitemapOrigins,
    savedUrls,
    wasClosed: () => closed,
  };
}

test("collects, normalizes, and saves provider URLs while skipping unavailable hosts", async () => {
  const fixture = createDependencies();

  await scanHost(options, fixture.dependencies);

  assert.deepEqual(fixture.openedOrigins, [
    "https://www.example.com",
    "https://shop.example.com",
    "https://broken.example.com",
  ]);
  assert.deepEqual(fixture.sitemapOrigins, ["https://www.example.com", "https://shop.example.com"]);
  assert.deepEqual(fixture.savedUrls, [[
    "https://shop.example.com/from-wayback",
    "https://shop.example.com/from-sitemap",
    "https://www.example.com/from-crawl",
    "https://www.example.com/from-feed",
    "https://www.example.com/from-sitemap",
  ].sort()]);
  assert.equal(fixture.wasClosed(), true);
});

test("closes the browser session and propagates provider failures", async () => {
  const fixture = createDependencies({
    sitemaps: async () => {
      throw new Error("sitemap provider failed");
    },
  });

  await assert.rejects(scanHost(options, fixture.dependencies), /sitemap provider failed/);
  assert.equal(fixture.wasClosed(), true);
  assert.deepEqual(fixture.savedUrls, []);
});

test("closes the browser session and propagates output writer failures", async () => {
  const fixture = createDependencies({
    writeUrls: async () => {
      throw new Error("output write failed");
    },
  });

  await assert.rejects(scanHost(options, fixture.dependencies), /output write failed/);
  assert.equal(fixture.wasClosed(), true);
});
