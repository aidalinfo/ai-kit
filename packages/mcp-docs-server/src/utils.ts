import path from "node:path";
import { fileURLToPath } from "node:url";

function resolvePackageRoot(): string {
  const currentFile = fileURLToPath(new URL(import.meta.url));
  const currentDir = path.dirname(currentFile);

  // When compiled, files live in dist/**, when run with tsx they live in src/**
  if (currentDir.includes(`${path.sep}dist${path.sep}`)) {
    return currentDir.slice(0, currentDir.indexOf(`${path.sep}dist${path.sep}`));
  }
  if (currentDir.endsWith(`${path.sep}dist`)) {
    return path.resolve(currentDir, "..");
  }
  if (currentDir.includes(`${path.sep}src${path.sep}`)) {
    return currentDir.slice(0, currentDir.indexOf(`${path.sep}src${path.sep}`));
  }
  if (currentDir.endsWith(`${path.sep}src`)) {
    return path.resolve(currentDir, "..");
  }
  return path.resolve(currentDir, "..");
}

export function getPackageRoot(): string {
  return resolvePackageRoot();
}

export function getDocsRoot(): string {
  const packageRoot = resolvePackageRoot();
  const envOverride = process.env.AI_KIT_DOCS_ROOT;
  if (envOverride) {
    return path.resolve(envOverride);
  }
  return path.resolve(packageRoot, "../..", "docs");
}

export function isWithinDocs(fullPath: string, docsRoot: string): boolean {
  const relative = path.relative(docsRoot, fullPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
