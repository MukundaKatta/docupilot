import {
  buildClientSchema,
  buildSchema,
  getIntrospectionQuery,
  type GraphQLSchema,
  type GraphQLObjectType,
  type GraphQLField,
  type GraphQLArgument,
  type GraphQLOutputType,
  type GraphQLInputType,
  type GraphQLNamedType,
  isObjectType,
  isInputObjectType,
  isEnumType,
  isUnionType,
  isListType,
  isNonNullType,
  isScalarType,
  isInterfaceType,
} from "graphql";
import type {
  ParsedAPI,
  ParsedEndpoint,
  ParsedParameter,
  ParsedResponse,
  ParsedSchema,
  ParseResult,
  APITag,
} from "./types";

/**
 * Parse a GraphQL schema from:
 * - SDL string (type Query { ... })
 * - Introspection result JSON
 * - A URL to introspect
 */
export async function parseGraphQL(
  input: string | Record<string, unknown>,
  options: { url?: string; headers?: Record<string, string> } = {}
): Promise<ParseResult> {
  const errors: { path?: string; message: string; code: string }[] = [];
  const warnings: { path?: string; message: string; code: string }[] = [];

  try {
    let schema: GraphQLSchema;

    if (typeof input === "string" && (input.includes("type ") || input.includes("schema "))) {
      // SDL string
      schema = buildSchema(input);
    } else if (typeof input === "string" && input.startsWith("http")) {
      // URL to introspect
      const introspectionResult = await fetchIntrospection(input, options.headers);
      schema = buildClientSchema(introspectionResult.data);
    } else if (typeof input === "object" && input.data) {
      // Introspection result
      schema = buildClientSchema(input.data as never);
    } else if (typeof input === "object" && input.__schema) {
      schema = buildClientSchema({ __schema: input.__schema } as never);
    } else if (typeof input === "string") {
      // Try to parse as JSON introspection
      const parsed = JSON.parse(input);
      if (parsed.data) {
        schema = buildClientSchema(parsed.data);
      } else if (parsed.__schema) {
        schema = buildClientSchema(parsed);
      } else {
        throw new Error("Unrecognized GraphQL input format");
      }
    } else {
      throw new Error("Unrecognized GraphQL input format");
    }

    const api = convertGraphQLSchema(schema, options.url);
    return { success: true, api, errors, warnings };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push({ message: msg, code: "GRAPHQL_PARSE_ERROR" });
    return { success: false, errors, warnings };
  }
}

async function fetchIntrospection(
  url: string,
  headers?: Record<string, string>
): Promise<{ data: never }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ query: getIntrospectionQuery() }),
  });

  if (!response.ok) {
    throw new Error(`Introspection request failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<{ data: never }>;
}

function convertGraphQLSchema(schema: GraphQLSchema, url?: string): ParsedAPI {
  const endpoints: ParsedEndpoint[] = [];
  const schemas: Record<string, ParsedSchema> = {};
  const tagsSet = new Set<string>();

  // Extract queries
  const queryType = schema.getQueryType();
  if (queryType) {
    const fields = queryType.getFields();
    for (const [name, field] of Object.entries(fields)) {
      endpoints.push(convertField(name, field, "QUERY"));
      tagsSet.add("Query");
    }
  }

  // Extract mutations
  const mutationType = schema.getMutationType();
  if (mutationType) {
    const fields = mutationType.getFields();
    for (const [name, field] of Object.entries(fields)) {
      endpoints.push(convertField(name, field, "MUTATION"));
      tagsSet.add("Mutation");
    }
  }

  // Extract subscriptions
  const subscriptionType = schema.getSubscriptionType();
  if (subscriptionType) {
    const fields = subscriptionType.getFields();
    for (const [name, field] of Object.entries(fields)) {
      endpoints.push(convertField(name, field, "SUBSCRIPTION"));
      tagsSet.add("Subscription");
    }
  }

  // Extract types as schemas
  const typeMap = schema.getTypeMap();
  for (const [typeName, type] of Object.entries(typeMap)) {
    if (typeName.startsWith("__")) continue; // skip introspection types
    schemas[typeName] = convertType(type);
  }

  const tags: APITag[] = Array.from(tagsSet).map((name) => ({ name }));

  return {
    name: "GraphQL API",
    version: "1.0.0",
    description: schema.description ?? undefined,
    baseUrl: url,
    endpoints,
    schemas,
    tags,
  };
}

function convertField(
  name: string,
  field: GraphQLField<unknown, unknown>,
  method: "QUERY" | "MUTATION" | "SUBSCRIPTION"
): ParsedEndpoint {
  const parameters: ParsedParameter[] = field.args.map(convertArgument);
  const responseSchema = convertOutputType(field.type);

  const responses: ParsedResponse[] = [
    {
      statusCode: "200",
      description: "Successful response",
      contentTypes: {
        "application/json": { schema: responseSchema },
      },
    },
  ];

  return {
    method,
    path: name,
    operationId: name,
    summary: field.description ?? undefined,
    description: field.description ?? undefined,
    tags: [method === "QUERY" ? "Query" : method === "MUTATION" ? "Mutation" : "Subscription"],
    deprecated: field.deprecationReason != null,
    parameters,
    responses,
  };
}

function convertArgument(arg: GraphQLArgument): ParsedParameter {
  return {
    name: arg.name,
    in: "argument",
    required: isNonNullType(arg.type),
    description: arg.description ?? undefined,
    schema: convertInputType(arg.type),
    example: arg.defaultValue,
  };
}

function convertOutputType(type: GraphQLOutputType): ParsedSchema {
  if (isNonNullType(type)) {
    const inner = convertOutputType(type.ofType);
    inner.nullable = false;
    return inner;
  }

  if (isListType(type)) {
    return {
      type: "array",
      items: convertOutputType(type.ofType),
      nullable: true,
    };
  }

  if (isScalarType(type)) {
    return { type: graphqlScalarToSchemaType(type.name), title: type.name, nullable: true };
  }

  if (isEnumType(type)) {
    return {
      type: "enum",
      title: type.name,
      description: type.description ?? undefined,
      enum: type.getValues().map((v) => v.value),
      nullable: true,
    };
  }

  if (isObjectType(type) || isInterfaceType(type)) {
    const fields = type.getFields();
    const properties: Record<string, ParsedSchema> = {};
    const required: string[] = [];

    for (const [fieldName, field] of Object.entries(fields)) {
      properties[fieldName] = convertOutputType(field.type);
      if (isNonNullType(field.type)) {
        required.push(fieldName);
      }
    }

    return {
      type: "object",
      title: type.name,
      description: type.description ?? undefined,
      properties,
      required: required.length > 0 ? required : undefined,
      nullable: true,
    };
  }

  if (isUnionType(type)) {
    return {
      type: "union",
      title: type.name,
      oneOf: type.getTypes().map((t) => convertOutputType(t)),
      nullable: true,
    };
  }

  return { type: "string", nullable: true };
}

function convertInputType(type: GraphQLInputType): ParsedSchema {
  if (isNonNullType(type)) {
    const inner = convertInputType(type.ofType);
    inner.nullable = false;
    return inner;
  }

  if (isListType(type)) {
    return { type: "array", items: convertInputType(type.ofType), nullable: true };
  }

  if (isScalarType(type)) {
    return { type: graphqlScalarToSchemaType(type.name), title: type.name, nullable: true };
  }

  if (isEnumType(type)) {
    return {
      type: "enum",
      title: type.name,
      enum: type.getValues().map((v) => v.value),
      nullable: true,
    };
  }

  if (isInputObjectType(type)) {
    const fields = type.getFields();
    const properties: Record<string, ParsedSchema> = {};
    const required: string[] = [];

    for (const [fieldName, field] of Object.entries(fields)) {
      properties[fieldName] = convertInputType(field.type);
      if (isNonNullType(field.type)) {
        required.push(fieldName);
      }
    }

    return {
      type: "object",
      title: type.name,
      description: type.description ?? undefined,
      properties,
      required: required.length > 0 ? required : undefined,
      nullable: true,
    };
  }

  return { type: "string", nullable: true };
}

function convertType(type: GraphQLNamedType): ParsedSchema {
  if (isObjectType(type) || isInputObjectType(type)) {
    const fields = type.getFields();
    const properties: Record<string, ParsedSchema> = {};
    for (const [name, field] of Object.entries(fields)) {
      properties[name] = "type" in field ? convertOutputType((field as GraphQLField<unknown, unknown>).type) : convertInputType(field.type);
    }
    return {
      type: "object",
      title: type.name,
      description: type.description ?? undefined,
      properties,
    };
  }

  if (isEnumType(type)) {
    return {
      type: "enum",
      title: type.name,
      description: type.description ?? undefined,
      enum: type.getValues().map((v) => v.value),
    };
  }

  if (isScalarType(type)) {
    return { type: "scalar", title: type.name, description: type.description ?? undefined };
  }

  if (isUnionType(type)) {
    return {
      type: "union",
      title: type.name,
      description: type.description ?? undefined,
      oneOf: type.getTypes().map((t) => ({ type: "object" as const, title: t.name })),
    };
  }

  return { title: type.name };
}

function graphqlScalarToSchemaType(name: string): ParsedSchema["type"] {
  switch (name) {
    case "Int":
      return "integer";
    case "Float":
      return "number";
    case "Boolean":
      return "boolean";
    case "ID":
    case "String":
    default:
      return "string";
  }
}
