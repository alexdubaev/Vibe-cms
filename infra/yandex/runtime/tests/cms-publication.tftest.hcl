mock_provider "yandex" {}

variables {
  cloud_id                    = "cloud-test"
  folder_id                   = "folder-test"
  primary_zone                = "ru-central1-a"
  project_slug                = "example-product"
  network_id                  = "network-id"
  registry_id                 = "registry-id"
  backend_image_name          = "backend"
  builder_image_name          = "website-builder"
  preview_image_name          = "website-preview"
  builder_service_account     = "builder-sa"
  preview_service_account     = "preview-sa"
  promotion_service_account   = "promotion-sa"
  publication_trigger_service_account = "publication-trigger-sa"
  builder_hmac_secret_binding = {
    secret_id  = "builder-hmac-secret"
    version_id = "builder-hmac-version"
    key        = "value"
  }
  builder_storage_secret_bindings = {
    ACCESS_KEY_ID = {
      secret_id  = "builder-storage-secret"
      version_id = "builder-storage-version"
      key        = "access_key_id"
    }
    SECRET_ACCESS_KEY = {
      secret_id  = "builder-storage-secret"
      version_id = "builder-storage-version"
      key        = "secret_access_key"
    }
  }
  preview_backend_origin       = "https://api.example.com"
  preview_domain               = "preview.example.com"
  website_public_origin        = "https://www.example.com"
  website_selector_url         = "https://selector.example.com/switch"
  website_purge_url            = "https://purge.example.com/purge"
  website_promotion_token_binding = {
    secret_id  = "promotion-secret"
    version_id = "promotion-version"
    key        = "value"
  }
  website_bucket                = "www.example.com"
  website_storage_endpoint      = "https://storage.yandexcloud.net"
  publication_queue_id          = "queue-id"
  publication_dlq_id            = "dlq-id"
  publication_enabled            = true
  builder_image_digest           = "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  preview_image_digest           = "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  logging_group_id              = "logging-id"
  runtime_environment           = {}
  runtime_secret_bindings       = {}
  database_credential_slot      = "blue"
  api_memory_mb                 = 1024
  task_memory_mb                = 512
  api_domain                    = "api.example.com"
  api_certificate_id            = "certificate-api"
  webapp_domain                 = "app.example.com"
  webapp_certificate_id         = "certificate-webapp"
  website_domain                = "www.example.com"
  website_certificate_id        = "certificate-website"
  preview_certificate_id        = "certificate-preview"
  dns_zone_id                   = null
  dns_zone_domain               = "example.com"
  enable_cdn                    = false
  route_static_through_cdn      = false
  webapp_website_endpoint       = "http://app.example.com.website.yandexcloud.net"
  webapp_website_domain         = "app.example.com.website.yandexcloud.net"
  website_website_endpoint      = "http://www.example.com.website.yandexcloud.net"
  website_website_domain        = "www.example.com.website.yandexcloud.net"
  runtime_image_digest          = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
}

run "cms_publication_runtime_is_isolated" {
  command = plan

  assert {
    condition = (
      yandex_serverless_container.builder[0].memory == 2048 &&
      yandex_serverless_container.builder[0].cores == 1 &&
      yandex_serverless_container.builder[0].execution_timeout == "600s"
    )
    error_message = "The builder must use the fixed 2 GiB, one-core, 10-minute envelope."
  }

  assert {
    condition = (
      yandex_function_trigger.publication[0].message_queue[0].batch_size == "1" &&
      yandex_function_trigger.publication[0].dlq[0].queue_id == var.publication_dlq_id
    )
    error_message = "The publication trigger must process one message at a time and expose the DLQ."
  }

  assert {
    condition = (
      yandex_serverless_container.builder[0].image[0].url == "cr.yandex/${var.registry_id}/${var.builder_image_name}@${var.builder_image_digest}" &&
      yandex_serverless_container.preview[0].image[0].url == "cr.yandex/${var.registry_id}/${var.preview_image_name}@${var.preview_image_digest}"
    )
    error_message = "Builder and preview must run immutable image digests from separate repositories."
  }

  assert {
    condition = (
      length(yandex_serverless_container.builder[0].secrets) == 4 &&
      length(yandex_serverless_container.preview[0].secrets) == 0
    )
    error_message = "Builder and preview must receive only their dedicated Lockbox bindings."
  }
}
