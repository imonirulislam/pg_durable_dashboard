import type { InstanceNode } from './types';
import { logicalChildren, parseQuery } from './graph';

// Reconstructs df.* call syntax from the same executed node tree the graph
// view renders — not pg_durable's original source, which it never stores.
// Verified live against pg_durable 0.2.5's actual function signatures
// (df.if(condition, then, else), df.loop(body, condition?), df.join/join3,
// df.race, df.wait_for_signal, df.wait_for_schedule, df.sleep) rather than
// assumed from docs.

export interface DslLine {
  indent: number;
  text: string;
  nodeId: string | null;
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function missing(): DslLine[] {
  return [{ indent: 0, text: '/* … */', nodeId: null }];
}

function withCapture(lines: DslLine[], name: string): DslLine[] {
  const copy = lines.slice();
  const last = copy[copy.length - 1]!;
  copy[copy.length - 1] = { ...last, text: `${last.text} |=> ${quote(name)}` };
  return copy;
}

/** A call `name(arg, arg, ...)`, one arg per line, indented one level in. */
function renderCall(name: string, args: DslLine[][], nodeId: string): DslLine[] {
  const lines: DslLine[] = [{ indent: 0, text: `${name}(`, nodeId }];
  args.forEach((argLines, i) => {
    const shifted = argLines.map((l) => ({ ...l, indent: l.indent + 1 }));
    if (i < args.length - 1) {
      const lastIdx = shifted.length - 1;
      shifted[lastIdx] = { ...shifted[lastIdx]!, text: `${shifted[lastIdx]!.text},` };
    }
    lines.push(...shifted);
  });
  lines.push({ indent: 0, text: ')', nodeId: null });
  return lines;
}

function child(
  node: InstanceNode,
  field: 'left_node' | 'right_node',
  byId: Map<string, InstanceNode>
): InstanceNode | null {
  const id = node[field];
  return id ? byId.get(id) ?? null : null;
}

/**
 * `A |=> 'name' ~> B` is stored as THEN(A, B) with result_name on the THEN
 * itself, not on A — the capture belongs to the sequencing point, not the
 * captured leaf. Confirmed live: isolating one doc-approval instance showed
 * the wrapping THEN carrying result_name "sig", while the SIGNAL leaf it
 * wraps had none.
 */
function renderThenChain(root: InstanceNode, byId: Map<string, InstanceNode>): DslLine[] {
  const items: DslLine[][] = [];

  function isThen(n: InstanceNode | null): n is InstanceNode {
    return !!n && (n.node_type === 'THEN' || n.node_type === 'SEQ');
  }

  function flatten(node: InstanceNode): void {
    const left = child(node, 'left_node', byId);
    if (isThen(left)) flatten(left);
    else items.push(left ? renderNode(left, byId) : missing());

    const right = child(node, 'right_node', byId);
    if (isThen(right)) flatten(right);
    else items.push(right ? renderNode(right, byId) : missing());

    // The THEN's own capture applies to whatever was just folded in on the
    // right — verified live: `A |=> 'doc' ~> B |=> 'sig' ~> C` stores 'doc'
    // directly on A (nothing to its right yet at that fold step) but stores
    // 'sig' on THEN(A, B), not on B — the THEN current at that fold step.
    if (node.result_name && items.length > 0) {
      items[items.length - 1] = withCapture(items[items.length - 1]!, node.result_name);
    }
  }
  flatten(root);

  const lines: DslLine[] = [];
  items.forEach((item, i) => {
    if (i === 0) {
      lines.push(...item);
      return;
    }
    const [first, ...rest] = item;
    lines.push({ ...first!, text: `~> ${first!.text}` });
    lines.push(...rest);
  });
  return lines;
}

function renderOwn(node: InstanceNode, byId: Map<string, InstanceNode>): DslLine[] {
  const config = parseQuery(node.query);

  switch (node.node_type) {
    case 'SQL':
      return [{ indent: 0, text: quote(node.query ?? ''), nodeId: node.node_id }];

    case 'IF': {
      const condId = typeof config?.condition_node === 'string' ? config.condition_node : null;
      const cond = condId ? byId.get(condId) ?? null : null;
      const thenNode = child(node, 'left_node', byId);
      const elseNode = child(node, 'right_node', byId);
      const args = [cond, thenNode, elseNode].map((n) => (n ? renderNode(n, byId) : missing()));
      return renderCall('df.if', args, node.node_id);
    }

    case 'LOOP': {
      const condId = typeof config?.condition_node === 'string' ? config.condition_node : null;
      const cond = condId ? byId.get(condId) ?? null : null;
      const body = child(node, 'left_node', byId);
      const args = [body ? renderNode(body, byId) : missing()];
      if (cond) args.push(renderNode(cond, byId));
      return renderCall('df.loop', args, node.node_id);
    }

    case 'JOIN':
    case 'RACE': {
      const a = child(node, 'left_node', byId);
      const b = child(node, 'right_node', byId);
      const extraIds = Array.isArray(config?.extra_nodes)
        ? config.extra_nodes.filter((id): id is string => typeof id === 'string')
        : [];
      const extras = extraIds.map((id) => byId.get(id) ?? null);
      const branches = [a, b, ...extras].map((n) => (n ? renderNode(n, byId) : missing()));
      const name = node.node_type === 'RACE' ? 'df.race' : extras.length ? 'df.join3' : 'df.join';
      return renderCall(name, branches, node.node_id);
    }

    case 'SIGNAL': {
      const name = typeof config?.signal_name === 'string' ? config.signal_name : '?';
      const timeout = config?.timeout_seconds;
      const args = [quote(name)];
      if (timeout != null) args.push(String(timeout));
      return [{ indent: 0, text: `df.wait_for_signal(${args.join(', ')})`, nodeId: node.node_id }];
    }

    case 'SLEEP': {
      // Bare numeric string, not JSON — confirmed live, unlike every other
      // operator's query column.
      const seconds = (node.query ?? '').trim();
      return [{ indent: 0, text: `df.sleep(${seconds || '?'})`, nodeId: node.node_id }];
    }

    case 'WAIT_SCHEDULE': {
      const cron = typeof config?.cron_expr === 'string' ? config.cron_expr : '?';
      return [{ indent: 0, text: `df.wait_for_schedule(${quote(cron)})`, nodeId: node.node_id }];
    }

    default:
      // A node type this reconstruction doesn't know how to render — show
      // that honestly rather than guessing at syntax.
      return [
        { indent: 0, text: `/* ${node.node_type}: unrecognised — showing raw node */`, nodeId: node.node_id },
      ];
  }
}

export function renderNode(node: InstanceNode, byId: Map<string, InstanceNode>): DslLine[] {
  if (node.node_type === 'THEN' || node.node_type === 'SEQ') {
    return renderThenChain(node, byId);
  }
  const lines = renderOwn(node, byId);
  return node.result_name ? withCapture(lines, node.result_name) : lines;
}

/** Reconstructs the whole instance as df.start(<expr>, 'label') where possible. */
export function reconstruct(nodes: InstanceNode[], label: string | null): DslLine[] {
  if (nodes.length === 0) return [];
  const byId = new Map(nodes.map((n) => [n.node_id, n]));
  const childIds = new Set<string>();
  nodes.forEach((n) => logicalChildren(n, byId).forEach((c) => childIds.add(c.id)));
  const roots = nodes.filter((n) => !childIds.has(n.node_id));

  const blocks = roots.map((root) => {
    const expr = renderNode(root, byId);
    if (roots.length === 1 && label) {
      return renderCall('df.start', [expr, [{ indent: 0, text: quote(label), nodeId: null }]], root.node_id);
    }
    return expr;
  });

  const out: DslLine[] = [];
  blocks.forEach((block, i) => {
    if (i > 0) out.push({ indent: 0, text: '', nodeId: null });
    out.push(...block);
  });
  return out;
}
