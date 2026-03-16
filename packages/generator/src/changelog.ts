import type { ParsedAPI, ParsedEndpoint, ParsedSchema } from "@docupilot/parser";
import { generateWithClaude, type ClaudeOptions } from "./claude-client";
import type { GeneratedDoc } from "./doc-writer";

export interface APIChange {
  type: "breaking" | "non_breaking" | "deprecation" | "addition" | "removal";
  category: "endpoint" | "parameter" | "request_body" | "response" | "schema" | "security";
  path: string;
  method?: string;
  summary: string;
  details: string;
  affectedEndpoints: string[];
}

export interface ChangelogEntry {
  versionFrom: string;
  versionTo: string;
  changes: APIChange[];
  generatedDoc?: GeneratedDoc;
}

/**
 * Detect changes between two versions of an API spec.
 */
export function detectAPIChanges(
  oldApi: ParsedAPI,
  newApi: ParsedAPI
): APIChange[] {
  const changes: APIChange[] = [];

  const oldEndpoints = new Map(
    oldApi.endpoints.map((e) => [`${e.method}:${e.path}`, e])
  );
  const newEndpoints = new Map(
    newApi.endpoints.map((e) => [`${e.method}:${e.path}`, e])
  );

  // Detect removed endpoints
  for (const [key, endpoint] of oldEndpoints) {
    if (!newEndpoints.has(key)) {
      changes.push({
        type: "removal",
        category: "endpoint",
        path: endpoint.path,
        method: endpoint.method,
        summary: `Removed endpoint ${endpoint.method} ${endpoint.path}`,
        details: `The endpoint ${endpoint.method} ${endpoint.path} has been removed.`,
        affectedEndpoints: [key],
      });
    }
  }

  // Detect added endpoints
  for (const [key, endpoint] of newEndpoints) {
    if (!oldEndpoints.has(key)) {
      changes.push({
        type: "addition",
        category: "endpoint",
        path: endpoint.path,
        method: endpoint.method,
        summary: `Added endpoint ${endpoint.method} ${endpoint.path}`,
        details: `New endpoint: ${endpoint.summary ?? endpoint.method + " " + endpoint.path}`,
        affectedEndpoints: [key],
      });
    }
  }

  // Detect changes to existing endpoints
  for (const [key, newEndpoint] of newEndpoints) {
    const oldEndpoint = oldEndpoints.get(key);
    if (!oldEndpoint) continue;

    // Check deprecation
    if (!oldEndpoint.deprecated && newEndpoint.deprecated) {
      changes.push({
        type: "deprecation",
        category: "endpoint",
        path: newEndpoint.path,
        method: newEndpoint.method,
        summary: `Deprecated endpoint ${newEndpoint.method} ${newEndpoint.path}`,
        details: "This endpoint has been marked as deprecated.",
        affectedEndpoints: [key],
      });
    }

    // Check parameter changes
    detectParameterChanges(oldEndpoint, newEndpoint, key, changes);

    // Check request body changes
    detectRequestBodyChanges(oldEndpoint, newEndpoint, key, changes);

    // Check response changes
    detectResponseChanges(oldEndpoint, newEndpoint, key, changes);
  }

  // Check schema-level changes
  detectSchemaChanges(oldApi.schemas, newApi.schemas, changes);

  return changes;
}

/**
 * Generate a changelog document from detected changes.
 */
export async function generateChangelogDoc(
  oldApi: ParsedAPI,
  newApi: ParsedAPI,
  changes: APIChange[],
  options: ClaudeOptions
): Promise<GeneratedDoc> {
  const breakingChanges = changes.filter((c) => c.type === "breaking");
  const additions = changes.filter((c) => c.type === "addition");
  const deprecations = changes.filter((c) => c.type === "deprecation");
  const removals = changes.filter((c) => c.type === "removal");
  const otherChanges = changes.filter((c) => c.type === "non_breaking");

  const changeSummary = `
API: ${newApi.name}
Version change: ${oldApi.version} -> ${newApi.version}

Breaking changes (${breakingChanges.length}):
${breakingChanges.map((c) => `- [${c.category}] ${c.summary}`).join("\n") || "None"}

New additions (${additions.length}):
${additions.map((c) => `- [${c.category}] ${c.summary}`).join("\n") || "None"}

Deprecations (${deprecations.length}):
${deprecations.map((c) => `- [${c.category}] ${c.summary}`).join("\n") || "None"}

Removals (${removals.length}):
${removals.map((c) => `- [${c.category}] ${c.summary}`).join("\n") || "None"}

Other changes (${otherChanges.length}):
${otherChanges.map((c) => `- [${c.category}] ${c.summary}`).join("\n") || "None"}`;

  const userPrompt = `Generate a professional API changelog entry in MDX format for the following changes:

${changeSummary}

Write the changelog including:
1. Version header with date
2. Migration guide for breaking changes (with before/after code examples)
3. Highlighted new features
4. Deprecation notices with migration timeline
5. Full list of changes organized by category

Use the <Callout type="danger"> component for breaking changes.
Use the <Callout type="warning"> component for deprecations.
Use the <Callout type="info"> component for new features.`;

  const content = await generateWithClaude(
    "You are a technical writer creating API changelog entries. Write clear, actionable changelog content in MDX format.",
    userPrompt,
    { ...options, maxTokens: 4096 }
  );

  const slug = `changelog-${newApi.version.replace(/\./g, "-")}`;

  return {
    title: `Changelog - v${newApi.version}`,
    slug,
    contentMdx: content,
    seoTitle: `${newApi.name} API Changelog - v${newApi.version}`,
    seoDescription: `What's new in ${newApi.name} API v${newApi.version}: ${breakingChanges.length} breaking changes, ${additions.length} additions, ${deprecations.length} deprecations.`,
    pageType: "changelog",
  };
}

// ─── Change Detection Helpers ─────────────────────────────

function detectParameterChanges(
  oldEndpoint: ParsedEndpoint,
  newEndpoint: ParsedEndpoint,
  key: string,
  changes: APIChange[]
): void {
  const oldParams = new Map(oldEndpoint.parameters.map((p) => [`${p.in}:${p.name}`, p]));
  const newParams = new Map(newEndpoint.parameters.map((p) => [`${p.in}:${p.name}`, p]));

  // Removed parameters
  for (const [paramKey, param] of oldParams) {
    if (!newParams.has(paramKey)) {
      changes.push({
        type: param.required ? "breaking" : "non_breaking",
        category: "parameter",
        path: newEndpoint.path,
        method: newEndpoint.method,
        summary: `Removed ${param.required ? "required " : ""}parameter "${param.name}" from ${newEndpoint.method} ${newEndpoint.path}`,
        details: `The ${param.in} parameter "${param.name}" has been removed.`,
        affectedEndpoints: [key],
      });
    }
  }

  // Added parameters
  for (const [paramKey, param] of newParams) {
    if (!oldParams.has(paramKey)) {
      changes.push({
        type: param.required ? "breaking" : "addition",
        category: "parameter",
        path: newEndpoint.path,
        method: newEndpoint.method,
        summary: `Added ${param.required ? "required " : ""}parameter "${param.name}" to ${newEndpoint.method} ${newEndpoint.path}`,
        details: `New ${param.in} parameter "${param.name}" (${param.required ? "required" : "optional"}).`,
        affectedEndpoints: [key],
      });
    }
  }

  // Changed parameters
  for (const [paramKey, newParam] of newParams) {
    const oldParam = oldParams.get(paramKey);
    if (!oldParam) continue;

    if (!oldParam.required && newParam.required) {
      changes.push({
        type: "breaking",
        category: "parameter",
        path: newEndpoint.path,
        method: newEndpoint.method,
        summary: `Parameter "${newParam.name}" is now required in ${newEndpoint.method} ${newEndpoint.path}`,
        details: `The ${newParam.in} parameter "${newParam.name}" changed from optional to required.`,
        affectedEndpoints: [key],
      });
    }

    if (oldParam.schema?.type !== newParam.schema?.type) {
      changes.push({
        type: "breaking",
        category: "parameter",
        path: newEndpoint.path,
        method: newEndpoint.method,
        summary: `Parameter "${newParam.name}" type changed in ${newEndpoint.method} ${newEndpoint.path}`,
        details: `Type changed from "${oldParam.schema?.type}" to "${newParam.schema?.type}".`,
        affectedEndpoints: [key],
      });
    }
  }
}

function detectRequestBodyChanges(
  oldEndpoint: ParsedEndpoint,
  newEndpoint: ParsedEndpoint,
  key: string,
  changes: APIChange[]
): void {
  const hadBody = !!oldEndpoint.requestBody;
  const hasBody = !!newEndpoint.requestBody;

  if (hadBody && !hasBody) {
    changes.push({
      type: "breaking",
      category: "request_body",
      path: newEndpoint.path,
      method: newEndpoint.method,
      summary: `Request body removed from ${newEndpoint.method} ${newEndpoint.path}`,
      details: "The request body has been removed from this endpoint.",
      affectedEndpoints: [key],
    });
  } else if (!hadBody && hasBody && newEndpoint.requestBody?.required) {
    changes.push({
      type: "breaking",
      category: "request_body",
      path: newEndpoint.path,
      method: newEndpoint.method,
      summary: `Required request body added to ${newEndpoint.method} ${newEndpoint.path}`,
      details: "A required request body has been added.",
      affectedEndpoints: [key],
    });
  }
}

function detectResponseChanges(
  oldEndpoint: ParsedEndpoint,
  newEndpoint: ParsedEndpoint,
  key: string,
  changes: APIChange[]
): void {
  const oldSuccessResponses = oldEndpoint.responses.filter(
    (r) => r.statusCode.startsWith("2")
  );
  const newSuccessResponses = newEndpoint.responses.filter(
    (r) => r.statusCode.startsWith("2")
  );

  // Check if success response status codes changed
  const oldCodes = new Set(oldSuccessResponses.map((r) => r.statusCode));
  const newCodes = new Set(newSuccessResponses.map((r) => r.statusCode));

  for (const code of oldCodes) {
    if (!newCodes.has(code)) {
      changes.push({
        type: "breaking",
        category: "response",
        path: newEndpoint.path,
        method: newEndpoint.method,
        summary: `Response ${code} removed from ${newEndpoint.method} ${newEndpoint.path}`,
        details: `The ${code} response has been removed.`,
        affectedEndpoints: [key],
      });
    }
  }

  for (const code of newCodes) {
    if (!oldCodes.has(code)) {
      changes.push({
        type: "non_breaking",
        category: "response",
        path: newEndpoint.path,
        method: newEndpoint.method,
        summary: `New response ${code} added to ${newEndpoint.method} ${newEndpoint.path}`,
        details: `A new ${code} response has been added.`,
        affectedEndpoints: [key],
      });
    }
  }
}

function detectSchemaChanges(
  oldSchemas: Record<string, ParsedSchema>,
  newSchemas: Record<string, ParsedSchema>,
  changes: APIChange[]
): void {
  // Detect removed schemas
  for (const name of Object.keys(oldSchemas)) {
    if (!(name in newSchemas)) {
      changes.push({
        type: "breaking",
        category: "schema",
        path: `#/schemas/${name}`,
        summary: `Schema "${name}" removed`,
        details: `The schema definition "${name}" has been removed.`,
        affectedEndpoints: [],
      });
    }
  }

  // Detect added schemas
  for (const name of Object.keys(newSchemas)) {
    if (!(name in oldSchemas)) {
      changes.push({
        type: "addition",
        category: "schema",
        path: `#/schemas/${name}`,
        summary: `New schema "${name}" added`,
        details: `A new schema definition "${name}" has been added.`,
        affectedEndpoints: [],
      });
    }
  }

  // Detect changed required fields in schemas
  for (const [name, newSchema] of Object.entries(newSchemas)) {
    const oldSchema = oldSchemas[name];
    if (!oldSchema) continue;

    const oldRequired = new Set(oldSchema.required ?? []);
    const newRequired = new Set(newSchema.required ?? []);

    for (const field of newRequired) {
      if (!oldRequired.has(field)) {
        changes.push({
          type: "breaking",
          category: "schema",
          path: `#/schemas/${name}/${field}`,
          summary: `Field "${field}" is now required in schema "${name}"`,
          details: `The field "${field}" in schema "${name}" changed from optional to required.`,
          affectedEndpoints: [],
        });
      }
    }
  }
}
