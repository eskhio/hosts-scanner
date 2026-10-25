import { color } from "./colors.ts";

/**
 * Prints a stage message on its own line, preceded by a blank line.
 * @param message - Text to display.
 */
export function progress(message: string): void {
  console.log(`\n${color.bold(color.cyan(message))}`);
}

/**
 * Runs a task while showing its status: a spinner with elapsed time in a terminal,
 * start/completion lines otherwise.
 * @param label - Description of the task.
 * @param task - Async work to run.
 * @returns The task's result; errors are rethrown after the display is cleaned up.
 */
export async function withProgress<T>(label: string, task: () => Promise<T>): Promise<T> {
  const started = Date.now();
  let frame = 0;
  if (process.stdout.isTTY) {
    const frames = ["|", "/", "-", "\\"];
    const timer = setInterval(() => {
      const elapsed = ((Date.now() - started) / 1000).toFixed(0);
      process.stdout.write(`\r${color.cyan(frames[frame++ % frames.length])} ${label} ${color.dim(`(${elapsed}s)`)}`);
    }, 120);
    try {
      const result = await task();
      clearInterval(timer);
      process.stdout.write(
        `\r${color.green("[+]")} ${label} ${color.dim(`completed in ${((Date.now() - started) / 1000).toFixed(1)}s`)}\n`,
      );
      return result;
    } catch (error) {
      clearInterval(timer);
      process.stdout.write("\n");
      throw error;
    }
  }

  console.log(`${color.cyan("Started:")} ${label}`);
  try {
    const result = await task();
    console.log(`${color.green("Completed:")} ${label} ${color.dim(`(${((Date.now() - started) / 1000).toFixed(1)}s)`)}`);
    return result;
  } catch (error) {
    console.log(`${color.red("Failed:")} ${label}`);
    throw error;
  }
}
