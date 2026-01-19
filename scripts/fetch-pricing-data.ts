#!/usr/bin/env npx ts-node
/**
 * Fetch comprehensive pricing data from all cloud providers
 * Run: npx ts-node scripts/fetch-pricing-data.ts
 *
 * Data sources:
 * - AWS: instances.vantage.sh (1,147 EC2 + 353 RDS)
 * - Azure: instances.vantage.sh (1,199 VMs)
 * - GCP: instances.vantage.sh (287 instances)
 * - OCI: Already comprehensive in bundled data
 */

import { writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLED_DIR = join(__dirname, '..', 'src', 'data', 'bundled');

// API endpoints
const AWS_EC2_URL = 'https://instances.vantage.sh/instances.json';
const AWS_RDS_URL = 'https://instances.vantage.sh/rds/instances.json';
const AZURE_URL = 'https://instances.vantage.sh/azure/instances.json';
const GCP_URL = 'https://instances.vantage.sh/gcp/instances.json';

// Default region for pricing (vantage.sh uses different region naming)
const AWS_REGION = 'us-east-1';
const AZURE_REGION = 'us-east'; // vantage.sh uses 'us-east' not 'eastus'
const GCP_REGION = 'us-central1';

interface ComputeInstance {
  provider: string;
  name: string;
  displayName?: string;
  vcpus: number;
  memoryGB: number;
  hourlyPrice: number;
  monthlyPrice: number;
  region: string;
  category: string;
  architecture?: string;
  gpuCount?: number;
  gpuType?: string;
  notes?: string;
}

interface StoragePricing {
  provider: string;
  name: string;
  type: string;
  tier: string;
  pricePerGBMonth: number;
  region: string;
  notes?: string;
}

interface DatabasePricing {
  provider: string;
  name: string;
  type: string;
  engine?: string;
  vcpus?: number;
  memoryGB?: number;
  hourlyPrice: number;
  monthlyPrice: number;
  notes?: string;
}

// ============= AWS =============
async function fetchAWSData() {
  console.log('Fetching AWS EC2 data...');
  const ec2Response = await fetch(AWS_EC2_URL);
  const ec2Data = await ec2Response.json() as any[];

  console.log(`  Found ${ec2Data.length} EC2 instance types`);

  const compute: ComputeInstance[] = [];

  for (const item of ec2Data) {
    const pricing = item.pricing?.[AWS_REGION]?.linux;
    if (!pricing?.ondemand) continue;

    const hourlyPrice = parseFloat(pricing.ondemand);
    if (isNaN(hourlyPrice) || hourlyPrice <= 0) continue;

    const category = mapAWSCategory(item.family);
    const architecture = item.arch?.includes('arm64') ? 'arm' : 'x86';

    compute.push({
      provider: 'aws',
      name: item.instance_type,
      displayName: `${item.instance_type} (${item.family})`,
      vcpus: item.vCPU,
      memoryGB: item.memory,
      hourlyPrice,
      monthlyPrice: Math.round(hourlyPrice * 730 * 100) / 100,
      region: AWS_REGION,
      category,
      architecture,
      gpuCount: item.GPU || undefined,
      notes: item.physical_processor || undefined,
    });
  }

  // Sort by price
  compute.sort((a, b) => a.monthlyPrice - b.monthlyPrice);

  console.log(`  Processed ${compute.length} EC2 instances with pricing`);

  // Fetch RDS data
  console.log('Fetching AWS RDS data...');
  const rdsResponse = await fetch(AWS_RDS_URL);
  const rdsData = await rdsResponse.json() as any[];

  console.log(`  Found ${rdsData.length} RDS instance types`);

  const database: DatabasePricing[] = [];
  const engines = ['PostgreSQL', 'MySQL', 'MariaDB'];

  for (const item of rdsData) {
    const regionPricing = item.pricing?.[AWS_REGION];
    if (!regionPricing) continue;

    for (const engine of engines) {
      const engineKey = Object.keys(regionPricing).find(
        k => k.toLowerCase().includes(engine.toLowerCase())
      );
      if (!engineKey) continue;

      const enginePricing = regionPricing[engineKey];
      if (!enginePricing?.ondemand) continue;

      const hourlyPrice = parseFloat(enginePricing.ondemand);
      if (isNaN(hourlyPrice) || hourlyPrice <= 0) continue;

      database.push({
        provider: 'aws',
        name: `RDS ${item.instance_type} (${engine})`,
        type: 'relational',
        engine,
        vcpus: item.vCPU,
        memoryGB: item.memory,
        hourlyPrice,
        monthlyPrice: Math.round(hourlyPrice * 730 * 100) / 100,
        notes: `Single-AZ, ${engine}`,
      });
    }
  }

  database.sort((a, b) => a.monthlyPrice - b.monthlyPrice);
  console.log(`  Processed ${database.length} RDS instances`);

  return { compute, database };
}

// ============= Azure =============
async function fetchAzureData() {
  console.log('Fetching Azure data...');
  const response = await fetch(AZURE_URL);
  const data = await response.json() as any[];

  console.log(`  Found ${data.length} Azure VM types`);

  const compute: ComputeInstance[] = [];

  for (const item of data) {
    const pricing = item.pricing?.[AZURE_REGION];
    // Azure pricing is nested: pricing.region.linux.ondemand
    const linuxPricing = pricing?.linux;
    if (!linuxPricing?.ondemand) continue;

    const hourlyPrice = parseFloat(linuxPricing.ondemand);
    if (isNaN(hourlyPrice) || hourlyPrice <= 0) continue;

    const category = mapAzureCategory(item.category);
    const vmName = item.pretty_name || item.name || 'Unknown';

    compute.push({
      provider: 'azure',
      name: vmName,
      displayName: `${vmName} (${item.category || 'General'})`,
      vcpus: item.vcpu || item.vcpus || 0, // vantage uses 'vcpu'
      memoryGB: item.memory || 0,
      hourlyPrice,
      monthlyPrice: Math.round(hourlyPrice * 730 * 100) / 100,
      region: 'eastus', // Store as standard Azure region name
      category,
      architecture: vmName.toLowerCase().includes('arm') || vmName.toLowerCase().includes('psv') ? 'arm' : 'x86',
      gpuCount: parseInt(item.GPU) || undefined,
      notes: item.family ? `${item.family}-series` : undefined,
    });
  }

  compute.sort((a, b) => a.monthlyPrice - b.monthlyPrice);
  console.log(`  Processed ${compute.length} Azure VMs with pricing`);

  return { compute };
}

// ============= GCP =============
async function fetchGCPData() {
  console.log('Fetching GCP data...');
  const response = await fetch(GCP_URL);
  const data = await response.json() as any[];

  console.log(`  Found ${data.length} GCP instance types`);

  const compute: ComputeInstance[] = [];

  for (const item of data) {
    const pricing = item.pricing?.[GCP_REGION];
    // GCP pricing is nested: pricing.region.linux.ondemand (as string)
    const linuxPricing = pricing?.linux;
    if (!linuxPricing?.ondemand) continue;

    const hourlyPrice = parseFloat(linuxPricing.ondemand);
    if (isNaN(hourlyPrice) || hourlyPrice <= 0) continue;

    const category = mapGCPCategory(item.family);
    const instanceName = item.instance_type || item.name || 'Unknown';

    compute.push({
      provider: 'gcp',
      name: instanceName,
      displayName: `${item.pretty_name || instanceName} (${item.family || 'General'})`,
      vcpus: item.vCPU || item.vcpus || 0, // vantage uses 'vCPU'
      memoryGB: item.memory || 0,
      hourlyPrice,
      monthlyPrice: Math.round(hourlyPrice * 730 * 100) / 100,
      region: GCP_REGION,
      category,
      architecture: instanceName.toLowerCase().includes('t2a') ? 'arm' : 'x86',
      gpuCount: item.GPU || undefined,
      gpuType: item.GPU_model || undefined,
      notes: item.generation || undefined,
    });
  }

  compute.sort((a, b) => a.monthlyPrice - b.monthlyPrice);
  console.log(`  Processed ${compute.length} GCP instances with pricing`);

  return { compute };
}

// ============= Helper Functions =============
function mapAWSCategory(family: string): string {
  const f = family?.toLowerCase() || '';
  if (f.includes('compute')) return 'compute';
  if (f.includes('memory')) return 'memory';
  if (f.includes('storage')) return 'storage';
  if (f.includes('accelerated') || f.includes('gpu')) return 'gpu';
  return 'general';
}

function mapAzureCategory(category: string): string {
  const c = category?.toLowerCase() || '';
  if (c.includes('compute')) return 'compute';
  if (c.includes('memory')) return 'memory';
  if (c.includes('storage')) return 'storage';
  if (c.includes('gpu') || c.includes('accelerated')) return 'gpu';
  return 'general';
}

function mapGCPCategory(family: string): string {
  const f = family?.toLowerCase() || '';
  if (f.includes('compute')) return 'compute';
  if (f.includes('memory') || f.includes('highmem')) return 'memory';
  if (f.includes('storage') || f.includes('highcpu')) return 'compute';
  if (f.includes('accelerator') || f.includes('gpu')) return 'gpu';
  return 'general';
}

// AWS Storage pricing (standard)
const AWS_STORAGE: StoragePricing[] = [
  { provider: 'aws', name: 'S3 Standard', type: 'object', tier: 'hot', pricePerGBMonth: 0.023, region: 'us-east-1', notes: 'First 50TB/month' },
  { provider: 'aws', name: 'S3 Infrequent Access', type: 'object', tier: 'cool', pricePerGBMonth: 0.0125, region: 'us-east-1', notes: '30-day minimum' },
  { provider: 'aws', name: 'S3 Glacier Instant', type: 'archive', tier: 'cold', pricePerGBMonth: 0.004, region: 'us-east-1', notes: 'Millisecond retrieval' },
  { provider: 'aws', name: 'S3 Glacier Deep Archive', type: 'archive', tier: 'archive', pricePerGBMonth: 0.00099, region: 'us-east-1', notes: '12-48hr retrieval' },
  { provider: 'aws', name: 'EBS gp3', type: 'block', tier: 'hot', pricePerGBMonth: 0.08, region: 'us-east-1', notes: '3000 IOPS, 125 MB/s included' },
  { provider: 'aws', name: 'EBS io2', type: 'block', tier: 'hot', pricePerGBMonth: 0.125, region: 'us-east-1', notes: 'Provisioned IOPS SSD' },
  { provider: 'aws', name: 'EFS Standard', type: 'file', tier: 'hot', pricePerGBMonth: 0.30, region: 'us-east-1', notes: 'NFS compatible' },
  { provider: 'aws', name: 'EFS Infrequent Access', type: 'file', tier: 'cool', pricePerGBMonth: 0.016, region: 'us-east-1', notes: 'Auto-tiering available' },
];

// Azure Storage pricing
const AZURE_STORAGE: StoragePricing[] = [
  { provider: 'azure', name: 'Blob Hot', type: 'object', tier: 'hot', pricePerGBMonth: 0.0184, region: 'eastus', notes: 'LRS, first 50TB' },
  { provider: 'azure', name: 'Blob Cool', type: 'object', tier: 'cool', pricePerGBMonth: 0.01, region: 'eastus', notes: '30-day minimum' },
  { provider: 'azure', name: 'Blob Cold', type: 'object', tier: 'cold', pricePerGBMonth: 0.0045, region: 'eastus', notes: '90-day minimum' },
  { provider: 'azure', name: 'Blob Archive', type: 'archive', tier: 'archive', pricePerGBMonth: 0.00099, region: 'eastus', notes: '180-day minimum' },
  { provider: 'azure', name: 'Managed Disk Premium SSD', type: 'block', tier: 'hot', pricePerGBMonth: 0.132, region: 'eastus', notes: 'P30 (1TB)' },
  { provider: 'azure', name: 'Managed Disk Standard SSD', type: 'block', tier: 'hot', pricePerGBMonth: 0.075, region: 'eastus', notes: 'E30 (1TB)' },
  { provider: 'azure', name: 'Azure Files Premium', type: 'file', tier: 'hot', pricePerGBMonth: 0.16, region: 'eastus', notes: 'SMB/NFS' },
  { provider: 'azure', name: 'Azure Files Standard', type: 'file', tier: 'hot', pricePerGBMonth: 0.06, region: 'eastus', notes: 'LRS' },
];

// GCP Storage pricing
const GCP_STORAGE: StoragePricing[] = [
  { provider: 'gcp', name: 'Cloud Storage Standard', type: 'object', tier: 'hot', pricePerGBMonth: 0.020, region: 'us-central1', notes: 'Multi-region +$0.006' },
  { provider: 'gcp', name: 'Cloud Storage Nearline', type: 'object', tier: 'cool', pricePerGBMonth: 0.010, region: 'us-central1', notes: '30-day minimum' },
  { provider: 'gcp', name: 'Cloud Storage Coldline', type: 'object', tier: 'cold', pricePerGBMonth: 0.004, region: 'us-central1', notes: '90-day minimum' },
  { provider: 'gcp', name: 'Cloud Storage Archive', type: 'archive', tier: 'archive', pricePerGBMonth: 0.0012, region: 'us-central1', notes: '365-day minimum' },
  { provider: 'gcp', name: 'Persistent Disk SSD', type: 'block', tier: 'hot', pricePerGBMonth: 0.170, region: 'us-central1', notes: 'Zonal' },
  { provider: 'gcp', name: 'Persistent Disk Balanced', type: 'block', tier: 'hot', pricePerGBMonth: 0.100, region: 'us-central1', notes: 'Cost-effective SSD' },
  { provider: 'gcp', name: 'Persistent Disk Standard', type: 'block', tier: 'hot', pricePerGBMonth: 0.040, region: 'us-central1', notes: 'HDD' },
  { provider: 'gcp', name: 'Filestore Basic', type: 'file', tier: 'hot', pricePerGBMonth: 0.20, region: 'us-central1', notes: 'NFS' },
];

// ============= Main =============
async function main() {
  console.log('=== Cloud Cost MCP - Pricing Data Fetcher ===\n');

  try {
    // Fetch AWS
    const awsData = await fetchAWSData();
    const awsBundle = {
      metadata: {
        provider: 'aws',
        lastUpdated: new Date().toISOString(),
        source: 'instances.vantage.sh + manual curation',
        version: '1.2.2',
        totalProducts: awsData.compute.length + awsData.database.length + AWS_STORAGE.length,
        currency: 'USD',
        notes: 'Comprehensive EC2 and RDS pricing from vantage.sh'
      },
      compute: awsData.compute,
      storage: AWS_STORAGE,
      egress: {
        provider: 'aws',
        freeGBPerMonth: 100,
        tiers: [
          { upToGB: 10240, pricePerGB: 0.09 },
          { upToGB: 51200, pricePerGB: 0.085 },
          { upToGB: 153600, pricePerGB: 0.07 },
          { upToGB: -1, pricePerGB: 0.05 }
        ],
        notes: 'First 100GB/month free. Tiered pricing after.'
      },
      kubernetes: {
        provider: 'aws',
        name: 'EKS',
        controlPlaneHourly: 0.10,
        controlPlaneMonthly: 73.00,
        workerNodeIncluded: false,
        notes: '$0.10/hr per cluster for control plane. Worker nodes billed separately.'
      },
      database: awsData.database,
    };

    writeFileSync(
      join(BUNDLED_DIR, 'aws-pricing.json'),
      JSON.stringify(awsBundle, null, 2)
    );
    console.log(`\nSaved AWS: ${awsData.compute.length} compute, ${awsData.database.length} database\n`);

    // Fetch Azure
    const azureData = await fetchAzureData();
    const azureBundle = {
      metadata: {
        provider: 'azure',
        lastUpdated: new Date().toISOString(),
        source: 'instances.vantage.sh + manual curation',
        version: '1.2.2',
        totalProducts: azureData.compute.length + AZURE_STORAGE.length,
        currency: 'USD',
        notes: 'Comprehensive Azure VM pricing from vantage.sh'
      },
      compute: azureData.compute,
      storage: AZURE_STORAGE,
      egress: {
        provider: 'azure',
        freeGBPerMonth: 100,
        tiers: [
          { upToGB: 10240, pricePerGB: 0.087 },
          { upToGB: 51200, pricePerGB: 0.083 },
          { upToGB: 153600, pricePerGB: 0.07 },
          { upToGB: -1, pricePerGB: 0.05 }
        ],
        notes: 'First 100GB/month free (with some services). Zone 1 pricing.'
      },
      kubernetes: {
        provider: 'azure',
        name: 'AKS',
        controlPlaneHourly: 0.0,
        controlPlaneMonthly: 0.0,
        workerNodeIncluded: false,
        notes: 'FREE control plane! Only pay for worker node VMs.'
      },
      database: [
        { provider: 'azure', name: 'Azure SQL Basic', type: 'relational', engine: 'SQL Server', vcpus: 1, memoryGB: 2, hourlyPrice: 0.0068, monthlyPrice: 4.99, notes: '5 DTUs, 2GB storage' },
        { provider: 'azure', name: 'Azure SQL Standard S0', type: 'relational', engine: 'SQL Server', vcpus: 1, memoryGB: 2, hourlyPrice: 0.0202, monthlyPrice: 14.72, notes: '10 DTUs' },
        { provider: 'azure', name: 'Azure SQL Standard S3', type: 'relational', engine: 'SQL Server', vcpus: 2, memoryGB: 8, hourlyPrice: 0.1343, monthlyPrice: 98.04, notes: '100 DTUs' },
        { provider: 'azure', name: 'Azure Database for PostgreSQL', type: 'relational', engine: 'PostgreSQL', vcpus: 2, memoryGB: 8, hourlyPrice: 0.102, monthlyPrice: 74.46, notes: 'Flexible Server' },
        { provider: 'azure', name: 'Azure Database for MySQL', type: 'relational', engine: 'MySQL', vcpus: 2, memoryGB: 8, hourlyPrice: 0.102, monthlyPrice: 74.46, notes: 'Flexible Server' },
        { provider: 'azure', name: 'Cosmos DB', type: 'nosql', engine: 'CosmosDB', hourlyPrice: 0.008, monthlyPrice: 5.84, notes: 'Per 100 RU/s provisioned' },
      ],
    };

    writeFileSync(
      join(BUNDLED_DIR, 'azure-pricing.json'),
      JSON.stringify(azureBundle, null, 2)
    );
    console.log(`Saved Azure: ${azureData.compute.length} compute\n`);

    // Fetch GCP
    const gcpData = await fetchGCPData();
    const gcpBundle = {
      metadata: {
        provider: 'gcp',
        lastUpdated: new Date().toISOString(),
        source: 'instances.vantage.sh + manual curation',
        version: '1.2.2',
        totalProducts: gcpData.compute.length + GCP_STORAGE.length,
        currency: 'USD',
        notes: 'Comprehensive GCP Compute Engine pricing from vantage.sh'
      },
      compute: gcpData.compute,
      storage: GCP_STORAGE,
      egress: {
        provider: 'gcp',
        freeGBPerMonth: 200,
        tiers: [
          { upToGB: 1024, pricePerGB: 0.12 },
          { upToGB: 10240, pricePerGB: 0.11 },
          { upToGB: -1, pricePerGB: 0.08 }
        ],
        notes: 'First 200GB/month free (Standard tier). Premium tier +$0.02-0.05.'
      },
      kubernetes: {
        provider: 'gcp',
        name: 'GKE',
        controlPlaneHourly: 0.10,
        controlPlaneMonthly: 73.00,
        workerNodeIncluded: false,
        notes: '$0.10/hr per cluster. Autopilot mode: $0.10/hr + pod resources.'
      },
      database: [
        { provider: 'gcp', name: 'Cloud SQL PostgreSQL', type: 'relational', engine: 'PostgreSQL', vcpus: 1, memoryGB: 3.75, hourlyPrice: 0.0413, monthlyPrice: 30.15, notes: 'db-f1-micro' },
        { provider: 'gcp', name: 'Cloud SQL PostgreSQL', type: 'relational', engine: 'PostgreSQL', vcpus: 2, memoryGB: 8, hourlyPrice: 0.1238, monthlyPrice: 90.37, notes: 'db-custom-2-8192' },
        { provider: 'gcp', name: 'Cloud SQL MySQL', type: 'relational', engine: 'MySQL', vcpus: 1, memoryGB: 3.75, hourlyPrice: 0.0413, monthlyPrice: 30.15, notes: 'db-f1-micro' },
        { provider: 'gcp', name: 'Cloud SQL MySQL', type: 'relational', engine: 'MySQL', vcpus: 2, memoryGB: 8, hourlyPrice: 0.1238, monthlyPrice: 90.37, notes: 'db-custom-2-8192' },
        { provider: 'gcp', name: 'Cloud Spanner', type: 'relational', engine: 'Spanner', vcpus: 1, memoryGB: 0, hourlyPrice: 0.90, monthlyPrice: 657.00, notes: 'Per node, globally distributed' },
        { provider: 'gcp', name: 'Firestore', type: 'nosql', engine: 'Firestore', hourlyPrice: 0.0, monthlyPrice: 0.0, notes: '$0.18/100K reads, $0.18/100K writes' },
        { provider: 'gcp', name: 'Bigtable', type: 'nosql', engine: 'Bigtable', vcpus: 3, memoryGB: 0, hourlyPrice: 0.65, monthlyPrice: 474.50, notes: 'Per node, wide-column store' },
      ],
    };

    writeFileSync(
      join(BUNDLED_DIR, 'gcp-pricing.json'),
      JSON.stringify(gcpBundle, null, 2)
    );
    console.log(`Saved GCP: ${gcpData.compute.length} compute\n`);

    // Summary
    console.log('=== Summary ===');
    console.log(`AWS: ${awsBundle.metadata.totalProducts} total SKUs`);
    console.log(`Azure: ${azureBundle.metadata.totalProducts} total SKUs`);
    console.log(`GCP: ${gcpBundle.metadata.totalProducts} total SKUs`);
    console.log('\nOCI data is already comprehensive (run separately if needed)');
    console.log('\nDone! Run `npm run build` to compile.');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
