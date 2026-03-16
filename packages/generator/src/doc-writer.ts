import type { ParsedEndpoint, ParsedAPI, ParsedSchema } from "@docupilot/parser";
import { generateWithClaude, type ClaudeOptions } from "./claude-client";

export interface DocWriterOptions extends ClaudeOptions {
  style?: "concise" | "detailed" | "tutorial";
  audienceLevel?: "beginner" | "intermediate" | "advanced";
  includeExamples?: boolean;
  tone?: string;
}

export interface GeneratedDoc {
  title: string;
  slug: string;
  contentMdx: string;
  seoTitle: string;
  seoDescription: string;
  pageType: "endpoint" | "guide" | "overview" | "error_reference" | "tutorial" | "changelog";
}

const SYSTEM_PROMPT = `You are an expert technical writer specializing in API documentation. You produce clear, accurate, well-structured documentation in MDX format.

Rules:
- Write in second person ("you")
- Use active voice
- Be precise and unambiguous
- Include practical examples
- Use proper MDX formatting with headings, code blocks, tables, and callouts
- Use the <Callout type="info|warning|danger"> component for important notes
- Use <CodeExample language="..."> for code blocks
- Use tables for parameter documentation
- Always document error cases
- Keep sentences concise`;

/**
 * Generate documentation for a single API endpoint.
 */
export async function generateEndpointDoc(
  endpoint: ParsedEndpoint,
  api: ParsedAPI,
  options: DocWriterOptions
): Promise<GeneratedDoc> {
  const userPrompt = buildEndpointPrompt(endpoint, api, options);

  const content = await generateWithClaude(SYSTEM_PROMPT, userPrompt, {
    ...options,
    maxTokens: options.maxTokens ?? 4096,
  });

  const slug = buildSlug(endpoint.method, endpoint.path);

  return {
    title: endpoint.summary ?? `${endpoint.method} ${endpoint.path}`,
    slug,
    contentMdx: content,
    seoTitle: `${endpoint.method} ${endpoint.path} - ${api.name} API`,
    seoDescription: endpoint.description ?? endpoint.summary ?? `Documentation for ${endpoint.method} ${endpoint.path}`,
    pageType: "endpoint",
  };
}

/**
 * Generate an overview/getting started page for the entire API.
 */
export async function generateOverviewDoc(
  api: ParsedAPI,
  options: DocWriterOptions
): Promise<GeneratedDoc> {
  const endpointSummary = api.endpoints
    .slice(0, 50)
    .map((e) => `- ${e.method} ${e.path}: ${e.summary ?? "No description"}`)
    .join("\n");

  const authInfo = api.auth
    ?.map((a) => `- ${a.name}: ${a.type}${a.scheme ? ` (${a.scheme})` : ""}`)
    .join("\n") ?? "No authentication documented";

  const userPrompt = `Generate a comprehensive API overview / getting started page for the "${api.name}" API (version ${api.version}).

API Description: ${api.description ?? "No description provided"}
Base URL: ${api.baseUrl ?? "Not specified"}

Authentication methods:
${authInfo}

Available endpoints (${api.endpoints.length} total):
${endpointSummary}

Available tags/categories:
${api.tags.map((t) => `- ${t.name}: ${t.description ?? ""}`).join("\n")}

Write the documentation in MDX format. Include:
1. A brief introduction explaining what this API does
2. Base URL and versioning information
3. Authentication setup with examples
4. Rate limiting information (if applicable, suggest common patterns)
5. Quick start example showing a simple API call
6. Overview of available endpoints grouped by category
7. Error handling overview
8. Links to detailed endpoint documentation

Style: ${options.style ?? "detailed"}
Audience: ${options.audienceLevel ?? "intermediate"} developers`;

  const content = await generateWithClaude(SYSTEM_PROMPT, userPrompt, {
    ...options,
    maxTokens: options.maxTokens ?? 6000,
  });

  return {
    title: `${api.name} API Overview`,
    slug: "overview",
    contentMdx: content,
    seoTitle: `${api.name} API Documentation - Getting Started`,
    seoDescription: `Complete API documentation for ${api.name}. Learn authentication, explore endpoints, and get started quickly.`,
    pageType: "overview",
  };
}

/**
 * Generate a tutorial page for common API workflows.
 */
export async function generateTutorialDoc(
  api: ParsedAPI,
  topic: string,
  relatedEndpoints: ParsedEndpoint[],
  options: DocWriterOptions
): Promise<GeneratedDoc> {
  const endpointDetails = relatedEndpoints
    .map(
      (e) =>
        `${e.method} ${e.path}: ${e.summary ?? ""}
  Parameters: ${JSON.stringify(e.parameters.map((p) => ({ name: p.name, in: p.in, required: p.required })))}
  Request body: ${e.requestBody ? JSON.stringify(Object.keys(e.requestBody.contentTypes)) : "None"}`
    )
    .join("\n\n");

  const userPrompt = `Write a step-by-step tutorial for "${topic}" using the ${api.name} API.

Related endpoints:
${endpointDetails}

Base URL: ${api.baseUrl ?? "Not specified"}

Write as an MDX tutorial with:
1. Prerequisites section
2. Step-by-step instructions with code examples
3. Expected responses at each step
4. Error handling for common issues
5. Complete working example at the end
6. Next steps / related tutorials

Style: ${options.style ?? "tutorial"}
Audience: ${options.audienceLevel ?? "beginner"} developers`;

  const content = await generateWithClaude(SYSTEM_PROMPT, userPrompt, {
    ...options,
    maxTokens: options.maxTokens ?? 6000,
  });

  const slug = `tutorial-${topic.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return {
    title: topic,
    slug,
    contentMdx: content,
    seoTitle: `${topic} - ${api.name} API Tutorial`,
    seoDescription: `Learn how to ${topic.toLowerCase()} with the ${api.name} API. Step-by-step tutorial with code examples.`,
    pageType: "tutorial",
  };
}

/**
 * Generate documentation for all endpoints in batch.
 */
export async function generateAllEndpointDocs(
  api: ParsedAPI,
  options: DocWriterOptions & { concurrency?: number }
): Promise<GeneratedDoc[]> {
  const concurrency = options.concurrency ?? 3;
  const results: GeneratedDoc[] = [];

  // Process in batches
  for (let i = 0; i < api.endpoints.length; i += concurrency) {
    const batch = api.endpoints.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((endpoint) => generateEndpointDoc(endpoint, api, options))
    );
    results.push(...batchResults);
  }

  return results;
}

// ─── Helpers ──────────────────────────────────────────────

function buildEndpointPrompt(
  endpoint: ParsedEndpoint,
  api: ParsedAPI,
  options: DocWriterOptions
): string {
  const params = endpoint.parameters
    .map(
      (p) =>
        `| ${p.name} | ${p.in} | ${p.required ? "Yes" : "No"} | ${p.schema?.type ?? "string"} | ${p.description ?? ""} |`
    )
    .join("\n");

  const requestBodyInfo = endpoint.requestBody
    ? Object.entries(endpoint.requestBody.contentTypes)
        .map(
          ([ct, { schema }]) =>
            `Content-Type: ${ct}\nSchema: ${JSON.stringify(schemaToSummary(schema), null, 2)}`
        )
        .join("\n\n")
    : "No request body";

  const responsesInfo = endpoint.responses
    .map(
      (r) =>
        `${r.statusCode}: ${r.description}${
          r.contentTypes
            ? "\n" +
              Object.entries(r.contentTypes)
                .map(([ct, { schema }]) => `  ${ct}: ${JSON.stringify(schemaToSummary(schema), null, 2)}`)
                .join("\n")
            : ""
        }`
    )
    .join("\n\n");

  return `Generate complete API documentation for this endpoint:

Method: ${endpoint.method}
Path: ${endpoint.path}
Operation ID: ${endpoint.operationId ?? "N/A"}
Summary: ${endpoint.summary ?? "N/A"}
Description: ${endpoint.description ?? "N/A"}
Tags: ${endpoint.tags.join(", ")}
Deprecated: ${endpoint.deprecated}
Base URL: ${api.baseUrl ?? "Not specified"}

Parameters:
| Name | In | Required | Type | Description |
|------|-----|----------|------|-------------|
${params || "| (none) | | | | |"}

Request Body:
${requestBodyInfo}

Responses:
${responsesInfo}

${endpoint.security ? `Security: ${JSON.stringify(endpoint.security)}` : ""}

Generate MDX documentation including:
1. Endpoint title and description
2. Authentication requirements
3. Parameters table
4. Request body documentation with example
5. Response documentation with example payloads
6. Error responses and how to handle them
7. A complete cURL example
${options.includeExamples ? "8. Code examples in JavaScript, Python, and Go" : ""}

Style: ${options.style ?? "detailed"}
Audience: ${options.audienceLevel ?? "intermediate"} developers`;
}

function schemaToSummary(schema: ParsedSchema, depth = 0): unknown {
  if (depth > 4) return "...";

  if (schema.type === "object" && schema.properties) {
    const result: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
      result[key] = schemaToSummary(prop, depth + 1);
    }
    return result;
  }

  if (schema.type === "array" && schema.items) {
    return [schemaToSummary(schema.items, depth + 1)];
  }

  if (schema.enum) {
    return schema.enum.join(" | ");
  }

  const type = schema.type ?? "unknown";
  const extra = [
    schema.format ? `format:${schema.format}` : null,
    schema.nullable ? "nullable" : null,
    schema.description ? schema.description.slice(0, 60) : null,
  ]
    .filter(Boolean)
    .join(", ");

  return extra ? `${type} (${extra})` : type;
}

function buildSlug(method: string, path: string): string {
  return `${method.toLowerCase()}-${path
    .replace(/^\//, "")
    .replace(/\{[^}]+\}/g, (m) => m.slice(1, -1))
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/-$/, "")}`;
}
