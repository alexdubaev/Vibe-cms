output "registry_id" {
  value = yandex_container_registry.production.id
}

output "image_repository" {
  value = "cr.yandex/${yandex_container_registry.production.id}/${var.backend_image_name}"
}

output "builder_image_repository" {
  value = "cr.yandex/${yandex_container_registry.production.id}/${var.builder_image_name}"
}

output "preview_image_repository" {
  value = "cr.yandex/${yandex_container_registry.production.id}/${var.preview_image_name}"
}

output "release_source" {
  description = "Effective source identity consumed by the guarded release wrapper."
  value = {
    git_branch = var.git_branch
  }
}

output "media_bucket" {
  value = yandex_storage_bucket.media.bucket
}

output "webapp_bucket" {
  value = yandex_storage_bucket.webapp.bucket
}

output "website_bucket" {
  value = yandex_storage_bucket.website.bucket
}

output "cms_publication_enabled" {
  value = var.cms_publication_enabled
}

output "static_publisher_access_key_id" {
  value     = yandex_iam_service_account_static_access_key.static_publisher.access_key
  sensitive = true
}

output "static_publisher_secret_access_key" {
  value     = yandex_iam_service_account_static_access_key.static_publisher.secret_key
  sensitive = true
}

output "storage_manager_ready" {
  value = alltrue([
    contains(yandex_storage_bucket_iam_binding.webapp_admins.members, "serviceAccount:${yandex_iam_service_account.storage_manager.id}"),
    contains(yandex_storage_bucket_iam_binding.website_admins.members, "serviceAccount:${yandex_iam_service_account.storage_manager.id}"),
    contains(yandex_storage_bucket_iam_binding.media_admins.members, "serviceAccount:${yandex_iam_service_account.storage_manager.id}"),
  ])
}

output "database_credential_metadata" {
  description = "Sensitive hashes and versions used by the wrapper to protect the live credential slot."
  sensitive   = true
  value = {
    fingerprints = {
      blue  = sha256(var.database_blue_password)
      green = sha256(var.database_green_password)
      jwt   = sha256(var.jwt_secret)
    }
    versions = {
      blue  = var.database_blue_password_version
      green = var.database_green_password_version
    }
  }
}

output "migration_inputs" {
  description = "Sensitive cross-state inputs written only to the ignored migration root by scripts/infra.mjs."
  sensitive   = true
  value = {
    cloud_id                  = var.cloud_id
    folder_id                 = var.folder_id
    primary_zone              = var.primary_zone
    project_slug              = var.project_slug
    network_id                = yandex_vpc_network.production.id
    registry_id               = yandex_container_registry.production.id
    backend_image_name        = var.backend_image_name
    migration_service_account = yandex_iam_service_account.migration.id
    logging_group_id          = yandex_logging_group.production.id
    migration_environment     = { NODE_ENV = "production" }
    migration_secret_bindings = local.migration_secret_bindings
    api_memory_mb             = var.api_memory_mb
  }
}

output "runtime_inputs" {
  description = "Cross-state inputs written only to the ignored runtime root by scripts/infra.mjs."
  sensitive   = true
  value = {
    cloud_id                 = var.cloud_id
    folder_id                = var.folder_id
    primary_zone             = var.primary_zone
    project_slug             = var.project_slug
    network_id               = yandex_vpc_network.production.id
    registry_id              = yandex_container_registry.production.id
    backend_image_name       = var.backend_image_name
    builder_image_name       = var.builder_image_name
    preview_image_name       = var.preview_image_name
    runtime_service_account  = yandex_iam_service_account.runtime.id
    gateway_service_account  = yandex_iam_service_account.gateway.id
    trigger_service_account  = yandex_iam_service_account.trigger.id
    publication_trigger_service_account = var.cms_publication_enabled ? yandex_iam_service_account.queue_trigger[0].id : null
    builder_service_account  = var.cms_publication_enabled ? yandex_iam_service_account.builder[0].id : null
    preview_service_account  = var.cms_publication_enabled ? yandex_iam_service_account.preview[0].id : null
    promotion_service_account = var.cms_publication_enabled ? yandex_iam_service_account.promotion[0].id : null
    logging_group_id         = yandex_logging_group.production.id
    runtime_environment      = local.runtime_environment
    runtime_secret_bindings  = local.runtime_secret_bindings
    database_credential_slot = var.database_active_slot
    api_memory_mb            = var.api_memory_mb
    task_memory_mb           = var.task_memory_mb
    api_domain               = var.api_domain
    api_certificate_id       = var.api_certificate_id
    webapp_domain            = var.webapp_domain
    webapp_certificate_id    = var.webapp_certificate_id
    website_domain           = var.website_domain
    website_certificate_id   = var.website_certificate_id
    dns_zone_id              = var.dns_zone_id
    dns_zone_domain          = var.dns_zone_domain
    enable_cdn               = var.enable_cdn
    route_static_through_cdn = var.route_static_through_cdn
    webapp_website_endpoint  = yandex_storage_bucket.webapp.website_endpoint
    webapp_website_domain    = yandex_storage_bucket.webapp.website_domain
    website_website_endpoint = yandex_storage_bucket.website.website_endpoint
    website_website_domain   = yandex_storage_bucket.website.website_domain
    publication_enabled      = var.cms_publication_enabled
    builder_image_digest     = null
    preview_image_digest     = null
    builder_hmac_secret_binding = var.cms_publication_enabled ? {
      secret_id  = yandex_lockbox_secret.builder_hmac[0].id
      version_id = yandex_lockbox_secret_version_hashed.builder_hmac[0].id
      key        = "value"
    } : null
    builder_storage_secret_bindings = var.cms_publication_enabled ? {
      CMS_WEBSITE_STORAGE_ACCESS_KEY_ID = {
        secret_id  = yandex_lockbox_secret.builder_storage[0].id
        version_id = yandex_iam_service_account_static_access_key.builder_publisher[0].output_to_lockbox_version_id
        key        = "access_key_id"
      }
      CMS_WEBSITE_STORAGE_SECRET_ACCESS_KEY = {
        secret_id  = yandex_lockbox_secret.builder_storage[0].id
        version_id = yandex_iam_service_account_static_access_key.builder_publisher[0].output_to_lockbox_version_id
        key        = "secret_access_key"
      }
    } : {}
    preview_backend_origin = var.cms_publication_enabled ? local.api_origin : null
    preview_domain = var.cms_publication_enabled ? var.preview_domain : null
    preview_certificate_id = var.cms_publication_enabled ? var.preview_certificate_id : null
    website_public_origin = var.cms_publication_enabled ? local.website_origin : null
    website_selector_url = var.cms_publication_enabled ? var.cms_website_selector_url : null
    website_purge_url = var.cms_publication_enabled ? var.cms_website_purge_url : null
    website_promotion_token_binding = var.cms_publication_enabled ? {
      secret_id  = yandex_lockbox_secret.builder_promotion[0].id
      version_id = yandex_lockbox_secret_version_hashed.builder_promotion[0].id
      key        = "value"
    } : null
    website_bucket = yandex_storage_bucket.website.bucket
    website_storage_endpoint = "https://storage.yandexcloud.net"
    publication_queue_id = var.cms_publication_enabled ? yandex_message_queue.publication[0].id : null
    publication_dlq_id = var.cms_publication_enabled ? yandex_message_queue.publication_dlq[0].id : null
  }
}
