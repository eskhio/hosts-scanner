import assert from "node:assert/strict";
import test from "node:test";
import { crawl } from "../providers/internal/crawl.ts";
import type { BrowserPage } from "../lib/browser-page.ts";

interface Route {
  links?: string[];
  finalUrl?: string;
  error?: Error;
}

function createPage(routes: Record<string, Route>): { page: BrowserPage; visits: string[] } {
  const visits: string[] = [];
  let currentUrl = "";

  const page: BrowserPage = {
    async goto(url) {
      visits.push(url);
      const route = routes[url];
      if (route?.error) throw route.error;
      currentUrl = route?.finalUrl ?? url;
    },
    url() {
      return currentUrl;
    },
    async evaluate() {
      return routes[currentUrl]?.links ?? [];
    },
  };

  return { page, visits };
}

test("returns no URLs and does not navigate when the page limit is not positive", async () => {
  const { page, visits } = createPage({});

  assert.deepEqual(await crawl({ page, startUrl: "https://example.com", maxPages: 0 }), []);
  assert.deepEqual(await crawl({ page, startUrl: "https://example.com", maxPages: -1 }), []);
  assert.deepEqual(visits, []);
});

test("collects same-host links, removes fragments, and visits normalized duplicates once", async () => {
  const startUrl = "https://example.com/";
  const nextUrl = "https://example.com/next";
  const { page, visits } = createPage({
    [startUrl]: {
      links: [
        "https://example.com/next#section",
        "https://example.com/next",
        "https://outside.example/ignored",
        "mailto:test@example.com",
        "javascript:void(0)",
      ],
    },
    [nextUrl]: { links: ["https://example.com/#top"] },
  });

  const urls = await crawl({ page, startUrl, maxPages: 10 });

  assert.deepEqual(new Set(urls), new Set([startUrl, nextUrl]));
  assert.deepEqual(visits, [startUrl, nextUrl]);
});

test("stops navigation at the page limit but returns discovered same-host URLs", async () => {
  const startUrl = "https://example.com/";
  const firstUrl = "https://example.com/first";
  const secondUrl = "https://example.com/second";
  const { page, visits } = createPage({
    [startUrl]: { links: [firstUrl, secondUrl] },
  });

  const urls = await crawl({ page, startUrl, maxPages: 1 });

  assert.deepEqual(urls, [startUrl, firstUrl, secondUrl]);
  assert.deepEqual(visits, [startUrl]);
});

test("skips navigation failures and continues crawling queued pages", async () => {
  const startUrl = "https://example.com/";
  const failedUrl = "https://example.com/fail";
  const nextUrl = "https://example.com/next";
  const { page, visits } = createPage({
    [startUrl]: { links: [failedUrl, nextUrl] },
    [failedUrl]: { error: new Error("navigation failed") },
    [nextUrl]: { links: [] },
  });

  const urls = await crawl({ page, startUrl, maxPages: 5 });

  assert.deepEqual(new Set(urls), new Set([startUrl, failedUrl, nextUrl]));
  assert.deepEqual(visits, [startUrl, failedUrl, nextUrl]);
});

test("ignores links on a page redirected to a different host", async () => {
  const startUrl = "https://example.com/";
  const redirectedUrl = "https://outside.example/";
  const { page, visits } = createPage({
    [startUrl]: { finalUrl: redirectedUrl, links: ["https://outside.example/page"] },
  });

  const urls = await crawl({ page, startUrl, maxPages: 5 });

  assert.deepEqual(urls, []);
  assert.deepEqual(visits, [startUrl]);
});
