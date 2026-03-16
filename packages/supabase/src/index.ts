import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export type { Database };
export type Tables = Database["public"]["Tables"];
export type Organization = Tables["organizations"]["Row"];
export type OrganizationInsert = Tables["organizations"]["Insert"];
export type Project = Tables["projects"]["Row"];
export type ProjectInsert = Tables["projects"]["Insert"];
export type ApiSpec = Tables["api_specs"]["Row"];
export type ApiSpecInsert = Tables["api_specs"]["Insert"];
export type Endpoint = Tables["endpoints"]["Row"];
export type EndpointInsert = Tables["endpoints"]["Insert"];
export type DocPage = Tables["doc_pages"]["Row"];
export type DocPageInsert = Tables["doc_pages"]["Insert"];
export type CodeExample = Tables["code_examples"]["Row"];
export type CodeExampleInsert = Tables["code_examples"]["Insert"];
export type DocDeployment = Tables["doc_deployments"]["Row"];
export type AnalyticsView = Tables["analytics_views"]["Row"];
export type ApiChangelog = Tables["api_changelog"]["Row"];
export type SearchIndexEntry = Tables["search_index"]["Row"];

export type SupabaseDB = SupabaseClient<Database>;

export function createSupabaseClient(url: string, key: string): SupabaseDB {
  return createClient<Database>(url, key);
}

export function createSupabaseServerClient(
  url: string,
  serviceRoleKey: string
): SupabaseDB {
  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
