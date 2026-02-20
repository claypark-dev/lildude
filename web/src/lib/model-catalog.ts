/** Curated catalog of recommended Ollama models for the onboarding wizard */

export interface ModelEntry {
  /** Human-readable model name */
  name: string;
  /** Ollama tag for pulling (e.g. 'llama3.2') */
  ollamaTag: string;
  /** Download size in GB */
  sizeGb: number;
  /** Minimum RAM required in GB */
  minRamGb: number;
  /** Minimum free disk space required in GB */
  minDiskGb: number;
  /** Short description of the model's strengths */
  description: string;
}

/** Curated set of models suitable for local execution */
export const MODEL_CATALOG: ModelEntry[] = [
  {
    name: 'Llama 3.2 3B',
    ollamaTag: 'llama3.2',
    sizeGb: 2.0,
    minRamGb: 8,
    minDiskGb: 4,
    description: 'Fast general-purpose model, great for everyday tasks',
  },
  {
    name: 'Phi-3 Mini 3.8B',
    ollamaTag: 'phi3:mini',
    sizeGb: 2.3,
    minRamGb: 8,
    minDiskGb: 4,
    description: 'Lightweight model with strong reasoning capabilities',
  },
  {
    name: 'Qwen 2.5 7B',
    ollamaTag: 'qwen2.5',
    sizeGb: 4.4,
    minRamGb: 16,
    minDiskGb: 8,
    description: 'Multilingual powerhouse with tool-use support',
  },
  {
    name: 'Llama 3.1 8B',
    ollamaTag: 'llama3.1',
    sizeGb: 4.7,
    minRamGb: 16,
    minDiskGb: 8,
    description: 'Strong reasoning and instruction following',
  },
  {
    name: 'Mistral 7B',
    ollamaTag: 'mistral',
    sizeGb: 4.1,
    minRamGb: 16,
    minDiskGb: 8,
    description: 'Excellent for coding and technical tasks',
  },
  {
    name: 'DeepSeek Coder V2 Lite',
    ollamaTag: 'deepseek-coder-v2:lite',
    sizeGb: 9.0,
    minRamGb: 16,
    minDiskGb: 12,
    description: 'Specialized code generation and understanding',
  },
];
