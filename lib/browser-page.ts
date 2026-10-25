/** Browser page operations used by URL discovery providers. */
export interface BrowserPage {
  /** Navigates to a URL, waiting for the requested load state. */
  goto(url: string, options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<unknown>;
  /** Returns the URL currently loaded in the page. */
  url(): string;
  /** Evaluates a callback in the page and returns its result. */
  evaluate(callback: () => string[]): Promise<string[]>;
}
