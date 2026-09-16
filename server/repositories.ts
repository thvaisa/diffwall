import { readdir } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { repoRoot as resolveRepoRoot } from "./git.js";

export interface RepositoryInfo {
  id: string;
  label: string;
  relativePath: string;
}

export interface Repository {
  info: RepositoryInfo;
  root: string;
}

export interface RepositoryRegistry {
  launchRoot: string;
  setupRequired: boolean;
  repositories: Repository[];
}

const MAX_DEPTH = 6;
const PRUNED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".cache",
  ".venv",
  "venv",
  "target",
  "dist",
  "build",
]);

export async function createRepositoryRegistry(
  launchDirectory: string,
): Promise<RepositoryRegistry> {
  const launchRoot = resolve(launchDirectory);
  try {
    const root = await resolveRepoRoot(launchRoot);
    return {
      launchRoot,
      setupRequired: false,
      repositories: [makeRepository(root, root)],
    };
  } catch {
    const roots = await discoverGitRoots(launchRoot);
    const repositories = roots
      .map((root) => makeRepository(root, launchRoot))
      .sort((a, b) => a.info.relativePath.localeCompare(b.info.relativePath));
    return { launchRoot, setupRequired: true, repositories };
  }
}

export function makeRepository(root: string, launchRoot: string): Repository {
  const absoluteRoot = resolve(root);
  const relativePath = toRelativePath(launchRoot, absoluteRoot);
  const id = relativePath || ".";
  return {
    root: absoluteRoot,
    info: {
      id,
      relativePath,
      label: basename(absoluteRoot),
    },
  };
}

export function findRepository(
  registry: RepositoryRegistry,
  id: string | null,
): Repository | null {
  const requested = id ?? (registry.repositories.length === 1
    ? registry.repositories[0]?.info.id
    : null);
  return registry.repositories.find((repo) => repo.info.id === requested) ?? null;
}

export async function discoverGitRoots(root: string): Promise<string[]> {
  const found = new Set<string>();
  await walk(root, 0, found);
  return [...found].sort((a, b) => a.localeCompare(b));
}

async function walk(
  directory: string,
  depth: number,
  found: Set<string>,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  if (entries.some((entry) => entry.name === ".git")) {
    try {
      found.add(await resolveRepoRoot(directory));
    } catch {
      // An invalid or inaccessible .git entry is not a repository.
    }
  }
  if (depth >= MAX_DEPTH) return;

  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.isSymbolicLink() &&
          !PRUNED_DIRECTORIES.has(entry.name),
      )
      .map((entry) => walk(resolve(directory, entry.name), depth + 1, found)),
  );
}

function toRelativePath(root: string, child: string): string {
  const rel = relative(root, child);
  if (!rel || rel === ".") return "";
  if (rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error("repository is outside launch directory");
  }
  return rel.split(sep).join("/");
}
