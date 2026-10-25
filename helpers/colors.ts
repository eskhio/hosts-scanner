const enabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

const wrap = (open: number, close: number) => (text: string) =>
  enabled ? `\x1b[${open}m${text}\x1b[${close}m` : text;

/** ANSI color helpers; they return the text unchanged when output is not a terminal or `NO_COLOR` is set. */
export const color = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  cyan: wrap(36, 39),
};
