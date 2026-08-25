import type { Edge, Node } from 'reactflow';
import type { InstanceNode } from './types';

// Matches the semantic status colors used for the list's status dots.
export const STATUS_COLORS: Record<string, string> = {
  completed: '#1d9e75',
  running: '#378add',
  pending: '#f2a623',
  failed: '#e24b4a',
  cancelled: '#888780',
  skipped: '#b4b2a9',
};

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 74;
const H_GAP = 28;
const V_GAP = 66;

/** What a rendered node carries; also what the custom node component reads. */
export interface GraphNodeData {
  nodeType: string;
  status: string;
  summary: string | null;
  resultName: string | null;
  dimmed: boolean;
  tooltip: string;
}

export type DurableNode = Node<GraphNodeData, 'durable'>;

export function statusOf(node: InstanceNode): string {
  return (node.inferred_status || node.status || '').toLowerCase();
}

export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? '#888780';
}

/** `query` is SQL for SQL nodes, JSON config for operators (SIGNAL, IF, ...). */
export function parseQuery(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** One line of context under the node type — what this step actually does. */
export function summarize(node: InstanceNode): string | null {
  // SLEEP's query is a bare numeric string ("30"), not JSON — unlike every
  // other operator. Checked live against a real SLEEP node to confirm.
  if (node.node_type === 'SLEEP' && node.query && /^\d+$/.test(node.query.trim())) {
    return `sleep ${node.query.trim()}s`;
  }
  const config = parseQuery(node.query);
  if (config) {
    if (typeof config.signal_name === 'string') {
      const timeout = config.timeout_seconds;
      return timeout
        ? `signal "${config.signal_name}" · ${String(timeout)}s timeout`
        : `signal "${config.signal_name}"`;
    }
    if (config.seconds != null) return `sleep ${String(config.seconds)}s`;
    if (config.cron_expr) return `cron ${String(config.cron_expr)}`;
    if (config.url) return `${String(config.method ?? 'POST')} ${String(config.url)}`;
    if (config.condition_node) {
      return node.node_type === 'LOOP'
        ? 'runs while its condition holds'
        : 'branches on its condition';
    }
    if (Array.isArray(config.extra_nodes)) return null;
    const first = Object.entries(config)[0];
    return first ? `${first[0]}: ${String(first[1])}` : null;
  }
  return node.query ? node.query.replace(/\s+/g, ' ').trim() : null;
}

interface Child {
  id: string;
  label: string | null;
  dashed?: boolean;
}

/**
 * Lays out the expression tree df.instance_nodes() returns. Each subtree gets
 * its own horizontal band, so nothing overlaps and no edges cross.
 *
 * An IF's condition is a third child, held in its query JSON rather than in
 * left_node/right_node.
 */
export function buildTree(rawNodes: InstanceNode[]): {
  nodes: DurableNode[];
  edges: Edge[];
} {
  const byId = new Map(rawNodes.map((n) => [n.node_id, n]));
  const childIds = new Set<string>();

  const childrenOf = (node: InstanceNode): Child[] => {
    const kids: Child[] = [];
    // Labels depend on the parent: order for THEN, branch for IF, concurrent
    // for JOIN, body for LOOP.
    const labels: [string | null, string | null] =
      node.node_type === 'IF'
        ? ['then', 'else']
        : node.node_type === 'THEN' || node.node_type === 'SEQ'
          ? ['1', '2']
          : node.node_type === 'JOIN' || node.node_type === 'RACE'
            ? ['∥', '∥']
            : node.node_type === 'LOOP'
              ? ['body', 'body']
              : [null, null];

    // IF and the conditional form of LOOP both hide their condition the same
    // way: a condition_node id inside query rather than left/right. The label
    // is the only thing that differs by node type.
    const config = parseQuery(node.query);
    const condition = config?.condition_node;
    if (typeof condition === 'string' && byId.has(condition)) {
      kids.push({
        id: condition,
        label: node.node_type === 'LOOP' ? 'while' : 'if',
        dashed: true,
      });
    }
    ([node.left_node, node.right_node] as const).forEach((id, i) => {
      if (id && byId.has(id)) kids.push({ id, label: labels[i] ?? null });
    });
    // df.join3() (and any other N-ary operator) puts branches past the second
    // in query.extra_nodes rather than left_node/right_node.
    if (Array.isArray(config?.extra_nodes)) {
      for (const id of config.extra_nodes) {
        if (typeof id === 'string' && byId.has(id)) {
          kids.push({ id, label: labels[1] ?? null });
        }
      }
    }
    return kids;
  };

  rawNodes.forEach((n) => {
    childrenOf(n).forEach((c) => childIds.add(c.id));
  });

  // Unreferenced nodes are roots. Normally one; several if the graph is only
  // partially recorded.
  const roots = rawNodes.filter((n) => !childIds.has(n.node_id));

  const nodes: DurableNode[] = [];
  const edges: Edge[] = [];
  const seen = new Set<string>();

  // Returns the subtree's width, so siblings can offset by it.
  function place(node: InstanceNode, depth: number, xOffset: number): number {
    if (seen.has(node.node_id)) return 0;
    seen.add(node.node_id);

    const kids = childrenOf(node).filter((c) => !seen.has(c.id));
    let childWidth = 0;
    const childCenters: number[] = [];

    kids.forEach((kid) => {
      const childNode = byId.get(kid.id);
      if (!childNode) return;
      const before = childWidth;
      const consumed = place(childNode, depth + 1, xOffset + childWidth);
      childWidth += consumed + (consumed ? H_GAP : 0);
      childCenters.push(before + consumed / 2);

      edges.push({
        id: `${node.node_id}->${kid.id}`,
        source: node.node_id,
        target: kid.id,
        label: kid.label ?? undefined,
        animated: statusOf(childNode) === 'running',
        style: {
          stroke: kid.dashed ? '#6a6f79' : '#3d434d',
          strokeWidth: 1.5,
          strokeDasharray: kid.dashed ? '4 3' : undefined,
        },
        labelStyle: { fill: '#8b8f98', fontSize: 10 },
        labelBgStyle: { fill: '#14171c' },
        labelBgPadding: [3, 1],
      });
    });

    if (childWidth > 0) childWidth -= H_GAP;
    const width = Math.max(NODE_WIDTH, childWidth);

    // Centre over the children's span.
    const first = childCenters[0];
    const last = childCenters[childCenters.length - 1];
    const x =
      first !== undefined && last !== undefined
        ? xOffset + (first + last) / 2 - NODE_WIDTH / 2
        : xOffset + (width - NODE_WIDTH) / 2;

    const status = statusOf(node);
    nodes.push({
      id: node.node_id,
      type: 'durable',
      position: { x, y: depth * (NODE_HEIGHT + V_GAP) },
      data: {
        nodeType: node.node_type,
        status,
        summary: summarize(node),
        resultName: node.result_name,
        // Never-reached branches shouldn't compete with the live path.
        dimmed: status === 'pending' || status === 'skipped',
        tooltip: [
          `${node.node_type} · ${node.node_id}`,
          node.query ? `\n${node.query}` : '',
          node.result ? `\nresult: ${node.result}` : '',
          node.status_details ? `\n${node.status_details}` : '',
        ]
          .filter(Boolean)
          .join(''),
      },
    });

    return width;
  }

  let cursor = 0;
  roots.forEach((root) => {
    cursor += place(root, 0, cursor) + H_GAP * 2;
  });

  // Unreachable nodes still get shown rather than silently dropped.
  rawNodes
    .filter((n) => !seen.has(n.node_id))
    .forEach((orphan) => {
      cursor += place(orphan, 0, cursor) + H_GAP * 2;
    });

  return { nodes, edges };
}
