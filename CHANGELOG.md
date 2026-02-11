# Changelog

All notable changes to the Cloud Cost Comparison MCP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.8] - 2026-02-11

### Added
- **OCI BYOL Detection**: Automatically detects and flags "BYOL" (Bring Your Own License) SKUs in OCI pricing
  - New `isBYOL: boolean` field on OCI pricing items
  - New `licenseModel: 'standard' | 'byol'` field for easy filtering
- **Enhanced OCI Summary Statistics**: OCI real-time pricing responses now include:
  - `summary.totalSKUs` - Total number of SKUs returned
  - `summary.standardPricing` - Count of standard pricing SKUs
  - `summary.byolPricing` - Count of BYOL pricing SKUs
  - `summary.uniqueCategories` - Number of unique service categories
- **OCI API Coverage Notes**: Automatic documentation of what's included/excluded:
  - Clarifies that public API returns PAY_AS_YOU_GO pricing only
  - Notes that BYOL variants are included as separate SKUs
  - Explains that Reserved/Committed pricing requires Oracle sales contact
  - Documents Universal Credits and Monthly Flex exclusions
  - Highlights that government cloud pricing may differ

### Changed
- Updated `refresh_oci_pricing` tool description to reflect accurate SKU counts (592 total: 562 standard + 30 BYOL)
- Enhanced OCI filtering to maintain accurate summary statistics when category/search filters are applied
- Fixed package.json formatting per npm standards (bin path, repository URL)

### Technical Details
- Oracle's public API contains 592 SKUs across 104 unique service categories
- All SKUs use PAY_AS_YOU_GO pricing model
- BYOL variants are identified by "BYOL" or "Bring Your Own License" in display name
- OCI Database category: 78 standard + 19 BYOL = 97 total SKUs

## [1.3.7] - 2026-02-01

### Added
- Enhanced AWS pricing with real-time data from instances.vantage.sh
- AWS RDS database pricing
- AWS Lightsail bundle pricing
- GCP Compute Engine real-time pricing (287 instances)
- Azure full VM pricing (1,199 instances)

### Changed
- Improved pricing data freshness checks
- Updated region lists for all providers

## [1.3.0] - 2026-01-18

### Added
- Real-time pricing refresh for Azure and OCI
- GPU pricing comparisons for OCI (A10, A100, H100, H200, MI300X)
- Enhanced storage tier comparisons
- Kubernetes cost comparisons across all providers

## [1.0.0] - 2025-11-15

### Added
- Initial release
- Multi-cloud cost comparison for AWS, Azure, GCP, OCI
- Compute, storage, egress, and Kubernetes pricing
- Quick estimate presets
- Migration savings calculator
