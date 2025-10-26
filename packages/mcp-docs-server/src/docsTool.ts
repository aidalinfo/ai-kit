import fs from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import { getDocsRoot, isWithinDocs } from "./utils.js";

const DOC_EXTENSIONS = [".md", ".mdx", ".markdown"];

function normalizePath(docPath: string | undefined): string {
  if (!docPath) return "";
  const trimmed = docPath.trim();
  if (!trimmed || trimmed === ".") return "";
  return trimmed.replace(/^\/+/, "");
}

async function listDirectory(fullPath: string, relativePath: string) {
  const entries = await fs.readdir(fullPath, { withFileTypes: true });
  const directories = entries
    .filter(entry => entry.isDirectory())
    .map(entry => `${path.join(relativePath, entry.name)}/`)
    .sort();
  const files = entries
    .filter(entry => entry.isFile() && DOC_EXTENSIONS.includes(path.extname(entry.name)))
    .map(entry => path.join(relativePath, entry.name))
    .sort();

  const lines = [
    `Directory: ${relativePath || "."}`,
    "",
    directories.length ? "Subdirectories:" : "No subdirectories.",
    ...directories.map(dir => `- ${dir}`),
    "",
    files.length ? "Files:" : "No documentation files in this directory.",
    ...files.map(file => `- ${file}`)
  ];

  return lines.join("\n");
}

async function readFile(fullPath: string) {
  return fs.readFile(fullPath, "utf8");
}

async function collectDocFiles(root: string): Promise<string[]> {
  const pending = ["."];
  const results: string[] = [];

  while (pending.length) {
    const relative = pending.pop();
    if (!relative) continue;
    const absolute = path.resolve(root, relative);
    const stats = await fs.stat(absolute);

    if (stats.isDirectory()) {
      const entries = await fs.readdir(absolute, { withFileTypes: true });
      for (const entry of entries) {
        const nextRelative = path.join(relative, entry.name);
        if (entry.isDirectory()) {
          pending.push(nextRelative);
        } else if (entry.isFile() && DOC_EXTENSIONS.includes(path.extname(entry.name))) {
          results.push(nextRelative.replace(/^\.\//, ""));
        }
      }
    } else if (stats.isFile() && DOC_EXTENSIONS.includes(path.extname(relative))) {
      results.push(relative.replace(/^\.\//, ""));
    }
  }

  return Array.from(new Set(results)).sort();
}

type KeywordSnippet = {
  keyword: string;
  snippet: string;
  position: number;
};

type KeywordMatch = {
  path: string;
  snippets: KeywordSnippet[];
};

function buildSnippets(content: string, keyword: string, context = 80): KeywordSnippet[] {
  const lowerContent = content.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  const snippets: KeywordSnippet[] = [];
  const seenPositions = new Set<number>();

  let searchIndex = 0;
  while (searchIndex < lowerContent.length) {
    const index = lowerContent.indexOf(lowerKeyword, searchIndex);
    if (index === -1) break;

    if (!seenPositions.has(index)) {
      const start = Math.max(0, index - context);
      const end = Math.min(content.length, index + keyword.length + context);
      const snippetText = content
        .slice(start, end)
        .replace(/\s+/g, " ")
        .trim();

      if (snippetText) {
        snippets.push({ keyword, snippet: `…${snippetText}…`, position: index });
        seenPositions.add(index);
      }
    }

    searchIndex = index + lowerKeyword.length;
  }

  return snippets;
}

async function searchKeywords(root: string, keywords: string[], context = 80): Promise<KeywordMatch[]> {
  if (!keywords.length) return [];
  const docFiles = await collectDocFiles(root);
  const matches: KeywordMatch[] = [];

  for (const relativePath of docFiles) {
    const absolute = path.resolve(root, relativePath);
    const content = await fs.readFile(absolute, "utf8");

    const deduped = new Map<string, KeywordSnippet>();

    for (const keyword of keywords) {
      const snippets = buildSnippets(content, keyword, context);
      for (const snippet of snippets) {
        const key = `${keyword}:${snippet.position}`;
        if (!deduped.has(key)) {
          deduped.set(key, snippet);
        }
      }
    }

    if (deduped.size) {
      const snippets = Array.from(deduped.values()).sort((a, b) => a.position - b.position);
      matches.push({ path: relativePath, snippets });
    }
  }

  return matches;
}

export function registerDocsTool(server: McpServer) {
  const docsRoot = getDocsRoot();

  const docsToolSchema = z.object({
    path: z.string().describe("Relative path inside the docs/ directory (e.g. core/agents/index.mdx).").optional(),
    keywords: z
      .array(z.string())
      .describe("Optional keywords to search across all docs to surface matching snippets.")
      .optional(),
    includeContent: z
      .boolean()
      .describe("When true, include the full content of files in directory listings.")
      .optional()
  });

  const docsToolShape = docsToolSchema.shape as ZodRawShape;

  server.registerTool(
    "ai_kit-docs",
    {
      title: "Browse AI Kit Docs",
      description:
        "List directories or read specific documentation files from the local docs/ tree. Optionally include full file contents and highlight keyword occurrences within that scope.",
      inputSchema: docsToolShape
    },
    async rawParams => {
      const params = docsToolSchema.parse(rawParams ?? {});

      const requestedPath = params.path ?? "";
      const keywords = (params.keywords ?? [])
        .map(keyword => keyword.trim())
        .filter(keyword => keyword.length > 0);
      const includeContent = params.includeContent ?? true;
      const normalized = normalizePath(requestedPath);
      const targetPath = normalized ? path.resolve(docsRoot, normalized) : docsRoot;

      if (!isWithinDocs(targetPath, docsRoot)) {
        return {
          content: [
            {
              type: "text",
              text: `The requested path "${requestedPath}" is outside of the documentation directory.`
            }
          ]
        };
      }

      let responseText = "";
      try {
        const stats = await fs.stat(targetPath);
        if (stats.isDirectory()) {
          responseText = await listDirectory(targetPath, normalized);
          if (includeContent) {
            const docFiles = await fs.readdir(targetPath, { withFileTypes: true });
            for (const entry of docFiles) {
              if (!entry.isFile()) continue;
              const ext = path.extname(entry.name);
              if (!DOC_EXTENSIONS.includes(ext)) continue;
              const fileRelative = path.join(normalized, entry.name);
              const fileAbsolute = path.resolve(targetPath, entry.name);
              const content = await readFile(fileAbsolute);
              responseText += `\n\n---\n\n# ${fileRelative}\n\n${content}`;
            }
          }
        } else if (stats.isFile()) {
          responseText = await readFile(targetPath);
        } else {
          responseText = `The path "${requestedPath}" is neither a file nor a directory.`;
        }
      } catch (error: any) {
        if (error.code === "ENOENT") {
          const availableFiles = await collectDocFiles(docsRoot);
          const directories = new Set<string>();
          for (const file of availableFiles) {
            const dir = path.dirname(file);
            if (dir && dir !== ".") {
              directories.add(dir);
            }
          }
          const available = [
            ...Array.from(directories)
              .sort()
              .map(dir => `- ${dir}/`),
            ...availableFiles.map(entry => `- ${entry}`)
          ].join("\n");
          responseText = [
            `The path "${requestedPath}" was not found.`,
            "Available documentation entries:",
            available
          ]
            .filter(Boolean)
            .join("\n");
        } else {
          throw error;
        }
      }

      if (keywords.length) {
        const matches = await searchKeywords(docsRoot, keywords, 2000 * 4);
        if (matches.length) {
          const formattedMatches = matches
            .map(match => {
              const snippets = match.snippets
                .map(({ keyword, snippet }) => `  - ${keyword}: ${snippet}`)
                .join("\n");
              return `- ${match.path}\n${snippets}`;
            })
            .join("\n");
          responseText = `${responseText}\n\nKeyword matches:\n${formattedMatches}`;
        } else {
          responseText = `${responseText}\n\nNo keyword matches found for: ${keywords.join(", ")}`;
        }
      }

      return {
        content: [
          {
            type: "text",
            text: responseText
          }
        ]
      };
    }
  );

  const docsSearchSchema = z.object({
    keyword: z
      .string()
      .min(1, "Provide at least one character to search for.")
      .describe("Keyword to search for across all documentation files."),
    includeSnippets: z
      .boolean()
      .default(true)
      .describe("Include contextual snippets around each keyword match."),
    snippetContextTokens: z
      .number()
      .int()
      .min(20)
      .max(4000)
      .default(2000)
      .describe("Approximate number of tokens to include around each keyword match (defaults to ~2000).")
      .optional(),
    paths: z
      .array(z.string().min(1))
      .describe("Optional list of doc paths to include (relative to docs/, e.g. core/agents/index.mdx).")
      .optional(),
    page: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe("Page of results to return (1-indexed)."),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(5)
      .describe("Number of snippet matches to include per page."),
  });

  server.registerTool(
    "ai_kit-docs-search",
    {
      title: "Search AI Kit Docs",
      description:
        "Locate keyword occurrences across the docs/ directory. Supports optional path filters, adjustable snippet context (default ≈2000 tokens), and paginated results so the agent can step through long files.",
      inputSchema: docsSearchSchema.shape as ZodRawShape
    },
    async rawParams => {
      const params = docsSearchSchema.parse(rawParams ?? {});
      const snippetContextTokens = params.snippetContextTokens ?? 2000;
      const approxCharsPerToken = 4;
      const contextCharacters = Math.min(snippetContextTokens * approxCharsPerToken, 16000);

      const matches = await searchKeywords(docsRoot, [params.keyword], contextCharacters);
      const filteredMatches = (() => {
        if (!params.paths?.length) return matches;
        const normalizedTargets = new Set(
          params.paths.map(target => target.replace(/^\/+/, "").replace(/^docs\//, ""))
        );
        return matches.filter(match => normalizedTargets.has(match.path));
      })();

      if (!filteredMatches.length) {
        return {
          content: [
            {
              type: "text",
              text: `No documentation files mention "${params.keyword}".`
            }
          ]
        };
      }

      const snippetEntries = filteredMatches.flatMap(match =>
        match.snippets.map((snippet, index) => ({
          path: match.path,
          keyword: snippet.keyword,
          snippet: snippet.snippet,
          position: snippet.position,
          matchIndex: index,
          totalForPath: match.snippets.length
        }))
      );

      if (!snippetEntries.length) {
        return {
          content: [
            {
              type: "text",
              text: `No documentation files mention "${params.keyword}".`
            }
          ]
        };
      }

      const sortedEntries = snippetEntries.sort((a, b) => {
        const pathCompare = a.path.localeCompare(b.path);
        if (pathCompare !== 0) return pathCompare;
        return a.position - b.position;
      });

      const totalMatches = sortedEntries.length;
      const pageSize = params.pageSize;
      const totalPages = Math.max(1, Math.ceil(totalMatches / pageSize));
      const currentPage = Math.min(params.page, totalPages);
      const startIndex = (currentPage - 1) * pageSize;
      const pageEntries = sortedEntries.slice(startIndex, startIndex + pageSize);

      const formatted = pageEntries
        .map(entry => {
          const matchLabel = `match ${entry.matchIndex + 1}/${entry.totalForPath}`;
          if (params.includeSnippets === false) {
            return `- ${entry.path} (${matchLabel})`;
          }
          return `- ${entry.path} (${matchLabel})\n  - ${entry.snippet}`;
        })
        .join("\n");

      const header = `Documentation snippets mentioning "${params.keyword}" (page ${currentPage}/${totalPages}, showing ${pageEntries.length} of ${totalMatches} matches). Use the page parameter to navigate.`;

      return {
        content: [
          {
            type: "text",
            text: `${header}\n${formatted}`
          }
        ]
      };
    }
  );
}
