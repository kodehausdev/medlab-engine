"use client";

// Durable audit rows for Call Logs / Compliance.
// Source of truth is Supabase (initial page + Realtime INSERTs). When
// Supabase env isn't configured (local dev before keys exist), the hook
// degrades to mirroring the engine's live SSE feed so the pages still work —
// they just don't survive an engine restart.

import { useEffect, useMemo, useState } from "react";
import { supabase, type AuditRow } from "@/lib/supabase";
import { eventSeq, type DashboardEvent } from "@/lib/engine";
import { useDashboard } from "@/components/console/dashboard-provider";

const PAGE_SIZE = 200;

function rowFromEvent(ev: DashboardEvent): AuditRow {
  return {
    id: eventSeq(ev),
    tenant_id: ev.tenant_id,
    event_id: ev.id,
    type: ev.type,
    channel: ev.channel,
    phone_tail: ev.phone_tail,
    data: ev.data,
    created_at: ev.ts,
  };
}

export function useAuditTrail(): {
  rows: AuditRow[];
  source: "supabase" | "engine";
  loading: boolean;
} {
  const { events } = useDashboard();
  const [dbRows, setDbRows] = useState<AuditRow[] | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    const sb = supabase;
    if (!sb) return;
    let disposed = false;

    sb
      .from("audit_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE)
      .then(({ data, error }) => {
        if (disposed) return;
        setLoading(false);
        if (!error && data) setDbRows(data as AuditRow[]);
      });

    const channel = sb
      .channel("audit-inserts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "audit_events" },
        (payload) => {
          const row = payload.new as AuditRow;
          setDbRows((prev) => {
            if (!prev) return [row];
            if (prev.some((r) => r.id === row.id)) return prev;
            return [row, ...prev].slice(0, PAGE_SIZE);
          });
        }
      )
      .subscribe();

    return () => {
      disposed = true;
      sb.removeChannel(channel);
    };
  }, []);

  const engineRows = useMemo(() => events.map(rowFromEvent), [events]);

  if (supabase) {
    return { rows: dbRows ?? [], source: "supabase", loading };
  }
  return { rows: engineRows, source: "engine", loading: false };
}
