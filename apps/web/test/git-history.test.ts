// Product history's git reading: the log and unified-diff parsers, picking only listed commits, and the clone setting.
// One test runs real git against a throwaway repository made here, so the parsers are checked against git's own output.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  cloneFor,
  commitsBetween,
  diffCommits,
  listCommits,
  parseDiff,
  parseLog,
  pickCommit,
} from "../server/hub/git-history.ts";

const SAMPLE = `diff --git a/src/a.js b/src/a.js
index 1111111..2222222 100644
--- a/src/a.js
+++ b/src/a.js
@@ -1,3 +1,4 @@ export function a() {
 one
-two
+TWO
+three
 four
\\ No newline at end of file
diff --git a/old name.txt b/new name.txt
similarity index 100%
rename from old name.txt
rename to new name.txt
diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..3333333
Binary files /dev/null and b/logo.png differ
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 4444444..0000000
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/run.sh b/run.sh
old mode 100644
new mode 100755
`;

describe("parseDiff", () => {
  const diff = parseDiff(SAMPLE);
  it("reads each file with its status and counts", () => {
    expect(diff.files.map((f) => [f.path, f.status, f.added, f.removed])).toEqual([
      ["src/a.js", "modified", 2, 1],
      ["new name.txt", "renamed", 0, 0],
      ["logo.png", "added", 0, 0],
      ["gone.txt", "deleted", 0, 1],
      ["run.sh", "mode", 0, 0],
    ]);
    expect(diff.added).toBe(2);
    expect(diff.removed).toBe(2);
    expect(diff.truncated).toBe(false);
  });
  it("numbers both sides of every line", () => {
    const [hunk] = diff.files[0]?.hunks ?? [];
    expect(hunk?.section).toBe("export function a() {");
    expect(hunk?.lines.map((l) => [l.kind, l.old, l.new, l.text])).toEqual([
      ["ctx", 1, 1, "one"],
      ["del", 2, null, "two"],
      ["add", null, 2, "TWO"],
      ["add", null, 3, "three"],
      ["ctx", 3, 4, "four"],
      ["note", null, null, "No newline at end of file"],
    ]);
  });
  it("keeps a rename's old path, a binary flag and a mode change", () => {
    expect(diff.files[1]?.oldPath).toBe("old name.txt");
    expect(diff.files[2]?.binary).toBe(true);
    expect(diff.files[4]?.mode).toEqual({ old: "100644", new: "100755" });
  });
  it("drops a cut-off last line and says the diff was cut", () => {
    const cut = parseDiff(`${SAMPLE.slice(0, SAMPLE.indexOf("+three") + 3)}`, true);
    expect(cut.truncated).toBe(true);
    expect(cut.files[0]?.added).toBe(1);
  });
});

describe("parseLog and pickCommit", () => {
  const sha = (c: string) => c.repeat(40);
  const log = `\x1e${sha("a")}\x1f${sha("b")}\x1fBob\x1fbob@example.com\x1f2026-11-14T16:33:04-05:00\x1fHEAD -> main, origin/main\x1fFix it\n\n 2 files changed, 23 insertions(+), 4 deletions(-)\n\x1e${sha("b")}\x1f\x1fAlice\x1falice@example.com\x1f2026-11-14T16:31:16-05:00\x1f\x1fStart\n\n 1 file changed, 17 insertions(+)\n`;
  const commits = parseLog(log);
  it("reads authors, refs and stats", () => {
    expect(commits.map((c) => [c.short, c.author.name, c.files, c.added, c.removed, c.parents.length])).toEqual([
      ["aaaaaaa", "Bob", 2, 23, 4, 1],
      ["bbbbbbb", "Alice", 1, 17, 0, 0],
    ]);
    expect(commits[0]?.refs).toEqual(["main", "origin/main"]);
  });
  it("accepts only a hex prefix of exactly one listed commit", () => {
    expect(pickCommit(commits, "aaaaaaa")?.author.name).toBe("Bob");
    expect(pickCommit(commits, "HEAD")).toBeNull();
    expect(pickCommit(commits, "aaaa")).toBeNull();
    expect(pickCommit(commits, "--output=/tmp/x")).toBeNull();
    expect(pickCommit(commits, "cccccccc")).toBeNull();
  });
});

describe("cloneFor", () => {
  it("reads only a configured absolute directory", () => {
    expect(cloneFor({ "x.dev/app": tmpdir() }, "x.dev/app")).toBe(tmpdir());
    expect(cloneFor({ "x.dev/app": "relative/path" }, "x.dev/app")).toBeNull();
    expect(cloneFor({}, "x.dev/app")).toBeNull();
    expect(cloneFor({}, "constructor")).toBeNull();
    expect(cloneFor({ "x.dev/app": "/no/such/dir/anywhere" }, "x.dev/app")).toBeNull();
  });
});

describe("against real git", () => {
  const dir = mkdtempSync(join(tmpdir(), "strata-history-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const g = (...args: string[]) =>
    execFileSync("git", ["-C", dir, "-c", "user.name=Tess", "-c", "user.email=tess@example.com", ...args]);

  it("lists commits and diffs two of them", async () => {
    g("init", "-q", "-b", "main");
    writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
    g("add", ".");
    g("commit", "-qm", "first");
    writeFileSync(join(dir, "a.txt"), "one\n2\nthree\n");
    g("commit", "-qam", "second");
    const commits = await listCommits(dir);
    expect(commits.map((c) => [c.subject, c.author.name, c.files])).toEqual([
      ["second", "Tess", 1],
      ["first", "Tess", 1],
    ]);
    const [after, before] = commits;
    if (!after || !before) throw new Error("no commits");
    expect(await commitsBetween(dir, before, after)).toEqual([after.sha]);
    const diff = await diffCommits(dir, before, after);
    expect(diff.files[0]?.path).toBe("a.txt");
    expect([diff.added, diff.removed]).toEqual([2, 1]);
    const root = await diffCommits(dir, null, before);
    expect(root.files[0]?.status).toBe("added");
  });
});
