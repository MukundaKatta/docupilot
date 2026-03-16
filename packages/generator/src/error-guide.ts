import type { ParsedAPI, ParsedEndpoint, ParsedResponse } from "@docupilot/parser";
import { generateWithClaude, type ClaudeOptions } from "./claude-client";
import type { GeneratedDoc } from "./doc-writer";

export interface ErrorInfo {
  statusCode: string;
  description: string;
  endpoints: string[];
}

const SYSTEM_PROMPT = `You are an expert technical writer specializing in API error handling documentation. You write clear, actionable error guides in MDX format.

Rules:
- For each error, explain what it means, why it happens, and how to fix it
- Use the <Callout type="warning"> component for common mistakes
- Use tables for structured error information
- Include example error response payloads
- Group errors logically (authentication, validation, rate limiting, server errors)
- Be practical: give developers the exact steps to resolve each error`;

/**
 * Generate a comprehensive error handling guide for the API.
 */
export async function generateErrorGuide(
  api: ParsedAPI,
  options: ClaudeOptions
): Promise<GeneratedDoc> {
  const errorMap = collectErrors(api);
  const errorSummary = buildErrorSummary(errorMap);

  const userPrompt = `Generate a comprehensive error handling guide for the "${api.name}" API.

Errors found across endpoints:
${errorSummary}

Authentication methods: ${api.auth?.map((a) => `${a.name} (${a.type})`).join(", ") ?? "None"}
Total endpoints: ${api.endpoints.length}

Write an MDX error reference guide that includes:
1. Overview of error response format
2. HTTP status codes used and their meanings
3. Common error scenarios with solutions:
   - Authentication errors (401, 403)
   - Validation errors (400, 422)
   - Not found errors (404)
   - Rate limiting (429)
   - Server errors (500, 502, 503)
4. Error response examples for each category
5. Best practices for error handling in client code
6. Retry strategies and backoff recommendations
7. How to report issues / get help`;

  const content = await generateWithClaude(SYSTEM_PROMPT, userPrompt, {
    ...options,
    maxTokens: 6000,
  });

  return {
    title: "Error Handling Guide",
    slug: "error-handling",
    contentMdx: content,
    seoTitle: `Error Handling - ${api.name} API`,
    seoDescription: `Complete error handling guide for the ${api.name} API. Learn how to handle authentication, validation, rate limiting, and server errors.`,
    pageType: "error_reference",
  };
}

/**
 * Generate error documentation for a specific endpoint.
 */
export async function generateEndpointErrorDoc(
  endpoint: ParsedEndpoint,
  api: ParsedAPI,
  options: ClaudeOptions
): Promise<string> {
  const errorResponses = endpoint.responses.filter(
    (r) => parseInt(r.statusCode, 10) >= 400
  );

  if (errorResponses.length === 0) {
    return generateDefaultErrorSection(endpoint);
  }

  const errorsDescription = errorResponses
    .map(
      (r) =>
        `${r.statusCode}: ${r.description}${
          r.contentTypes
            ? ` (schema: ${JSON.stringify(
                Object.values(r.contentTypes)[0]?.schema ?? {}
              ).slice(0, 200)})`
            : ""
        }`
    )
    .join("\n");

  const userPrompt = `Generate the error handling section for the ${endpoint.method} ${endpoint.path} endpoint.

Documented error responses:
${errorsDescription}

Authentication: ${endpoint.security ? JSON.stringify(endpoint.security) : "None specified"}
Required parameters: ${endpoint.parameters.filter((p) => p.required).map((p) => p.name).join(", ") || "None"}

Write a concise MDX section documenting:
1. Each error status code with description
2. Example error response payload
3. Common causes
4. How to fix / avoid the error`;

  return await generateWithClaude(SYSTEM_PROMPT, userPrompt, {
    ...options,
    maxTokens: 2048,
  });
}

// ─── Helpers ──────────────────────────────────────────────

function collectErrors(api: ParsedAPI): Map<string, ErrorInfo> {
  const errorMap = new Map<string, ErrorInfo>();

  for (const endpoint of api.endpoints) {
    for (const response of endpoint.responses) {
      const code = parseInt(response.statusCode, 10);
      if (code < 400) continue;

      const key = response.statusCode;
      const existing = errorMap.get(key);

      if (existing) {
        existing.endpoints.push(`${endpoint.method} ${endpoint.path}`);
      } else {
        errorMap.set(key, {
          statusCode: response.statusCode,
          description: response.description,
          endpoints: [`${endpoint.method} ${endpoint.path}`],
        });
      }
    }
  }

  return errorMap;
}

function buildErrorSummary(errorMap: Map<string, ErrorInfo>): string {
  if (errorMap.size === 0) {
    return "No explicit error responses documented in the spec. Generate based on common API patterns.";
  }

  const lines: string[] = [];
  const sorted = Array.from(errorMap.entries()).sort(
    ([a], [b]) => parseInt(a, 10) - parseInt(b, 10)
  );

  for (const [code, info] of sorted) {
    lines.push(
      `${code} - ${info.description} (used by ${info.endpoints.length} endpoint${info.endpoints.length > 1 ? "s" : ""})`
    );
  }

  return lines.join("\n");
}

function generateDefaultErrorSection(endpoint: ParsedEndpoint): string {
  const lines: string[] = [
    "## Error Responses",
    "",
    "This endpoint may return the following errors:",
    "",
    "| Status Code | Description |",
    "|-------------|-------------|",
  ];

  if (endpoint.security && endpoint.security.length > 0) {
    lines.push("| 401 | Unauthorized - Invalid or missing authentication |");
    lines.push("| 403 | Forbidden - Insufficient permissions |");
  }

  const requiredParams = endpoint.parameters.filter((p) => p.required);
  if (requiredParams.length > 0 || endpoint.requestBody?.required) {
    lines.push("| 400 | Bad Request - Invalid or missing parameters |");
    lines.push("| 422 | Unprocessable Entity - Validation error |");
  }

  if (endpoint.path.includes("{")) {
    lines.push("| 404 | Not Found - Resource does not exist |");
  }

  lines.push("| 429 | Too Many Requests - Rate limit exceeded |");
  lines.push("| 500 | Internal Server Error |");

  return lines.join("\n");
}
