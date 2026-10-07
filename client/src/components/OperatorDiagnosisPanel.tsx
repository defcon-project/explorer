import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { OperatorDiagnosis, OperatorDiagnosisData } from '@defcon/shared/dist/contracts';
import { fetchOperatorDiagnosis } from '../services/api';
import './OperatorDiagnosisPanel.css';

export const nodePermalink = (identity: string) => `/ban-detection?node=${encodeURIComponent(identity)}`;
function notice(nodes: OperatorDiagnosisData['nodes']) {
  const groups = new Map<string, string[]>();
  for (const n of nodes) for (const d of n.operatorDiagnosis) {
    const lines = groups.get(d.code) ?? [];
    // API evidence text is plain text; remove Discord control characters.
    const plain = (s: string) => s.replace(/[@`*_~<>\r\n]/g, ' ');
    lines.push(`${plain(n.service)} · ${n.proTxHash.slice(0, 12)} · ${plain(d.message)} ${plain(d.hint)} [${d.evidence}; ${d.since}]`);
    groups.set(d.code, lines);
  }
  return ['Operator notice', ...[...groups].flatMap(([code, lines]) => [`\n**${code}**`, ...lines])].join('\n');
}
function Diagnosis({ diagnosis: d }: { diagnosis: OperatorDiagnosis }) {
  return <details className="operator-diagnosis" title={`${d.message} ${d.hint}`}>
    <summary><span aria-hidden="true">⚠ </span>{d.code} · {d.level} · {d.evidence}</summary>
    <p>{d.message}</p><p>{d.hint}</p>
    <small>{d.source} · {new Date(d.since).toLocaleString()}</small>
  </details>;
}
export function OperatorDiagnosisPanel({ filter, paused }: { filter: string; paused: boolean }) {
  const [copyStatus, setCopyStatus] = useState('');
  const [clock, setClock] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const { data, isError, isFetching, refetch } = useQuery({ queryKey: ['operator-diagnosis'], queryFn: fetchOperatorDiagnosis,
    refetchInterval: paused ? false : 90000, staleTime: 30000 });
  // Fail closed on errors/old query data; cached action cues must not survive a failed refresh.
  const age = data ? Math.max(clock, Date.now()) - Date.parse(data.generatedAt) : Infinity;
  const fresh = !isError && data && age >= -1000 && age <= 180000;
  const nodes = fresh ? data.nodes.filter(n => n.operatorDiagnosis.length &&
    `${n.service} ${n.proTxHash}`.toLowerCase().includes(filter.toLowerCase())) : [];
  async function copyNotice() {
    try { await navigator.clipboard.writeText(notice(nodes)); setCopyStatus('Operator notice copied'); }
    catch { setCopyStatus('Copy failed. Clipboard access is unavailable.'); }
  }
  return <section className="mnh-panel operator-panel">
    <div className="mnh-panel-header"><h2 className="mnh-panel-title">Operator diagnosis</h2>
      <button type="button" onClick={() => void refetch()} disabled={isFetching}>Refresh diagnosis</button>
      <button type="button" onClick={copyNotice} disabled={!nodes.length || isFetching}>Operator notice</button></div>
    <p className="mnh-panel-sub">Conditional DKG risk, retained revival patterns and last-known inventory observations. Open a diagnosis for its evidence, time and suggested checks.</p>
    <span role="status">{copyStatus}</span>
    {!fresh ? <p>Operator diagnosis unavailable or awaiting a fresh snapshot.</p> : <>
      <p className="mnh-panel-sub">Observed {new Date(data.generatedAt).toLocaleString()} · {data.registeredCount} registered nodes · maximum penalty {data.maxPenalty}. Revival history is limited to retained events since {new Date(data.historySince).toLocaleDateString()}.</p>
      {!nodes.length && <p>No recorded diagnoses match this search.</p>}
      <div className="mnh-table-wrap"><table className="mnh-table"><thead><tr><th>Node / Service</th><th>Diagnosis</th></tr></thead>
        <tbody>{nodes.map(n => <tr key={n.proTxHash} className={n.operatorDiagnosis.some(d => d.operatorAction) ? 'operator-action-row' : ''}>
          <td><Link to={nodePermalink(n.proTxHash)}>{n.service || 'Unknown service'}</Link>
            <div className="mnh-meta-line" title={n.proTxHash}>{n.proTxHash.slice(0, 12)}</div>
            {n.operatorDiagnosis.some(d => d.operatorAction) && <strong className="operator-action-badge">⚠ Operator action</strong>}</td>
          <td>{n.operatorDiagnosis.map(d => <Diagnosis key={d.code} diagnosis={d} />)}</td>
        </tr>)}</tbody></table></div>
    </>}
  </section>;
}
