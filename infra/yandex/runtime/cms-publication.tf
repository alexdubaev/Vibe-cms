locals {
  cms_publication_environment = {
    CMS_BACKEND_INTERNAL_BASE_URL            = var.api_domain == "" ? "" : "https://${var.api_domain}"
    CMS_WEBSITE_STORAGE_ENDPOINT             = var.website_storage_endpoint
    CMS_WEBSITE_STORAGE_BUCKET               = var.website_bucket
    CMS_WEBSITE_PUBLIC_ORIGIN                = var.website_public_origin
    CMS_WEBSITE_SELECTOR_URL                 = var.website_selector_url
    CMS_WEBSITE_PURGE_URL                    = var.website_purge_url
    CMS_WEBSITE_DIRECTORY                    = "/app/website"
  }

  cms_builder_secret_bindings = merge(
    var.builder_storage_secret_bindings,
    var.builder_hmac_secret_binding == null ? {} : {
      CMS_BUILDER_HMAC_SECRET = var.builder_hmac_secret_binding
    },
    var.website_promotion_token_binding == null ? {} : {
      CMS_WEBSITE_PROMOTION_TOKEN = var.website_promotion_token_binding
    },
  )
}

resource "yandex_serverless_container" "builder" {
  count = var.publication_enabled ? 1 : 0

  folder_id          = var.folder_id
  name               = "${var.project_slug}-prod-cms-builder"
  memory             = 2048
  cores              = 1
  core_fraction      = 100
  concurrency        = 1
  execution_timeout  = "600s"
  service_account_id = var.builder_service_account

  runtime { type = "http" }

  image {
    url = "cr.yandex/${var.registry_id}/${var.builder_image_name}@${var.builder_image_digest}"
    environment = merge(
      local.cms_publication_environment,
      {
        NODE_ENV = "production"
      },
    )
  }

  dynamic "secrets" {
    for_each = local.cms_builder_secret_bindings
    content {
      environment_variable = secrets.key
      id                   = secrets.value.secret_id
      version_id           = secrets.value.version_id
      key                  = secrets.value.key
    }
  }

  log_options {
    log_group_id = var.logging_group_id
    min_level    = "INFO"
  }

  metadata_options {
    gce_http_endpoint    = 2
    aws_v1_http_endpoint = 2
  }
}

resource "yandex_serverless_container" "preview" {
  count = var.publication_enabled ? 1 : 0

  folder_id          = var.folder_id
  name               = "${var.project_slug}-prod-cms-preview"
  memory             = 512
  cores              = 1
  core_fraction      = 100
  concurrency        = 16
  execution_timeout  = "30s"
  service_account_id = var.preview_service_account

  runtime { type = "http" }

  image {
    url = "cr.yandex/${var.registry_id}/${var.preview_image_name}@${var.preview_image_digest}"
    environment = {
      NODE_ENV           = "production"
      HOST               = "0.0.0.0"
      PORT               = "4321"
      CMS_BACKEND_ORIGIN = var.preview_backend_origin
    }
  }

  log_options {
    log_group_id = var.logging_group_id
    min_level    = "INFO"
  }

  metadata_options {
    gce_http_endpoint    = 2
    aws_v1_http_endpoint = 2
  }
}

resource "yandex_serverless_container_iam_member" "publication_trigger_builder" {
  count = var.publication_enabled ? 1 : 0

  container_id = yandex_serverless_container.builder[0].id
  role         = "serverless-containers.containerInvoker"
  member       = "serviceAccount:${var.publication_trigger_service_account}"
}

resource "yandex_function_trigger" "publication" {
  count = var.publication_enabled ? 1 : 0

  folder_id = var.folder_id
  name      = "${var.project_slug}-prod-cms-publication"

  container {
    id                 = yandex_serverless_container.builder[0].id
    service_account_id = var.publication_trigger_service_account
  }

  message_queue {
    queue_id           = var.publication_queue_id
    service_account_id = var.publication_trigger_service_account
    batch_cutoff       = "1s"
    batch_size         = "1"
    visibility_timeout = "600s"
  }

  dlq {
    queue_id           = var.publication_dlq_id
    service_account_id = var.publication_trigger_service_account
  }

  depends_on = [yandex_serverless_container_iam_member.publication_trigger_builder]
}

resource "yandex_serverless_container_iam_member" "gateway_preview" {
  count = var.publication_enabled ? 1 : 0

  container_id = yandex_serverless_container.preview[0].id
  role         = "serverless-containers.containerInvoker"
  member       = "serviceAccount:${var.gateway_service_account}"
}

resource "yandex_api_gateway" "preview" {
  count = var.publication_enabled ? 1 : 0

  folder_id = var.folder_id
  name      = "${var.project_slug}-prod-cms-preview"
  spec = yamlencode({
    openapi = "3.0.0"
    info = {
      title   = "${var.project_slug} CMS preview"
      version = "1.0.0"
    }
    paths = {
      "/{proxy+}" = {
        "x-yc-apigateway-any-method" = {
          "x-yc-apigateway-integration" = {
            type               = "serverless_containers"
            container_id       = yandex_serverless_container.preview[0].id
            service_account_id = var.gateway_service_account
          }
          parameters = [{
            explode  = false
            in       = "path"
            name     = "proxy"
            required = false
            schema = {
              default = "-"
              type    = "string"
            }
            style = "simple"
          }]
        }
      }
    }
  })

  custom_domains {
    fqdn           = var.preview_domain
    certificate_id = var.preview_certificate_id
  }

  log_options {
    log_group_id = var.logging_group_id
    min_level    = "INFO"
  }

  depends_on = [yandex_serverless_container_iam_member.gateway_preview]
}
