import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
} from 'reactflow';
import {
  buildTree,
  statusColor,
  type DurableNode,
  type GraphNodeData,
} from '../graph';
import type { InstanceNode } from '../types';

// Flash duration for the "this node's data just changed" pulse below.
const PULSE_MS = 1200;

interface RenderedNodeData extends GraphNodeData {
  pulsing: boolean;
}

function CustomNode({ data }: NodeProps<RenderedNodeData>) {
  const color = statusColor(data.status);
  return (
    <div
      className={`graph-node${data.dimmed ? ' dimmed' : ''}${data.pulsing ? ' pulse' : ''}`}
      style={{ borderColor: color }}
      title={data.tooltip}
    >
      <Handle type="target" position={Position.Top} />
      <div className="graph-node-head">
        <span className="graph-node-type">{data.nodeType}</span>
        <span className="graph-node-status" style={{ color }}>
          {data.status || 'unknown'}
        </span>
      </div>
      {data.summary && <div className="graph-node-summary">{data.summary}</div>}
      {data.resultName && (
        <div className="graph-node-result">→ ${data.resultName}</div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const NODE_TYPES: NodeTypes = { durable: CustomNode };

const LEGEND = ['running', 'completed', 'pending', 'failed', 'cancelled'];

interface Props {
  nodes: InstanceNode[];
}

export default function InstanceGraph({ nodes: rawNodes }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { nodes: layoutNodes, edges } = useMemo(
    () => buildTree(rawNodes),
    [rawNodes]
  );

  // React Flow owns positions so dragging sticks. Re-layout only when the shape
  // changes; otherwise merge fresh statuses into current positions.
  const [nodes, setNodes] = useState<DurableNode[]>(layoutNodes);
  const shape = useMemo(
    () => layoutNodes.map((n) => n.id).join('|'),
    [layoutNodes]
  );

  useEffect(() => {
    setNodes(layoutNodes);
    // Keyed on shape, not layoutNodes: a poll must not reset positions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  useEffect(() => {
    const fresh = new Map(layoutNodes.map((n) => [n.id, n]));
    setNodes((current) =>
      current.map((n) => {
        const update = fresh.get(n.id);
        return update ? { ...n, data: update.data } : n;
      })
    );
  }, [layoutNodes]);

  // A node whose status reads the same on every poll can still have done a
  // full pending -> running -> completed loop in between, faster than the
  // 4s poll caught it — updated_at moving is proof a poll saw real activity
  // even when the visible status text didn't change. Flash it briefly so
  // that isn't invisible.
  const lastUpdatedAt = useRef(new Map<string, string | null>());
  const [pulsing, setPulsing] = useState<Set<string>>(new Set());

  useEffect(() => {
    const changed: string[] = [];
    layoutNodes.forEach((n) => {
      const prev = lastUpdatedAt.current.get(n.id);
      if (prev !== undefined && prev !== n.data.updatedAt) changed.push(n.id);
      lastUpdatedAt.current.set(n.id, n.data.updatedAt);
    });
    if (changed.length === 0) return;

    setPulsing((current) => new Set([...current, ...changed]));
    const timer = setTimeout(() => {
      setPulsing((current) => {
        const next = new Set(current);
        changed.forEach((id) => next.delete(id));
        return next;
      });
    }, PULSE_MS);
    return () => clearTimeout(timer);
  }, [layoutNodes]);

  const renderedNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        data: { ...n.data, pulsing: pulsing.has(n.id) },
      })),
    [nodes, pulsing]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) =>
      setNodes((current) => applyNodeChanges(changes, current) as DurableNode[]),
    []
  );

  if (rawNodes.length === 0) {
    return <div className="empty">no graph data yet.</div>;
  }

  return (
    <>
      <div className="graph-toolbar">
        <div className="graph-legend">
          {LEGEND.map((status) => (
            <span key={status} className="graph-legend-item">
              <i style={{ background: statusColor(status) }} />
              {status}
            </span>
          ))}
        </div>
        <div className="graph-count">
          {nodes.length} nodes · {edges.length} edges
          <button type="button" onClick={() => setExpanded((e) => !e)}>
            {expanded ? 'shrink' : 'expand'}
          </button>
        </div>
      </div>
      <div className={`instance-graph${expanded ? ' expanded' : ''}`}>
        <ReactFlow
          nodes={renderedNodes}
          edges={edges}
          onNodesChange={onNodesChange}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.15}
          proOptions={{ hideAttribution: true }}
        >
          {/* Dot grid, for a sense of scale when panning. */}
          <Background
            variant={BackgroundVariant.Dots}
            gap={18}
            size={1.6}
            color="#3d4552"
          />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </>
  );
}
