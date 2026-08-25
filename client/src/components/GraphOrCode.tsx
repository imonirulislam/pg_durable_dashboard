import type { ReactNode } from 'react';
import { useState } from 'react';
import type { InstanceNode } from '../types';
import CodeView from './CodeView';
import InstanceGraph from './InstanceGraph';

type Tab = 'graph' | 'code';

interface Props {
  nodes: InstanceNode[];
  label: string | null;
  /** Extra controls (e.g. "open in new tab"), right-aligned next to the tabs. */
  actions?: ReactNode;
}

export default function GraphOrCode({ nodes, label, actions }: Props) {
  const [tab, setTab] = useState<Tab>('graph');

  return (
    <div>
      <div className="view-tabs">
        <button
          type="button"
          className={tab === 'graph' ? 'active' : ''}
          onClick={() => setTab('graph')}
        >
          graph
        </button>
        <button
          type="button"
          className={tab === 'code' ? 'active' : ''}
          onClick={() => setTab('code')}
        >
          code
        </button>
        {actions && <span className="view-tabs-actions">{actions}</span>}
      </div>
      {tab === 'graph' ? <InstanceGraph nodes={nodes} /> : <CodeView nodes={nodes} label={label} />}
    </div>
  );
}
