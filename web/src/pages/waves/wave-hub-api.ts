/**
 * Waves Hub API client.
 * Centralizes all fetch calls for the enhanced Waves Hub frontend.
 */

import { getStoredApiKey } from '../../lib/api.ts';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

/** Authenticated fetch wrapper for hub API calls. */
async function hubFetch(path: string, options?: RequestInit): Promise<Response> {
  const apiKey = getStoredApiKey();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  return fetch(`${BASE_URL}${path}`, { ...options, headers });
}

/** Display-ready wave card from the API. */
export interface WaveCard {
  name: string;
  displayName: string;
  description: string;
  author: string;
  version: string;
  category: string;
  tags: string[];
  installCount: number;
  averageRating: number;
  ratingCount: number;
  verified: boolean;
  featured: boolean;
  isPartyWave: boolean;
  safetyTier: string;
  deterministic: boolean;
  installed: boolean;
  source: string;
  iconUrl: string | null;
  executionCount: number;
  successRate: number;
  lastExecutedAt: string | null;
}

/** Category with wave count. */
export interface WaveCategory {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  icon: string | null;
  waveCount: number;
}

/** Wave review. */
export interface WaveReview {
  id: string;
  waveName: string;
  rating: number;
  comment: string | null;
  reviewer: string;
  createdAt: string;
}

/** Hub aggregate stats. */
export interface HubStats {
  registryCount: number;
  installedCount: number;
  categoryCount: number;
  featuredCount: number;
  totalExecutions: number;
  executionsBySource: { bundled: number; installed: number; generated: number };
  topInstalled: Array<{ waveName: string; installCount: number }>;
  topRated: Array<{ waveName: string; averageRating: number; ratingCount: number }>;
  topExecuted: Array<{ waveName: string; executionCount: number; successRate: number }>;
}

/** Listed wave (basic installed wave info). */
export interface ListedWave {
  name: string;
  version: string;
  source: 'bundled' | 'installed';
  status: 'enabled' | 'disabled';
}

/** Fetch categories with wave counts. */
export async function fetchCategories(): Promise<{ categories: WaveCategory[] }> {
  const res = await hubFetch('/api/v1/hub/categories');
  if (!res.ok) throw new Error('Failed to fetch categories');
  return res.json();
}

/** Fetch featured waves as WaveCards. */
export async function fetchFeatured(): Promise<{ featured: WaveCard[] }> {
  const res = await hubFetch('/api/v1/hub/featured');
  if (!res.ok) throw new Error('Failed to fetch featured waves');
  return res.json();
}

/** Browse waves with filters. */
export async function fetchBrowse(params: {
  q?: string;
  category?: string;
  tags?: string;
  sort?: string;
  party?: string;
  limit?: number;
  offset?: number;
}): Promise<{ waves: WaveCard[]; total: number }> {
  const searchParams = new URLSearchParams();
  if (params.q) searchParams.set('q', params.q);
  if (params.category) searchParams.set('category', params.category);
  if (params.tags) searchParams.set('tags', params.tags);
  if (params.sort) searchParams.set('sort', params.sort);
  if (params.party) searchParams.set('party', params.party);
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.offset) searchParams.set('offset', String(params.offset));

  const qs = searchParams.toString();
  const url = qs ? `/api/v1/hub/browse?${qs}` : '/api/v1/hub/browse';
  const res = await hubFetch(url);
  if (!res.ok) throw new Error('Failed to browse waves');
  return res.json();
}

/** Execution stats returned with wave detail. */
export interface WaveExecutionStats {
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgExecutionTimeMs: number | null;
  lastExecutedAt: string | null;
}

/** Fetch full wave detail with reviews and execution stats. */
export async function fetchWaveDetail(name: string): Promise<{
  wave: WaveCard;
  reviews: WaveReview[];
  executionStats: WaveExecutionStats | null;
}> {
  const res = await hubFetch(`/api/v1/hub/waves/${encodeURIComponent(name)}/detail`);
  if (!res.ok) throw new Error(`Failed to fetch wave "${name}"`);
  return res.json();
}

/** Fetch reviews for a wave. */
export async function fetchWaveReviews(name: string, limit?: number): Promise<{
  reviews: WaveReview[];
  averageRating: number;
  ratingCount: number;
}> {
  const qs = limit ? `?limit=${limit}` : '';
  const res = await hubFetch(`/api/v1/hub/waves/${encodeURIComponent(name)}/reviews${qs}`);
  if (!res.ok) throw new Error('Failed to fetch reviews');
  return res.json();
}

/** Submit a review for a wave. */
export async function submitReview(name: string, rating: number, comment?: string): Promise<WaveReview> {
  const res = await hubFetch(`/api/v1/hub/waves/${encodeURIComponent(name)}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating, comment }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({ error: 'Failed to submit review' }));
    throw new Error(errData.error ?? 'Failed to submit review');
  }
  return res.json();
}

/** Fetch aggregate hub stats. */
export async function fetchHubStats(): Promise<{ stats: HubStats }> {
  const res = await hubFetch('/api/v1/hub/stats');
  if (!res.ok) throw new Error('Failed to fetch hub stats');
  return res.json();
}

/** Fetch installed waves (basic listing). */
export async function fetchInstalledWaves(): Promise<{ waves: ListedWave[] }> {
  const res = await hubFetch('/api/v1/hub/waves');
  if (!res.ok) throw new Error('Failed to fetch installed waves');
  return res.json();
}

/** Install a wave from source. */
export async function installWave(source: string): Promise<{ name: string; version: string }> {
  const res = await hubFetch('/api/v1/hub/install', {
    method: 'POST',
    body: JSON.stringify({ source }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Installation failed');
  return data;
}

/** Wave update info returned by the updates API. */
export interface WaveUpdateInfo {
  name: string;
  currentVersion: string;
  latestVersion: string;
  source: string;
  description: string;
}

/** Fetch available updates for installed waves. */
export async function fetchUpdates(): Promise<{ updates: WaveUpdateInfo[]; total: number }> {
  const res = await hubFetch('/api/v1/hub/updates');
  if (!res.ok) throw new Error('Failed to check for updates');
  return res.json();
}

/** Update an installed wave to its latest version. */
export async function updateWave(
  name: string,
  source: string,
): Promise<{ name: string; version: string }> {
  const res = await hubFetch(`/api/v1/hub/update/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: JSON.stringify({ source }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Update failed');
  return data;
}

/** Uninstall a wave by name. */
export async function uninstallWave(name: string): Promise<void> {
  const res = await hubFetch(`/api/v1/hub/waves/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Uninstall failed' }));
    throw new Error(data.error ?? 'Uninstall failed');
  }
}
