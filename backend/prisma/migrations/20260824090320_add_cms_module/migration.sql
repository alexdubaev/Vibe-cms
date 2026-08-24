-- CreateEnum
CREATE TYPE "cms_content_entry_type" AS ENUM ('service', 'review', 'teamMember', 'faq', 'case');

-- CreateEnum
CREATE TYPE "cms_media_state" AS ENUM ('pending', 'ready', 'deleting', 'deleted');

-- CreateEnum
CREATE TYPE "cms_approval_status" AS ENUM ('pending', 'approved', 'rejected', 'superseded');

-- CreateEnum
CREATE TYPE "cms_publication_artifact_state" AS ENUM ('missing', 'uploading', 'ready');

-- CreateEnum
CREATE TYPE "cms_publication_status" AS ENUM ('queued', 'building', 'published', 'failed');

-- CreateEnum
CREATE TYPE "cms_publication_slot" AS ENUM ('blue', 'green');

-- CreateEnum
CREATE TYPE "cms_build_state" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "cms_menu_location" AS ENUM ('header', 'footer');

-- CreateTable
CREATE TABLE "cms_site_settings" (
    "key" TEXT NOT NULL DEFAULT 'default',
    "draft_payload" JSONB NOT NULL,
    "draft_revision" INTEGER NOT NULL DEFAULT 1,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cms_site_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "cms_policy" (
    "key" TEXT NOT NULL DEFAULT 'default',
    "editor_can_publish" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cms_policy_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "cms_pages" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "path" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "draft_payload" JSONB NOT NULL,
    "draft_revision" INTEGER NOT NULL DEFAULT 1,
    "published_revision_id" UUID,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cms_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_page_revisions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "page_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "source_draft_revision" INTEGER NOT NULL,
    "source_payload" JSONB NOT NULL,
    "public_payload" JSONB NOT NULL,
    "author_user_id" UUID,
    "publication_revision" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cms_page_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_content_entries" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "type" "cms_content_entry_type" NOT NULL,
    "draft_payload" JSONB NOT NULL,
    "draft_revision" INTEGER NOT NULL DEFAULT 1,
    "published_revision_id" UUID,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cms_content_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_content_entry_revisions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "entry_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "source_draft_revision" INTEGER NOT NULL,
    "source_payload" JSONB NOT NULL,
    "public_payload" JSONB NOT NULL,
    "author_user_id" UUID,
    "publication_revision" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cms_content_entry_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_menus" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "location" "cms_menu_location" NOT NULL,
    "draft_payload" JSONB NOT NULL,
    "draft_revision" INTEGER NOT NULL DEFAULT 1,
    "published_revision_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cms_menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_menu_revisions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "menu_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "source_draft_revision" INTEGER NOT NULL,
    "source_payload" JSONB NOT NULL,
    "public_payload" JSONB NOT NULL,
    "author_user_id" UUID,
    "publication_revision" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cms_menu_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_media_assets" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "object_key" TEXT NOT NULL,
    "content_version" UUID NOT NULL DEFAULT uuidv7(),
    "storage_etag" TEXT,
    "content_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration_ms" INTEGER,
    "alt_text" TEXT,
    "state" "cms_media_state" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cms_media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_media_usage" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "asset_id" UUID NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cms_media_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_content_usage" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_type" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "referenced_type" TEXT NOT NULL,
    "referenced_id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cms_content_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_approval_requests" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "revision_map" JSONB NOT NULL,
    "candidate_snapshot" JSONB NOT NULL,
    "requester_user_id" UUID NOT NULL,
    "status" "cms_approval_status" NOT NULL DEFAULT 'pending',
    "reviewer_user_id" UUID,
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "cms_approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_publications" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "artifact_state" "cms_publication_artifact_state" NOT NULL DEFAULT 'missing',
    "artifact_object_key" TEXT,
    "artifact_etag" TEXT,
    "source_approval_id" UUID,
    "actor_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cms_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_redirects" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "source_path" TEXT NOT NULL,
    "destination_path" TEXT NOT NULL,
    "publication_revision" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cms_redirects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_publication_controller" (
    "key" TEXT NOT NULL DEFAULT 'default',
    "desired_revision" INTEGER,
    "published_revision" INTEGER,
    "active_build_id" UUID,
    "active_slot" "cms_publication_slot" NOT NULL DEFAULT 'blue',
    "status" "cms_publication_status" NOT NULL DEFAULT 'queued',
    "heartbeat_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cms_publication_controller_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "cms_publication_builds" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "publication_revision" INTEGER NOT NULL,
    "slot" "cms_publication_slot" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "state" "cms_build_state" NOT NULL DEFAULT 'queued',
    "heartbeat_at" TIMESTAMP(3),
    "marker_verified_at" TIMESTAMP(3),
    "diagnostics" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cms_publication_builds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_preview_grants" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "code_hash" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cms_preview_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_preview_sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "token_hash" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cms_preview_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_builder_request_nonces" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "nonce" TEXT NOT NULL,
    "key_version" TEXT NOT NULL,
    "build_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cms_builder_request_nonces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_audit_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "actor_user_id" UUID,
    "action_key" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID,
    "summary" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cms_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cms_pages_path_key" ON "cms_pages"("path");

-- CreateIndex
CREATE INDEX "cms_pages_archived_at_idx" ON "cms_pages"("archived_at");

-- CreateIndex
CREATE INDEX "cms_page_revisions_publication_revision_idx" ON "cms_page_revisions"("publication_revision");

-- CreateIndex
CREATE UNIQUE INDEX "cms_page_revisions_page_id_revision_key" ON "cms_page_revisions"("page_id", "revision");

-- CreateIndex
CREATE INDEX "cms_content_entries_type_archived_at_idx" ON "cms_content_entries"("type", "archived_at");

-- CreateIndex
CREATE INDEX "cms_content_entry_revisions_publication_revision_idx" ON "cms_content_entry_revisions"("publication_revision");

-- CreateIndex
CREATE UNIQUE INDEX "cms_content_entry_revisions_entry_id_revision_key" ON "cms_content_entry_revisions"("entry_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "cms_menus_location_key" ON "cms_menus"("location");

-- CreateIndex
CREATE INDEX "cms_menu_revisions_publication_revision_idx" ON "cms_menu_revisions"("publication_revision");

-- CreateIndex
CREATE UNIQUE INDEX "cms_menu_revisions_menu_id_revision_key" ON "cms_menu_revisions"("menu_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "cms_media_assets_object_key_key" ON "cms_media_assets"("object_key");

-- CreateIndex
CREATE UNIQUE INDEX "cms_media_assets_content_version_key" ON "cms_media_assets"("content_version");

-- CreateIndex
CREATE INDEX "cms_media_assets_state_created_at_idx" ON "cms_media_assets"("state", "created_at");

-- CreateIndex
CREATE INDEX "cms_media_usage_owner_scope_idx" ON "cms_media_usage"("owner_type", "owner_id", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "cms_media_usage_asset_owner_scope_key" ON "cms_media_usage"("asset_id", "owner_type", "owner_id", "scope");

-- CreateIndex
CREATE INDEX "cms_content_usage_owner_scope_idx" ON "cms_content_usage"("owner_type", "owner_id", "scope");

-- CreateIndex
CREATE INDEX "cms_content_usage_referenced_idx" ON "cms_content_usage"("referenced_type", "referenced_id");

-- CreateIndex
CREATE UNIQUE INDEX "cms_content_usage_reference_key" ON "cms_content_usage"("owner_type", "owner_id", "scope", "referenced_type", "referenced_id", "path");

-- CreateIndex
CREATE INDEX "cms_approval_requests_status_created_at_idx" ON "cms_approval_requests"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "cms_publications_revision_key" ON "cms_publications"("revision");

-- CreateIndex
CREATE UNIQUE INDEX "cms_redirects_source_path_key" ON "cms_redirects"("source_path");

-- CreateIndex
CREATE INDEX "cms_redirects_active_source_path_idx" ON "cms_redirects"("active", "source_path");

-- CreateIndex
CREATE INDEX "cms_publication_builds_revision_state_idx" ON "cms_publication_builds"("publication_revision", "state");

-- CreateIndex
CREATE INDEX "cms_publication_builds_state_heartbeat_idx" ON "cms_publication_builds"("state", "heartbeat_at");

-- CreateIndex
CREATE UNIQUE INDEX "cms_preview_grants_code_hash_key" ON "cms_preview_grants"("code_hash");

-- CreateIndex
CREATE INDEX "cms_preview_grants_page_expires_idx" ON "cms_preview_grants"("page_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "cms_preview_sessions_token_hash_key" ON "cms_preview_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "cms_preview_sessions_page_expiry_idx" ON "cms_preview_sessions"("page_id", "expires_at", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "cms_builder_request_nonces_nonce_key" ON "cms_builder_request_nonces"("nonce");

-- CreateIndex
CREATE INDEX "cms_builder_request_nonces_build_expiry_idx" ON "cms_builder_request_nonces"("build_id", "expires_at");

-- CreateIndex
CREATE INDEX "cms_audit_events_action_created_idx" ON "cms_audit_events"("action_key", "created_at");

-- CreateIndex
CREATE INDEX "cms_audit_events_target_created_idx" ON "cms_audit_events"("target_type", "target_id", "created_at");

-- AddForeignKey
ALTER TABLE "cms_page_revisions" ADD CONSTRAINT "cms_page_revisions_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "cms_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms_content_entry_revisions" ADD CONSTRAINT "cms_content_entry_revisions_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "cms_content_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms_menu_revisions" ADD CONSTRAINT "cms_menu_revisions_menu_id_fkey" FOREIGN KEY ("menu_id") REFERENCES "cms_menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms_media_usage" ADD CONSTRAINT "cms_media_usage_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "cms_media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
