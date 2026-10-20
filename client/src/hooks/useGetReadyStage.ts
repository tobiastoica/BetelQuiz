import { useEffect, useState } from 'react';

// Get Ready reveals the question type first, then multi-select 2 s before the question starts, then the
// points 1 s before. It is timed from the server's remaining time (endsAt on this device's clock), so a
// refreshed screen shows the same stage as every other screen.
export function useGetReadyStage(active: boolean, endsAt: number | undefined): number {
  const [reached, setReached] = useState<{ endsAt?: number; stage: number }>({ stage: 1 });

  useEffect(() => {
    if (!active || endsAt === undefined) return;
    const left = endsAt - Date.now();
    const timers = [
      setTimeout(() => setReached({ endsAt, stage: 2 }), left - 2000),
      setTimeout(() => setReached({ endsAt, stage: 3 }), left - 1000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [active, endsAt]);

  // A stage reached for an earlier Get Ready never carries over
  return active && reached.endsAt === endsAt ? reached.stage : 1;
}
