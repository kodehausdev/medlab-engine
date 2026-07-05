"use client";

// Single SSE connection + state snapshot for the whole console.
// Counters come from the /state snapshot (authoritative), then advance with
// live events whose sequence number is beyond the snapshot's watermark —
// that avoids double-counting the ring-buffer replay the stream sends on
// connect. The feed list itself dedupes by event id, so replay is harmless.

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ENGINE_URL,
  eventSeq,
  type Counters,
  type DashboardEvent,
  type EngineState,
} from "@/lib/engine";

interface DashboardContextValue {
  connected: boolean;
  tenant: EngineState["tenant"] | null;
  counters: Counters;
  events: DashboardEvent[]; // newest first
}

const EMPTY_COUNTERS: Counters = {
  calls_answered: 0,
  bookings_confirmed: 0,
  guardrail_events: 0,
};

const DashboardContext = createContext<DashboardContextValue>({
  connected: false,
  tenant: null,
  counters: EMPTY_COUNTERS,
  events: [],
});

export function useDashboard() {
  return useContext(DashboardContext);
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [tenant, setTenant] = useState<EngineState["tenant"] | null>(null);
  const [counters, setCounters] = useState<Counters>(EMPTY_COUNTERS);
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  // Highest sequence number already reflected in `counters`.
  const watermark = useRef(0);

  useEffect(() => {
    let disposed = false;
    const es = new EventSource(`${ENGINE_URL}/api/dashboard/events`);

    const ingest = (ev: DashboardEvent) => {
      setEvents((prev) => {
        if (prev.some((e) => e.id === ev.id)) return prev;
        return [ev, ...prev].slice(0, 100);
      });
      if (eventSeq(ev) > watermark.current) {
        watermark.current = eventSeq(ev);
        setCounters((c) => ({
          calls_answered:
            c.calls_answered + (ev.type === "call.answered" ? 1 : 0),
          bookings_confirmed:
            c.bookings_confirmed + (ev.type === "booking.confirmed" ? 1 : 0),
          guardrail_events:
            c.guardrail_events + (ev.type === "guardrail.redacted" ? 1 : 0),
        }));
      }
    };

    es.onopen = async () => {
      try {
        const res = await fetch(`${ENGINE_URL}/api/dashboard/state`);
        const state: EngineState = await res.json();
        if (disposed) return;
        setTenant(state.tenant);
        setCounters(state.counters);
        watermark.current = Math.max(
          watermark.current,
          ...state.recent.map(eventSeq),
          0
        );
        setEvents((prev) => {
          const byId = new Map(
            [...state.recent, ...prev].map((e) => [e.id, e])
          );
          return [...byId.values()].sort((a, b) => eventSeq(b) - eventSeq(a));
        });
        setConnected(true);
      } catch {
        // stream is up but state fetch failed; stay in connecting state
      }
    };

    es.onmessage = (m) => {
      try {
        ingest(JSON.parse(m.data) as DashboardEvent);
      } catch {
        // ignore malformed frames
      }
    };

    es.onerror = () => {
      setConnected(false);
      // EventSource retries on its own; onopen re-syncs the snapshot.
    };

    return () => {
      disposed = true;
      es.close();
    };
  }, []);

  return (
    <DashboardContext.Provider value={{ connected, tenant, counters, events }}>
      {children}
    </DashboardContext.Provider>
  );
}
