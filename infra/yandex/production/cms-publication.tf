locals {
  cms_publication_queue_name = replace("${local.name_prefix}-cms-publication", "_", "-")
  cms_publication_dlq_name   = replace("${local.name_prefix}-cms-publication-dlq", "_", "-")
  cms_builder_storage_actions = [
    "s3:AbortMultipartUpload",
    "s3:DeleteObject",
    "s3:GetBucketLocation",
    "s3:GetObject",
    "s3:ListBucket",
    "s3:ListBucketMultipartUploads",
    "s3:ListMultipartUploadParts",
    "s3:PutObject",
  ]
}

resource "terraform_data" "cms_publication_requirements" {
  count = var.cms_publication_enabled ? 1 : 0

  lifecycle {
    precondition {
      condition = alltrue([
        var.preview_domain != null && var.preview_certificate_id != null,
        length(coalesce(var.cms_builder_hmac_secret, "")) >= 32,
        length(coalesce(var.cms_website_promotion_token, "")) >= 32,
        can(regex("^https://", coalesce(var.cms_website_selector_url, ""))),
        can(regex("^https://", coalesce(var.cms_website_purge_url, ""))),
      ])
      error_message = "CMS publication requires preview TLS/domain, 32+ character HMAC/token values, and HTTPS selector/purge endpoints."
    }
  }
}

resource "yandex_iam_service_account" "queue_sender" {
  count = var.cms_publication_enabled ? 1 : 0

  folder_id   = var.folder_id
  name        = "${local.name_prefix}-cms-queue-sender"
  description = "Backend-only writer for the CMS publication queue."
}

resource "yandex_resourcemanager_folder_iam_member" "queue_sender" {
  count = var.cms_publication_enabled ? 1 : 0

  folder_id = var.folder_id
  role      = "ymq.writer"
  member    = "serviceAccount:${yandex_iam_service_account.queue_sender[0].id}"
}

resource "yandex_iam_service_account_static_access_key" "queue_sender" {
  count = var.cms_publication_enabled ? 1 : 0

  service_account_id = yandex_iam_service_account.queue_sender[0].id
  description        = "CMS publication queue sender key."
}

resource "yandex_lockbox_secret" "builder_queue" {
  count = var.cms_publication_enabled ? 1 : 0

  folder_id           = var.folder_id
  name                = "${local.name_prefix}-cms-queue-credentials"
  deletion_protection = true
}

resource "yandex_lockbox_secret_version_hashed" "builder_queue" {
  count = var.cms_publication_enabled ? 1 : 0

  secret_id   = yandex_lockbox_secret.builder_queue[0].id
  description = "CMS publication queue sender credentials."
  key_1       = "access_key_id"
  text_value_1 = yandex_iam_service_account_static_access_key.queue_sender[0].access_key
  key_2       = "secret_access_key"
  text_value_2 = yandex_iam_service_account_static_access_key.queue_sender[0].secret_key
}

resource "yandex_iam_service_account" "queue_trigger" {
  count = var.cms_publication_enabled ? 1 : 0

  folder_id   = var.folder_id
  name        = "${local.name_prefix}-cms-queue-trigger"
  description = "Dedicated YMQ reader and builder invoker for the CMS publication trigger."
}

resource "yandex_resourcemanager_folder_iam_member" "queue_trigger_reader" {
  count = var.cms_publication_enabled ? 1 : 0

  folder_id = var.folder_id
  role      = "ymq.reader"
  member    = "serviceAccount:${yandex_iam_service_account.queue_trigger[0].id}"
}

resource "yandex_resourcemanager_folder_iam_member" "queue_trigger_writer" {
  count = var.cms_publication_enabled ? 1 : 0

  folder_id = var.folder_id
  role      = "ymq.writer"
  member    = "serviceAccount:${yandex_iam_service_account.queue_trigger[0].id}"
}

resource "yandex_iam_service_account" "builder" {
  count = var.cms_publication_enabled ? 1 : 0

  folder_id   = var.folder_id
  name        = "${local.name_prefix}-cms-builder"
  description = "Dedicated website builder runtime without database access."
}

resource "yandex_resourcemanager_folder_iam_member" "builder_roles" {
  for_each = var.cms_publication_enabled ? toset([
    "container-registry.images.puller",
    "logging.writer",
  ]) : toset([])

  folder_id = var.folder_id
  role      = each.value
  member    = "serviceAccount:${yandex_iam_service_account.builder[0].id}"
}

resource "yandex_iam_service_account" "preview" {
  count = var.cms_publication_enabled ? 1 : 0

  folder_id   = var.folder_id
  name        = "${local.name_prefix}-cms-preview"
  description = "Dedicated protected Astro preview runtime."
}

resource "yandex_resourcemanager_folder_iam_member" "preview_roles" {
  for_each = var.cms_publication_enabled ? toset([
    "container-registry.images.puller",
    "logging.writer",
    "vpc.user",
  ]) : toset([])

  folder_id = var.folder_id
  role      = each.value
  member    = "serviceAccount:${yandex_iam_service_account.preview[0].id}"
}

resource "yandex_iam_service_account" "promotion" {
  count = var.cms_publication_enabled ? 1 : 0

  folder_id   = var.folder_id
  name        = "${local.name_prefix}-cms-promotion"
  description = "Ownership marker for the external HTTPS selector and purge control plane."
}

resource "yandex_lockbox_secret" "builder_hmac" {
  count = var.cms_publication_enabled ? 1 : 0

  folder_id           = var.folder_id
  name                = "${local.name_prefix}-cms-builder-hmac"
  deletion_protection = true
}

resource "yandex_lockbox_secret_version_hashed" "builder_hmac" {
  count = var.cms_publication_enabled ? 1 : 0

  secret_id    = yandex_lockbox_secret.builder_hmac[0].id
  description  = "Shared backend and builder callback HMAC."
  key_1        = "value"
  text_value_1 = var.cms_builder_hmac_secret
}

resource "yandex_lockbox_secret" "builder_storage" {
  count = var.cms_publication_enabled ? 1 : 0

  folder_id           = var.folder_id
  name                = "${local.name_prefix}-cms-builder-storage"
  deletion_protection = true
}

resource "yandex_iam_service_account" "builder_publisher" {
  count = var.cms_publication_enabled ? 1 : 0

  folder_id   = var.folder_id
  name        = "${local.name_prefix}-cms-builder-publisher"
  description = "Website-slot object access for the isolated CMS builder only."
}

resource "yandex_iam_service_account_static_access_key" "builder_publisher" {
  count = var.cms_publication_enabled ? 1 : 0

  service_account_id = yandex_iam_service_account.builder_publisher[0].id
  description        = "CMS builder website-slot storage credentials."

  output_to_lockbox {
    secret_id            = yandex_lockbox_secret.builder_storage[0].id
    entry_for_access_key = "access_key_id"
    entry_for_secret_key = "secret_access_key"
  }
}

resource "yandex_lockbox_secret" "builder_promotion" {
  count = var.cms_publication_enabled ? 1 : 0

  folder_id           = var.folder_id
  name                = "${local.name_prefix}-cms-builder-promotion"
  deletion_protection = true
}

resource "yandex_lockbox_secret_version_hashed" "builder_promotion" {
  count = var.cms_publication_enabled ? 1 : 0

  secret_id    = yandex_lockbox_secret.builder_promotion[0].id
  description  = "Bearer token for the CMS website selector and purge endpoints."
  key_1        = "value"
  text_value_1 = var.cms_website_promotion_token
}

resource "yandex_lockbox_secret_iam_member" "runtime_builder_hmac" {
  count = var.cms_publication_enabled ? 1 : 0

  secret_id = yandex_lockbox_secret.builder_hmac[0].id
  role      = "lockbox.payloadViewer"
  member    = "serviceAccount:${yandex_iam_service_account.runtime.id}"
}

resource "yandex_lockbox_secret_iam_member" "runtime_builder_queue" {
  count = var.cms_publication_enabled ? 1 : 0

  secret_id = yandex_lockbox_secret.builder_queue[0].id
  role      = "lockbox.payloadViewer"
  member    = "serviceAccount:${yandex_iam_service_account.runtime.id}"
}

resource "yandex_lockbox_secret_iam_member" "builder_hmac" {
  count = var.cms_publication_enabled ? 1 : 0

  secret_id = yandex_lockbox_secret.builder_hmac[0].id
  role      = "lockbox.payloadViewer"
  member    = "serviceAccount:${yandex_iam_service_account.builder[0].id}"
}

resource "yandex_lockbox_secret_iam_member" "builder_storage" {
  count = var.cms_publication_enabled ? 1 : 0

  secret_id = yandex_lockbox_secret.builder_storage[0].id
  role      = "lockbox.payloadViewer"
  member    = "serviceAccount:${yandex_iam_service_account.builder[0].id}"
}

resource "yandex_lockbox_secret_iam_member" "builder_promotion" {
  count = var.cms_publication_enabled ? 1 : 0

  secret_id = yandex_lockbox_secret.builder_promotion[0].id
  role      = "lockbox.payloadViewer"
  member    = "serviceAccount:${yandex_iam_service_account.builder[0].id}"
}

resource "yandex_message_queue" "publication_dlq" {
  count = var.cms_publication_enabled ? 1 : 0

  name                        = local.cms_publication_dlq_name
  region_id                   = "ru-central1"
  visibility_timeout_seconds = 600
  message_retention_seconds  = 1209600
  access_key                  = yandex_iam_service_account_static_access_key.queue_sender[0].access_key
  secret_key                  = yandex_iam_service_account_static_access_key.queue_sender[0].secret_key

  depends_on = [yandex_resourcemanager_folder_iam_member.queue_sender]
}

resource "yandex_message_queue" "publication" {
  count = var.cms_publication_enabled ? 1 : 0

  name                        = local.cms_publication_queue_name
  region_id                   = "ru-central1"
  visibility_timeout_seconds = 600
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 1209600
  redrive_policy = jsonencode({
    deadLetterTargetArn = yandex_message_queue.publication_dlq[0].arn
    maxReceiveCount     = 5
  })
  access_key = yandex_iam_service_account_static_access_key.queue_sender[0].access_key
  secret_key = yandex_iam_service_account_static_access_key.queue_sender[0].secret_key

  depends_on = [yandex_resourcemanager_folder_iam_member.queue_sender]
}
