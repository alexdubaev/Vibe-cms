output "runtime_image_digest" { value = var.runtime_image_digest }
output "builder_image_digest" { value = var.builder_image_digest }
output "preview_image_digest" { value = var.preview_image_digest }
output "publication_enabled" { value = var.publication_enabled }
output "database_credential_slot" { value = var.database_credential_slot }
output "api_url" { value = local.api_origin }
output "webapp_url" { value = local.webapp_origin }
output "website_url" { value = local.website_origin }
output "required_dns_records" {
  value = {
    api = {
      name  = var.api_domain
      type  = "CNAME"
      value = yandex_api_gateway.api.domain
    }
    webapp = {
      name  = var.webapp_domain
      type  = "CNAME"
      value = local.webapp_dns_target
    }
    website = {
      name  = var.website_domain
      type  = "CNAME"
      value = local.website_dns_target
    }
  }
}

output "direct_static_dns_records" {
  value = {
    webapp  = { name = var.webapp_domain, type = "CNAME", value = var.webapp_website_domain }
    website = { name = var.website_domain, type = "CNAME", value = var.website_website_domain }
  }
}

output "cdn_dns_records" {
  value = var.enable_cdn ? {
    webapp  = { name = var.webapp_domain, type = "CNAME", value = local.webapp_cdn_cname }
    website = { name = var.website_domain, type = "CNAME", value = local.website_cdn_cname }
  } : {}
}
