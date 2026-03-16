/** Unified internal representation of a parsed API */

export interface ParsedAPI {
  name: string;
  version: string;
  description?: string;
  baseUrl?: string;
  servers?: APIServer[];
  auth?: APIAuth[];
  endpoints: ParsedEndpoint[];
  schemas: Record<string, ParsedSchema>;
  tags: APITag[];
  externalDocs?: { url: string; description?: string };
}

export interface APIServer {
  url: string;
  description?: string;
  variables?: Record<string, { default: string; enum?: string[]; description?: string }>;
}

export interface APIAuth {
  name: string;
  type: "apiKey" | "http" | "oauth2" | "openIdConnect";
  scheme?: string;
  bearerFormat?: string;
  in?: "header" | "query" | "cookie";
  paramName?: string;
  flows?: Record<string, OAuthFlow>;
}

export interface OAuthFlow {
  authorizationUrl?: string;
  tokenUrl?: string;
  refreshUrl?: string;
  scopes: Record<string, string>;
}

export interface ParsedEndpoint {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "QUERY" | "MUTATION" | "SUBSCRIPTION" | "RPC";
  path: string;
  operationId?: string;
  summary?: string;
  description?: string;
  tags: string[];
  deprecated: boolean;
  parameters: ParsedParameter[];
  requestBody?: ParsedRequestBody;
  responses: ParsedResponse[];
  security?: Array<Record<string, string[]>>;
}

export interface ParsedParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie" | "body" | "argument";
  required: boolean;
  description?: string;
  schema?: ParsedSchema;
  example?: unknown;
  deprecated?: boolean;
}

export interface ParsedRequestBody {
  description?: string;
  required: boolean;
  contentTypes: Record<string, { schema: ParsedSchema; examples?: Record<string, unknown> }>;
}

export interface ParsedResponse {
  statusCode: string;
  description: string;
  contentTypes?: Record<string, { schema: ParsedSchema; examples?: Record<string, unknown> }>;
  headers?: Record<string, { description?: string; schema?: ParsedSchema }>;
}

export interface ParsedSchema {
  type?: "string" | "number" | "integer" | "boolean" | "array" | "object" | "null" | "enum" | "union" | "scalar";
  title?: string;
  description?: string;
  format?: string;
  required?: string[];
  properties?: Record<string, ParsedSchema>;
  items?: ParsedSchema;
  enum?: unknown[];
  default?: unknown;
  example?: unknown;
  nullable?: boolean;
  oneOf?: ParsedSchema[];
  anyOf?: ParsedSchema[];
  allOf?: ParsedSchema[];
  ref?: string;
  additionalProperties?: boolean | ParsedSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface APITag {
  name: string;
  description?: string;
}

export interface ParseResult {
  success: boolean;
  api?: ParsedAPI;
  errors: ParseError[];
  warnings: ParseWarning[];
}

export interface ParseError {
  path?: string;
  message: string;
  code: string;
}

export interface ParseWarning {
  path?: string;
  message: string;
  code: string;
}

export interface ParserOptions {
  /** Resolve external $ref references */
  resolveExternalRefs?: boolean;
  /** Validate the spec against its schema */
  validate?: boolean;
  /** Base URL for resolving relative $ref paths */
  baseUrl?: string;
}
