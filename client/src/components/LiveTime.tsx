import { useEffect, useState } from 'react';
import { relativeTime, runDuration } from '../grouping';
import type { InstanceSummary } from '../types';

/**
 * Nothing re-renders when only time passes, and a settled run polls every 30s —
 * long enough for elapsed times to visibly freeze. Leaf components so the tick
 * doesn't re-render the graph.
 */
function useTick(ms = 1000): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function LiveRelativeTime({ iso }: { iso: string | null }) {
  useTick();
  return <>{relativeTime(iso)}</>;
}

export function LiveDuration({ run }: { run: InstanceSummary }) {
  useTick();
  return <>{runDuration(run)}</>;
}
