# Placeholder Terraform configuration for Terraform Cloud CI.
#
# This repository does not provision infrastructure with Terraform, but the
# Terraform Cloud VCS integration automatically runs `terraform plan` on every
# commit. Without any .tf file present, `terraform plan` fails with
# "Error: No configuration files found", which breaks CI on every PR.
#
# This empty configuration is intentional: it gives `terraform plan` a valid
# configuration to evaluate so the run succeeds (plan = "No changes").
terraform {
  required_providers {}
}
