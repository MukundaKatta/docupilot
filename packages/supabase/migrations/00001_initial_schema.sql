-- DocuPilot Database Schema
-- Migration: 00001_initial_schema

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-------------------------------------------------------
-- ORGANIZATIONS
-------------------------------------------------------
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    logo_url TEXT,
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT UNIQUE,
    plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
    plan_expires_at TIMESTAMPTZ,
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_organizations_slug ON organizations (slug);
CREATE INDEX idx_organizations_stripe ON organizations (stripe_customer_id);

-------------------------------------------------------
-- ORGANIZATION MEMBERS
-------------------------------------------------------
CREATE TABLE organization_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    invited_email TEXT,
    invited_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, user_id)
);

CREATE INDEX idx_org_members_user ON organization_members (user_id);
CREATE INDEX idx_org_members_org ON organization_members (organization_id);

-------------------------------------------------------
-- PROJECTS
-------------------------------------------------------
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    logo_url TEXT,
    base_url TEXT,
    github_repo_url TEXT,
    github_installation_id BIGINT,
    default_branch TEXT DEFAULT 'main',
    custom_domain TEXT UNIQUE,
    subdomain TEXT UNIQUE,
    theme TEXT NOT NULL DEFAULT 'default',
    theme_config JSONB NOT NULL DEFAULT '{}',
    nav_config JSONB NOT NULL DEFAULT '[]',
    seo_config JSONB NOT NULL DEFAULT '{}',
    is_public BOOLEAN NOT NULL DEFAULT true,
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, slug)
);

CREATE INDEX idx_projects_org ON projects (organization_id);
CREATE INDEX idx_projects_subdomain ON projects (subdomain);
CREATE INDEX idx_projects_custom_domain ON projects (custom_domain);

-------------------------------------------------------
-- API SPECS
-------------------------------------------------------
CREATE TABLE api_specs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '1.0.0',
    spec_type TEXT NOT NULL CHECK (spec_type IN ('openapi', 'graphql', 'grpc', 'postman', 'custom')),
    source_type TEXT NOT NULL CHECK (source_type IN ('upload', 'url', 'github', 'scan')),
    source_url TEXT,
    source_path TEXT,
    raw_spec JSONB,
    parsed_spec JSONB,
    checksum TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_specs_project ON api_specs (project_id);
CREATE INDEX idx_api_specs_active ON api_specs (project_id, is_active) WHERE is_active = true;

-------------------------------------------------------
-- ENDPOINTS
-------------------------------------------------------
CREATE TABLE endpoints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_spec_id UUID NOT NULL REFERENCES api_specs(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    method TEXT NOT NULL CHECK (method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'QUERY', 'MUTATION', 'SUBSCRIPTION', 'RPC')),
    path TEXT NOT NULL,
    operation_id TEXT,
    summary TEXT,
    description TEXT,
    tags TEXT[] NOT NULL DEFAULT '{}',
    parameters JSONB NOT NULL DEFAULT '[]',
    request_body JSONB,
    responses JSONB NOT NULL DEFAULT '{}',
    security JSONB,
    deprecated BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB NOT NULL DEFAULT '{}',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_endpoints_spec ON endpoints (api_spec_id);
CREATE INDEX idx_endpoints_project ON endpoints (project_id);
CREATE INDEX idx_endpoints_tags ON endpoints USING GIN (tags);
CREATE INDEX idx_endpoints_method_path ON endpoints (project_id, method, path);

-------------------------------------------------------
-- DOC PAGES
-------------------------------------------------------
CREATE TABLE doc_pages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    endpoint_id UUID REFERENCES endpoints(id) ON DELETE SET NULL,
    parent_id UUID REFERENCES doc_pages(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    content_mdx TEXT NOT NULL DEFAULT '',
    content_html TEXT,
    page_type TEXT NOT NULL DEFAULT 'guide' CHECK (page_type IN ('guide', 'endpoint', 'changelog', 'error_reference', 'tutorial', 'overview')),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    seo_title TEXT,
    seo_description TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    last_generated_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, slug)
);

CREATE INDEX idx_doc_pages_project ON doc_pages (project_id);
CREATE INDEX idx_doc_pages_endpoint ON doc_pages (endpoint_id);
CREATE INDEX idx_doc_pages_parent ON doc_pages (parent_id);
CREATE INDEX idx_doc_pages_status ON doc_pages (project_id, status);
CREATE INDEX idx_doc_pages_type ON doc_pages (project_id, page_type);

-------------------------------------------------------
-- CODE EXAMPLES
-------------------------------------------------------
CREATE TABLE code_examples (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    endpoint_id UUID NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    language TEXT NOT NULL,
    label TEXT NOT NULL,
    code TEXT NOT NULL,
    dependencies JSONB NOT NULL DEFAULT '{}',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_generated BOOLEAN NOT NULL DEFAULT true,
    last_generated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_code_examples_endpoint ON code_examples (endpoint_id);
CREATE INDEX idx_code_examples_project ON code_examples (project_id);
CREATE INDEX idx_code_examples_lang ON code_examples (endpoint_id, language);

-------------------------------------------------------
-- DOC DEPLOYMENTS
-------------------------------------------------------
CREATE TABLE doc_deployments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'building', 'deploying', 'live', 'failed', 'rolled_back')),
    deployment_url TEXT,
    vercel_deployment_id TEXT,
    build_log TEXT,
    pages_snapshot JSONB,
    triggered_by UUID REFERENCES auth.users(id),
    trigger_type TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_type IN ('manual', 'auto', 'webhook', 'schedule')),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deployments_project ON doc_deployments (project_id);
CREATE INDEX idx_deployments_status ON doc_deployments (project_id, status);
CREATE INDEX idx_deployments_live ON doc_deployments (project_id) WHERE status = 'live';

-------------------------------------------------------
-- ANALYTICS VIEWS
-------------------------------------------------------
CREATE TABLE analytics_views (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    doc_page_id UUID REFERENCES doc_pages(id) ON DELETE SET NULL,
    endpoint_id UUID REFERENCES endpoints(id) ON DELETE SET NULL,
    path TEXT NOT NULL,
    referrer TEXT,
    user_agent TEXT,
    country TEXT,
    session_id TEXT,
    visitor_id TEXT,
    duration_ms INTEGER,
    search_query TEXT,
    feedback_helpful BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_analytics_project ON analytics_views (project_id);
CREATE INDEX idx_analytics_page ON analytics_views (doc_page_id);
CREATE INDEX idx_analytics_created ON analytics_views (project_id, created_at);
CREATE INDEX idx_analytics_path ON analytics_views (project_id, path);

-- Partitioned by month for performance (create current and next month)
-- In production, use pg_partman or create partitions via cron

-------------------------------------------------------
-- API CHANGE LOG
-------------------------------------------------------
CREATE TABLE api_changelog (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    api_spec_id UUID REFERENCES api_specs(id) ON DELETE SET NULL,
    version_from TEXT,
    version_to TEXT,
    change_type TEXT NOT NULL CHECK (change_type IN ('breaking', 'non_breaking', 'deprecation', 'addition', 'removal')),
    summary TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}',
    affected_endpoints UUID[] NOT NULL DEFAULT '{}',
    doc_page_id UUID REFERENCES doc_pages(id) ON DELETE SET NULL,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_changelog_project ON api_changelog (project_id);
CREATE INDEX idx_changelog_spec ON api_changelog (api_spec_id);
CREATE INDEX idx_changelog_type ON api_changelog (project_id, change_type);

-------------------------------------------------------
-- SEARCH INDEX
-------------------------------------------------------
CREATE TABLE search_index (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    doc_page_id UUID REFERENCES doc_pages(id) ON DELETE CASCADE,
    endpoint_id UUID REFERENCES endpoints(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    section TEXT,
    path TEXT NOT NULL,
    search_vector TSVECTOR,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_search_project ON search_index (project_id);
CREATE INDEX idx_search_vector ON search_index USING GIN (search_vector);
CREATE INDEX idx_search_trgm ON search_index USING GIN (title gin_trgm_ops);

-- Auto-update search vector
CREATE OR REPLACE FUNCTION update_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.section, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_search_vector
    BEFORE INSERT OR UPDATE ON search_index
    FOR EACH ROW EXECUTE FUNCTION update_search_vector();

-------------------------------------------------------
-- UPDATED_AT TRIGGER
-------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON api_specs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON endpoints FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON doc_pages FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON code_examples FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON search_index FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-------------------------------------------------------
-- ROW LEVEL SECURITY
-------------------------------------------------------

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE code_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_changelog ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_index ENABLE ROW LEVEL SECURITY;

-- Helper function: check if user is member of org
CREATE OR REPLACE FUNCTION is_org_member(org_id UUID, min_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN AS $$
DECLARE
    user_role TEXT;
    role_rank INTEGER;
    min_rank INTEGER;
BEGIN
    SELECT role INTO user_role
    FROM organization_members
    WHERE organization_id = org_id AND user_id = auth.uid();

    IF user_role IS NULL THEN RETURN false; END IF;

    role_rank := CASE user_role
        WHEN 'owner' THEN 4
        WHEN 'admin' THEN 3
        WHEN 'member' THEN 2
        WHEN 'viewer' THEN 1
        ELSE 0
    END;

    min_rank := CASE min_role
        WHEN 'owner' THEN 4
        WHEN 'admin' THEN 3
        WHEN 'member' THEN 2
        WHEN 'viewer' THEN 1
        ELSE 0
    END;

    RETURN role_rank >= min_rank;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper: get org_id from project_id
CREATE OR REPLACE FUNCTION get_org_id_from_project(p_id UUID)
RETURNS UUID AS $$
    SELECT organization_id FROM projects WHERE id = p_id;
$$ LANGUAGE sql SECURITY DEFINER;

-- Organizations policies
CREATE POLICY "org_select" ON organizations FOR SELECT
    USING (is_org_member(id));

CREATE POLICY "org_insert" ON organizations FOR INSERT
    WITH CHECK (true); -- handled in app logic after auth check

CREATE POLICY "org_update" ON organizations FOR UPDATE
    USING (is_org_member(id, 'admin'));

CREATE POLICY "org_delete" ON organizations FOR DELETE
    USING (is_org_member(id, 'owner'));

-- Organization members policies
CREATE POLICY "org_members_select" ON organization_members FOR SELECT
    USING (is_org_member(organization_id));

CREATE POLICY "org_members_insert" ON organization_members FOR INSERT
    WITH CHECK (is_org_member(organization_id, 'admin'));

CREATE POLICY "org_members_update" ON organization_members FOR UPDATE
    USING (is_org_member(organization_id, 'admin'));

CREATE POLICY "org_members_delete" ON organization_members FOR DELETE
    USING (is_org_member(organization_id, 'admin') OR user_id = auth.uid());

-- Projects policies
CREATE POLICY "projects_select" ON projects FOR SELECT
    USING (is_public = true OR is_org_member(organization_id));

CREATE POLICY "projects_insert" ON projects FOR INSERT
    WITH CHECK (is_org_member(organization_id, 'member'));

CREATE POLICY "projects_update" ON projects FOR UPDATE
    USING (is_org_member(organization_id, 'member'));

CREATE POLICY "projects_delete" ON projects FOR DELETE
    USING (is_org_member(organization_id, 'admin'));

-- API specs policies
CREATE POLICY "specs_select" ON api_specs FOR SELECT
    USING (is_org_member(get_org_id_from_project(project_id)));

CREATE POLICY "specs_insert" ON api_specs FOR INSERT
    WITH CHECK (is_org_member(get_org_id_from_project(project_id), 'member'));

CREATE POLICY "specs_update" ON api_specs FOR UPDATE
    USING (is_org_member(get_org_id_from_project(project_id), 'member'));

CREATE POLICY "specs_delete" ON api_specs FOR DELETE
    USING (is_org_member(get_org_id_from_project(project_id), 'admin'));

-- Endpoints policies
CREATE POLICY "endpoints_select" ON endpoints FOR SELECT
    USING (is_org_member(get_org_id_from_project(project_id)));

CREATE POLICY "endpoints_insert" ON endpoints FOR INSERT
    WITH CHECK (is_org_member(get_org_id_from_project(project_id), 'member'));

CREATE POLICY "endpoints_update" ON endpoints FOR UPDATE
    USING (is_org_member(get_org_id_from_project(project_id), 'member'));

CREATE POLICY "endpoints_delete" ON endpoints FOR DELETE
    USING (is_org_member(get_org_id_from_project(project_id), 'admin'));

-- Doc pages policies (public pages visible to all for published docs)
CREATE POLICY "pages_select_public" ON doc_pages FOR SELECT
    USING (
        status = 'published' AND EXISTS (
            SELECT 1 FROM projects WHERE id = project_id AND is_public = true
        )
    );

CREATE POLICY "pages_select_member" ON doc_pages FOR SELECT
    USING (is_org_member(get_org_id_from_project(project_id)));

CREATE POLICY "pages_insert" ON doc_pages FOR INSERT
    WITH CHECK (is_org_member(get_org_id_from_project(project_id), 'member'));

CREATE POLICY "pages_update" ON doc_pages FOR UPDATE
    USING (is_org_member(get_org_id_from_project(project_id), 'member'));

CREATE POLICY "pages_delete" ON doc_pages FOR DELETE
    USING (is_org_member(get_org_id_from_project(project_id), 'admin'));

-- Code examples policies
CREATE POLICY "examples_select" ON code_examples FOR SELECT
    USING (is_org_member(get_org_id_from_project(project_id)));

CREATE POLICY "examples_insert" ON code_examples FOR INSERT
    WITH CHECK (is_org_member(get_org_id_from_project(project_id), 'member'));

CREATE POLICY "examples_update" ON code_examples FOR UPDATE
    USING (is_org_member(get_org_id_from_project(project_id), 'member'));

CREATE POLICY "examples_delete" ON code_examples FOR DELETE
    USING (is_org_member(get_org_id_from_project(project_id), 'admin'));

-- Deployments policies
CREATE POLICY "deployments_select" ON doc_deployments FOR SELECT
    USING (is_org_member(get_org_id_from_project(project_id)));

CREATE POLICY "deployments_insert" ON doc_deployments FOR INSERT
    WITH CHECK (is_org_member(get_org_id_from_project(project_id), 'member'));

CREATE POLICY "deployments_update" ON doc_deployments FOR UPDATE
    USING (is_org_member(get_org_id_from_project(project_id), 'member'));

-- Analytics: anyone can insert (for public doc sites), members can read
CREATE POLICY "analytics_insert" ON analytics_views FOR INSERT
    WITH CHECK (true);

CREATE POLICY "analytics_select" ON analytics_views FOR SELECT
    USING (is_org_member(get_org_id_from_project(project_id)));

-- Changelog policies
CREATE POLICY "changelog_select" ON api_changelog FOR SELECT
    USING (is_org_member(get_org_id_from_project(project_id)));

CREATE POLICY "changelog_insert" ON api_changelog FOR INSERT
    WITH CHECK (is_org_member(get_org_id_from_project(project_id), 'member'));

-- Search index: public for published projects, full for members
CREATE POLICY "search_public" ON search_index FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM projects WHERE id = project_id AND is_public = true
    ));

CREATE POLICY "search_member" ON search_index FOR SELECT
    USING (is_org_member(get_org_id_from_project(project_id)));

CREATE POLICY "search_insert" ON search_index FOR INSERT
    WITH CHECK (is_org_member(get_org_id_from_project(project_id), 'member'));

CREATE POLICY "search_update" ON search_index FOR UPDATE
    USING (is_org_member(get_org_id_from_project(project_id), 'member'));

CREATE POLICY "search_delete" ON search_index FOR DELETE
    USING (is_org_member(get_org_id_from_project(project_id), 'member'));

-------------------------------------------------------
-- STORAGE BUCKETS
-------------------------------------------------------
INSERT INTO storage.buckets (id, name, public) VALUES
    ('project-assets', 'project-assets', true),
    ('api-specs', 'api-specs', false);

CREATE POLICY "project_assets_select" ON storage.objects FOR SELECT
    USING (bucket_id = 'project-assets');

CREATE POLICY "project_assets_insert" ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'project-assets' AND auth.role() = 'authenticated');

CREATE POLICY "api_specs_select" ON storage.objects FOR SELECT
    USING (bucket_id = 'api-specs' AND auth.role() = 'authenticated');

CREATE POLICY "api_specs_insert" ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'api-specs' AND auth.role() = 'authenticated');
