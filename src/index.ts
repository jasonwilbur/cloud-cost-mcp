#!/usr/bin/env node

/**
 * Cloud Cost MCP Server
 * Multi-cloud pricing comparison for AWS, Azure, GCP, and OCI
 *
 * Copyright 2026 Jason Wilbur
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

// Import comparison tools
import {
  compareCompute,
  compareStorage,
  compareEgress,
  compareKubernetes,
  findCheapestCompute,
  getStoragePricingSummary,
} from './tools/compare.js';

// Import calculator tools
import {
  calculateWorkloadCost,
  quickEstimate,
  getAvailablePresets,
  estimateMigrationSavings,
} from './tools/calculator.js';

// Import GPU tools
import {
  listGPUShapes,
  getGPUShapeDetails,
  compareGPUShapes,
  recommendGPUShape,
} from './tools/gpu.js';

// Import data functions
import {
  getDataFreshness,
  getProviderData,
  getAllProviderData,
  refreshAllCache,
} from './data/loader.js';

// Import real-time fetchers
import {
  fetchAzureComputePricing,
  checkAzureAPIStatus,
  fetchAzureVantagePricing,
  getAzureVantageRegions,
  getAzureCategories,
} from './data/fetchers/azure.js';
import {
  fetchGCPComputePricing,
  getGCPRegions,
  getGCPInstanceFamilies,
  checkGCPAPIStatus,
} from './data/fetchers/gcp.js';
import { fetchOCIRealTimePricing, getOCICategories, checkOCIAPIStatus } from './data/fetchers/oci.js';
import {
  fetchAWSEC2Pricing,
  fetchAWSRDSPricing,
  getAWSLightsailPricing,
  getAWSRegions,
  getAWSInstanceFamilies,
  checkAWSAPIStatus,
} from './data/fetchers/aws.js';

// Create server instance
const server = new Server(
  {
    name: 'cloud-cost-mcp',
    version: '1.2.1',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
const TOOLS = [
  // Core comparison tools
  {
    name: 'compare_compute',
    description: 'Compare VM/instance pricing across AWS, Azure, GCP, and OCI. Finds instances matching your vCPU and memory requirements.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        vcpus: {
          type: 'number',
          description: 'Desired number of vCPUs',
        },
        memoryGB: {
          type: 'number',
          description: 'Desired memory in GB',
        },
        category: {
          type: 'string',
          enum: ['general', 'compute', 'memory', 'storage', 'gpu', 'arm'],
          description: 'Optional: filter by instance category',
        },
      },
      required: ['vcpus', 'memoryGB'],
    },
  },
  {
    name: 'compare_storage',
    description: 'Compare object and block storage pricing across all clouds.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sizeGB: {
          type: 'number',
          description: 'Storage size in GB',
        },
        tier: {
          type: 'string',
          enum: ['hot', 'cool', 'cold', 'archive'],
          description: 'Optional: storage tier',
        },
        type: {
          type: 'string',
          enum: ['object', 'block'],
          description: 'Optional: storage type',
        },
      },
      required: ['sizeGB'],
    },
  },
  {
    name: 'compare_egress',
    description: 'Compare data transfer/egress costs. OCI offers 10TB/month free (100x more than others)!',
    inputSchema: {
      type: 'object' as const,
      properties: {
        monthlyGB: {
          type: 'number',
          description: 'Monthly outbound data in GB',
        },
      },
      required: ['monthlyGB'],
    },
  },
  {
    name: 'compare_kubernetes',
    description: 'Compare managed Kubernetes pricing (EKS, AKS, GKE, OKE). Shows control plane and worker node costs.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        nodeCount: {
          type: 'number',
          description: 'Number of worker nodes',
        },
        nodeVcpus: {
          type: 'number',
          description: 'vCPUs per node',
        },
        nodeMemoryGB: {
          type: 'number',
          description: 'Memory per node in GB',
        },
      },
      required: ['nodeCount', 'nodeVcpus', 'nodeMemoryGB'],
    },
  },
  {
    name: 'find_cheapest_compute',
    description: 'Find the cheapest cloud provider for specific compute specs.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        vcpus: {
          type: 'number',
          description: 'Desired number of vCPUs',
        },
        memoryGB: {
          type: 'number',
          description: 'Desired memory in GB',
        },
        category: {
          type: 'string',
          enum: ['general', 'compute', 'memory', 'storage', 'gpu', 'arm'],
          description: 'Optional: filter by instance category',
        },
      },
      required: ['vcpus', 'memoryGB'],
    },
  },

  // Calculator tools
  {
    name: 'calculate_workload_cost',
    description: 'Estimate total monthly cost for a workload across all cloud providers. Includes compute, storage, egress, and Kubernetes.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        compute: {
          type: 'object',
          properties: {
            vcpus: { type: 'number' },
            memoryGB: { type: 'number' },
            count: { type: 'number', description: 'Number of instances (default: 1)' },
          },
          required: ['vcpus', 'memoryGB'],
        },
        storage: {
          type: 'object',
          properties: {
            objectGB: { type: 'number', description: 'Object storage in GB' },
            blockGB: { type: 'number', description: 'Block storage in GB' },
          },
        },
        egress: {
          type: 'object',
          properties: {
            monthlyGB: { type: 'number', description: 'Monthly outbound data in GB' },
          },
        },
        kubernetes: {
          type: 'object',
          properties: {
            nodeCount: { type: 'number' },
            nodeVcpus: { type: 'number' },
            nodeMemoryGB: { type: 'number' },
          },
          required: ['nodeCount', 'nodeVcpus', 'nodeMemoryGB'],
        },
      },
    },
  },
  {
    name: 'quick_estimate',
    description: 'Get instant cost comparison for common deployment presets including GPU workloads.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        preset: {
          type: 'string',
          enum: [
            'small-web-app', 'medium-api-server', 'large-database', 'ml-training',
            'kubernetes-cluster', 'data-lake', 'high-egress-cdn', 'high-traffic-web',
            'gpu-inference', 'gpu-training-small', 'gpu-training-large'
          ],
          description: 'Deployment preset name',
        },
      },
      required: ['preset'],
    },
  },
  {
    name: 'list_presets',
    description: 'List all available deployment presets for quick_estimate.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'estimate_migration_savings',
    description: 'Calculate potential savings when migrating from one cloud provider to another.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        currentProvider: {
          type: 'string',
          enum: ['aws', 'azure', 'gcp', 'oci'],
          description: 'Your current cloud provider',
        },
        targetProvider: {
          type: 'string',
          enum: ['aws', 'azure', 'gcp', 'oci'],
          description: 'Optional: target provider (finds cheapest if not specified)',
        },
        compute: {
          type: 'object',
          properties: {
            vcpus: { type: 'number' },
            memoryGB: { type: 'number' },
            count: { type: 'number' },
          },
        },
        storage: {
          type: 'object',
          properties: {
            objectGB: { type: 'number' },
            blockGB: { type: 'number' },
          },
        },
        egress: {
          type: 'object',
          properties: {
            monthlyGB: { type: 'number' },
          },
        },
      },
      required: ['currentProvider'],
    },
  },

  // Data management tools
  {
    name: 'get_data_freshness',
    description: 'Check how recent the pricing data is for each provider. Warns if data is stale (>30 days).',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_provider_details',
    description: 'Get detailed pricing data for a specific cloud provider.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        provider: {
          type: 'string',
          enum: ['aws', 'azure', 'gcp', 'oci'],
          description: 'Cloud provider',
        },
        category: {
          type: 'string',
          enum: ['compute', 'storage', 'egress', 'kubernetes', 'database'],
          description: 'Optional: filter by category',
        },
      },
      required: ['provider'],
    },
  },
  {
    name: 'get_storage_summary',
    description: 'Get storage pricing summary by tier (hot, cool, cold, archive) for all providers.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sizeGB: {
          type: 'number',
          description: 'Storage size in GB for cost calculation',
        },
      },
      required: ['sizeGB'],
    },
  },

  // Real-time API tools
  {
    name: 'refresh_azure_pricing',
    description: 'Fetch latest Azure VM pricing from the public Azure Retail Prices API. No authentication required.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        region: {
          type: 'string',
          description: 'Azure region (default: eastus)',
        },
        vmSeries: {
          type: 'string',
          description: 'Optional: filter by VM series (e.g., "D", "E", "F")',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum results to return (default: 100)',
        },
      },
    },
  },
  {
    name: 'refresh_oci_pricing',
    description: 'Fetch latest OCI pricing from Oracle\'s public API. Returns 600+ products. No authentication required.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        currency: {
          type: 'string',
          description: 'Currency code (default: USD)',
        },
        category: {
          type: 'string',
          description: 'Filter by service category (e.g., "Compute", "Storage")',
        },
        search: {
          type: 'string',
          description: 'Search term for product name',
        },
      },
    },
  },
  {
    name: 'list_oci_categories',
    description: 'List all service categories available from OCI\'s real-time pricing API.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'check_api_status',
    description: 'Check if the real-time pricing APIs (Azure, OCI, AWS) are accessible.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },

  // AWS Real-Time Pricing Tools (1,147 EC2 instances, 353 RDS instances)
  {
    name: 'refresh_aws_ec2_pricing',
    description: 'Fetch real-time AWS EC2 pricing from instances.vantage.sh. Returns 1,147 instance types with on-demand, spot, and reserved pricing. No authentication required.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        region: {
          type: 'string',
          description: 'AWS region (default: us-east-1). Use list_aws_regions to see all available.',
        },
        family: {
          type: 'string',
          description: 'Filter by instance family (e.g., "General purpose", "Compute optimized")',
        },
        architecture: {
          type: 'string',
          enum: ['x86', 'arm'],
          description: 'Filter by CPU architecture',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum results to return (default: 500)',
        },
        includeSpot: {
          type: 'boolean',
          description: 'Include spot pricing in notes',
        },
        includeReserved: {
          type: 'boolean',
          description: 'Include reserved pricing in notes',
        },
      },
    },
  },
  {
    name: 'refresh_aws_rds_pricing',
    description: 'Fetch real-time AWS RDS database pricing. Returns 353 instance types across multiple database engines.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        region: {
          type: 'string',
          description: 'AWS region (default: us-east-1)',
        },
        engine: {
          type: 'string',
          description: 'Database engine (default: PostgreSQL). Options: PostgreSQL, MySQL, MariaDB, Oracle, SQL Server',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum results to return (default: 100)',
        },
      },
    },
  },
  {
    name: 'get_aws_lightsail_pricing',
    description: 'Get AWS Lightsail bundle pricing. Simplified VPS with fixed monthly pricing including storage and transfer.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        region: {
          type: 'string',
          description: 'AWS region (default: us-east-1)',
        },
      },
    },
  },
  {
    name: 'list_aws_regions',
    description: 'List all AWS regions available in the pricing data.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'list_aws_instance_families',
    description: 'List AWS EC2 instance families with counts (e.g., General purpose: 200, Compute optimized: 150).',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },

  // GCP Real-Time Pricing Tools (287 instance types, 40+ regions)
  {
    name: 'refresh_gcp_pricing',
    description: 'Fetch real-time GCP Compute Engine pricing from instances.vantage.sh. Returns 287 instance types with on-demand and spot pricing across 40+ regions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        region: {
          type: 'string',
          description: 'GCP region (default: us-central1). Use list_gcp_regions to see all available.',
        },
        family: {
          type: 'string',
          description: 'Filter by instance family (e.g., "General purpose", "Compute optimized")',
        },
        includeSpot: {
          type: 'boolean',
          description: 'Include spot/preemptible pricing in notes',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum results to return (default: 300)',
        },
      },
    },
  },
  {
    name: 'list_gcp_regions',
    description: 'List all GCP regions available in the pricing data with their display names.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'list_gcp_instance_families',
    description: 'List GCP instance families with counts.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },

  // Azure Enhanced Pricing Tools (1,199 instance types)
  {
    name: 'refresh_azure_full_pricing',
    description: 'Fetch comprehensive Azure VM pricing from instances.vantage.sh. Returns 1,199 instance types with on-demand, spot, and Windows pricing.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        region: {
          type: 'string',
          description: 'Azure region (default: us-east). Use list_azure_regions to see all available.',
        },
        category: {
          type: 'string',
          description: 'Filter by category (e.g., "generalpurpose", "computeoptimized", "memoryoptimized")',
        },
        includeSpot: {
          type: 'boolean',
          description: 'Include spot pricing in notes',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum results to return (default: 500)',
        },
      },
    },
  },
  {
    name: 'list_azure_regions',
    description: 'List all Azure regions available in the pricing data.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'list_azure_categories',
    description: 'List Azure VM categories with counts (e.g., generalpurpose: 400, computeoptimized: 200).',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },

  // GPU Tools (OCI)
  {
    name: 'list_gpu_shapes',
    description: 'List OCI GPU shapes with pricing. Filter by GPU model (A10, A100, H100, H200, L40S, MI300X) or use case (inference, training).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        gpuModel: {
          type: 'string',
          description: 'Filter by GPU model (e.g., "A100", "H100", "MI300X")',
        },
        useCase: {
          type: 'string',
          enum: ['inference', 'training', 'graphics', 'general'],
          description: 'Filter by intended use case',
        },
        maxPricePerHour: {
          type: 'number',
          description: 'Maximum hourly price filter',
        },
      },
    },
  },
  {
    name: 'get_gpu_shape_details',
    description: 'Get detailed specifications and pricing for a specific OCI GPU shape.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        shapeFamily: {
          type: 'string',
          description: 'GPU shape family (e.g., "BM.GPU.H100.8", "BM.GPU.A100-v2.8", "VM.GPU.A10.1")',
        },
      },
      required: ['shapeFamily'],
    },
  },
  {
    name: 'compare_gpu_shapes',
    description: 'Compare multiple OCI GPU shapes side-by-side on specs, pricing, and price-per-GPU metrics.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        shapes: {
          type: 'array',
          items: { type: 'string' },
          description: 'GPU shape families to compare (e.g., ["BM.GPU.A10.4", "BM.GPU.A100-v2.8", "BM.GPU.H100.8"])',
        },
      },
      required: ['shapes'],
    },
  },
  {
    name: 'recommend_gpu_shape',
    description: 'Get GPU shape recommendation based on workload requirements and budget.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workloadType: {
          type: 'string',
          enum: ['inference', 'training', 'fine-tuning', 'data-science'],
          description: 'Type of AI/ML workload',
        },
        minGPUMemoryGB: {
          type: 'number',
          description: 'Minimum GPU memory needed per GPU (e.g., 24, 40, 80)',
        },
        budget: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Budget constraint (low: <$5/hr, medium: <$20/hr, high: unlimited)',
        },
      },
      required: ['workloadType'],
    },
  },
];

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const typedArgs = args as any;

    switch (name) {
      // Comparison tools
      case 'compare_compute':
        result = compareCompute(typedArgs);
        break;
      case 'compare_storage':
        result = compareStorage(typedArgs);
        break;
      case 'compare_egress':
        result = compareEgress(typedArgs);
        break;
      case 'compare_kubernetes':
        result = compareKubernetes(typedArgs);
        break;
      case 'find_cheapest_compute':
        result = findCheapestCompute(typedArgs);
        break;

      // Calculator tools
      case 'calculate_workload_cost':
        result = calculateWorkloadCost(typedArgs);
        break;
      case 'quick_estimate':
        result = quickEstimate(typedArgs.preset);
        break;
      case 'list_presets':
        result = getAvailablePresets();
        break;
      case 'estimate_migration_savings':
        result = estimateMigrationSavings({
          spec: {
            compute: typedArgs.compute,
            storage: typedArgs.storage,
            egress: typedArgs.egress,
          },
          currentProvider: typedArgs.currentProvider,
          targetProvider: typedArgs.targetProvider,
        });
        break;

      // Data management tools
      case 'get_data_freshness':
        result = {
          providers: getDataFreshness(),
          note: 'Azure and OCI can be refreshed in real-time using refresh_azure_pricing and refresh_oci_pricing tools. AWS and GCP require an npm update for new data.',
        };
        break;
      case 'get_provider_details': {
        const data = getProviderData(typedArgs.provider);
        if (typedArgs.category) {
          result = {
            provider: typedArgs.provider,
            metadata: data.metadata,
            [typedArgs.category]: data[typedArgs.category as keyof typeof data],
          };
        } else {
          result = data;
        }
        break;
      }
      case 'get_storage_summary':
        result = getStoragePricingSummary(typedArgs.sizeGB);
        break;

      // Real-time API tools
      case 'refresh_azure_pricing':
        result = {
          instances: await fetchAzureComputePricing(typedArgs),
          note: 'Real-time pricing from Azure Retail Prices API',
          timestamp: new Date().toISOString(),
        };
        break;
      case 'refresh_oci_pricing':
        result = await fetchOCIRealTimePricing(typedArgs);
        break;
      case 'list_oci_categories':
        result = await getOCICategories();
        break;
      case 'check_api_status':
        const [azureStatus, ociStatus, awsStatus, gcpStatus] = await Promise.all([
          checkAzureAPIStatus(),
          checkOCIAPIStatus(),
          checkAWSAPIStatus(),
          checkGCPAPIStatus(),
        ]);
        result = {
          aws: awsStatus,
          azure: azureStatus,
          gcp: gcpStatus,
          oci: ociStatus,
          note: 'All providers now have real-time pricing via instances.vantage.sh: AWS (1,147), Azure (1,199), GCP (287), OCI (600+)',
        };
        break;

      // AWS Real-Time Pricing Tools
      case 'refresh_aws_ec2_pricing':
        result = await fetchAWSEC2Pricing(typedArgs);
        break;
      case 'refresh_aws_rds_pricing':
        result = await fetchAWSRDSPricing(typedArgs);
        break;
      case 'get_aws_lightsail_pricing':
        result = getAWSLightsailPricing(typedArgs);
        break;
      case 'list_aws_regions':
        result = {
          regions: await getAWSRegions(),
          note: 'Regions with EC2 pricing data available',
        };
        break;
      case 'list_aws_instance_families':
        result = {
          families: await getAWSInstanceFamilies(),
          note: 'EC2 instance families with count of instance types',
        };
        break;

      // GCP Real-Time Pricing Tools
      case 'refresh_gcp_pricing':
        result = await fetchGCPComputePricing(typedArgs);
        break;
      case 'list_gcp_regions':
        result = {
          regions: await getGCPRegions(),
          note: 'GCP regions with compute pricing data available',
        };
        break;
      case 'list_gcp_instance_families':
        result = {
          families: await getGCPInstanceFamilies(),
          note: 'GCP instance families with count of instance types',
        };
        break;

      // Azure Enhanced Pricing Tools (1,199 instance types from vantage.sh)
      case 'refresh_azure_full_pricing':
        result = await fetchAzureVantagePricing(typedArgs);
        break;
      case 'list_azure_regions':
        result = {
          regions: await getAzureVantageRegions(),
          note: 'Azure regions with compute pricing data available',
        };
        break;
      case 'list_azure_categories':
        result = {
          categories: await getAzureCategories(),
          note: 'Azure VM categories with count of instance types',
        };
        break;

      // GPU Tools (OCI)
      case 'list_gpu_shapes':
        result = listGPUShapes({
          gpuModel: typedArgs.gpuModel,
          useCase: typedArgs.useCase,
          maxPricePerHour: typedArgs.maxPricePerHour,
        });
        break;
      case 'get_gpu_shape_details':
        result = getGPUShapeDetails(typedArgs.shapeFamily);
        break;
      case 'compare_gpu_shapes':
        result = compareGPUShapes(typedArgs.shapes);
        break;
      case 'recommend_gpu_shape':
        result = recommendGPUShape({
          workloadType: typedArgs.workloadType,
          minGPUMemoryGB: typedArgs.minGPUMemoryGB,
          budget: typedArgs.budget,
        });
        break;

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new McpError(ErrorCode.InternalError, errorMessage);
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Cloud Cost MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
