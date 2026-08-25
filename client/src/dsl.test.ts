import { describe, expect, it } from 'vitest';
import { reconstruct, type DslLine } from './dsl';
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

function text(lines: DslLine[]): string[] {
  return lines.map((l) => `${'  '.repeat(l.indent)}${l.text}`);
}

describe('reconstruct', () => {
  it('returns nothing for an empty tree', () => {
    expect(reconstruct([], 'x')).toEqual([]);
  });

  // Exact shape captured live from a single doc-approval instance (isolated
  // by instance_id, not the earlier grouped-by-label query that mixed three
  // instances together). The point of this test: 'doc' sits directly on the
  // SQL leaf that produced it, but 'sig' sits on the THEN wrapping
  // [doc-select, signal] — not on the SIGNAL leaf itself. Both must render
  // as `expr |=> 'name'` in the right place despite living on different node
  // types.
  const docApproval: InstanceNode[] = [
    node({ node_id: '9028c459', node_type: 'THEN', left_node: '6f52fce0', right_node: '611ab174' }),
    node({ node_id: '6f52fce0', node_type: 'THEN', left_node: '6b7bdb95', right_node: '1e3f4d47', result_name: 'sig' }),
    node({
      node_id: '6b7bdb95',
      query: 'SELECT id FROM playground.documents LIMIT 1',
      result_name: 'doc',
    }),
    node({
      node_id: '1e3f4d47',
      node_type: 'SIGNAL',
      query: '{"signal_name":"approval","timeout_seconds":86400}',
    }),
    node({
      node_id: '611ab174',
      node_type: 'IF',
      left_node: '90959d28',
      right_node: 'a6ffb6b5',
      query: '{"condition_node":"6e165ab7"}',
    }),
    node({ node_id: '6e165ab7', query: "SELECT ($sig::jsonb->>'timed_out')::boolean = false" }),
    node({ node_id: '90959d28', query: "UPDATE playground.documents SET status = 'approved' WHERE id = $doc" }),
    node({ node_id: 'a6ffb6b5', query: "UPDATE playground.documents SET status = 'rejected' WHERE id = $doc" }),
  ];

  it('reconstructs doc-approval matching the real seed source', () => {
    expect(text(reconstruct(docApproval, 'doc-approval'))).toEqual([
      "df.start(",
      "  'SELECT id FROM playground.documents LIMIT 1' |=> 'doc'",
      "  ~> df.wait_for_signal('approval', 86400) |=> 'sig'",
      "  ~> df.if(",
      "    'SELECT ($sig::jsonb->>''timed_out'')::boolean = false',",
      "    'UPDATE playground.documents SET status = ''approved'' WHERE id = $doc',",
      "    'UPDATE playground.documents SET status = ''rejected'' WHERE id = $doc'",
      "  ),",
      "  'doc-approval'",
      ")",
    ]);
  });

  it('escapes single quotes in SQL text', () => {
    const nodes = [node({ node_id: 'a', query: "SELECT 'x'" })];
    expect(text(reconstruct(nodes, null))).toEqual(["'SELECT ''x'''"]);
  });

  // Confirmed live: df.loop(body text, condition text DEFAULT NULL) — body
  // always sits in left_node, condition (when present) in query.condition_node,
  // never in right_node.
  it('reconstructs an unconditional loop with just a body', () => {
    const nodes = [
      node({ node_id: 'loop', node_type: 'LOOP', left_node: 'body' }),
      node({ node_id: 'body', query: "INSERT INTO logs VALUES ('heartbeat')" }),
    ];
    expect(text(reconstruct(nodes, null))).toEqual([
      'df.loop(',
      "  'INSERT INTO logs VALUES (''heartbeat'')'",
      ')',
    ]);
  });

  it('reconstructs a conditional loop with body first, condition second', () => {
    const nodes = [
      node({ node_id: 'loop', node_type: 'LOOP', left_node: 'body', query: '{"condition_node":"cond"}' }),
      node({ node_id: 'body', query: "INSERT INTO logs VALUES ('polling')" }),
      node({ node_id: 'cond', query: 'SELECT true' }),
    ];
    expect(text(reconstruct(nodes, null))).toEqual([
      'df.loop(',
      "  'INSERT INTO logs VALUES (''polling'')',",
      "  'SELECT true'",
      ')',
    ]);
  });

  it('reconstructs a plain two-way join as df.join', () => {
    const nodes = [
      node({ node_id: 'j', node_type: 'JOIN', left_node: 'a', right_node: 'b' }),
      node({ node_id: 'a', query: 'SELECT 1' }),
      node({ node_id: 'b', query: 'SELECT 2' }),
    ];
    expect(text(reconstruct(nodes, null))).toEqual([
      'df.join(', "  'SELECT 1',", "  'SELECT 2'", ')',
    ]);
  });

  // df.join3()'s third branch is hidden in query.extra_nodes, not left/right —
  // the same real bug found in the graph view applies here.
  it('reconstructs a three-way join as df.join3', () => {
    const nodes = [
      node({ node_id: 'j', node_type: 'JOIN', left_node: 'a', right_node: 'b', query: '{"extra_nodes":["c"]}' }),
      node({ node_id: 'a', query: 'SELECT 1' }),
      node({ node_id: 'b', query: 'SELECT 2' }),
      node({ node_id: 'c', query: 'SELECT 3' }),
    ];
    expect(text(reconstruct(nodes, null))).toEqual([
      'df.join3(', "  'SELECT 1',", "  'SELECT 2',", "  'SELECT 3'", ')',
    ]);
  });

  it('reconstructs a race as df.race', () => {
    const nodes = [
      node({ node_id: 'r', node_type: 'RACE', left_node: 'a', right_node: 'b' }),
      node({ node_id: 'a', query: 'SELECT 1' }),
      node({ node_id: 'b', query: 'SELECT 2' }),
    ];
    expect(text(reconstruct(nodes, null))).toEqual([
      'df.race(', "  'SELECT 1',", "  'SELECT 2'", ')',
    ]);
  });

  it('omits the timeout arg when a signal has none', () => {
    const nodes = [node({ node_id: 's', node_type: 'SIGNAL', query: '{"signal_name":"go"}' })];
    expect(text(reconstruct(nodes, null))).toEqual(["df.wait_for_signal('go')"]);
  });

  // SLEEP's query is a bare numeric string ("30"), not JSON — the same
  // real, previously-shipped-wrong assumption fixed in graph.ts's summarize().
  it('reconstructs sleep from the bare-number query', () => {
    const nodes = [node({ node_id: 's', node_type: 'SLEEP', query: '30' })];
    expect(text(reconstruct(nodes, null))).toEqual(['df.sleep(30)']);
  });

  it('reconstructs wait_for_schedule from cron_expr', () => {
    const nodes = [
      node({ node_id: 'w', node_type: 'WAIT_SCHEDULE', query: '{"cron_expr":"*/5 * * * *"}' }),
    ];
    expect(text(reconstruct(nodes, null))).toEqual(["df.wait_for_schedule('*/5 * * * *')"]);
  });

  it('shows an honest placeholder for a node type it does not recognise', () => {
    const nodes = [node({ node_id: 'x', node_type: 'FUTURE_OP' })];
    const [line] = reconstruct(nodes, null);
    expect(line!.text).toContain('FUTURE_OP');
    expect(line!.text).toContain('unrecognised');
  });

  it('omits the df.start wrapper when there is no label', () => {
    const nodes = [node({ node_id: 'a', query: 'SELECT 1' })];
    expect(text(reconstruct(nodes, null))).toEqual(["'SELECT 1'"]);
  });

  it('renders every disconnected root when the graph is only partially recorded', () => {
    const nodes = [
      node({ node_id: 'a', query: 'SELECT 1' }),
      node({ node_id: 'b', query: 'SELECT 2' }),
    ];
    expect(text(reconstruct(nodes, 'two-roots'))).toEqual(["'SELECT 1'", '', "'SELECT 2'"]);
  });
});
