import type { ParsedEndpoint, ParsedAPI, ParsedSchema } from "@docupilot/parser";
import { generateWithClaude, type ClaudeOptions } from "./claude-client";

export type SupportedLanguage =
  | "javascript"
  | "typescript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "csharp"
  | "php"
  | "ruby"
  | "swift"
  | "kotlin"
  | "curl"
  | "httpie";

export interface CodeExampleResult {
  language: SupportedLanguage;
  label: string;
  code: string;
  dependencies: Record<string, string>;
}

const LANGUAGE_CONFIG: Record<
  SupportedLanguage,
  { label: string; httpLib: string; depHint: string }
> = {
  javascript: { label: "JavaScript", httpLib: "fetch", depHint: "Uses native fetch (Node 18+)" },
  typescript: { label: "TypeScript", httpLib: "fetch", depHint: "Uses native fetch with type annotations" },
  python: { label: "Python", httpLib: "requests", depHint: "pip install requests" },
  go: { label: "Go", httpLib: "net/http", depHint: "Standard library" },
  rust: { label: "Rust", httpLib: "reqwest", depHint: 'reqwest = { version = "0.12", features = ["json"] }' },
  java: { label: "Java", httpLib: "HttpClient", depHint: "Java 11+ HttpClient" },
  csharp: { label: "C#", httpLib: "HttpClient", depHint: ".NET HttpClient" },
  php: { label: "PHP", httpLib: "Guzzle", depHint: "composer require guzzlehttp/guzzle" },
  ruby: { label: "Ruby", httpLib: "net/http", depHint: "Standard library or gem install httparty" },
  swift: { label: "Swift", httpLib: "URLSession", depHint: "Foundation framework" },
  kotlin: { label: "Kotlin", httpLib: "OkHttp", depHint: 'implementation("com.squareup.okhttp3:okhttp:4.12.0")' },
  curl: { label: "cURL", httpLib: "curl", depHint: "Command line" },
  httpie: { label: "HTTPie", httpLib: "httpie", depHint: "pip install httpie" },
};

const SYSTEM_PROMPT = `You are an expert developer who writes clean, idiomatic code examples for API documentation.

Rules:
- Write production-ready, idiomatic code for the target language
- Include proper error handling
- Include necessary imports
- Use the most popular/standard HTTP library for each language
- Add brief inline comments for clarity
- Use realistic but generic example values (not "foo", "bar")
- Return ONLY the code, no explanations or markdown fencing`;

/**
 * Generate a code example for a specific endpoint in a specific language.
 */
export async function generateCodeExample(
  endpoint: ParsedEndpoint,
  api: ParsedAPI,
  language: SupportedLanguage,
  options: ClaudeOptions
): Promise<CodeExampleResult> {
  const config = LANGUAGE_CONFIG[language];

  // For simple cases (curl, httpie), generate locally without AI
  if (language === "curl") {
    return {
      language,
      label: config.label,
      code: generateCurlExample(endpoint, api),
      dependencies: {},
    };
  }

  if (language === "httpie") {
    return {
      language,
      label: config.label,
      code: generateHttpieExample(endpoint, api),
      dependencies: {},
    };
  }

  const userPrompt = buildCodeExamplePrompt(endpoint, api, language, config);

  const code = await generateWithClaude(SYSTEM_PROMPT, userPrompt, {
    ...options,
    maxTokens: 2048,
    temperature: 0.2,
  });

  // Clean up any accidental markdown fencing
  const cleanCode = code
    .replace(/^```\w*\n?/, "")
    .replace(/\n?```$/, "")
    .trim();

  const dependencies = extractDependencies(cleanCode, language);

  return {
    language,
    label: config.label,
    code: cleanCode,
    dependencies,
  };
}

/**
 * Generate code examples in multiple languages for an endpoint.
 */
export async function generateMultiLanguageExamples(
  endpoint: ParsedEndpoint,
  api: ParsedAPI,
  languages: SupportedLanguage[],
  options: ClaudeOptions & { concurrency?: number }
): Promise<CodeExampleResult[]> {
  const concurrency = options.concurrency ?? 3;
  const results: CodeExampleResult[] = [];

  for (let i = 0; i < languages.length; i += concurrency) {
    const batch = languages.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((lang) => generateCodeExample(endpoint, api, lang, options))
    );
    results.push(...batchResults);
  }

  return results;
}

// ─── Local Generators (no AI needed) ──────────────────────

function generateCurlExample(endpoint: ParsedEndpoint, api: ParsedAPI): string {
  const baseUrl = api.baseUrl ?? "https://api.example.com";
  let path = endpoint.path;

  // Replace path params with example values
  const pathParams = endpoint.parameters.filter((p) => p.in === "path");
  for (const param of pathParams) {
    const example = param.example ?? `example_${param.name}`;
    path = path.replace(`{${param.name}}`, String(example));
  }

  const url = `${baseUrl}${path}`;
  const parts: string[] = ["curl"];

  if (endpoint.method !== "GET") {
    parts.push(`-X ${endpoint.method}`);
  }

  // Headers
  const hasAuth = api.auth && api.auth.length > 0;
  if (hasAuth) {
    const auth = api.auth![0];
    if (auth.type === "http" && auth.scheme === "bearer") {
      parts.push(`-H "Authorization: Bearer YOUR_API_KEY"`);
    } else if (auth.type === "apiKey" && auth.in === "header") {
      parts.push(`-H "${auth.paramName ?? "X-API-Key"}: YOUR_API_KEY"`);
    }
  }

  // Request body
  if (endpoint.requestBody) {
    parts.push(`-H "Content-Type: application/json"`);
    const schema = Object.values(endpoint.requestBody.contentTypes)[0]?.schema;
    if (schema) {
      const example = generateExampleFromSchema(schema);
      parts.push(`-d '${JSON.stringify(example, null, 2)}'`);
    }
  }

  // Query params
  const queryParams = endpoint.parameters.filter((p) => p.in === "query");
  const queryString = queryParams
    .filter((p) => p.required || p.example)
    .map((p) => `${p.name}=${encodeURIComponent(String(p.example ?? "value"))}`)
    .join("&");

  const fullUrl = queryString ? `${url}?${queryString}` : url;
  parts.push(`"${fullUrl}"`);

  return parts.join(" \\\n  ");
}

function generateHttpieExample(endpoint: ParsedEndpoint, api: ParsedAPI): string {
  const baseUrl = api.baseUrl ?? "https://api.example.com";
  let path = endpoint.path;

  const pathParams = endpoint.parameters.filter((p) => p.in === "path");
  for (const param of pathParams) {
    const example = param.example ?? `example_${param.name}`;
    path = path.replace(`{${param.name}}`, String(example));
  }

  const url = `${baseUrl}${path}`;
  const parts: string[] = ["http", endpoint.method, `"${url}"`];

  const hasAuth = api.auth && api.auth.length > 0;
  if (hasAuth) {
    const auth = api.auth![0];
    if (auth.type === "http" && auth.scheme === "bearer") {
      parts.push(`"Authorization: Bearer YOUR_API_KEY"`);
    }
  }

  if (endpoint.requestBody) {
    const schema = Object.values(endpoint.requestBody.contentTypes)[0]?.schema;
    if (schema && schema.properties) {
      for (const [key, prop] of Object.entries(schema.properties)) {
        const val = prop.example ?? getDefaultForType(prop.type);
        parts.push(`${key}=${JSON.stringify(val)}`);
      }
    }
  }

  return parts.join(" \\\n  ");
}

// ─── Helpers ──────────────────────────────────────────────

function buildCodeExamplePrompt(
  endpoint: ParsedEndpoint,
  api: ParsedAPI,
  language: SupportedLanguage,
  config: { label: string; httpLib: string; depHint: string }
): string {
  const baseUrl = api.baseUrl ?? "https://api.example.com";

  const paramsDesc = endpoint.parameters
    .map((p) => `- ${p.name} (${p.in}, ${p.required ? "required" : "optional"}, ${p.schema?.type ?? "string"}): ${p.description ?? ""}`)
    .join("\n");

  let bodyDesc = "No request body";
  if (endpoint.requestBody) {
    const entry = Object.entries(endpoint.requestBody.contentTypes)[0];
    if (entry) {
      const [ct, { schema }] = entry;
      bodyDesc = `Content-Type: ${ct}\n${JSON.stringify(generateExampleFromSchema(schema), null, 2)}`;
    }
  }

  const authDesc = api.auth
    ?.map((a) => {
      if (a.type === "http" && a.scheme === "bearer") return "Bearer token in Authorization header";
      if (a.type === "apiKey") return `API key in ${a.in} as "${a.paramName}"`;
      return `${a.type} authentication`;
    })
    .join(", ") ?? "None specified";

  return `Write a complete ${config.label} code example using ${config.httpLib} for this API endpoint:

Method: ${endpoint.method}
URL: ${baseUrl}${endpoint.path}
Authentication: ${authDesc}

Parameters:
${paramsDesc || "None"}

Request Body:
${bodyDesc}

Expected Response: ${endpoint.responses[0]?.statusCode ?? "200"} ${endpoint.responses[0]?.description ?? "OK"}

Requirements:
- Use ${config.httpLib} (${config.depHint})
- Include proper error handling
- Replace path parameters with example values
- Include required headers
- Show how to read and use the response`;
}

function generateExampleFromSchema(schema: ParsedSchema): unknown {
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;

  switch (schema.type) {
    case "string":
      if (schema.enum && schema.enum.length > 0) return schema.enum[0];
      if (schema.format === "email") return "user@example.com";
      if (schema.format === "date-time") return "2024-01-15T09:30:00Z";
      if (schema.format === "date") return "2024-01-15";
      if (schema.format === "uri" || schema.format === "url") return "https://example.com";
      if (schema.format === "uuid") return "550e8400-e29b-41d4-a716-446655440000";
      return "string";
    case "integer":
      return schema.minimum ?? 1;
    case "number":
      return schema.minimum ?? 1.0;
    case "boolean":
      return true;
    case "array":
      return schema.items ? [generateExampleFromSchema(schema.items)] : [];
    case "object": {
      const result: Record<string, unknown> = {};
      if (schema.properties) {
        for (const [key, prop] of Object.entries(schema.properties)) {
          result[key] = generateExampleFromSchema(prop);
        }
      }
      return result;
    }
    default:
      return null;
  }
}

function getDefaultForType(type?: string): unknown {
  switch (type) {
    case "string": return "example";
    case "integer": return 1;
    case "number": return 1.0;
    case "boolean": return true;
    case "array": return [];
    case "object": return {};
    default: return "value";
  }
}

function extractDependencies(code: string, language: SupportedLanguage): Record<string, string> {
  const deps: Record<string, string> = {};

  switch (language) {
    case "python":
      if (code.includes("import requests")) deps["requests"] = ">=2.31.0";
      if (code.includes("import httpx")) deps["httpx"] = ">=0.27.0";
      break;
    case "javascript":
    case "typescript":
      if (code.includes("require('axios')") || code.includes("from 'axios'")) deps["axios"] = "^1.7.0";
      if (code.includes("require('node-fetch')") || code.includes("from 'node-fetch'")) deps["node-fetch"] = "^3.3.0";
      break;
    case "php":
      if (code.includes("GuzzleHttp")) deps["guzzlehttp/guzzle"] = "^7.9";
      break;
    case "ruby":
      if (code.includes("httparty")) deps["httparty"] = "~> 0.22";
      break;
    case "rust":
      if (code.includes("reqwest")) deps["reqwest"] = "0.12";
      if (code.includes("serde")) deps["serde"] = "1.0";
      break;
  }

  return deps;
}
