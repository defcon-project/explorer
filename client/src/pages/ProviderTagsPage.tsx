import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HiOutlineTag } from 'react-icons/hi2';
import { fetchActiveProviderTags, submitProviderTag, submitProviderTagsBulk } from '../services/api';
import type {
  ProviderTagBulkInvalidLine,
  ProviderTagBulkSubmissionInput,
} from '../types/api';
import { formatNumber } from '../utils/formatters';
import './PageStyles.css';
import './MasternodesPage.css';

type ProviderTagSubmitState = {
  cidr: string;
  provider: string;
  reporter: string;
  contact: string;
  evidenceUrl: string;
  notes: string;
};

type ProviderTagSourceValue = NonNullable<ProviderTagBulkSubmissionInput['source']>;

type ProviderTagBulkSubmitState = {
  provider: string;
  source: ProviderTagSourceValue;
  confidence: string;
  submittedBy: string;
  reporter: string;
  contact: string;
  evidenceUrl: string;
  notes: string;
  rawText: string;
};

type ProviderTagBulkPreview = {
  totalLines: number;
  validEntries: string[];
  duplicatesSkipped: number;
  alreadyExistsSkipped?: number;
  invalidLines: ProviderTagBulkInvalidLine[];
};

function isValidIpv4ForProviderTag(value: string): boolean {
  return /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/.test(value);
}

function normalizeProviderTagBulkLine(rawLine: string): string | null {
  const value = String(rawLine || '').trim();
  if (!value) return null;

  let candidate = value;
  const withPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/);
  if (withPort) candidate = withPort[1];

  if (candidate.includes('/')) {
    const [ipPart, prefixPart] = candidate.split('/');
    const ip = String(ipPart || '').trim();
    const prefix = Number.parseInt(String(prefixPart || '').trim(), 10);
    if (!isValidIpv4ForProviderTag(ip)) return null;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
    return `${ip}/${prefix}`;
  }

  if (!isValidIpv4ForProviderTag(candidate)) return null;
  return `${candidate}/32`;
}

function buildProviderTagBulkPreview(rawText: string): ProviderTagBulkPreview {
  const lines = String(rawText || '').split(/\r?\n/g);
  const dedup = new Set<string>();
  const validEntries: string[] = [];
  const invalidLines: ProviderTagBulkInvalidLine[] = [];
  let duplicatesSkipped = 0;

  lines.forEach((line, index) => {
    const value = String(line || '').trim();
    if (!value) return;
    const normalized = normalizeProviderTagBulkLine(value);
    if (!normalized) {
      invalidLines.push({
        lineNumber: index + 1,
        value,
        reason: 'Invalid IPv4, IPv4:port, or IPv4 CIDR',
      });
      return;
    }
    const key = normalized.toLowerCase();
    if (dedup.has(key)) {
      duplicatesSkipped += 1;
      return;
    }
    dedup.add(key);
    validEntries.push(normalized);
  });

  return {
    totalLines: lines.length,
    validEntries,
    duplicatesSkipped,
    invalidLines,
  };
}

export default function ProviderTagsPage() {
  const activeTagsQuery = useQuery({
    queryKey: ['provider-tags', 'active'],
    queryFn: fetchActiveProviderTags,
    staleTime: 60_000,
  });

  const providerTagRows = activeTagsQuery.data?.rows || [];
  const loading = activeTagsQuery.isLoading;
  const error =
    activeTagsQuery.error != null
      ? ((activeTagsQuery.error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
          (activeTagsQuery.error as Error)?.message ||
          'Failed to load provider tags')
      : null;

  const taggedNodesCount = activeTagsQuery.data?.taggedNodes ?? 0;
  const taggedCoveragePct = activeTagsQuery.data?.taggedCoveragePct ?? 0;

  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSuccess, setBulkSuccess] = useState<string | null>(null);
  const [bulkPreview, setBulkPreview] = useState<ProviderTagBulkPreview | null>(null);
  const [submitForm, setSubmitForm] = useState<ProviderTagSubmitState>({
    cidr: '',
    provider: '',
    reporter: '',
    contact: '',
    evidenceUrl: '',
    notes: '',
  });
  const [bulkForm, setBulkForm] = useState<ProviderTagBulkSubmitState>({
    provider: '',
    source: 'operator_reported',
    confidence: '85',
    submittedBy: '',
    reporter: '',
    contact: '',
    evidenceUrl: '',
    notes: '',
    rawText: '',
  });

  const setSubmitField = (field: keyof ProviderTagSubmitState, value: string) => {
    setSubmitForm((prev) => ({ ...prev, [field]: value }));
  };

  const setBulkField = (field: keyof ProviderTagBulkSubmitState, value: string) => {
    setBulkForm((prev) => ({ ...prev, [field]: value }));
  };

  const closeSubmitForm = () => {
    if (submitLoading || bulkLoading) return;
    setSubmitError(null);
    setSubmitSuccess(null);
    setBulkError(null);
    setBulkSuccess(null);
    setBulkPreview(null);
    setShowSubmitForm(false);
  };

  const handlePreviewBulkProviderTags = () => {
    setBulkError(null);
    setBulkSuccess(null);
    const provider = bulkForm.provider.trim();
    if (!provider) {
      setBulkError('Provider is required for bulk preview.');
      setBulkPreview(null);
      return;
    }

    const preview = buildProviderTagBulkPreview(bulkForm.rawText);
    if (preview.validEntries.length === 0) {
      setBulkError('No valid entries found. Please fix invalid lines and try again.');
    }
    setBulkPreview(preview);
  };

  const handleSubmitProviderTag = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(null);

    const cidr = submitForm.cidr.trim();
    const provider = submitForm.provider.trim();

    if (!cidr || !provider) {
      setSubmitError('CIDR and provider are required.');
      return;
    }

    setSubmitLoading(true);
    try {
      const result = await submitProviderTag({
        cidr,
        provider,
        reporter: submitForm.reporter.trim() || undefined,
        contact: submitForm.contact.trim() || undefined,
        evidenceUrl: submitForm.evidenceUrl.trim() || undefined,
        notes: submitForm.notes.trim() || undefined,
      });

      setSubmitSuccess(result.message || 'Submission queued for review.');
      setSubmitForm((prev) => ({ ...prev, cidr: '', provider: '', evidenceUrl: '', notes: '' }));
    } catch (err) {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
        (err as Error)?.message ||
        'Failed to submit provider tag.';
      setSubmitError(message);
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleSubmitProviderTagsBulk = async (event: FormEvent) => {
    event.preventDefault();
    setBulkError(null);
    setBulkSuccess(null);

    const provider = bulkForm.provider.trim();
    if (!provider) {
      setBulkError('Provider is required.');
      return;
    }

    const preview = buildProviderTagBulkPreview(bulkForm.rawText);
    setBulkPreview(preview);
    if (preview.validEntries.length === 0) {
      setBulkError('No valid entries to submit.');
      return;
    }

    const confidenceValue = Number.parseFloat(String(bulkForm.confidence || '').trim());
    const confidence =
      Number.isFinite(confidenceValue) && confidenceValue >= 0 && confidenceValue <= 100
        ? Math.round(confidenceValue)
        : 85;

    setBulkLoading(true);
    try {
      const result = await submitProviderTagsBulk({
        provider,
        source: bulkForm.source,
        confidence,
        submittedBy: bulkForm.submittedBy.trim() || undefined,
        reporter: bulkForm.reporter.trim() || undefined,
        contact: bulkForm.contact.trim() || undefined,
        evidenceUrl: bulkForm.evidenceUrl.trim() || undefined,
        notes: bulkForm.notes.trim() || undefined,
        rawText: bulkForm.rawText,
      });

      setBulkSuccess(result.message || `Queued ${result.submitted} entries for review.`);
      setBulkPreview({
        totalLines: result.totalLines,
        validEntries: result.normalizedCidrs,
        duplicatesSkipped: result.duplicatesSkipped,
        alreadyExistsSkipped: result.alreadyExistsSkipped,
        invalidLines: result.invalidLines,
      });
      setBulkForm((prev) => ({ ...prev, rawText: '' }));
      void activeTagsQuery.refetch();
    } catch (err) {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
        (err as Error)?.message ||
        'Failed to submit provider tags in bulk.';
      setBulkError(message);
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title">
          <HiOutlineTag /> Provider Tags
        </h1>
        <p className="page-subtitle">
          CIDR based provider attribution for masternode analytics and PoSe monitoring.
        </p>
        <div className="mn-header-pills">
          <span className="mn-header-pill">{loading ? 'Loading...' : `${formatNumber(taggedNodesCount)} tagged nodes`}</span>
          <span className="mn-header-pill">{loading ? 'Loading...' : `${taggedCoveragePct.toFixed(1)}% live coverage`}</span>
          <span className="mn-header-pill">Review-first submissions</span>
        </div>
      </div>

      <div className="card mn-panel-card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <h2 className="card-title">
            <HiOutlineTag style={{ verticalAlign: '-0.15em', marginRight: '0.42rem' }} />
            Provider Tags (CIDR matches)
          </h2>
          <div className="mn-provider-tags-actions">
            <span className="text-muted">Live coverage: {formatNumber(taggedNodesCount)} tagged nodes</span>
            <button
              type="button"
              className={`btn btn-sm ${showSubmitForm ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => {
                if (showSubmitForm) closeSubmitForm();
                else {
                  setSubmitError(null);
                  setSubmitSuccess(null);
                  setBulkError(null);
                  setBulkSuccess(null);
                  setShowSubmitForm(true);
                }
              }}
            >
              {showSubmitForm ? 'Close form' : 'Submit Provider Tag'}
            </button>
          </div>
        </div>
        <p className="mn-panel-subtitle">
          Community-submitted CIDR labels that passed admin review and currently match live nodes.
        </p>

        {showSubmitForm ? (
          <div className="mn-inline-submit">
            <div className="mn-submit-section">
              <h3 className="mn-submit-title">Single Entry</h3>
              <p className="mn-modal-subtitle">
                Submit CIDR-to-provider mapping for review. It becomes active only after admin approval.
              </p>
              <p className="mn-modal-subtitle">Required fields: CIDR and Provider. All other fields are optional.</p>
              <form className="mn-submit-form" onSubmit={handleSubmitProviderTag}>
                <label className="mn-form-field">
                  <span>CIDR *</span>
                  <input
                    type="text"
                    placeholder="e.g. 198.51.100.0/24"
                    value={submitForm.cidr}
                    onChange={(event) => setSubmitField('cidr', event.target.value)}
                    disabled={submitLoading || bulkLoading}
                  />
                </label>

                <label className="mn-form-field">
                  <span>Provider *</span>
                  <input
                    type="text"
                    placeholder="e.g. RackNerd"
                    value={submitForm.provider}
                    onChange={(event) => setSubmitField('provider', event.target.value)}
                    disabled={submitLoading || bulkLoading}
                  />
                </label>

                <label className="mn-form-field">
                  <span>Reporter</span>
                  <input
                    type="text"
                    placeholder="Your name / handle"
                    value={submitForm.reporter}
                    onChange={(event) => setSubmitField('reporter', event.target.value)}
                    disabled={submitLoading || bulkLoading}
                  />
                </label>

                <label className="mn-form-field">
                  <span>Contact</span>
                  <input
                    type="text"
                    placeholder="Discord / email (optional)"
                    value={submitForm.contact}
                    onChange={(event) => setSubmitField('contact', event.target.value)}
                    disabled={submitLoading || bulkLoading}
                  />
                </label>

                <label className="mn-form-field">
                  <span>Evidence URL</span>
                  <input
                    type="url"
                    placeholder="https://..."
                    value={submitForm.evidenceUrl}
                    onChange={(event) => setSubmitField('evidenceUrl', event.target.value)}
                    disabled={submitLoading || bulkLoading}
                  />
                </label>

                <label className="mn-form-field">
                  <span>Notes</span>
                  <textarea
                    placeholder="Any extra context about this range"
                    value={submitForm.notes}
                    onChange={(event) => setSubmitField('notes', event.target.value)}
                    disabled={submitLoading || bulkLoading}
                    rows={3}
                  />
                </label>

                {submitError ? <div className="mn-form-message error">{submitError}</div> : null}
                {submitSuccess ? <div className="mn-form-message success">{submitSuccess}</div> : null}

                <div className="mn-form-actions">
                  <button type="button" className="btn btn-secondary" onClick={closeSubmitForm} disabled={submitLoading || bulkLoading}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={submitLoading || bulkLoading}>
                    {submitLoading ? 'Submitting...' : 'Submit for review'}
                  </button>
                </div>
              </form>
            </div>

            <div className="mn-submit-divider" />

            <div className="mn-submit-section">
              <h3 className="mn-submit-title">Bulk Import</h3>
              <p className="mn-modal-subtitle">
                Paste one IP, IP:port, or CIDR per line. Plain IPs will be stored as /32.
              </p>
              <form className="mn-submit-form mn-submit-form-bulk" onSubmit={handleSubmitProviderTagsBulk}>
                <label className="mn-form-field">
                  <span>Provider Name *</span>
                  <input
                    type="text"
                    placeholder="e.g. RackNerd"
                    value={bulkForm.provider}
                    onChange={(event) => setBulkField('provider', event.target.value)}
                    disabled={submitLoading || bulkLoading}
                  />
                </label>

                <label className="mn-form-field">
                  <span>Source</span>
                  <select
                    value={bulkForm.source}
                    onChange={(event) => setBulkField('source', event.target.value as ProviderTagSourceValue)}
                    disabled={submitLoading || bulkLoading}
                  >
                    <option value="operator_reported">Operator reported</option>
                    <option value="manual">Manual</option>
                    <option value="asn">ASN</option>
                    <option value="rdns">rDNS</option>
                  </select>
                </label>

                <label className="mn-form-field">
                  <span>Confidence (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={bulkForm.confidence}
                    onChange={(event) => setBulkField('confidence', event.target.value)}
                    disabled={submitLoading || bulkLoading}
                  />
                </label>

                <label className="mn-form-field">
                  <span>Submitted By</span>
                  <input
                    type="text"
                    placeholder="Your name / handle"
                    value={bulkForm.submittedBy}
                    onChange={(event) => setBulkField('submittedBy', event.target.value)}
                    disabled={submitLoading || bulkLoading}
                  />
                </label>

                <label className="mn-form-field">
                  <span>Reporter</span>
                  <input
                    type="text"
                    placeholder="Optional reporter"
                    value={bulkForm.reporter}
                    onChange={(event) => setBulkField('reporter', event.target.value)}
                    disabled={submitLoading || bulkLoading}
                  />
                </label>

                <label className="mn-form-field">
                  <span>Contact</span>
                  <input
                    type="text"
                    placeholder="Discord / email (optional)"
                    value={bulkForm.contact}
                    onChange={(event) => setBulkField('contact', event.target.value)}
                    disabled={submitLoading || bulkLoading}
                  />
                </label>

                <label className="mn-form-field">
                  <span>Evidence URL</span>
                  <input
                    type="url"
                    placeholder="https://..."
                    value={bulkForm.evidenceUrl}
                    onChange={(event) => setBulkField('evidenceUrl', event.target.value)}
                    disabled={submitLoading || bulkLoading}
                  />
                </label>

                <label className="mn-form-field">
                  <span>Notes</span>
                  <input
                    type="text"
                    placeholder="Optional batch context"
                    value={bulkForm.notes}
                    onChange={(event) => setBulkField('notes', event.target.value)}
                    disabled={submitLoading || bulkLoading}
                  />
                </label>

                <label className="mn-form-field mn-form-field-full">
                  <span>Bulk Input *</span>
                  <textarea
                    placeholder={'198.51.100.23:8192\n198.51.100.23\n198.51.100.23/32\n203.0.113.0/24'}
                    value={bulkForm.rawText}
                    onChange={(event) => setBulkField('rawText', event.target.value)}
                    disabled={submitLoading || bulkLoading}
                    rows={9}
                  />
                </label>

                {bulkError ? <div className="mn-form-message error">{bulkError}</div> : null}
                {bulkSuccess ? <div className="mn-form-message success">{bulkSuccess}</div> : null}

                <div className="mn-form-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handlePreviewBulkProviderTags}
                    disabled={submitLoading || bulkLoading}
                  >
                    Preview
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={submitLoading || bulkLoading}>
                    {bulkLoading ? 'Submitting...' : 'Submit for review'}
                  </button>
                </div>
              </form>

              {bulkPreview ? (
                <div className="mn-bulk-preview">
                  <div className="mn-bulk-preview-grid">
                    <div><strong>Provider:</strong> {bulkForm.provider.trim() || '-'}</div>
                    <div><strong>Total pasted lines:</strong> {formatNumber(bulkPreview.totalLines)}</div>
                    <div><strong>Valid entries:</strong> {formatNumber(bulkPreview.validEntries.length)}</div>
                    <div><strong>Duplicates skipped:</strong> {formatNumber(bulkPreview.duplicatesSkipped)}</div>
                    <div><strong>Already existing skipped:</strong> {formatNumber(bulkPreview.alreadyExistsSkipped ?? 0)}</div>
                    <div><strong>Invalid lines:</strong> {formatNumber(bulkPreview.invalidLines.length)}</div>
                  </div>

                  {bulkPreview.invalidLines.length > 0 ? (
                    <div className="mn-bulk-preview-invalid">
                      <strong>Invalid lines (not submitted):</strong>
                      <ul>
                        {bulkPreview.invalidLines.slice(0, 20).map((line) => (
                          <li key={`invalid-${line.lineNumber}-${line.value}`}>
                            Line {line.lineNumber}: <span className="mono">{line.value}</span> ({line.reason})
                          </li>
                        ))}
                      </ul>
                      {bulkPreview.invalidLines.length > 20 ? (
                        <p className="text-muted">Showing first 20 invalid lines.</p>
                      ) : null}
                    </div>
                  ) : null}

                  {bulkPreview.validEntries.length > 0 ? (
                    <div className="mn-bulk-preview-valid">
                      <strong>Normalized CIDR list:</strong>
                      <div className="mn-bulk-preview-list mono">
                        {bulkPreview.validEntries.map((entry) => (
                          <span key={`bulk-valid-${entry}`}>{entry}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="placeholder-content" style={{ padding: '1.7rem' }}>
            <p className="text-muted">{error}</p>
          </div>
        ) : loading ? (
          <div className="placeholder-content" style={{ padding: '1.7rem' }}>
            <p className="text-muted">Loading provider tags...</p>
          </div>
        ) : providerTagRows.length === 0 ? (
          <div className="placeholder-content" style={{ padding: '1.7rem' }}>
            <p className="text-muted">No active provider tags matched current nodes yet.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>CIDR</th>
                  <th>Provider</th>
                  <th>Source</th>
                  <th>Nodes</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {providerTagRows.map((row) => (
                  <tr key={`${row.cidr}-${row.provider}-${row.source}`}>
                    <td className="mono">{row.cidr}</td>
                    <td>{row.provider}</td>
                    <td>
                      <span className="mn-tag-pill">{row.source.replace('_', ' ')}</span>
                    </td>
                    <td>{formatNumber(row.nodes)}</td>
                    <td>{row.confidence != null ? `${row.confidence.toFixed(1)}%` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
