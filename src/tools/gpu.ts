/**
 * Cloud Cost MCP - GPU Tools
 * Tools for listing, comparing, and recommending GPU shapes
 */

import type { GPUPricing, GPUUseCase } from '../types.js';
import { getGPUPricing, getGPUShapeByFamily } from '../data/loader.js';

/**
 * List GPU shapes with optional filtering
 */
export function listGPUShapes(params: {
  gpuModel?: string;
  useCase?: GPUUseCase;
  maxPricePerHour?: number;
}): {
  shapes: GPUPricing[];
  count: number;
  summary: string;
} {
  let shapes = getGPUPricing();

  // Filter by GPU model
  if (params.gpuModel) {
    const model = params.gpuModel.toLowerCase();
    shapes = shapes.filter(
      (s) =>
        s.gpuModel.toLowerCase().includes(model) ||
        s.type.toLowerCase().includes(model) ||
        s.shapeFamily.toLowerCase().includes(model)
    );
  }

  // Filter by use case
  if (params.useCase) {
    shapes = shapes.filter((s) => s.useCase === params.useCase);
  }

  // Filter by max price
  if (params.maxPricePerHour !== undefined) {
    shapes = shapes.filter((s) => s.pricePerHour <= params.maxPricePerHour!);
  }

  // Sort by price
  shapes.sort((a, b) => a.pricePerHour - b.pricePerHour);

  const summary =
    shapes.length === 0
      ? 'No GPU shapes match the specified criteria.'
      : `Found ${shapes.length} GPU shape(s). Prices range from $${shapes[0].pricePerHour.toFixed(2)}/hr to $${shapes[shapes.length - 1].pricePerHour.toFixed(2)}/hr.`;

  return {
    shapes,
    count: shapes.length,
    summary,
  };
}

/**
 * Get detailed info for a specific GPU shape
 */
export function getGPUShapeDetails(shapeFamily: string): {
  found: boolean;
  shape?: GPUPricing;
  monthlyEstimate?: number;
  costBreakdown?: {
    hourly: number;
    daily: number;
    monthly: number;
    annual: number;
  };
  specs?: {
    totalGPUMemoryGB: number;
    gpuMemoryPerUnit: number;
    memoryPerOCPU: number;
  };
  message: string;
} {
  const shape = getGPUShapeByFamily(shapeFamily);

  if (!shape) {
    const allShapes = getGPUPricing();
    const availableShapes = allShapes.map((s) => s.shapeFamily).join(', ');
    return {
      found: false,
      message: `GPU shape '${shapeFamily}' not found. Available shapes: ${availableShapes}`,
    };
  }

  const monthlyEstimate = shape.pricePerHour * 730; // 730 hours/month
  const totalGPUMemoryGB = shape.gpuCount * shape.gpuMemoryGB;

  return {
    found: true,
    shape,
    monthlyEstimate,
    costBreakdown: {
      hourly: shape.pricePerHour,
      daily: shape.pricePerHour * 24,
      monthly: monthlyEstimate,
      annual: monthlyEstimate * 12,
    },
    specs: {
      totalGPUMemoryGB,
      gpuMemoryPerUnit: shape.gpuMemoryGB,
      memoryPerOCPU: Math.round(shape.memoryGB / shape.ocpus),
    },
    message: `${shape.name}: ${shape.gpuCount}x ${shape.gpuModel} with ${totalGPUMemoryGB}GB total GPU memory at $${shape.pricePerHour.toFixed(2)}/hr ($${monthlyEstimate.toFixed(2)}/month)`,
  };
}

/**
 * Compare multiple GPU shapes side by side
 */
export function compareGPUShapes(shapes: string[]): {
  comparison: Array<{
    shapeFamily: string;
    name: string;
    gpuCount: number;
    gpuModel: string;
    gpuMemoryGB: number;
    totalGPUMemoryGB: number;
    ocpus: number;
    memoryGB: number;
    pricePerHour: number;
    monthlyPrice: number;
    useCase: string;
    pricePerGPU: number;
    pricePerGPUMemoryGB: number;
  }>;
  cheapest: string | null;
  mostMemory: string | null;
  summary: string;
} {
  const results: Array<{
    shapeFamily: string;
    name: string;
    gpuCount: number;
    gpuModel: string;
    gpuMemoryGB: number;
    totalGPUMemoryGB: number;
    ocpus: number;
    memoryGB: number;
    pricePerHour: number;
    monthlyPrice: number;
    useCase: string;
    pricePerGPU: number;
    pricePerGPUMemoryGB: number;
  }> = [];

  const notFound: string[] = [];

  for (const shapeFamily of shapes) {
    const shape = getGPUShapeByFamily(shapeFamily);
    if (shape) {
      const totalGPUMemoryGB = shape.gpuCount * shape.gpuMemoryGB;
      results.push({
        shapeFamily: shape.shapeFamily,
        name: shape.name,
        gpuCount: shape.gpuCount,
        gpuModel: shape.gpuModel,
        gpuMemoryGB: shape.gpuMemoryGB,
        totalGPUMemoryGB,
        ocpus: shape.ocpus,
        memoryGB: shape.memoryGB,
        pricePerHour: shape.pricePerHour,
        monthlyPrice: shape.pricePerHour * 730,
        useCase: shape.useCase,
        pricePerGPU: shape.pricePerHour / shape.gpuCount,
        pricePerGPUMemoryGB: shape.pricePerHour / totalGPUMemoryGB,
      });
    } else {
      notFound.push(shapeFamily);
    }
  }

  if (results.length === 0) {
    return {
      comparison: [],
      cheapest: null,
      mostMemory: null,
      summary: `No valid GPU shapes found. Not found: ${notFound.join(', ')}`,
    };
  }

  // Find cheapest and most memory
  const cheapest = results.reduce((a, b) =>
    a.pricePerHour < b.pricePerHour ? a : b
  );
  const mostMemory = results.reduce((a, b) =>
    a.totalGPUMemoryGB > b.totalGPUMemoryGB ? a : b
  );

  let summary = `Compared ${results.length} GPU shapes. `;
  summary += `Cheapest: ${cheapest.name} at $${cheapest.pricePerHour.toFixed(2)}/hr. `;
  summary += `Most GPU memory: ${mostMemory.name} with ${mostMemory.totalGPUMemoryGB}GB total.`;

  if (notFound.length > 0) {
    summary += ` Not found: ${notFound.join(', ')}.`;
  }

  return {
    comparison: results,
    cheapest: cheapest.shapeFamily,
    mostMemory: mostMemory.shapeFamily,
    summary,
  };
}

/**
 * Recommend GPU shape based on workload requirements
 */
export function recommendGPUShape(params: {
  workloadType: 'inference' | 'training' | 'fine-tuning' | 'data-science';
  minGPUMemoryGB?: number;
  budget?: 'low' | 'medium' | 'high';
}): {
  recommended: GPUPricing | null;
  alternatives: GPUPricing[];
  reasoning: string;
  allMatches: GPUPricing[];
} {
  let shapes = getGPUPricing();

  // Map workload type to use case
  const useCaseMap: Record<string, GPUUseCase[]> = {
    inference: ['inference'],
    training: ['training'],
    'fine-tuning': ['training', 'inference'],
    'data-science': ['inference', 'training', 'general'],
  };

  const relevantUseCases = useCaseMap[params.workloadType] || ['general'];

  // Filter by use case
  shapes = shapes.filter((s) => relevantUseCases.includes(s.useCase));

  // Filter by minimum GPU memory if specified
  if (params.minGPUMemoryGB) {
    shapes = shapes.filter((s) => s.gpuMemoryGB >= params.minGPUMemoryGB!);
  }

  // Filter by budget
  const budgetRanges: Record<string, { min: number; max: number }> = {
    low: { min: 0, max: 5 },
    medium: { min: 0, max: 20 },
    high: { min: 0, max: Infinity },
  };

  if (params.budget) {
    const range = budgetRanges[params.budget];
    shapes = shapes.filter(
      (s) => s.pricePerHour >= range.min && s.pricePerHour <= range.max
    );
  }

  // Sort by price
  shapes.sort((a, b) => a.pricePerHour - b.pricePerHour);

  if (shapes.length === 0) {
    return {
      recommended: null,
      alternatives: [],
      reasoning: `No GPU shapes match the criteria: workloadType=${params.workloadType}, minGPUMemoryGB=${params.minGPUMemoryGB || 'any'}, budget=${params.budget || 'any'}. Try relaxing your requirements.`,
      allMatches: [],
    };
  }

  // Pick recommended based on workload type
  let recommended: GPUPricing;

  if (params.workloadType === 'inference') {
    // For inference, prefer A10 or L40S (good inference performance, reasonable cost)
    recommended =
      shapes.find(
        (s) => s.type === 'nvidia-a10' || s.type === 'nvidia-l40s'
      ) || shapes[0];
  } else if (params.workloadType === 'training') {
    // For training, prefer H100 > A100 > others if budget allows
    recommended =
      shapes.find((s) => s.type === 'nvidia-h100') ||
      shapes.find((s) => s.type === 'nvidia-a100') ||
      shapes[shapes.length - 1]; // Most capable in range
  } else if (params.workloadType === 'fine-tuning') {
    // For fine-tuning, A100 is often the sweet spot
    recommended =
      shapes.find((s) => s.type === 'nvidia-a100') ||
      shapes.find((s) => s.type === 'nvidia-a10') ||
      shapes[0];
  } else {
    // Data science - balance of cost and capability
    recommended = shapes[Math.floor(shapes.length / 2)] || shapes[0];
  }

  const alternatives = shapes.filter(
    (s) => s.shapeFamily !== recommended.shapeFamily
  );

  const reasoning = buildRecommendationReasoning(recommended, params);

  return {
    recommended,
    alternatives: alternatives.slice(0, 3), // Top 3 alternatives
    reasoning,
    allMatches: shapes,
  };
}

function buildRecommendationReasoning(
  shape: GPUPricing,
  params: {
    workloadType: string;
    minGPUMemoryGB?: number;
    budget?: string;
  }
): string {
  const parts: string[] = [];

  parts.push(`Recommended: ${shape.name} (${shape.shapeFamily})`);
  parts.push(`- ${shape.gpuCount}x ${shape.gpuModel} with ${shape.gpuMemoryGB}GB memory per GPU`);
  parts.push(`- Total GPU memory: ${shape.gpuCount * shape.gpuMemoryGB}GB`);
  parts.push(`- Price: $${shape.pricePerHour.toFixed(2)}/hr ($${(shape.pricePerHour * 730).toFixed(2)}/month)`);

  switch (params.workloadType) {
    case 'inference':
      parts.push(`- Best for inference due to balanced performance-to-cost ratio`);
      break;
    case 'training':
      parts.push(`- Best for training with high memory bandwidth and tensor cores`);
      break;
    case 'fine-tuning':
      parts.push(`- Good balance of memory and cost for fine-tuning workloads`);
      break;
    case 'data-science':
      parts.push(`- Versatile option for data science experimentation`);
      break;
  }

  if (shape.notes) {
    parts.push(`- Note: ${shape.notes}`);
  }

  return parts.join('\n');
}
