import type { Metrics } from '../types';

interface Props {
  metrics: Metrics | undefined;
  loading: boolean;
}

export default function MetricsBar({ metrics, loading }: Props) {
  if (loading) return <div className="metrics-bar">loading metrics…</div>;
  if (!metrics || Object.keys(metrics).length === 0) return null;

  return (
    <div className="metrics-bar">
      {Object.entries(metrics).map(([key, value]) => (
        <div className="metric" key={key}>
          <div className="metric-value">{String(value)}</div>
          <div className="metric-label">{key.replaceAll('_', ' ')}</div>
        </div>
      ))}
    </div>
  );
}
