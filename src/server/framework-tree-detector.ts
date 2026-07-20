import { candidateFileNames } from "./framework-file-detectors.js";
import type { GitHubTreeEntry } from "./github-connect.js";

// A filename only belongs here if every fileRule that can match its content in
// framework-file-detectors.ts still resolves to this same family (e.g. go.mod is
// always a Go project, whether or not it turns out to be Fiber specifically). Filenames
// whose rule is content-gated and can plausibly fail to match (program.cs, server.java,
// Main.java) — or, for build.gradle/build.gradle.kts, could genuinely belong to a
// different family entirely (Kotlin, Android, Scala) — are left out on purpose: badging
// a folder from bare presence when the precise detector might come back with nothing,
// or with a wrong label, is worse than showing no badge.
const FAMILY_SLUG_BY_FILE_NAME: Record<string, string> = {
  "go.mod": "golang",
  "Cargo.toml": "rust",
  "requirements.txt": "python",
  "pyproject.toml": "python",
  "main.py": "python",
  "app.py": "python",
  "server.py": "python",
  "pom.xml": "java",
  "app.csproj": "dotnet",
  "server.csproj": "dotnet"
};

// Filtering against candidateFileNames (the precise detector's own file list) means the
// coarse layer can never name a marker the precise layer doesn't already recognize — the
// two tiers share one source of truth instead of drifting apart as separate lists.
const MARKER_FILE_SLUGS: { fileName: string; slug: string }[] = candidateFileNames
  .filter((fileName) => fileName in FAMILY_SLUG_BY_FILE_NAME)
  .map((fileName) => ({ fileName, slug: FAMILY_SLUG_BY_FILE_NAME[fileName] }));

// package.json isn't in candidateFileNames — dependency detection for JS/TS lives in a
// separate path (frameworks.ts's package.json/workspace resolution), not the file-rule
// tier — but it has full precise support there, so it's still a safe coarse marker.
MARKER_FILE_SLUGS.push({ fileName: "package.json", slug: "nodejs" });

export function directChildFileNames(dirPath: string, tree: GitHubTreeEntry[]) {
  const prefix = dirPath ? `${dirPath}/` : "";
  const fileNames = new Set<string>();

  for (const entry of tree) {
    if (entry.type !== "blob" || !entry.path.startsWith(prefix)) continue;
    const remainder = entry.path.slice(prefix.length);
    if (!remainder || remainder.includes("/")) continue;
    fileNames.add(remainder);
  }

  return fileNames;
}

// Coarse, presence-only signal for a directory listing: no file content is read, so
// this never issues a network call. It answers "what language lives here", not the
// precise framework — that's resolved lazily once a directory is actually opened.
export function deriveFrameworkHint(dirPath: string, tree: GitHubTreeEntry[]): string | null {
  const fileNames = directChildFileNames(dirPath, tree);

  for (const marker of MARKER_FILE_SLUGS) {
    if (fileNames.has(marker.fileName)) return marker.slug;
  }

  return null;
}
