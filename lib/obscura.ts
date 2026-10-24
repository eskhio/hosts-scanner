import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright-core";

const PORT = 9222;
const OBSCURA = fileURLToPath(
  new URL(`../bin/obscura${process.platform === "win32" ? ".exe" : ""}`, import.meta.url),
);

/**
 * Fetches a URL from inside the page (same-origin rules apply).
 * @param url - Absolute URL to fetch.
 * @returns The response body, or null on any failure or non-2xx status.
 */
export type GetText = (url: string) => Promise<string | null>;

/** A running Obscura browser driven through Playwright. */
export interface ObscuraSession {
  /** Playwright page driving Obscura. */
  page: Page;
  /** Page-based fetch helper. */
  getText: GetText;
  /** Closes the browser and stops the Obscura process. */
  close: () => Promise<void>;
}

/**
 * Polls Obscura's CDP /json/version endpoint until it answers.
 * @param timeoutMs - Maximum time to wait, in milliseconds.
 * @throws If the server does not answer before the timeout.
 */
async function waitForServer(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Obscura CDP server did not start");
}

/**
 * Spawns bin/obscura.exe, connects Playwright over CDP and opens a fresh page.
 * @returns The live session.
 * @throws If Obscura fails to start; the process is cleaned up before rethrowing.
 */
export async function startObscura(): Promise<ObscuraSession> {
  const server = spawn(OBSCURA, ["serve", "--port", String(PORT)], { stdio: "ignore" });
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  const close = async () => {
    await browser?.close();
    server.kill();
  };
  try {
    await waitForServer();
    browser = await chromium.connectOverCDP({ endpointURL: `ws://127.0.0.1:${PORT}` });
    const page = await (await browser.newContext()).newPage();

    const getText: GetText = (url) =>
      page
        .evaluate(async (u) => {
          try {
            const r = await fetch(u);
            return r.ok ? await r.text() : null;
          } catch {
            return null;
          }
        }, url)
        .catch(() => null);

    return { page, getText, close };
  } catch (e) {
    await close();
    throw e;
  }
}
