import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function copyDirectory(source: string, destination: string): Promise<void> {
  const entries = await fs.readdir(source, { withFileTypes: true });
  await fs.mkdir(destination, { recursive: true });

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}

async function main(): Promise<void> {
  const scriptUrl = new URL("../", import.meta.url);
  const scriptDir = path.dirname(fileURLToPath(scriptUrl));
  const packageRoot = path.resolve(scriptDir);

  const docSourceCandidates = [
    {
      path: path.resolve(packageRoot, "../mintlify-docs/en"),
      label: "Mintlify (en)"
    },
    {
      path: path.resolve(packageRoot, "../docs/src/content/docs"),
      label: "legacy docs"
    }
  ];

  const resolvedSource = await (async () => {
    for (const candidate of docSourceCandidates) {
      if (await pathExists(candidate.path)) {
        return candidate;
      }
    }
    return null;
  })();

  if (!resolvedSource) {
    console.warn("No docs source found; skipping copy.");
    return;
  }

  const docsSource = resolvedSource.path;
  const docsDestination = path.resolve(packageRoot, "dist", "docs");

  await fs.rm(docsDestination, { recursive: true, force: true });
  await copyDirectory(docsSource, docsDestination);
  console.log(`Copied docs from ${resolvedSource.label} to ${docsDestination}`);
}

main().catch(error => {
  console.error("Failed to copy docs", error);
  process.exit(1);
});
