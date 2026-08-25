/**
 * The exact environment used to prove that the website-builder composition root starts.
 *
 * Kept separate from the Docker orchestration so the builder suite can boot `server.ts` with the
 * same values. Adding another required startup variable therefore breaks the fast suite before it
 * can silently invalidate the slower image smoke.
 */
export const builderSmokeEnvironment = {
  CMS_BACKEND_INTERNAL_BASE_URL: 'http://backend.invalid',
  CMS_BUILDER_HMAC_SECRET: 'builder-smoke-secret',
  CMS_WEBSITE_STORAGE_ENDPOINT: 'http://storage.invalid',
  CMS_WEBSITE_STORAGE_BUCKET: 'builder-smoke-bucket',
  CMS_WEBSITE_STORAGE_ACCESS_KEY_ID: 'builder-smoke-key',
  CMS_WEBSITE_STORAGE_SECRET_ACCESS_KEY: 'builder-smoke-secret',
  CMS_WEBSITE_STORAGE_REGION: 'us-east-1',
  CMS_WEBSITE_STORAGE_FORCE_PATH_STYLE: 'true',
  CMS_WEBSITE_PUBLIC_ORIGIN: 'https://site.example',
  CMS_WEBSITE_SELECTOR_URL: 'https://selector.invalid',
  CMS_WEBSITE_PURGE_URL: 'https://purge.invalid',
  CMS_WEBSITE_PROMOTION_TOKEN: 'builder-smoke-token',
} as const satisfies Record<string, string>
