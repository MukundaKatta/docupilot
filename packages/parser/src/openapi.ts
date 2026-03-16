import SwaggerParser from "@apidevtools/swagger-parser";
import YAML from "yaml";
import type {
  ParsedAPI,
  ParsedEndpoint,
  ParsedParameter,
  ParsedRequestBody,
  ParsedResponse,
  ParsedSchema,
  ParseResult,
  ParserOptions,
  APIAuth,
  APIServer,
  APITag,
} from "./types";

/**
 * Parse an OpenAPI 2.x (Swagger) or 3.x specification.
 * Accepts JSON string, YAML string, parsed object, or file path / URL.
 */
export async function parseOpenAPI(
  input: string | Record<string, unknown>,
  options: ParserOptions = {}
): Promise<ParseResult> {
  const errors: { path?: string; message: string; code: string }[] = [];
  const warnings: { path?: string; message: string; code: string }[] = [];

  try {
    let spec: Record<string, unknown>;

    if (typeof input === "string") {
      // Try to detect if it's a file path / URL or raw content
      if (input.startsWith("http") || input.startsWith("/") || input.startsWith("./")) {
        spec = (await SwaggerParser.parse(input)) as Record<string, unknown>;
      } else {
        // Try parsing as JSON first, then YAML
        try {
          spec = JSON.parse(input) as Record<string, unknown>;
        } catch {
          spec = YAML.parse(input) as Record<string, unknown>;
        }
      }
    } else {
      spec = input;
    }

    // Validate and dereference
    let dereferenced: Record<string, unknown>;
    if (options.validate !== false) {
      try {
        dereferenced = (await SwaggerParser.validate(
          structuredClone(spec) as never
        )) as Record<string, unknown>;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push({ message: `Validation warning: ${msg}`, code: "VALIDATION_WARNING" });
        dereferenced = (await SwaggerParser.dereference(
          structuredClone(spec) as never
        )) as Record<string, unknown>;
      }
    } else {
      dereferenced = (await SwaggerParser.dereference(
        structuredClone(spec) as never
      )) as Record<string, unknown>;
    }

    const isV2 = !!(dereferenced as { swagger?: string }).swagger;
    const api = isV2 ? parseSwagger2(dereferenced) : parseOpenAPI3(dereferenced);

    return { success: true, api, errors, warnings };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push({ message: msg, code: "PARSE_ERROR" });
    return { success: false, errors, warnings };
  }
}

// ─── OpenAPI 3.x ──────────────────────────────────────────

interface OA3Spec {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: Array<{ url: string; description?: string; variables?: Record<string, { default: string; enum?: string[]; description?: string }> }>;
  paths?: Record<string, Record<string, unknown>>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
  tags?: Array<{ name: string; description?: string }>;
  externalDocs?: { url: string; description?: string };
  security?: Array<Record<string, string[]>>;
}

function parseOpenAPI3(raw: Record<string, unknown>): ParsedAPI {
  const spec = raw as unknown as OA3Spec;

  const servers: APIServer[] = (spec.servers ?? []).map((s) => ({
    url: s.url,
    description: s.description,
    variables: s.variables,
  }));

  const auth = extractSecuritySchemes(spec.components?.securitySchemes);
  const schemas = extractSchemas(spec.components?.schemas ?? {});
  const tags: APITag[] = (spec.tags ?? []).map((t) => ({ name: t.name, description: t.description }));
  const endpoints = extractPaths(spec.paths ?? {}, spec.security);

  return {
    name: spec.info.title,
    version: spec.info.version,
    description: spec.info.description,
    baseUrl: servers[0]?.url,
    servers,
    auth,
    endpoints,
    schemas,
    tags,
    externalDocs: spec.externalDocs,
  };
}

// ─── Swagger 2.x ──────────────────────────────────────────

interface Sw2Spec {
  swagger: string;
  info: { title: string; version: string; description?: string };
  host?: string;
  basePath?: string;
  schemes?: string[];
  paths?: Record<string, Record<string, unknown>>;
  definitions?: Record<string, unknown>;
  securityDefinitions?: Record<string, unknown>;
  tags?: Array<{ name: string; description?: string }>;
  security?: Array<Record<string, string[]>>;
}

function parseSwagger2(raw: Record<string, unknown>): ParsedAPI {
  const spec = raw as unknown as Sw2Spec;
  const scheme = spec.schemes?.[0] ?? "https";
  const baseUrl = spec.host ? `${scheme}://${spec.host}${spec.basePath ?? ""}` : undefined;

  const auth = extractSecuritySchemes(spec.securityDefinitions);
  const schemas = extractSchemas(spec.definitions ?? {});
  const tags: APITag[] = (spec.tags ?? []).map((t) => ({ name: t.name, description: t.description }));
  const endpoints = extractPaths(spec.paths ?? {}, spec.security);

  return {
    name: spec.info.title,
    version: spec.info.version,
    description: spec.info.description,
    baseUrl,
    servers: baseUrl ? [{ url: baseUrl }] : [],
    auth,
    endpoints,
    schemas,
    tags,
  };
}

// ─── Shared Extraction ────────────────────────────────────

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

function extractPaths(
  paths: Record<string, Record<string, unknown>>,
  globalSecurity?: Array<Record<string, string[]>>
): ParsedEndpoint[] {
  const endpoints: ParsedEndpoint[] = [];

  for (const [path, pathItem] of Object.entries(paths)) {
    const pathParams = (pathItem.parameters as unknown[]) ?? [];

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !operation || typeof operation !== "object") continue;
      const op = operation as Record<string, unknown>;

      const params = mergeParameters(
        pathParams as Array<Record<string, unknown>>,
        (op.parameters ?? []) as Array<Record<string, unknown>>
      );

      const endpoint: ParsedEndpoint = {
        method: method.toUpperCase() as ParsedEndpoint["method"],
        path,
        operationId: op.operationId as string | undefined,
        summary: op.summary as string | undefined,
        description: op.description as string | undefined,
        tags: (op.tags as string[]) ?? [],
        deprecated: (op.deprecated as boolean) ?? false,
        parameters: params.map(convertParameter),
        requestBody: op.requestBody ? convertRequestBody(op.requestBody as Record<string, unknown>) : undefined,
        responses: convertResponses(op.responses as Record<string, unknown> ?? {}),
        security: (op.security as Array<Record<string, string[]>>) ?? globalSecurity,
      };

      endpoints.push(endpoint);
    }
  }

  return endpoints;
}

function mergeParameters(
  pathParams: Array<Record<string, unknown>>,
  opParams: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const p of pathParams) {
    map.set(`${p.in}:${p.name}`, p);
  }
  for (const p of opParams) {
    map.set(`${p.in}:${p.name}`, p);
  }
  return Array.from(map.values());
}

function convertParameter(raw: Record<string, unknown>): ParsedParameter {
  return {
    name: raw.name as string,
    in: raw.in as ParsedParameter["in"],
    required: (raw.required as boolean) ?? (raw.in === "path"),
    description: raw.description as string | undefined,
    schema: raw.schema ? convertSchema(raw.schema as Record<string, unknown>) : undefined,
    example: raw.example,
    deprecated: raw.deprecated as boolean | undefined,
  };
}

function convertRequestBody(raw: Record<string, unknown>): ParsedRequestBody {
  const content = raw.content as Record<string, Record<string, unknown>> | undefined;
  const contentTypes: ParsedRequestBody["contentTypes"] = {};

  if (content) {
    for (const [ct, mediaType] of Object.entries(content)) {
      contentTypes[ct] = {
        schema: convertSchema((mediaType.schema ?? {}) as Record<string, unknown>),
        examples: mediaType.examples as Record<string, unknown> | undefined,
      };
    }
  }

  return {
    description: raw.description as string | undefined,
    required: (raw.required as boolean) ?? false,
    contentTypes,
  };
}

function convertResponses(raw: Record<string, unknown>): ParsedResponse[] {
  const responses: ParsedResponse[] = [];

  for (const [statusCode, response] of Object.entries(raw)) {
    if (!response || typeof response !== "object") continue;
    const resp = response as Record<string, unknown>;
    const content = resp.content as Record<string, Record<string, unknown>> | undefined;
    const contentTypes: ParsedResponse["contentTypes"] = {};

    if (content) {
      for (const [ct, mediaType] of Object.entries(content)) {
        contentTypes[ct] = {
          schema: convertSchema((mediaType.schema ?? {}) as Record<string, unknown>),
          examples: mediaType.examples as Record<string, unknown> | undefined,
        };
      }
    }

    responses.push({
      statusCode,
      description: (resp.description as string) ?? "",
      contentTypes: Object.keys(contentTypes).length > 0 ? contentTypes : undefined,
    });
  }

  return responses;
}

function convertSchema(raw: Record<string, unknown>): ParsedSchema {
  const schema: ParsedSchema = {};

  if (raw.type) schema.type = raw.type as ParsedSchema["type"];
  if (raw.title) schema.title = raw.title as string;
  if (raw.description) schema.description = raw.description as string;
  if (raw.format) schema.format = raw.format as string;
  if (raw.required) schema.required = raw.required as string[];
  if (raw.enum) schema.enum = raw.enum as unknown[];
  if (raw.default !== undefined) schema.default = raw.default;
  if (raw.example !== undefined) schema.example = raw.example;
  if (raw.nullable) schema.nullable = raw.nullable as boolean;
  if (raw.minimum !== undefined) schema.minimum = raw.minimum as number;
  if (raw.maximum !== undefined) schema.maximum = raw.maximum as number;
  if (raw.minLength !== undefined) schema.minLength = raw.minLength as number;
  if (raw.maxLength !== undefined) schema.maxLength = raw.maxLength as number;
  if (raw.pattern) schema.pattern = raw.pattern as string;
  if (raw.$ref) schema.ref = raw.$ref as string;
  if (raw.additionalProperties !== undefined) {
    schema.additionalProperties =
      typeof raw.additionalProperties === "boolean"
        ? raw.additionalProperties
        : convertSchema(raw.additionalProperties as Record<string, unknown>);
  }

  if (raw.properties && typeof raw.properties === "object") {
    schema.properties = {};
    for (const [key, val] of Object.entries(raw.properties as Record<string, unknown>)) {
      schema.properties[key] = convertSchema(val as Record<string, unknown>);
    }
  }

  if (raw.items && typeof raw.items === "object") {
    schema.items = convertSchema(raw.items as Record<string, unknown>);
  }

  if (raw.oneOf) schema.oneOf = (raw.oneOf as unknown[]).map((s) => convertSchema(s as Record<string, unknown>));
  if (raw.anyOf) schema.anyOf = (raw.anyOf as unknown[]).map((s) => convertSchema(s as Record<string, unknown>));
  if (raw.allOf) schema.allOf = (raw.allOf as unknown[]).map((s) => convertSchema(s as Record<string, unknown>));

  return schema;
}

function extractSchemas(raw: Record<string, unknown>): Record<string, ParsedSchema> {
  const schemas: Record<string, ParsedSchema> = {};
  for (const [name, schema] of Object.entries(raw)) {
    if (schema && typeof schema === "object") {
      schemas[name] = convertSchema(schema as Record<string, unknown>);
    }
  }
  return schemas;
}

function extractSecuritySchemes(raw?: Record<string, unknown>): APIAuth[] {
  if (!raw) return [];
  const auth: APIAuth[] = [];

  for (const [name, scheme] of Object.entries(raw)) {
    if (!scheme || typeof scheme !== "object") continue;
    const s = scheme as Record<string, unknown>;

    auth.push({
      name,
      type: s.type as APIAuth["type"],
      scheme: s.scheme as string | undefined,
      bearerFormat: s.bearerFormat as string | undefined,
      in: s.in as APIAuth["in"],
      paramName: s.name as string | undefined,
      flows: s.flows as Record<string, { authorizationUrl?: string; tokenUrl?: string; refreshUrl?: string; scopes: Record<string, string> }> | undefined,
    });
  }

  return auth;
}
