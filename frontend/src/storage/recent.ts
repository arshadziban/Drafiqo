export interface RecentProject {
  path: string;
  name: string;
  openedAt: string;
}

const KEY = "drafiqo.recentProjects";
const LIMIT = 10;

export function loadRecent(): RecentProject[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is RecentProject => typeof r === "object" && r !== null && typeof r.path === "string" && typeof r.name === "string",
    );
  } catch {
    return [];
  }
}

function store(list: RecentProject[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, LIMIT)));
  } catch {
    // Recent projects are a convenience; failing to remember one is not an error.
  }
}

export function addRecent(path: string, name: string): void {
  store([{ path, name, openedAt: new Date().toISOString() }, ...loadRecent().filter((r) => r.path !== path)]);
}

export function removeRecent(path: string): void {
  store(loadRecent().filter((r) => r.path !== path));
}
