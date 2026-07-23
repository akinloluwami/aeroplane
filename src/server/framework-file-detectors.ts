import { FRAMEWORK_ICON_CATALOG, type FrameworkIconCatalogEntry } from "./framework-icon-catalog.js";

export type FrameworkFileDetectionOptions = {
  buildCommand?: null | string;
  installCommand?: null | string;
  prebuildCommand?: null | string;
  serviceName?: null | string;
  startCommand?: null | string;
};

export type ProjectFileReader = (path: string) => Promise<null | string>;

type ProjectFile = {
  content: string;
  name: string;
  path: string;
};

type FileRule = {
  fileNames: string[];
  matches: (file: ProjectFile, files: ProjectFile[], options: FrameworkFileDetectionOptions) => boolean;
  slug: string;
};

export const candidateFileNames = [
  "go.mod",
  "Cargo.toml",
  "app.csproj",
  "server.csproj",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "requirements.txt",
  "pyproject.toml",
  "main.py",
  "app.py",
  "server.py",
  "program.cs",
  "Program.cs",
  "server.java",
  "Main.java"
];

function catalogEntry(slug: string) {
  return FRAMEWORK_ICON_CATALOG.find((entry) => entry.slug === slug) ?? null;
}

function normalizeRootDir(rootDir: null | string) {
  const normalized = rootDir?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  return normalized.includes("..") ? "" : normalized;
}

function filePath(rootDir: null | string, fileName: string) {
  const root = normalizeRootDir(rootDir);
  return root ? `${root}/${fileName}` : fileName;
}

function commandText(options: FrameworkFileDetectionOptions) {
  return [options.installCommand, options.prebuildCommand, options.buildCommand, options.startCommand, options.serviceName]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
}

function containsAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

async function readProjectFiles(readFile: ProjectFileReader, rootDir: null | string, knownFiles?: Set<string>) {
  // When the caller already knows which files exist in this directory (from a repo tree
  // listing), skip probing the ones that don't — turns up to 16 speculative reads into
  // just the one or two that are actually there.
  const namesToRead = knownFiles ? candidateFileNames.filter((name) => knownFiles.has(name)) : candidateFileNames;

  const reads = await Promise.all(
    namesToRead.map(async (name) => {
      const path = filePath(rootDir, name);
      const content = await readFile(path);
      return content ? { content, name, path } : null;
    })
  );

  return reads.filter((file): file is ProjectFile => Boolean(file));
}

const fileRules: FileRule[] = [
  {
    slug: "fiber",
    fileNames: ["go.mod"],
    matches: (file) => /github\.com\/gofiber\/fiber\/v[0-9]+/i.test(file.content)
  },
  {
    slug: "spring",
    fileNames: ["pom.xml", "build.gradle", "build.gradle.kts"],
    matches: (file) => containsAny(file.content, [/spring-boot/i, /org\.springframework\.boot/i, /springframework\.boot/i])
  },
  {
    slug: "django",
    fileNames: ["requirements.txt", "pyproject.toml"],
    matches: (file) => containsAny(file.content, [/(^|\s|["'])django([<>=~\s"']|$)/im])
  },
  {
    slug: "flask",
    fileNames: ["requirements.txt", "pyproject.toml"],
    matches: (file) => containsAny(file.content, [/(^|\s|["'])flask([<>=~\s"']|$)/im])
  },
  {
    slug: "golang",
    fileNames: ["go.mod"],
    matches: (file) => /^module\s+\S+/m.test(file.content)
  },
  {
    slug: "rust",
    fileNames: ["Cargo.toml"],
    // A workspace-root Cargo.toml has [workspace] but no [package] section of its own —
    // still unambiguously Rust, so presence alone is the fallback signal.
    matches: (file) => containsAny(file.content, [/\[package\]/i, /\[workspace\]/i])
  },
  {
    slug: "dotnet",
    fileNames: ["app.csproj", "server.csproj"],
    matches: (file) => containsAny(file.content, [/<Project[\s>]/i, /Microsoft\.NET\.Sdk/i])
  },
  {
    slug: "dotnet",
    fileNames: ["program.cs", "Program.cs"],
    matches: (file) => containsAny(file.content, [/\bWebApplication\.CreateBuilder\b/i, /\bHost\.CreateDefaultBuilder\b/i])
  },
  {
    slug: "java",
    fileNames: ["pom.xml", "build.gradle", "build.gradle.kts"],
    // Unlike pom.xml (always <project ...> XML), a Gradle build file is shared by
    // Kotlin, Android, Scala and Groovy projects too — presence alone isn't safe to
    // label "Java", so this stays content-gated. build.gradle/.kts are deliberately
    // left out of the coarse tree detector's marker list for the same reason.
    matches: (file) => containsAny(file.content, [/<project[\s>]/i, /\bjava\b/i])
  },
  {
    slug: "java",
    fileNames: ["server.java", "Main.java"],
    matches: (file) => /\bclass\s+\w+/i.test(file.content)
  },
  {
    slug: "python",
    fileNames: ["requirements.txt", "pyproject.toml", "main.py", "app.py", "server.py"],
    // requirements.txt/pyproject.toml presence is already unambiguous on its own — an
    // ordinary one with no Django/Flask import shouldn't fall through to "no framework
    // detected" when the coarse layer already showed a Python badge for it.
    matches: (file, _files, options) =>
      file.name.endsWith(".py") ||
      file.name === "requirements.txt" ||
      file.name === "pyproject.toml" ||
      /\bpython\b/i.test(commandText(options))
  }
];

export async function detectFrameworkFromProjectFiles(
  readFile: ProjectFileReader,
  rootDir: null | string,
  options: FrameworkFileDetectionOptions = {},
  knownFiles?: Set<string>
): Promise<FrameworkIconCatalogEntry | null> {
  const files = await readProjectFiles(readFile, rootDir, knownFiles);
  if (files.length === 0) return null;

  for (const rule of fileRules) {
    const match = files.find((file) => rule.fileNames.includes(file.name) && rule.matches(file, files, options));
    if (!match) continue;

    return catalogEntry(rule.slug);
  }

  return null;
}
