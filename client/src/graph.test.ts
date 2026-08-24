import { describe, expect, it } from 'vitest';
import { buildTree, parseQuery, summarize } from './graph';
import type { InstanceNode } from './types';

function node(partial: Partial<InstanceNode> & { node_id: string }): InstanceNode {
  return {
    node_type: 'SQL',
    query: null,
    result_name: null,
    left_node: null,
    right_node: null,
    status: 'completed',
    result: null,
    status_details: null,
    inferred_status: null,
    inferred_status_from_ancestor_id: null,
    updated_at: null,
    ...partial,
  };
}

/**
 * Shape of the `doc-approval` workflow as pg_durable 0.2.5 actually returns it:
 *
 *   THEN ─1─ THEN ─1─ SQL (fetch doc)
 *        │        └─2─ SIGNAL (wait for approval)
 *        └─2─ IF ──if─ SQL (condition)      <- only in the query JSON
 *                 ├then SQL (approve)
 *                 └else SQL (reject)
 */
const docApproval: InstanceNode[] = [
  node({ node_id: 'root', node_type: 'THEN', left_node: 'then1', right_node: 'if1', status: 'running' }),
  node({ node_id: 'then1', node_type: 'THEN', left_node: 'fetch', right_node: 'signal', status: 'running' }),
  node({ node_id: 'fetch', query: 'SELECT id FROM documents LIMIT 1', result_name: 'doc' }),
  node({
    node_id: 'signal',
    node_type: 'SIGNAL',
    query: '{"signal_name":"approval","timeout_seconds":86400}',
    status: 'running',
  }),
  node({
    node_id: 'if1',
    node_type: 'IF',
    query: '{"condition_node":"cond"}',
    left_node: 'approve',
    right_node: 'reject',
    status: 'pending',
  }),
  node({ node_id: 'cond', query: "SELECT true", status: 'pending' }),
  node({ node_id: 'approve', query: 'UPDATE documents SET status = 1', status: 'pending' }),
  node({ node_id: 'reject', query: 'UPDATE documents SET status = 2', status: 'pending' }),
];

describe('buildTree', () => {
  it('renders every node and every real edge', () => {
    const { nodes, edges } = buildTree(docApproval);
    expect(nodes).toHaveLength(8);
    // 6 left/right links plus the IF's condition child.
    expect(edges).toHaveLength(7);
  });

  it('links an IF to the condition node hidden in its query JSON', () => {
    const { edges } = buildTree(docApproval);
    const conditionEdge = edges.find((e) => e.target === 'cond');
    expect(conditionEdge).toMatchObject({ source: 'if1', label: 'if' });
    // Dashed, to read differently from a branch that actually executes.
    expect(conditionEdge?.style?.strokeDasharray).toBeTruthy();
  });

  it('labels edges by what the parent operator means', () => {
    const { edges } = buildTree(docApproval);
    const label = (source: string, target: string) =>
      edges.find((e) => e.source === source && e.target === target)?.label;

    expect(label('root', 'then1')).toBe('1');
    expect(label('root', 'if1')).toBe('2');
    expect(label('if1', 'approve')).toBe('then');
    expect(label('if1', 'reject')).toBe('else');
  });

  it('labels JOIN children as concurrent rather than ordered', () => {
    const { edges } = buildTree([
      node({ node_id: 'j', node_type: 'JOIN', left_node: 'a', right_node: 'b' }),
      node({ node_id: 'a' }),
      node({ node_id: 'b' }),
    ]);
    expect(edges.map((e) => e.label)).toEqual(['∥', '∥']);
  });

  it('connects df.join3\'s third branch, carried in query.extra_nodes', () => {
    // Structure taken from a live pg_durable 0.2.5 instance: df.join3() records
    // one JOIN node with left/right pointing at two branches and the third
    // hidden in query.extra_nodes, the same pattern IF uses for condition_node.
    const { nodes, edges } = buildTree([
      node({
        node_id: 'j3',
        node_type: 'JOIN',
        left_node: 'a',
        right_node: 'b',
        query: '{"extra_nodes":["c"]}',
      }),
      node({ node_id: 'a', query: 'SELECT 1' }),
      node({ node_id: 'b', query: 'SELECT 2' }),
      node({ node_id: 'c', query: 'SELECT 3' }),
    ]);
    expect(nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'j3']);
    expect(edges.find((e) => e.source === 'j3' && e.target === 'c')).toMatchObject({
      label: '∥',
    });
  });

  it('labels a LOOP body distinctly from an unconditioned edge', () => {
    const { edges } = buildTree([
      node({ node_id: 'l', node_type: 'LOOP', left_node: 'body' }),
      node({ node_id: 'body' }),
    ]);
    expect(edges[0]).toMatchObject({ source: 'l', target: 'body', label: 'body' });
  });

  it('connects the conditional form of LOOP and labels it while, not if', () => {
    // Structure from a live pg_durable 0.2.5 instance: df.loop(body, condition)
    // hides its condition the same way IF does, but "if" would misdescribe it.
    const { nodes, edges } = buildTree([
      node({
        node_id: 'l',
        node_type: 'LOOP',
        left_node: 'body',
        query: '{"condition_node":"cond"}',
      }),
      node({ node_id: 'body', query: 'SELECT 1' }),
      node({ node_id: 'cond', query: 'SELECT count(*) > 0 FROM queue' }),
    ]);
    expect(nodes.map((n) => n.id).sort()).toEqual(['body', 'cond', 'l']);
    const conditionEdge = edges.find((e) => e.target === 'cond');
    expect(conditionEdge).toMatchObject({ source: 'l', label: 'while' });
    expect(conditionEdge?.style?.strokeDasharray).toBeTruthy();
  });

  it('puts children below their parent and left child left of right child', () => {
    const { nodes } = buildTree(docApproval);
    const at = (id: string) => nodes.find((n) => n.id === id)!.position;

    expect(at('root').y).toBeLessThan(at('then1').y);
    expect(at('then1').y).toBeLessThan(at('fetch').y);
    expect(at('fetch').x).toBeLessThan(at('signal').x);
    expect(at('then1').x).toBeLessThan(at('if1').x);
  });

  it('gives every node a distinct position, so nothing overlaps', () => {
    const { nodes } = buildTree(docApproval);
    const seen = new Set(nodes.map((n) => `${n.position.x},${n.position.y}`));
    expect(seen.size).toBe(nodes.length);
  });

  it('centres a parent over the span of its children', () => {
    const { nodes } = buildTree([
      node({ node_id: 'p', node_type: 'THEN', left_node: 'l', right_node: 'r' }),
      node({ node_id: 'l' }),
      node({ node_id: 'r' }),
    ]);
    const at = (id: string) => nodes.find((n) => n.id === id)!.position.x;
    expect(at('p')).toBeCloseTo((at('l') + at('r')) / 2, 5);
  });

  it('animates edges into running nodes only', () => {
    const { edges } = buildTree(docApproval);
    expect(edges.find((e) => e.target === 'signal')?.animated).toBe(true);
    expect(edges.find((e) => e.target === 'approve')?.animated).toBe(false);
  });

  it('prefers inferred_status, which is how unreached branches are known', () => {
    const { nodes } = buildTree([
      node({ node_id: 'x', status: 'pending', inferred_status: 'skipped' }),
    ]);
    expect(nodes[0]!.data.status).toBe('skipped');
    expect(nodes[0]!.data.dimmed).toBe(true);
  });

  it('still shows nodes that are unreachable from any root', () => {
    // A partially-recorded graph shouldn't silently lose rows.
    const { nodes } = buildTree([
      node({ node_id: 'a', node_type: 'THEN', left_node: 'b', right_node: 'c' }),
      node({ node_id: 'b' }),
      node({ node_id: 'c' }),
      node({ node_id: 'orphan-cycle-1', node_type: 'THEN', left_node: 'orphan-cycle-2' }),
      node({ node_id: 'orphan-cycle-2', node_type: 'THEN', left_node: 'orphan-cycle-1' }),
    ]);
    expect(nodes.map((n) => n.id).sort()).toEqual([
      'a',
      'b',
      'c',
      'orphan-cycle-1',
      'orphan-cycle-2',
    ]);
  });

  it('ignores pointers to nodes that were not returned', () => {
    const { nodes, edges } = buildTree([
      node({ node_id: 'lonely', node_type: 'THEN', left_node: 'missing' }),
    ]);
    expect(nodes).toHaveLength(1);
    expect(edges).toHaveLength(0);
  });

  it('handles an empty graph', () => {
    expect(buildTree([])).toEqual({ nodes: [], edges: [] });
  });
});

describe('parseQuery', () => {
  it('returns null for SQL text, so it is not mistaken for config', () => {
    expect(parseQuery('SELECT 1')).toBeNull();
    expect(parseQuery(null)).toBeNull();
  });

  it('returns null rather than throwing on malformed JSON', () => {
    expect(parseQuery('{"unterminated": ')).toBeNull();
  });

  it('parses operator config', () => {
    expect(parseQuery('{"seconds":30}')).toEqual({ seconds: 30 });
  });
});

describe('summarize', () => {
  it('describes operator nodes from their config', () => {
    expect(
      summarize(node({ node_id: 's', query: '{"signal_name":"approval","timeout_seconds":86400}' }))
    ).toBe('signal "approval" · 86400s timeout');
    expect(summarize(node({ node_id: 's', query: '{"seconds":30}' }))).toBe('sleep 30s');
    expect(summarize(node({ node_id: 's', query: '{"cron_expr":"*/5 * * * *"}' }))).toBe(
      'cron */5 * * * *'
    );
    expect(summarize(node({ node_id: 's', query: '{"condition_node":"abc"}' }))).toBe(
      'branches on its condition'
    );
  });

  it('describes a LOOP\'s condition differently from an IF\'s, same underlying key', () => {
    expect(
      summarize(
        node({ node_id: 's', node_type: 'LOOP', query: '{"condition_node":"abc"}' })
      )
    ).toBe('runs while its condition holds');
  });

  it('collapses whitespace in SQL so it fits on two lines', () => {
    expect(summarize(node({ node_id: 's', query: 'SELECT\n  1,\n  2' }))).toBe('SELECT 1, 2');
  });

  it('has nothing to say about an operator with no query', () => {
    expect(summarize(node({ node_id: 's', node_type: 'THEN' }))).toBeNull();
  });
});
