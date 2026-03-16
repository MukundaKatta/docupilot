import * as fs from "node:fs";
import * as path from "node:path";
import { glob } from "glob";
import type {
  ParsedAPI,
  ParsedEndpoint,
  ParsedParameter,
  ParsedSchema,
  ParsedResponse,
  ParseResult,
  APITag,
} from "./types";

/**
 * Scan a codebase directory for API routes / endpoints.
 * Supports:
 * - Next.js App Router (app/**/route.ts)
 * - Next.js Pages API (pages/api/**/*.ts)
 * - Express.js patterns (app.get, router.post, etc.)
 * - Fastify patterns (fastify.get, etc.)
 * - NestJS decorators (@Get, @Post, etc.)
 */
export async function parseCodebase(
  directory: string,
  options: CodebaseScanOptions = {}
): Promise<ParseResult> {
  const errors: { path?: string; message: string; code: string }[] = [];
  const warnings: { path?: string; message: string; code: string }[] = [];

  try {
    const absDir = path.resolve(directory);
    if (!fs.existsSync(absDir)) {
      errors.push({ message: `Directory not found: ${absDir}`, code: "DIR_NOT_FOUND" });
      return { success: false, errors, warnings };
    }

    const endpoints: ParsedEndpoint[] = [];
    const tagsSet = new Set<string>();

    // Detect framework and scan accordingly
    const framework = options.framework ?? detectFramework(absDir);

    switch (framework) {
      case "nextjs-app":
        await scanNextAppRouter(absDir, endpoints, tagsSet, warnings);
        break;
      case "nextjs-pages":
        await scanNextPagesAPI(absDir, endpoints, tagsSet, warnings);
        break;
      case "express":
        await scanExpress(absDir, endpoints, tagsSet, warnings);
        break;
      case "fastify":
        await scanExpress(absDir, endpoints, tagsSet, warnings); // similar patterns
        break;
      case "nestjs":
        await scanNestJS(absDir, endpoints, tagsSet, warnings);
        break;
      default:
        // Try all scanners
        await scanNextAppRouter(absDir, endpoints, tagsSet, warnings);
        await scanNextPagesAPI(absDir, endpoints, tagsSet, warnings);
        await scanExpress(absDir, endpoints, tagsSet, warnings);
        await scanNestJS(absDir, endpoints, tagsSet, warnings);
    }

    if (endpoints.length === 0) {
      warnings.push({ message: "No API endpoints found in codebase", code: "NO_ENDPOINTS" });
    }

    const tags: APITag[] = Array.from(tagsSet).map((name) => ({ name }));

    const api: ParsedAPI = {
      name: options.projectName ?? path.basename(absDir),
      version: "1.0.0",
      description: `API endpoints discovered from ${framework ?? "codebase"} scan`,
      endpoints,
      schemas: {},
      tags,
    };

    return { success: true, api, errors, warnings };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push({ message: msg, code: "CODEBASE_SCAN_ERROR" });
    return { success: false, errors, warnings };
  }
}

export interface CodebaseScanOptions {
  framework?: "nextjs-app" | "nextjs-pages" | "express" | "fastify" | "nestjs";
  projectName?: string;
  ignore?: string[];
}

// ─── Framework Detection ──────────────────────────────────

function detectFramework(dir: string): string | undefined {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return undefined;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps["next"]) {
      // Check for app router
      if (fs.existsSync(path.join(dir, "app")) || fs.existsSync(path.join(dir, "src/app"))) {
        return "nextjs-app";
      }
      return "nextjs-pages";
    }
    if (deps["@nestjs/core"]) return "nestjs";
    if (deps["fastify"]) return "fastify";
    if (deps["express"]) return "express";
  } catch {
    // ignore
  }

  return undefined;
}

// ─── Next.js App Router Scanner ───────────────────────────

async function scanNextAppRouter(
  dir: string,
  endpoints: ParsedEndpoint[],
  tags: Set<string>,
  warnings: Array<{ path?: string; message: string; code: string }>
): Promise<void> {
  const patterns = [
    path.join(dir, "app/**/route.{ts,tsx,js,jsx}"),
    path.join(dir, "src/app/**/route.{ts,tsx,js,jsx}"),
  ];

  for (const pattern of patterns) {
    const files = await glob(pattern, { ignore: ["**/node_modules/**"] });

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, "utf-8");
        const relativePath = path.relative(dir, file);
        const routePath = extractNextAppRoutePath(relativePath);
        const methods = extractExportedMethods(content);

        const tag = extractRouteTag(routePath);
        tags.add(tag);

        for (const method of methods) {
          const params = extractPathParams(routePath);
          const { summary, description } = extractJSDocComments(content, method);

          endpoints.push({
            method: method as ParsedEndpoint["method"],
            path: routePath,
            operationId: `${method.toLowerCase()}_${routePath.replace(/[^a-zA-Z0-9]/g, "_")}`,
            summary,
            description,
            tags: [tag],
            deprecated: content.includes("@deprecated"),
            parameters: params,
            responses: [{ statusCode: "200", description: "Successful response" }],
          });
        }
      } catch (err) {
        warnings.push({
          path: file,
          message: `Failed to parse: ${err instanceof Error ? err.message : String(err)}`,
          code: "PARSE_FILE_ERROR",
        });
      }
    }
  }
}

function extractNextAppRoutePath(relativePath: string): string {
  // Remove app/ or src/app/ prefix and route.ts suffix
  let routePath = relativePath
    .replace(/^src\//, "")
    .replace(/^app\//, "")
    .replace(/\/route\.(ts|tsx|js|jsx)$/, "");

  // Convert Next.js dynamic segments: [param] -> {param}, [...param] -> {param}
  routePath = routePath
    .replace(/\[\.\.\.(\w+)\]/g, "{$1}")
    .replace(/\[(\w+)\]/g, "{$1}");

  // Handle route groups: (group) segments are removed
  routePath = routePath.replace(/\([^)]+\)\//g, "").replace(/\([^)]+\)$/, "");

  return "/" + (routePath || "").replace(/^\//, "");
}

function extractExportedMethods(content: string): string[] {
  const methods: string[] = [];
  const methodNames = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

  for (const method of methodNames) {
    // Match: export async function GET, export function GET, export const GET
    const patterns = [
      new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`),
      new RegExp(`export\\s+const\\s+${method}\\s*=`),
    ];
    if (patterns.some((p) => p.test(content))) {
      methods.push(method);
    }
  }

  return methods;
}

// ─── Next.js Pages API Scanner ────────────────────────────

async function scanNextPagesAPI(
  dir: string,
  endpoints: ParsedEndpoint[],
  tags: Set<string>,
  warnings: Array<{ path?: string; message: string; code: string }>
): Promise<void> {
  const patterns = [
    path.join(dir, "pages/api/**/*.{ts,tsx,js,jsx}"),
    path.join(dir, "src/pages/api/**/*.{ts,tsx,js,jsx}"),
  ];

  for (const pattern of patterns) {
    const files = await glob(pattern, { ignore: ["**/node_modules/**"] });

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, "utf-8");
        const relativePath = path.relative(dir, file);
        let routePath = relativePath
          .replace(/^src\//, "")
          .replace(/^pages/, "")
          .replace(/\.(ts|tsx|js|jsx)$/, "")
          .replace(/\/index$/, "");

        // Convert dynamic segments
        routePath = routePath
          .replace(/\[\.\.\.(\w+)\]/g, "{$1}")
          .replace(/\[(\w+)\]/g, "{$1}");

        if (!routePath.startsWith("/")) routePath = "/" + routePath;

        const tag = extractRouteTag(routePath);
        tags.add(tag);

        // In Pages API, the handler checks req.method
        const methods = extractPagesAPIMethods(content);

        for (const method of methods) {
          const params = extractPathParams(routePath);
          endpoints.push({
            method: method as ParsedEndpoint["method"],
            path: routePath,
            operationId: `${method.toLowerCase()}_${routePath.replace(/[^a-zA-Z0-9]/g, "_")}`,
            summary: `${method} ${routePath}`,
            tags: [tag],
            deprecated: false,
            parameters: params,
            responses: [{ statusCode: "200", description: "Successful response" }],
          });
        }
      } catch (err) {
        warnings.push({
          path: file,
          message: `Failed to parse: ${err instanceof Error ? err.message : String(err)}`,
          code: "PARSE_FILE_ERROR",
        });
      }
    }
  }
}

function extractPagesAPIMethods(content: string): string[] {
  const methods: string[] = [];
  const methodChecks = content.match(/req\.method\s*===?\s*['"](\w+)['"]/g);

  if (methodChecks) {
    for (const check of methodChecks) {
      const match = check.match(/['"](\w+)['"]/);
      if (match) methods.push(match[1]);
    }
  }

  // If no method checks found, assume it handles all methods or just GET/POST
  if (methods.length === 0) {
    if (content.includes("export default")) {
      methods.push("GET", "POST");
    }
  }

  return [...new Set(methods)];
}

// ─── Express/Fastify Scanner ──────────────────────────────

async function scanExpress(
  dir: string,
  endpoints: ParsedEndpoint[],
  tags: Set<string>,
  warnings: Array<{ path?: string; message: string; code: string }>
): Promise<void> {
  const files = await glob(path.join(dir, "**/*.{ts,js}"), {
    ignore: ["**/node_modules/**", "**/dist/**", "**/*.test.*", "**/*.spec.*"],
  });

  const routePattern =
    /(?:app|router|server|fastify)\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, "utf-8");
      let match: RegExpExecArray | null;

      while ((match = routePattern.exec(content)) !== null) {
        const method = match[1].toUpperCase();
        let routePath = match[2];

        // Convert Express :param to {param}
        routePath = routePath.replace(/:(\w+)/g, "{$1}");

        const tag = extractRouteTag(routePath);
        tags.add(tag);

        const params = extractPathParams(routePath);
        const { summary, description } = extractJSDocComments(content, method);

        endpoints.push({
          method: method as ParsedEndpoint["method"],
          path: routePath,
          operationId: `${method.toLowerCase()}_${routePath.replace(/[^a-zA-Z0-9]/g, "_")}`,
          summary: summary ?? `${method} ${routePath}`,
          description,
          tags: [tag],
          deprecated: false,
          parameters: params,
          responses: [{ statusCode: "200", description: "Successful response" }],
        });
      }
    } catch (err) {
      warnings.push({
        path: file,
        message: `Failed to parse: ${err instanceof Error ? err.message : String(err)}`,
        code: "PARSE_FILE_ERROR",
      });
    }
  }
}

// ─── NestJS Scanner ───────────────────────────────────────

async function scanNestJS(
  dir: string,
  endpoints: ParsedEndpoint[],
  tags: Set<string>,
  warnings: Array<{ path?: string; message: string; code: string }>
): Promise<void> {
  const files = await glob(path.join(dir, "**/*.controller.{ts,js}"), {
    ignore: ["**/node_modules/**", "**/dist/**"],
  });

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, "utf-8");

      // Extract controller path
      const controllerMatch = content.match(/@Controller\s*\(\s*['"`]([^'"`]*)['"`]\s*\)/);
      const basePath = controllerMatch ? `/${controllerMatch[1].replace(/^\//, "")}` : "";

      // Extract controller name as tag
      const classMatch = content.match(/class\s+(\w+)/);
      const tag = classMatch ? classMatch[1].replace("Controller", "") : "Default";
      tags.add(tag);

      // Extract route decorators
      const decoratorPattern =
        /@(Get|Post|Put|Patch|Delete|Head|Options)\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/gi;
      let match: RegExpExecArray | null;

      while ((match = decoratorPattern.exec(content)) !== null) {
        const method = match[1].toUpperCase();
        const routeSuffix = match[2] ?? "";
        let routePath = `${basePath}/${routeSuffix}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";

        // Convert NestJS :param to {param}
        routePath = routePath.replace(/:(\w+)/g, "{$1}");

        const params = extractPathParams(routePath);

        // Try to extract the method name and JSDoc
        const methodNameMatch = content
          .slice(match.index)
          .match(/@(?:Get|Post|Put|Patch|Delete|Head|Options)[^]*?(?:async\s+)?(\w+)\s*\(/);
        const methodName = methodNameMatch?.[1] ?? routePath;
        const { summary, description } = extractJSDocComments(content, methodName);

        endpoints.push({
          method: method as ParsedEndpoint["method"],
          path: routePath,
          operationId: `${tag.toLowerCase()}_${methodName}`,
          summary: summary ?? `${method} ${routePath}`,
          description,
          tags: [tag],
          deprecated: content.slice(Math.max(0, match.index - 200), match.index).includes("@deprecated"),
          parameters: params,
          responses: [{ statusCode: "200", description: "Successful response" }],
        });
      }
    } catch (err) {
      warnings.push({
        path: file,
        message: `Failed to parse: ${err instanceof Error ? err.message : String(err)}`,
        code: "PARSE_FILE_ERROR",
      });
    }
  }
}

// ─── Utilities ────────────────────────────────────────────

function extractPathParams(routePath: string): ParsedParameter[] {
  const params: ParsedParameter[] = [];
  const paramPattern = /\{(\w+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = paramPattern.exec(routePath)) !== null) {
    params.push({
      name: match[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    });
  }

  return params;
}

function extractRouteTag(routePath: string): string {
  const parts = routePath.split("/").filter(Boolean);
  // Use the first non-param segment
  for (const part of parts) {
    if (!part.startsWith("{") && part !== "api") {
      return part.charAt(0).toUpperCase() + part.slice(1);
    }
  }
  return "Default";
}

function extractJSDocComments(
  content: string,
  identifier: string
): { summary?: string; description?: string } {
  // Look for JSDoc block before the identifier
  const pattern = new RegExp(
    `/\\*\\*([^]*?)\\*/[\\s\\n]*(?:export\\s+)?(?:async\\s+)?(?:function\\s+)?${identifier}`,
    "i"
  );
  const match = content.match(pattern);

  if (!match) return {};

  const block = match[1];
  const lines = block
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, "").trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("@"));

  return {
    summary: lines[0],
    description: lines.length > 1 ? lines.join("\n") : undefined,
  };
}
