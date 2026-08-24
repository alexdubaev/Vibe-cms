/*
  Warnings:

  - Added the required column `filename` to the `cms_media_assets` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "cms_media_assets" ADD COLUMN     "filename" TEXT NOT NULL;
