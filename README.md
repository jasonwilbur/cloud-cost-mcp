# Cloud Cost MCP

[![npm version](https://img.shields.io/npm/v/cloud-cost-mcp.svg)](https://www.npmjs.com/package/cloud-cost-mcp)
[![npm downloads](https://img.shields.io/npm/dm/cloud-cost-mcp.svg)](https://www.npmjs.com/package/cloud-cost-mcp)
[![CI](https://github.com/jasonwilbur/cloud-cost-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/jasonwilbur/cloud-cost-mcp/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

Multi-cloud pricing comparison MCP server for AWS, Azure, GCP, and OCI. Compare compute, storage, egress, and Kubernetes costs across all major cloud providers with a single query.

> **⚠️ DISCLAIMER**: All pricing data is retrieved from publicly available APIs and data sources including [instances.vantage.sh](https://instances.vantage.sh), Azure Retail Prices API, and Oracle Cloud Price List API. This data is provided for informational and estimation purposes only. **Cloud pricing changes frequently and may vary by region, account type, commitment terms, and other factors.** Users are solely responsible for verifying all pricing information directly with cloud providers before making any purchasing or architectural decisions. The authors make no warranties about the accuracy, completeness, or timeliness of this data.

## Features

- **Comprehensive Coverage**: 4,900+ instance types across all providers
  - AWS: 1,300+ EC2 instances + 1,180+ managed-database types + Lightsail
  - Azure: 1,680+ VM types (official Azure Retail Prices API)
  - GCP: 360+ instance types across 40+ regions
  - OCI: 600+ products via Oracle API
- **No API Keys Required**: All data from public APIs (instances.vantage.sh + provider APIs)
- **Fresh data, two ways**: AWS/Azure/GCP bundled data is auto-refreshed weekly via GitHub Actions, and the `refresh_*` tools fetch live pricing on demand (cached 60 min in-memory). OCI bundled data is curated. See [Data freshness](#data-freshness) for the exact model.
- **Natural Language Queries**: Ask Claude "What's cheapest for 4 vCPU 16GB?"
- **Workload Calculator**: Estimate full workload costs including compute, storage, and egress
- **Migration Planning**: Calculate potential savings when switching providers

## Installation

### For Claude Code Users

```bash
# One-command install
claude mcp add cloud-cost -- npx -y cloud-cost-mcp
```

### For Claude Desktop Users

Add this to your `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows: `%APPDATA%\Claude\claude_desktop_config.json`), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "cloud-cost": {
      "command": "npx",
      "args": ["-y", "cloud-cost-mcp"]
    }
  }
}
```

### Manual Installation

```bash
npm install -g cloud-cost-mcp
```

Then reference the installed binary in any MCP client config:

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
"Estimate cost for gpu-training-large preset"
```

### GPU Pricing (OCI)
```
"List all available GPU shapes"
"Compare A100 vs H100 GPU pricing"
"What GPU should I use for ML training with 80GB memory?"
"Get details for BM.GPU.H100.8"
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

**Available presets**: `small-web-app`, `medium-api-server`, `large-database`, `ml-training`, `kubernetes-cluster`, `data-lake`, `high-egress-cdn`, `high-traffic-web`, `gpu-inference`, `gpu-training-small`, `gpu-training-large`

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

### GPU Tools (OCI)
| Tool | Description |
|------|-------------|
| `list_gpu_shapes` | List GPU shapes with filtering by model, use case, price |
| `get_gpu_shape_details` | Get detailed specs and pricing for a GPU shape |
| `compare_gpu_shapes` | Compare multiple GPU shapes side-by-side |
| `recommend_gpu_shape` | Get GPU recommendation based on workload type |

**Available GPU shapes**: A10, A100 80GB, H100 80GB, H200 141GB, L40S, MI300X

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

## Data freshness

This server uses a **two-tier** data model — it helps to know which is which:

1. **Bundled data** (`src/data/bundled/*.json`) is what the comparison/calculator tools
   read by default, so the server works instantly with no network calls.
   - **AWS, Azure, GCP** bundled data is regenerated from live upstream sources
     (`instances.vantage.sh` + the official Azure Retail Prices API) and **auto-refreshed
     weekly** via the [`refresh-data` GitHub Action](.github/workflows/refresh-data.yml).
     You can also regenerate locally with `npm run fetch-data`.
   - **OCI** bundled data is **curated** (vantage.sh has no OCI feed) and updated manually.
     For always-live OCI pricing, use the `refresh_oci_pricing` tool or the dedicated
     [oci-pricing-mcp](https://github.com/jasonwilbur/oci-pricing-mcp).

2. **Live refresh tools** (`refresh_aws_ec2_pricing`, `refresh_azure_full_pricing`,
   `refresh_gcp_pricing`, `refresh_oci_pricing`, `refresh_aws_rds_pricing`) fetch current
   pricing from provider APIs at call time, cached **60 minutes in-memory** for the life of
   the process. These return fresh data to the caller but do **not** rewrite the bundled
   files — that only happens via `npm run fetch-data` / the weekly Action.

Use `get_data_freshness` to see the bundled timestamp and staleness for each provider.

## License

Apache-2.0

## Author

Jason Wilbur ([jasonwilbur.com](https://jasonwilbur.com))

## Related Projects

- [oci-pricing-mcp](https://github.com/jasonwilbur/oci-pricing-mcp) - Dedicated OCI pricing MCP with 25+ tools
