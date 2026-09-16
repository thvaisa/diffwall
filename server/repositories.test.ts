import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createRepositoryRegistry,
  discoverGitRoots,
} from "./repositories.js";

const execFile = promisify(execFileCallback);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "diffwall-repositories-"));
  temporaryRoots.push(root);
  return root;
}

async function initRepo(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  await execFile("git", ["init", "--quiet", path]);
}

describe("repository discovery", () => {
  it("discovers nested repositories in stable relative order", async () => {
    const root = await fixture();
    await initRepo(join(root, "zeta"));
    await initRepo(join(root, "group", "alpha"));
    await mkdir(join(root, "node_modules", "ignored"), { recursive: true });
    await initRepo(join(root, "node_modules", "ignored", "repo"));

    const roots = await discoverGitRoots(root);
    assert.deepEqual(roots, [join(root, "group", "alpha"), join(root, "zeta")]);
  });

  it("requires setup outside Git and directly selects a Git root inside Git", async () => {
    const root = await fixture();
    const repo = join(root, "project");
    await initRepo(repo);

    const parent = await createRepositoryRegistry(root);
    assert.equal(parent.setupRequired, true);
    assert.deepEqual(
      parent.repositories.map((item) => item.info.id),
      ["project"],
    );

    const direct = await createRepositoryRegistry(repo);
    assert.equal(direct.setupRequired, false);
    assert.equal(direct.repositories[0]?.info.id, ".");
  });
});
