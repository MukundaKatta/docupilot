export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          logo_url: string | null;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          plan: "free" | "pro" | "enterprise";
          plan_expires_at: string | null;
          settings: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          logo_url?: string | null;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          plan?: "free" | "pro" | "enterprise";
          plan_expires_at?: string | null;
          settings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          logo_url?: string | null;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          plan?: "free" | "pro" | "enterprise";
          plan_expires_at?: string | null;
          settings?: Json;
          updated_at?: string;
        };
      };
      organization_members: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          role: "owner" | "admin" | "member" | "viewer";
          invited_email: string | null;
          invited_at: string | null;
          accepted_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          role?: "owner" | "admin" | "member" | "viewer";
          invited_email?: string | null;
          invited_at?: string | null;
          accepted_at?: string | null;
          created_at?: string;
        };
        Update: {
          role?: "owner" | "admin" | "member" | "viewer";
          accepted_at?: string | null;
        };
      };
      projects: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          slug: string;
          description: string | null;
          logo_url: string | null;
          base_url: string | null;
          github_repo_url: string | null;
          github_installation_id: number | null;
          default_branch: string;
          custom_domain: string | null;
          subdomain: string | null;
          theme: string;
          theme_config: Json;
          nav_config: Json;
          seo_config: Json;
          is_public: boolean;
          settings: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          slug: string;
          description?: string | null;
          logo_url?: string | null;
          base_url?: string | null;
          github_repo_url?: string | null;
          github_installation_id?: number | null;
          default_branch?: string;
          custom_domain?: string | null;
          subdomain?: string | null;
          theme?: string;
          theme_config?: Json;
          nav_config?: Json;
          seo_config?: Json;
          is_public?: boolean;
          settings?: Json;
        };
        Update: {
          name?: string;
          slug?: string;
          description?: string | null;
          logo_url?: string | null;
          base_url?: string | null;
          github_repo_url?: string | null;
          github_installation_id?: number | null;
          default_branch?: string;
          custom_domain?: string | null;
          subdomain?: string | null;
          theme?: string;
          theme_config?: Json;
          nav_config?: Json;
          seo_config?: Json;
          is_public?: boolean;
          settings?: Json;
        };
      };
      api_specs: {
        Row: {
          id: string;
          project_id: string;
          name: string;
          version: string;
          spec_type: "openapi" | "graphql" | "grpc" | "postman" | "custom";
          source_type: "upload" | "url" | "github" | "scan";
          source_url: string | null;
          source_path: string | null;
          raw_spec: Json;
          parsed_spec: Json;
          checksum: string | null;
          is_active: boolean;
          last_synced_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          name: string;
          version?: string;
          spec_type: "openapi" | "graphql" | "grpc" | "postman" | "custom";
          source_type: "upload" | "url" | "github" | "scan";
          source_url?: string | null;
          source_path?: string | null;
          raw_spec?: Json;
          parsed_spec?: Json;
          checksum?: string | null;
          is_active?: boolean;
          last_synced_at?: string | null;
        };
        Update: {
          name?: string;
          version?: string;
          raw_spec?: Json;
          parsed_spec?: Json;
          checksum?: string | null;
          is_active?: boolean;
          last_synced_at?: string | null;
        };
      };
      endpoints: {
        Row: {
          id: string;
          api_spec_id: string;
          project_id: string;
          method: string;
          path: string;
          operation_id: string | null;
          summary: string | null;
          description: string | null;
          tags: string[];
          parameters: Json;
          request_body: Json | null;
          responses: Json;
          security: Json | null;
          deprecated: boolean;
          metadata: Json;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          api_spec_id: string;
          project_id: string;
          method: string;
          path: string;
          operation_id?: string | null;
          summary?: string | null;
          description?: string | null;
          tags?: string[];
          parameters?: Json;
          request_body?: Json | null;
          responses?: Json;
          security?: Json | null;
          deprecated?: boolean;
          metadata?: Json;
          sort_order?: number;
        };
        Update: {
          method?: string;
          path?: string;
          operation_id?: string | null;
          summary?: string | null;
          description?: string | null;
          tags?: string[];
          parameters?: Json;
          request_body?: Json | null;
          responses?: Json;
          security?: Json | null;
          deprecated?: boolean;
          metadata?: Json;
          sort_order?: number;
        };
      };
      doc_pages: {
        Row: {
          id: string;
          project_id: string;
          endpoint_id: string | null;
          parent_id: string | null;
          title: string;
          slug: string;
          content_mdx: string;
          content_html: string | null;
          page_type: "guide" | "endpoint" | "changelog" | "error_reference" | "tutorial" | "overview";
          status: "draft" | "published" | "archived";
          sort_order: number;
          seo_title: string | null;
          seo_description: string | null;
          metadata: Json;
          last_generated_at: string | null;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          endpoint_id?: string | null;
          parent_id?: string | null;
          title: string;
          slug: string;
          content_mdx?: string;
          content_html?: string | null;
          page_type?: "guide" | "endpoint" | "changelog" | "error_reference" | "tutorial" | "overview";
          status?: "draft" | "published" | "archived";
          sort_order?: number;
          seo_title?: string | null;
          seo_description?: string | null;
          metadata?: Json;
        };
        Update: {
          title?: string;
          slug?: string;
          content_mdx?: string;
          content_html?: string | null;
          page_type?: "guide" | "endpoint" | "changelog" | "error_reference" | "tutorial" | "overview";
          status?: "draft" | "published" | "archived";
          sort_order?: number;
          seo_title?: string | null;
          seo_description?: string | null;
          metadata?: Json;
          last_generated_at?: string | null;
          published_at?: string | null;
        };
      };
      code_examples: {
        Row: {
          id: string;
          endpoint_id: string;
          project_id: string;
          language: string;
          label: string;
          code: string;
          dependencies: Json;
          sort_order: number;
          is_generated: boolean;
          last_generated_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          endpoint_id: string;
          project_id: string;
          language: string;
          label: string;
          code: string;
          dependencies?: Json;
          sort_order?: number;
          is_generated?: boolean;
          last_generated_at?: string | null;
        };
        Update: {
          language?: string;
          label?: string;
          code?: string;
          dependencies?: Json;
          sort_order?: number;
          is_generated?: boolean;
          last_generated_at?: string | null;
        };
      };
      doc_deployments: {
        Row: {
          id: string;
          project_id: string;
          version: string;
          status: "pending" | "building" | "deploying" | "live" | "failed" | "rolled_back";
          deployment_url: string | null;
          vercel_deployment_id: string | null;
          build_log: string | null;
          pages_snapshot: Json | null;
          triggered_by: string | null;
          trigger_type: "manual" | "auto" | "webhook" | "schedule";
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          version: string;
          status?: "pending" | "building" | "deploying" | "live" | "failed" | "rolled_back";
          deployment_url?: string | null;
          vercel_deployment_id?: string | null;
          build_log?: string | null;
          pages_snapshot?: Json | null;
          triggered_by?: string | null;
          trigger_type?: "manual" | "auto" | "webhook" | "schedule";
          started_at?: string | null;
          completed_at?: string | null;
        };
        Update: {
          status?: "pending" | "building" | "deploying" | "live" | "failed" | "rolled_back";
          deployment_url?: string | null;
          vercel_deployment_id?: string | null;
          build_log?: string | null;
          completed_at?: string | null;
        };
      };
      analytics_views: {
        Row: {
          id: string;
          project_id: string;
          doc_page_id: string | null;
          endpoint_id: string | null;
          path: string;
          referrer: string | null;
          user_agent: string | null;
          country: string | null;
          session_id: string | null;
          visitor_id: string | null;
          duration_ms: number | null;
          search_query: string | null;
          feedback_helpful: boolean | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          doc_page_id?: string | null;
          endpoint_id?: string | null;
          path: string;
          referrer?: string | null;
          user_agent?: string | null;
          country?: string | null;
          session_id?: string | null;
          visitor_id?: string | null;
          duration_ms?: number | null;
          search_query?: string | null;
          feedback_helpful?: boolean | null;
        };
        Update: never;
      };
      api_changelog: {
        Row: {
          id: string;
          project_id: string;
          api_spec_id: string | null;
          version_from: string | null;
          version_to: string | null;
          change_type: "breaking" | "non_breaking" | "deprecation" | "addition" | "removal";
          summary: string;
          details: Json;
          affected_endpoints: string[];
          doc_page_id: string | null;
          detected_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          api_spec_id?: string | null;
          version_from?: string | null;
          version_to?: string | null;
          change_type: "breaking" | "non_breaking" | "deprecation" | "addition" | "removal";
          summary: string;
          details?: Json;
          affected_endpoints?: string[];
          doc_page_id?: string | null;
        };
        Update: {
          summary?: string;
          details?: Json;
          doc_page_id?: string | null;
        };
      };
      search_index: {
        Row: {
          id: string;
          project_id: string;
          doc_page_id: string | null;
          endpoint_id: string | null;
          title: string;
          content: string;
          section: string | null;
          path: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          doc_page_id?: string | null;
          endpoint_id?: string | null;
          title: string;
          content: string;
          section?: string | null;
          path: string;
        };
        Update: {
          title?: string;
          content?: string;
          section?: string | null;
          path?: string;
        };
      };
    };
  };
}
