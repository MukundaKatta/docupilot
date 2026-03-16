import type {
  ParsedAPI,
  ParsedEndpoint,
  ParsedParameter,
  ParsedRequestBody,
  ParsedResponse,
  ParsedSchema,
  ParseResult,
  APITag,
} from "./types";

/**
 * Parse a Postman Collection v2.1 format into our unified API representation.
 */
export async function parsePostman(
  input: string | Record<string, unknown>
): Promise<ParseResult> {
  const errors: { path?: string; message: string; code: string }[] = [];
  const warnings: { path?: string; message: string; code: string }[] = [];

  try {
    let collection: PostmanCollection;

    if (typeof input === "string") {
      collection = JSON.parse(input) as PostmanCollection;
    } else {
      collection = input as unknown as PostmanCollection;
    }

    if (!collection.info || !collection.item) {
      errors.push({ message: "Invalid Postman collection: missing info or item fields", code: "INVALID_COLLECTION" });
      return { success: false, errors, warnings };
    }

    const endpoints: ParsedEndpoint[] = [];
    const tags: APITag[] = [];
    const schemas: Record<string, ParsedSchema> = {};

    // Recursively extract items from folders
    extractItems(collection.item, endpoints, tags, []);

    // Try to extract schemas from responses
    for (const endpoint of endpoints) {
      for (const response of endpoint.responses) {
        if (response.contentTypes?.["application/json"]?.schema) {
          const schema = response.contentTypes["application/json"].schema;
          if (schema.title) {
            schemas[schema.title] = schema;
          }
        }
      }
    }

    const api: ParsedAPI = {
      name: collection.info.name,
      version: collection.info.version ?? "1.0.0",
      description: collection.info.description,
      baseUrl: extractBaseUrl(endpoints),
      endpoints,
      schemas,
      tags,
    };

    return { success: true, api, errors, warnings };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push({ message: msg, code: "POSTMAN_PARSE_ERROR" });
    return { success: false, errors, warnings };
  }
}

// ─── Postman Types ────────────────────────────────────────

interface PostmanCollection {
  info: {
    name: string;
    description?: string;
    version?: string;
    schema: string;
  };
  item: PostmanItem[];
  variable?: PostmanVariable[];
  auth?: PostmanAuth;
}

interface PostmanItem {
  name: string;
  description?: string;
  item?: PostmanItem[]; // folder
  request?: PostmanRequest;
  response?: PostmanResponse[];
}

interface PostmanRequest {
  method: string;
  header?: PostmanHeader[];
  body?: PostmanBody;
  url: PostmanUrl | string;
  description?: string;
  auth?: PostmanAuth;
}

interface PostmanUrl {
  raw?: string;
  protocol?: string;
  host?: string[];
  path?: string[];
  query?: PostmanQuery[];
  variable?: PostmanVariable[];
}

interface PostmanQuery {
  key: string;
  value?: string;
  description?: string;
  disabled?: boolean;
}

interface PostmanVariable {
  key: string;
  value?: string;
  description?: string;
  type?: string;
}

interface PostmanHeader {
  key: string;
  value: string;
  description?: string;
  disabled?: boolean;
}

interface PostmanBody {
  mode: "raw" | "urlencoded" | "formdata" | "file" | "graphql";
  raw?: string;
  options?: { raw?: { language?: string } };
  urlencoded?: Array<{ key: string; value?: string; description?: string; type?: string }>;
  formdata?: Array<{ key: string; value?: string; description?: string; type?: string }>;
}

interface PostmanResponse {
  name: string;
  status?: string;
  code?: number;
  header?: PostmanHeader[];
  body?: string;
  _postman_previewlanguage?: string;
}

interface PostmanAuth {
  type: string;
  apikey?: Array<{ key: string; value: string }>;
  bearer?: Array<{ key: string; value: string }>;
  basic?: Array<{ key: string; value: string }>;
}

// ─── Extraction ───────────────────────────────────────────

function extractItems(
  items: PostmanItem[],
  endpoints: ParsedEndpoint[],
  tags: APITag[],
  parentPath: string[]
): void {
  for (const item of items) {
    if (item.item) {
      // It's a folder — use as tag
      const tagName = [...parentPath, item.name].join(" / ");
      tags.push({ name: tagName, description: item.description });
      extractItems(item.item, endpoints, tags, [...parentPath, item.name]);
    } else if (item.request) {
      const tagName = parentPath.join(" / ") || "Default";
      endpoints.push(convertPostmanRequest(item, tagName));
    }
  }
}

function convertPostmanRequest(item: PostmanItem, tag: string): ParsedEndpoint {
  const req = item.request!;
  const url = normalizeUrl(req.url);
  const path = buildPath(url);
  const method = (req.method ?? "GET").toUpperCase() as ParsedEndpoint["method"];

  const parameters: ParsedParameter[] = [];

  // Path variables
  if (url.variable) {
    for (const v of url.variable) {
      parameters.push({
        name: v.key,
        in: "path",
        required: true,
        description: v.description,
        schema: { type: "string" },
        example: v.value,
      });
    }
  }

  // Query parameters
  if (url.query) {
    for (const q of url.query) {
      if (q.disabled) continue;
      parameters.push({
        name: q.key,
        in: "query",
        required: false,
        description: q.description,
        schema: { type: "string" },
        example: q.value,
      });
    }
  }

  // Headers
  if (req.header) {
    for (const h of req.header) {
      if (h.disabled) continue;
      if (h.key.toLowerCase() === "content-type") continue;
      parameters.push({
        name: h.key,
        in: "header",
        required: false,
        description: h.description,
        schema: { type: "string" },
        example: h.value,
      });
    }
  }

  // Request body
  let requestBody: ParsedRequestBody | undefined;
  if (req.body) {
    requestBody = convertPostmanBody(req.body);
  }

  // Responses
  const responses: ParsedResponse[] = [];
  if (item.response && item.response.length > 0) {
    for (const resp of item.response) {
      responses.push(convertPostmanResponse(resp));
    }
  } else {
    responses.push({ statusCode: "200", description: "Successful response" });
  }

  return {
    method,
    path,
    operationId: item.name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase(),
    summary: item.name,
    description: item.description ?? req.description,
    tags: [tag],
    deprecated: false,
    parameters,
    requestBody,
    responses,
  };
}

function normalizeUrl(url: PostmanUrl | string): PostmanUrl {
  if (typeof url === "string") {
    try {
      const parsed = new URL(url);
      return {
        raw: url,
        protocol: parsed.protocol.replace(":", ""),
        host: parsed.hostname.split("."),
        path: parsed.pathname.split("/").filter(Boolean),
        query: Array.from(parsed.searchParams.entries()).map(([key, value]) => ({ key, value })),
      };
    } catch {
      return { raw: url, path: url.split("/").filter(Boolean) };
    }
  }
  return url;
}

function buildPath(url: PostmanUrl): string {
  const parts = url.path ?? [];
  const path = "/" + parts.map((p) => {
    // Convert :param and {{param}} to {param}
    if (p.startsWith(":")) return `{${p.slice(1)}}`;
    if (p.startsWith("{{") && p.endsWith("}}")) return `{${p.slice(2, -2)}}`;
    return p;
  }).join("/");
  return path;
}

function convertPostmanBody(body: PostmanBody): ParsedRequestBody {
  const contentTypes: ParsedRequestBody["contentTypes"] = {};

  switch (body.mode) {
    case "raw": {
      const lang = body.options?.raw?.language ?? "json";
      const ct = lang === "json" ? "application/json" : lang === "xml" ? "application/xml" : "text/plain";
      let schema: ParsedSchema = { type: "string" };

      if (lang === "json" && body.raw) {
        try {
          const parsed = JSON.parse(body.raw);
          schema = inferSchemaFromValue(parsed);
        } catch {
          // raw body that isn't valid JSON
        }
      }

      contentTypes[ct] = { schema, examples: body.raw ? { default: tryParseJSON(body.raw) } : undefined };
      break;
    }
    case "urlencoded": {
      const properties: Record<string, ParsedSchema> = {};
      for (const item of body.urlencoded ?? []) {
        properties[item.key] = { type: "string", description: item.description, example: item.value };
      }
      contentTypes["application/x-www-form-urlencoded"] = {
        schema: { type: "object", properties },
      };
      break;
    }
    case "formdata": {
      const properties: Record<string, ParsedSchema> = {};
      for (const item of body.formdata ?? []) {
        properties[item.key] = {
          type: item.type === "file" ? "string" : "string",
          format: item.type === "file" ? "binary" : undefined,
          description: item.description,
          example: item.value,
        };
      }
      contentTypes["multipart/form-data"] = {
        schema: { type: "object", properties },
      };
      break;
    }
  }

  return { required: true, contentTypes };
}

function convertPostmanResponse(resp: PostmanResponse): ParsedResponse {
  const statusCode = String(resp.code ?? 200);
  const result: ParsedResponse = {
    statusCode,
    description: resp.name ?? resp.status ?? `Status ${statusCode}`,
  };

  if (resp.body) {
    const lang = resp._postman_previewlanguage ?? "json";
    const ct = lang === "json" ? "application/json" : lang === "xml" ? "application/xml" : "text/plain";

    let schema: ParsedSchema = { type: "string" };
    if (lang === "json") {
      try {
        const parsed = JSON.parse(resp.body);
        schema = inferSchemaFromValue(parsed);
      } catch {
        // leave as string
      }
    }

    result.contentTypes = { [ct]: { schema, examples: { default: tryParseJSON(resp.body) } } };
  }

  return result;
}

function inferSchemaFromValue(value: unknown): ParsedSchema {
  if (value === null) return { type: "null" };
  if (typeof value === "string") return { type: "string", example: value };
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number", example: value };
  if (typeof value === "boolean") return { type: "boolean", example: value };

  if (Array.isArray(value)) {
    return {
      type: "array",
      items: value.length > 0 ? inferSchemaFromValue(value[0]) : { type: "string" },
      example: value,
    };
  }

  if (typeof value === "object") {
    const properties: Record<string, ParsedSchema> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      properties[key] = inferSchemaFromValue(val);
    }
    return { type: "object", properties };
  }

  return { type: "string" };
}

function tryParseJSON(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

function extractBaseUrl(endpoints: ParsedEndpoint[]): string | undefined {
  // Not derivable from endpoints alone in Postman format
  return undefined;
}
