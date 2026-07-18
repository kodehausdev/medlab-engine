"use client";

// Blocked windows for one day — backs the "BLOCKED" state on the Scheduling
// grid. Same pattern as use-appointments.ts: Supabase + Realtime is the
// source of truth; when Supabase env isn't configured, there's simply
// nothing to show (blocks have no engine SSE event, so there's no
// engine-feed fallback to degrade to).

import { useEffect, useId, useState } from "react";
import { supabase } from "@/lib/supabase";

export interface ScheduleBlock {
  id: number;
  date: string; // YYYY-MM-DD
  time_slot: string; // HH:MM
  reason: string | null;
  created_at: string;
}

export function useScheduleBlocks(date: string): {
  blocks: ScheduleBlock[];
  loading: boolean;
} {
  // Unique per hook instance — see use-audit-trail.ts for why two callers
  // must never share a Realtime channel name.
  const instanceId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [state, setState] = useState<{ date: string; rows: ScheduleBlock[] } | null>(null);
  const loading = Boolean(supabase) && state?.date !== date;

  useEffect(() => {
    const sb = supabase;
    if (!sb) return;
    let disposed = false;

    sb.from("schedule_blocks")
      .select("id, date, time_slot, reason, created_at")
      .eq("date", date)
      .then(({ data, error }) => {
        if (disposed) return;
        if (!error && data) setState({ date, rows: data as ScheduleBlock[] });
      });

    const channel = sb
      .channel(`schedule-blocks-${date}-${instanceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "schedule_blocks", filter: `date=eq.${date}` },
        (payload) => {
          setState((prev) => {
            const list = prev?.date === date ? prev.rows : [];
            if (payload.eventType === "DELETE") {
              return { date, rows: list.filter((b) => b.id !== (payload.old as ScheduleBlock).id) };
            }
            const row = payload.new as ScheduleBlock;
            return { date, rows: [...list.filter((b) => b.id !== row.id), row] };
          });
        }
      )
      .subscribe();

    return () => {
      disposed = true;
      sb.removeChannel(channel);
    };
  }, [date, instanceId]);

  return { blocks: state?.date === date ? state.rows : [], loading };
}
