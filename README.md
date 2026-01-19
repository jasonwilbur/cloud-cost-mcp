# Cloud Cost MCP

Multi-cloud pricing comparison MCP server for AWS, Azure, GCP, and OCI. Compare compute, storage, egress, and Kubernetes costs across all major cloud providers with a single query.

> **⚠️ DISCLAIMER**: All pricing data is retrieved from publicly available APIs and data sources including [instances.vantage.sh](https://instances.vantage.sh), Azure Retail Prices API, and Oracle Cloud Price List API. This data is provided for informational and estimation purposes only. **Cloud pricing changes frequently and may vary by region, account type, commitment terms, and other factors.** Users are solely responsible for verifying all pricing information directly with cloud providers before making any purchasing or architectural decisions. The authors make no warranties about the accuracy, completeness, or timeliness of this data.

## Features

- **Comprehensive Coverage**: 2,700+ instance types across all providers
  - AWS: 1,147 EC2 instances + 353 RDS database types + Lightsail
  - Azure: 1,199 VM types
  - GCP: 287 instance types across 40+ regions
  - OCI: 600+ products via Oracle API
- **No API Keys Required**: All data from public APIs (instances.vantage.sh + provider APIs)
- **Real-Time Pricing**: All providers have real-time refresh capability
- **Natural Language Queries**: Ask Claude "What's cheapest for 4 vCPU 16GB?"
- **Workload Calculator**: Estimate full workload costs including compute, storage, and egress
- **Migration Planning**: Calculate potential savings when switching providers

## Installation

### For Claude Code Users

```bash
# One-command install
claude mcp add cloud-cost -- npx cloud-cost-mcp
```

### Manual Installation

```bash
npm install -g cloud-cost-mcp
```

Then add to your Claude Code configuration:

```json
{
  "mcpServers": {
    "cloud-cost": {
      "command": "cloud-cost-mcp"
    }
  }
}
```

## Usage Examples

Once installed, just ask Claude:

### Compare Compute
```
"Compare 4 vCPU 16GB VMs across AWS, Azure, GCP, and OCI"
"Find the cheapest cloud for an 8-core VM with 32GB RAM"
"What's the best deal for ARM instances with 4 cores?"
```

### Compare Storage
```
"Compare object storage pricing for 1TB across all clouds"
"What's the cheapest archival storage for 10TB?"
```

### Compare Egress (OCI Advantage!)
```
"Compare egress costs for 5TB monthly"
"What's the cheapest cloud for 10TB data transfer?"
```
*Note: OCI offers 10TB/month free egress - 100x more than AWS/Azure/GCP!*

### Full Workload Estimates
```
"Estimate cost for 3 VMs with 4 vCPU each, 500GB storage, and 1TB egress"
"What would a Kubernetes cluster with 5 nodes cost across all clouds?"
```

### Quick Estimates
```
"Quick estimate for a medium API server"
"Compare all clouds for a kubernetes-cluster preset"
```

### Migration Planning
```
"How much could I save migrating from AWS to OCI?"
"Compare my current GCP setup against other clouds"
```

## Available Tools

### Comparison Tools
| Tool | Description |
|------|-------------|
| `compare_compute` | Compare VM/instance pricing by vCPU and memory |
| `compare_storage` | Compare object and block storage pricing |
| `compare_egress` | Compare data transfer costs (OCI: 10TB free!) |
| `compare_kubernetes` | Compare managed K8s costs (EKS, AKS, GKE, OKE) |
| `find_cheapest_compute` | Find cheapest provider for given specs |

### Calculator Tools
| Tool | Description |
|------|-------------|
| `calculate_workload_cost` | Full workload estimate across all clouds |
| `quick_estimate` | Instant comparison for common presets |
| `estimate_migration_savings` | Calculate migration savings |
| `list_presets` | List available deployment presets |

### Data Management Tools
| Tool | Description |
|------|-------------|
| `get_data_freshness` | Check pricing data age (warns if >30 days) |
| `get_provider_details` | Get detailed pricing for one provider |
| `get_storage_summary` | Storage pricing by tier for all providers |

### Real-Time API Tools

#### AWS (1,147 EC2 + 353 RDS + Lightsail)
| Tool | Description |
|------|-------------|
| `refresh_aws_ec2_pricing` | Fetch 1,147 EC2 instance types with spot/reserved pricing |
| `refresh_aws_rds_pricing` | Fetch 353 RDS database instance types |
| `get_aws_lightsail_pricing` | Get Lightsail bundle pricing |
| `list_aws_regions` | List AWS regions with pricing data |
| `list_aws_instance_families` | List EC2 instance families |

#### GCP (287 instance types)
| Tool | Description |
|------|-------------|
| `refresh_gcp_pricing` | Fetch GCP Compute Engine pricing (40+ regions) |
| `list_gcp_regions` | List GCP regions with pricing data |
| `list_gcp_instance_families` | List GCP instance families |

#### Azure (1,199 VM types)
| Tool | Description |
|------|-------------|
| `refresh_azure_pricing` | Fetch Azure Retail Prices API |
| `refresh_azure_full_pricing` | Fetch 1,199 VM types from vantage.sh |
| `list_azure_regions` | List Azure regions with pricing data |
| `list_azure_categories` | List Azure VM categories |

#### OCI (600+ products)
| Tool | Description |
|------|-------------|
| `refresh_oci_pricing` | Fetch live OCI pricing (public API) |
| `list_oci_categories` | List OCI service categories |

#### Status
| Tool | Description |
|------|-------------|
| `check_api_status` | Check if all real-time APIs are accessible |

## Data Freshness

All providers now support real-time pricing refresh via public APIs:

| Provider | Data Source | Instance Types | Real-Time |
|----------|-------------|----------------|-----------|
| **AWS** | instances.vantage.sh | 1,147 EC2 + 353 RDS | ✓ Yes |
| **Azure** | instances.vantage.sh + Retail Prices API | 1,199 | ✓ Yes |
| **GCP** | instances.vantage.sh | 287 | ✓ Yes |
| **OCI** | Oracle Cloud Price List API | 600+ | ✓ Yes |

Use `check_api_status` to verify API accessibility. Use `get_data_freshness` to check bundled data age.

## Key Insights

### OCI Cost Advantages
- **10TB/month free egress** (vs 100GB on AWS/Azure/GCP)
- **Free Kubernetes control plane** (basic clusters)
- **Uniform global pricing** (no regional variation)
- **Always Free tier** includes 4 OCPUs + 24GB RAM on ARM

### Free Kubernetes Control Planes
- **OCI (OKE)**: Free basic clusters
- **Azure (AKS)**: Free control plane
- AWS (EKS) and GCP (GKE): $73/month per cluster

## Example Output

```
User: "Compare cost for a 4 vCPU, 16GB RAM VM across all clouds"

┌─────────┬──────────────────────┬────────┬──────────┬─────────────┐
│ Provider│ Instance Type        │ vCPUs  │ Memory   │ Monthly Cost│
├─────────┼──────────────────────┼────────┼──────────┼─────────────┤
│ OCI     │ VM.Standard.E5.Flex  │ 4      │ 16 GB    │ $61.32      │
│ GCP     │ e2-standard-4        │ 4      │ 16 GB    │ $97.82      │
│ AWS     │ t3.xlarge            │ 4      │ 16 GB    │ $121.47     │
│ Azure   │ Standard_D4s_v5      │ 4      │ 16 GB    │ $140.16     │
└─────────┴──────────────────────┴────────┴──────────┴─────────────┘

Cheapest: OCI ($61.32/month) - 50% savings vs AWS
```

## Development

```bash
# Clone and install
git clone https://github.com/jasonwilbur/cloud-cost-mcp.git
cd cloud-cost-mcp
npm install

# Build
npm run build

# Test locally with Claude Code
claude mcp add cloud-cost-dev -- node /path/to/cloud-cost-mcp/dist/index.js
```

## Updating Pricing Data

All providers support real-time refresh:

```
# Refresh all providers
refresh_aws_ec2_pricing
refresh_azure_full_pricing
refresh_gcp_pricing
refresh_oci_pricing
```

Data is cached for 60 minutes. Bundled fallback data is in `src/data/bundled/`.

## License

Apache-2.0

## Author

Jason Wilbur ([jasonwilbur.com](https://jasonwilbur.com))

## Related Projects

- [oci-pricing-mcp](https://github.com/jasonwilbur/oci-pricing-mcp) - Dedicated OCI pricing MCP with 25+ tools
