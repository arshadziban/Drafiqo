/**
 * Shortens a file path for display by dropping the middle, keeping the start
 * (drive or first folder) and the end (where the file is):
 *   C:\Users\zibsh\Documents\Projects\Design\Exports  ->  C:\Users\…\Exports
 * The full path belongs in a tooltip.
 */
export function shortenPath(path: string, max = 40): string {
  if (path.length <= max) return path;
  const sep = path.includes("\\") && !path.includes("/") ? "\\" : "/";
  const parts = path.split(sep).filter((p, i) => p !== "" || i === 0);
  const tail = parts[parts.length - 1] ?? "";
  // Keep as much of the start as fits (drive, user folder, ...) next to the last folder.
  for (const keep of [3, 2]) {
    if (parts.length <= keep + 1) continue;
    const joined = `${parts.slice(0, keep).join(sep)}${sep}…${sep}${tail}`;
    if (joined.length <= max) return joined;
  }
  const bare = `…${sep}${tail}`;
  if (parts.length > 2 && bare.length <= max) return bare;
  // Nothing sensible to drop: keep the end, which is the part that identifies the place.
  return `…${path.slice(path.length - (max - 1))}`;
}
