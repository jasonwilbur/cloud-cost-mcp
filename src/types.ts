/**
 * Cloud Cost MCP - Unified Type Definitions
 * Consistent types across AWS, Azure, GCP, and OCI
 */

export type CloudProvider = 'aws' | 'azure' | 'gcp' | 'oci';

export type ComputeCategory = 'general' | 'compute' | 'memory' | 'storage' | 'gpu' | 'arm';

export type StorageTier = 'hot' | 'cool' | 'cold' | 'archive';

// Metadata for bundled pricing data
export interface PricingMetadata {
  provider: CloudProvider;
  lastUpdated: string;
  source: string;
  version: string;
  totalProducts: number;
  currency: string;
}

// Unified compute instance pricing
export interface ComputeInstance {
  provider: CloudProvider;
  name: string;              // e.g., "t3.medium", "Standard_D2s_v3", "e2-medium", "VM.Standard.E5.Flex"
  displayName?: string;      // Human-friendly name
  vcpus: number;
  memoryGB: number;
  hourlyPrice: number;
  monthlyPrice: number;      // hourlyPrice * 730
  region: string;
  category: ComputeCategory;
  architecture?: 'x86' | 'arm';
  gpuCount?: number;
  gpuType?: string;
  notes?: string;
}

// Unified storage pricing
export interface StoragePricing {
  provider: CloudProvider;
  name: string;              // e.g., "S3 Standard", "Blob Hot", "GCS Standard", "Object Storage"
  type: 'object' | 'block' | 'file' | 'archive';
  tier: StorageTier;
  pricePerGBMonth: number;
  region: string;
  redundancy?: string;       // e.g., "LRS", "GRS", "Multi-region"
  notes?: string;
}

// Unified egress pricing
export interface EgressPricing {
  provider: CloudProvider;
  freeGBPerMonth: number;    // OCI: 10240, AWS: 100, Azure: 100, GCP: 200
  tiers: EgressTier[];
  notes?: string;
}

export interface EgressTier {
  upToGB: number;            // -1 for unlimited
  pricePerGB: number;
}

// Unified Kubernetes pricing
export interface KubernetesPricing {
  provider: CloudProvider;
  name: string;              // e.g., "EKS", "AKS", "GKE", "OKE"
  controlPlaneHourly: number;
  controlPlaneMonthly: number;
  workerNodeIncluded: boolean;
  notes?: string;
}

// Unified database pricing
export interface DatabasePricing {
  provider: CloudProvider;
  name: string;
  type: 'relational' | 'nosql' | 'serverless';
  engine?: string;           // e.g., "MySQL", "PostgreSQL", "MongoDB"
  vcpus?: number;
  memoryGB?: number;
  hourlyPrice: number;
  monthlyPrice: number;
  notes?: string;
}

// Comparison result types
export interface ComputeComparisonQuery {
  vcpus: number;
  memoryGB: number;
  category?: ComputeCategory;
  region?: string;
}

export interface ComputeComparisonResult {
  query: ComputeComparisonQuery;
  matches: ComputeInstance[];
  cheapest: ComputeInstance | null;
  summary: string;
  savingsVsAWS?: number;     // Percentage savings compared to AWS baseline
}

export interface StorageComparisonQuery {
  sizeGB: number;
  tier?: StorageTier;
  type?: 'object' | 'block';
}

export interface StorageComparisonResult {
  query: StorageComparisonQuery;
  matches: StoragePricing[];
  cheapest: StoragePricing | null;
  monthlyEstimates: Array<{
    provider: CloudProvider;
    name: string;
    monthlyCost: number;
  }>;
  summary: string;
}

export interface EgressComparisonQuery {
  monthlyGB: number;
}

export interface EgressComparisonResult {
  query: EgressComparisonQuery;
  estimates: Array<{
    provider: CloudProvider;
    monthlyCost: number;
    breakdown: string;
  }>;
  cheapest: CloudProvider;
  summary: string;
}

// Full pricing data structure for each provider
export interface ProviderPricingData {
  metadata: PricingMetadata;
  compute: ComputeInstance[];
  storage: StoragePricing[];
  egress: EgressPricing;
  kubernetes?: KubernetesPricing;
  database?: DatabasePricing[];
}

// Combined pricing data for all providers
export interface AllCloudPricing {
  aws: ProviderPricingData;
  azure: ProviderPricingData;
  gcp: ProviderPricingData;
  oci: ProviderPricingData;
}

// Data freshness info
export interface DataFreshnessInfo {
  provider: CloudProvider;
  lastUpdated: string;
  ageInDays: number;
  isStale: boolean;          // true if > 30 days old
  source: string;
  canRefresh: boolean;       // true for Azure/OCI (public APIs)
}

// Workload cost estimation
export interface WorkloadSpec {
  compute?: {
    vcpus: number;
    memoryGB: number;
    count?: number;
  };
  storage?: {
    objectGB?: number;
    blockGB?: number;
  };
  egress?: {
    monthlyGB: number;
  };
  kubernetes?: {
    nodeCount: number;
    nodeVcpus: number;
    nodeMemoryGB: number;
  };
}

export interface WorkloadCostEstimate {
  provider: CloudProvider;
  breakdown: Array<{
    category: string;
    item: string;
    quantity: number;
    unitPrice: number;
    monthlyTotal: number;
  }>;
  totalMonthly: number;
  notes: string[];
}

export interface WorkloadComparisonResult {
  spec: WorkloadSpec;
  estimates: WorkloadCostEstimate[];
  cheapest: CloudProvider;
  savingsSummary: string;
}
