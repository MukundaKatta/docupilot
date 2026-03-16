import type { ParsedAPI, ParsedEndpoint, ParsedSchema } from "@docupilot/parser";
import type { GeneratedDoc } from "./doc-writer";

export interface SearchEntry {
  title: string;
  content: string;
  section?: string;
  path: string;
  type: "endpoint" | "guide" | "schema" | "error" | "changelog";
  tags: string[];
  boost?: number;
}

export interface SearchIndex {
  entries: SearchEntry[];
  version: string;
  generatedAt: string;
}

/**
 * Build a search index from parsed API data and generated docs.
 */
export function buildSearchIndex(
  api: ParsedAPI,
  docs: GeneratedDoc[],
  options: SearchIndexOptions = {}
): SearchIndex {
  const entries: SearchEntry[] = [];
  const baseUrl = options.baseUrlPrefix ?? "/docs";

  // Index endpoints
  for (const endpoint of api.endpoints) {
    const endpointEntries = indexEndpoint(endpoint, baseUrl);
    entries.push(...endpointEntries);
  }

  // Index generated docs
  for (const doc of docs) {
    const docEntries = indexDoc(doc, baseUrl);
    entries.push(...docEntries);
  }

  // Index schemas
  for (const [name, schema] of Object.entries(api.schemas)) {
    entries.push(indexSchema(name, schema, baseUrl));
  }

  // Deduplicate by path + section
  const seen = new Set<string>();
  const deduped = entries.filter((e) => {
    const key = `${e.path}#${e.section ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    entries: deduped,
    version: api.version,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generate a JSON search index file for client-side search (e.g., Fuse.js, MiniSearch).
 */
export function exportSearchIndexJSON(index: SearchIndex): string {
  const lightweight = index.entries.map((e) => ({
    t: e.title,
    c: truncateContent(e.content, 500),
    s: e.section,
    p: e.path,
    y: e.type,
    g: e.tags,
    b: e.boost,
  }));

  return JSON.stringify({ v: index.version, d: index.generatedAt, e: lightweight });
}

/**
 * Generate SQL INSERT statements for populating the search_index table.
 */
export function exportSearchIndexSQL(
  index: SearchIndex,
  projectId: string
): string {
  const statements: string[] = [
    `-- Search index for project ${projectId}`,
    `-- Generated at ${index.generatedAt}`,
    `DELETE FROM search_index WHERE project_id = '${projectId}';`,
    "",
  ];

  for (const entry of index.entries) {
    const title = escapeSql(entry.title);
    const content = escapeSql(truncateContent(entry.content, 10000));
    const section = entry.section ? `'${escapeSql(entry.section)}'` : "NULL";
    const path = escapeSql(entry.path);

    statements.push(
      `INSERT INTO search_index (project_id, title, content, section, path) VALUES ('${projectId}', '${title}', '${content}', ${section}, '${path}');`
    );
  }

  return statements.join("\n");
}

export interface SearchIndexOptions {
  baseUrlPrefix?: string;
}

// ─── Indexing Functions ───────────────────────────────────

function indexEndpoint(endpoint: ParsedEndpoint, baseUrl: string): SearchEntry[] {
  const entries: SearchEntry[] = [];
  const slug = `${endpoint.method.toLowerCase()}-${endpoint.path.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-")}`;
  const path = `${baseUrl}/endpoints/${slug}`;

  // Main endpoint entry (high boost)
  entries.push({
    title: `${endpoint.method} ${endpoint.path}`,
    content: [
      endpoint.summary,
      endpoint.description,
      `Method: ${endpoint.method}`,
      `Path: ${endpoint.path}`,
      endpoint.operationId ? `Operation: ${endpoint.operationId}` : null,
    ]
      .filter(Boolean)
      .join(" "),
    path,
    type: "endpoint",
    tags: endpoint.tags,
    boost: 10,
  });

  // Index parameters as separate entries
  if (endpoint.parameters.length > 0) {
    entries.push({
      title: `${endpoint.method} ${endpoint.path} - Parameters`,
      content: endpoint.parameters
        .map(
          (p) =>
            `${p.name} (${p.in}${p.required ? ", required" : ""}): ${p.description ?? p.schema?.type ?? ""}`
        )
        .join(". "),
      section: "Parameters",
      path: `${path}#parameters`,
      type: "endpoint",
      tags: endpoint.tags,
      boost: 5,
    });
  }

  // Index request body
  if (endpoint.requestBody) {
    const bodyContent = Object.entries(endpoint.requestBody.contentTypes)
      .map(([ct, { schema }]) => `${ct}: ${schemaToText(schema)}`)
      .join(". ");

    entries.push({
      title: `${endpoint.method} ${endpoint.path} - Request Body`,
      content: `${endpoint.requestBody.description ?? ""} ${bodyContent}`,
      section: "Request Body",
      path: `${path}#request-body`,
      type: "endpoint",
      tags: endpoint.tags,
      boost: 3,
    });
  }

  // Index responses
  for (const response of endpoint.responses) {
    entries.push({
      title: `${endpoint.method} ${endpoint.path} - ${response.statusCode} Response`,
      content: response.description,
      section: `Response ${response.statusCode}`,
      path: `${path}#response-${response.statusCode}`,
      type: "endpoint",
      tags: endpoint.tags,
      boost: 2,
    });
  }

  return entries;
}

function indexDoc(doc: GeneratedDoc, baseUrl: string): SearchEntry[] {
  const entries: SearchEntry[] = [];
  const path = `${baseUrl}/${doc.slug}`;

  // Split MDX content into sections by headings
  const sections = splitMdxIntoSections(doc.contentMdx);

  // Main doc entry
  entries.push({
    title: doc.title,
    content: sections[0]?.content ?? doc.contentMdx.slice(0, 500),
    path,
    type: docTypeToSearchType(doc.pageType),
    tags: [],
    boost: 8,
  });

  // Each section as a separate entry
  for (const section of sections.slice(1)) {
    entries.push({
      title: `${doc.title} - ${section.heading}`,
      content: section.content,
      section: section.heading,
      path: `${path}#${slugify(section.heading)}`,
      type: docTypeToSearchType(doc.pageType),
      tags: [],
      boost: 4,
    });
  }

  return entries;
}

function indexSchema(name: string, schema: ParsedSchema, baseUrl: string): SearchEntry {
  return {
    title: `Schema: ${name}`,
    content: [
      schema.description,
      schema.type ? `Type: ${schema.type}` : null,
      schema.properties
        ? `Properties: ${Object.keys(schema.properties).join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join(". "),
    path: `${baseUrl}/schemas/${slugify(name)}`,
    type: "schema",
    tags: [],
    boost: 6,
  };
}

// ─── Utilities ────────────────────────────────────────────

interface MdxSection {
  heading: string;
  content: string;
}

function splitMdxIntoSections(mdx: string): MdxSection[] {
  const sections: MdxSection[] = [];
  const lines = mdx.split("\n");
  let currentHeading = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      if (currentContent.length > 0) {
        sections.push({
          heading: currentHeading,
          content: stripMdxComponents(currentContent.join("\n")),
        });
      }
      currentHeading = headingMatch[1];
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  if (currentContent.length > 0) {
    sections.push({
      heading: currentHeading,
      content: stripMdxComponents(currentContent.join("\n")),
    });
  }

  return sections;
}

function stripMdxComponents(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/```[\s\S]*?```/g, "[code block]")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function schemaToText(schema: ParsedSchema): string {
  if (schema.type === "object" && schema.properties) {
    const props = Object.entries(schema.properties)
      .map(([name, prop]) => `${name}: ${prop.type ?? "unknown"}`)
      .join(", ");
    return `object { ${props} }`;
  }
  if (schema.type === "array" && schema.items) {
    return `array of ${schema.items.type ?? "unknown"}`;
  }
  return schema.type ?? "unknown";
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function truncateContent(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength - 3) + "...";
}

function escapeSql(str: string): string {
  return str.replace(/'/g, "''").replace(/\\/g, "\\\\");
}

function docTypeToSearchType(pageType: string): SearchEntry["type"] {
  switch (pageType) {
    case "endpoint":
      return "endpoint";
    case "error_reference":
      return "error";
    case "changelog":
      return "changelog";
    default:
      return "guide";
  }
}
