-- AlterTable
ALTER TABLE "cms_content_entry_revisions" ADD COLUMN     "site_package_schema_version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "cms_menu_revisions" ADD COLUMN     "site_package_schema_version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "cms_page_revisions" ADD COLUMN     "site_package_schema_version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "cms_site_package_state" (
    "key" TEXT NOT NULL DEFAULT 'default',
    "package_id" TEXT NOT NULL,
    "package_version" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "migrated_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cms_site_package_state_pkey" PRIMARY KEY ("key")
);
