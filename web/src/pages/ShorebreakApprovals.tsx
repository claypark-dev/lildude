import { useCallback, useState } from 'react';
import { useApi } from '../hooks/useApi.ts';
import {
  fetchProposals,
  fetchProposalDetail,
  approveProposal,
  rejectProposal,
} from '../lib/api.ts';
import type { WaveProposal, ProposalsResponse } from '../lib/types.ts';

/** Status badge colors for scan/test results */
function StatusBadge({ passed, label }: { passed: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
        passed
          ? 'bg-green-500/10 text-green-400'
          : 'bg-red-500/10 text-red-400'
      }`}
    >
      {passed ? '\u2713' : '\u2717'} {label}
    </span>
  );
}

/** Safety tier badge */
function TierBadge({ tier }: { tier: string }) {
  const tierColors: Record<string, string> = {
    basic: 'bg-blue-500/10 text-blue-400',
    standard: 'bg-amber-500/10 text-amber-400',
    privileged: 'bg-red-500/10 text-red-400',
  };
  const color = tierColors[tier] ?? 'bg-[#333] text-[#ccc]';
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {tier}
    </span>
  );
}

/** Individual proposal card in the list view */
function ProposalCard({
  proposal,
  onSelect,
}: {
  proposal: ProposalsResponse['proposals'][number];
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className="w-full text-left bg-[#111] rounded-xl p-5 border border-[#222] hover:border-[#444] transition-colors"
      onClick={() => onSelect(proposal.id)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-white font-semibold truncate">{proposal.name}</h3>
          <p className="text-[#a0a0a0] text-sm mt-1 line-clamp-2">{proposal.description}</p>
        </div>
        <TierBadge tier={proposal.safety_tier} />
      </div>
      <div className="flex items-center gap-3 mt-3">
        <StatusBadge passed={proposal.scan_passed === 1} label="Scan" />
        <StatusBadge passed={proposal.test_passed === 1} label="Tests" />
        <span className="text-xs text-[#666] ml-auto">
          {new Date(proposal.created_at).toLocaleDateString()}
        </span>
      </div>
    </button>
  );
}

/** Full detail view for a selected proposal */
function ProposalDetailView({
  proposal,
  onBack,
  onAction,
  actionLoading,
}: {
  proposal: WaveProposal;
  onBack: () => void;
  onAction: (action: 'approve' | 'reject') => void;
  actionLoading: boolean;
}) {
  const [showSource, setShowSource] = useState(false);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="px-3 py-1.5 bg-[#1a1a1a] hover:bg-[#333] text-[#ccc] text-sm rounded-lg transition-colors"
          onClick={onBack}
        >
          {'\u2190'} Back
        </button>
        <h2 className="text-2xl font-bold text-white">{proposal.name}</h2>
        <TierBadge tier={proposal.safetyTier} />
      </div>

      {/* Description + metadata */}
      <div className="bg-[#111] rounded-xl p-6 border border-[#222] space-y-4">
        <p className="text-[#ccc]">{proposal.description}</p>
        <div className="flex flex-wrap gap-3">
          <StatusBadge passed={proposal.scanPassed} label="Security Scan" />
          <StatusBadge passed={proposal.testPassed} label="Sandbox Tests" />
          <span className="text-xs text-[#666]">
            Template: {proposal.sourceTemplate}
          </span>
          <span className="text-xs text-[#666]">
            Created: {new Date(proposal.createdAt).toLocaleString()}
          </span>
        </div>
      </div>

      {/* Scan result */}
      <div className="bg-[#111] rounded-xl p-6 border border-[#222]">
        <h3 className="text-white font-semibold mb-3">Security Scan Results</h3>
        <pre className="text-xs text-[#a0a0a0] bg-[#0a0a0a] p-4 rounded-lg overflow-x-auto max-h-48">
          {JSON.stringify(proposal.scanResult, null, 2)}
        </pre>
      </div>

      {/* Source code (collapsible) */}
      <div className="bg-[#111] rounded-xl p-6 border border-[#222]">
        <button
          type="button"
          className="text-white font-semibold flex items-center gap-2"
          onClick={() => setShowSource(!showSource)}
        >
          {showSource ? '\u25BC' : '\u25B6'} Source Code
        </button>
        {showSource && (
          <pre className="text-xs text-[#a0a0a0] bg-[#0a0a0a] p-4 rounded-lg overflow-x-auto mt-3 max-h-96">
            {proposal.sourceCode}
          </pre>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="px-6 py-2.5 bg-green-600 hover:bg-green-500 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
          onClick={() => onAction('approve')}
          disabled={actionLoading}
        >
          {actionLoading ? 'Processing...' : 'Approve Wave'}
        </button>
        <button
          type="button"
          className="px-6 py-2.5 bg-red-600 hover:bg-red-500 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
          onClick={() => onAction('reject')}
          disabled={actionLoading}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

/** Shorebreak wave approval page — lists pending proposals for review */
export function ShorebreakApprovals() {
  const proposals = useApi(useCallback(() => fetchProposals(), []));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WaveProposal | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function handleSelect(id: string) {
    setSelectedId(id);
    setDetailLoading(true);
    setDetailError(null);
    setActionMessage(null);
    try {
      const data = await fetchProposalDetail(id);
      setDetail(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load proposal';
      setDetailError(message);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleAction(action: 'approve' | 'reject') {
    if (!selectedId) return;
    setActionLoading(true);
    setActionMessage(null);
    try {
      const fn = action === 'approve' ? approveProposal : rejectProposal;
      const result = await fn(selectedId);
      setActionMessage(result.message);
      setSelectedId(null);
      setDetail(null);
      proposals.refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Action failed';
      setActionMessage(message);
    } finally {
      setActionLoading(false);
    }
  }

  const proposalCount = proposals.data?.count ?? 0;

  // Detail view
  if (selectedId) {
    return (
      <div className="max-w-3xl space-y-6">
        {detailLoading && <p className="text-[#a0a0a0] text-sm">Loading proposal...</p>}
        {detailError && <p className="text-red-400 text-sm">{detailError}</p>}
        {detail && (
          <ProposalDetailView
            proposal={detail}
            onBack={() => {
              setSelectedId(null);
              setDetail(null);
            }}
            onAction={handleAction}
            actionLoading={actionLoading}
          />
        )}
        {actionMessage && (
          <p className="text-sm text-blue-400 bg-blue-500/10 px-4 py-2 rounded-lg">
            {actionMessage}
          </p>
        )}
      </div>
    );
  }

  // List view
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Wave Approvals</h2>
        <button
          type="button"
          className="px-4 py-2 bg-[#1a1a1a] hover:bg-[#333] text-white text-sm rounded-lg transition-colors"
          onClick={proposals.refetch}
        >
          Refresh
        </button>
      </div>

      {/* Summary */}
      <div className="bg-[#111] rounded-xl p-4 border border-[#222]">
        <p className="text-xs text-[#a0a0a0] uppercase tracking-wide">Pending Proposals</p>
        <p className="text-2xl font-semibold text-white mt-1">{proposalCount}</p>
      </div>

      {actionMessage && (
        <p className="text-sm text-blue-400 bg-blue-500/10 px-4 py-2 rounded-lg">
          {actionMessage}
        </p>
      )}

      {/* Proposal list */}
      <section className="space-y-3">
        {proposals.loading && <p className="text-[#a0a0a0] text-sm">Loading proposals...</p>}
        {proposals.error && <p className="text-red-400 text-sm">{proposals.error}</p>}
        {proposals.data && proposalCount === 0 && (
          <div className="bg-[#111] rounded-xl p-8 border border-[#222] text-center">
            <p className="text-[#a0a0a0]">No pending wave proposals.</p>
            <p className="text-xs text-[#666] mt-2">
              Shorebreak proposals will appear here when generated.
            </p>
          </div>
        )}
        {proposals.data?.proposals.map((proposal) => (
          <ProposalCard
            key={proposal.id}
            proposal={proposal}
            onSelect={handleSelect}
          />
        ))}
      </section>
    </div>
  );
}
