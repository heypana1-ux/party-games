"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getBrowserClient } from "@/lib/supabase/browser";
import { getModule } from "@/games/registry";
import { createRng } from "@/games/contract/rng";
import { claimHost, sendHeartbeat } from "@/platform/rooms/client";
import { CommandError, sendAction } from "@/platform/session/commands";
import {
  HEARTBEAT_MS,
  HOST_STALE_SECONDS,
  presenceOf,
  type ConnectionStatus,
  type MemberInfo,
  type RoomInfo,
  type RoomPhase,
  type SessionInfo,
} from "@/platform/session/types";
import type { ActionContext, DispatchResult, SeatRef } from "@/games/contract/types";

/*
  The room store.

  The design rule that everything here follows: the server's snapshot is the
  truth, and the truth arrives whole. Realtime carries the entire session row on
  every change, so a client that missed a message is correct again after the
  next one — no gap detection, no replay on the client, no divergence that
  needs reconciling. Reconnecting is just "read the snapshot again".

  Optimistic updates sit on top of that and are always disposable.
*/

interface RoomStore {
  room: RoomInfo | null;
  members: readonly MemberInfo[];
  session: SessionInfo | null;
  /** The state as shown, i.e. server snapshot plus unconfirmed local actions. */
  displayState: unknown;
  pending: readonly unknown[];
  connection: ConnectionStatus;
  phase: RoomPhase;
  me: { userId: string } | null;
  mySeat: SeatRef | null;
  isHost: boolean;
  error: string | null;
  dispatch: (action: unknown) => Promise<DispatchResult>;
  resync: () => Promise<void>;
  clearError: () => void;
}

const RoomContext = createContext<RoomStore | null>(null);

export function useRoom(): RoomStore {
  const store = useContext(RoomContext);
  if (!store) throw new Error("useRoom must be used inside <RoomProvider>");
  return store;
}

interface PendingAction {
  clientActionId: string;
  action: unknown;
  sentAt: number;
}

/** Pending actions older than this are assumed lost; the snapshot decides. */
const PENDING_TTL_MS = 10_000;

export function RoomProvider({
  code,
  userId,
  children,
  onMissing,
}: {
  code: string;
  userId: string;
  children: React.ReactNode;
  onMissing?: () => void;
}) {
  const supabase = getBrowserClient();

  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [members, setMembers] = useState<readonly MemberInfo[]>([]);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<readonly PendingAction[]>([]);
  const [now, setNow] = useState(() => Date.now());

  // Latest-value refs for the realtime callbacks and dispatch, which outlive
  // the render they were created in. Written in effects, never during render.
  const roomRef = useRef<RoomInfo | null>(null);
  const sessionRef = useRef<SessionInfo | null>(null);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // ---------------------------------------------------------------- loading
  const loadAll = useCallback(async (): Promise<RoomInfo | null> => {
    // Rooms are readable only to members, so a row coming back here is itself
    // proof of membership — there is no separate permission check to forget.
    const { data: roomRow } = await supabase
      .from("rooms")
      .select("*")
      .eq("code", code.toUpperCase())
      .maybeSingle();

    if (!roomRow) {
      setRoom(null);
      onMissing?.();
      return null;
    }

    const info: RoomInfo = {
      id: roomRow.id,
      code: roomRow.code,
      status: roomRow.status,
      hostId: roomRow.host_id,
      settings: (roomRow.settings ?? {}) as Record<string, unknown>,
    };
    setRoom(info);

    const [{ data: memberRows }, { data: sessionRow }] = await Promise.all([
      supabase
        .from("room_members")
        .select("user_id, display_name, is_spectator, joined_at, last_seen_at")
        .eq("room_id", roomRow.id)
        .is("left_at", null)
        .order("joined_at", { ascending: true }),
      supabase
        .from("game_sessions")
        .select("*")
        .eq("room_id", roomRow.id)
        .in("status", ["setup", "running", "finished"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const stamp = Date.now();
    setMembers(
      (memberRows ?? []).map((m) => ({
        userId: m.user_id,
        displayName: m.display_name,
        isSpectator: m.is_spectator,
        joinedAt: m.joined_at,
        lastSeenAt: m.last_seen_at,
        presence: presenceOf(m.last_seen_at, stamp),
        isHost: m.user_id === roomRow.host_id,
      })),
    );

    if (!sessionRow) {
      setSession(null);
      return info;
    }

    const { data: seatRows } = await supabase
      .from("session_players")
      .select("user_id, seat_index, display_name")
      .eq("session_id", sessionRow.id)
      .order("seat_index", { ascending: true });

    setSession({
      id: sessionRow.id,
      gameId: sessionRow.game_id,
      moduleVersion: sessionRow.module_version,
      stateVersion: sessionRow.state_version,
      status: sessionRow.status,
      state: sessionRow.state,
      revision: sessionRow.revision,
      seats: (seatRows ?? []).map((s) => ({
        userId: s.user_id,
        seatIndex: s.seat_index,
        displayName: s.display_name,
      })),
    });

    return info;
  }, [supabase, code, onMissing]);

  const resync = useCallback(async () => {
    try {
      await loadAll();
      // Anything still unconfirmed is now either in the snapshot or lost.
      setPending((current) => current.filter((p) => Date.now() - p.sentAt < PENDING_TTL_MS));
    } catch {
      setConnection("offline");
    }
  }, [loadAll]);

  // ---------------------------------------------------------------- realtime
  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    (async () => {
      // Use what the load returned rather than reading a ref: the ref is
      // written by an effect, which has not necessarily run by the time this
      // await resumes.
      const current = await loadAll();
      if (cancelled || !current) return;

      // Private channel: the topic carries the room's UUID, never its joinable
      // code, and RLS on realtime.messages keeps non-members out entirely.
      await supabase.realtime.setAuth();
      channel = supabase.channel(`room:${current.id}`, { config: { private: true } });

      channel
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "rooms", filter: `id=eq.${current.id}` },
          (payload) => {
            const row = payload.new as Record<string, unknown>;
            if (!row?.id) return;
            setRoom((prev) =>
              prev
                ? {
                    ...prev,
                    status: row.status as RoomInfo["status"],
                    hostId: row.host_id as string,
                    settings: (row.settings ?? {}) as Record<string, unknown>,
                  }
                : prev,
            );
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "room_members",
            filter: `room_id=eq.${current.id}`,
          },
          () => {
            // Membership changes are rare and cheap to re-read in full, which
            // avoids maintaining a second, subtly different merge path.
            void loadAll();
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "game_sessions",
            filter: `room_id=eq.${current.id}`,
          },
          (payload) => {
            const row = payload.new as Record<string, unknown> | null;
            if (!row?.id) return;

            const known = sessionRef.current;
            const revision = Number(row.revision ?? 0);

            // A brand new session, or a state we have not seen. Anything older
            // is an out-of-order delivery and is safe to drop, because each
            // message carries the whole state rather than a delta.
            if (!known || known.id !== row.id) {
              void loadAll();
              return;
            }
            if (revision <= known.revision) return;

            setSession({
              ...known,
              status: row.status as SessionInfo["status"],
              state: row.state,
              revision,
              stateVersion: Number(row.state_version ?? known.stateVersion),
            });
            setPending([]);
          },
        )
        .on("presence", { event: "sync" }, () => setNow(Date.now()))
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            setConnection("live");
            // Always re-read on (re)subscribe: whatever happened while the
            // socket was down is in the snapshot, not in a replayed stream.
            void resync();
            void channel?.track({ userId, at: Date.now() });
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            setConnection("reconnecting");
          } else if (status === "CLOSED") {
            setConnection("reconnecting");
          }
        });
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, loadAll, resync, userId]);

  // ------------------------------------------------------- heartbeat & tick
  useEffect(() => {
    if (!room) return;
    const beat = () => void sendHeartbeat(room.id).catch(() => {});
    beat();
    const timer = setInterval(() => {
      beat();
      setNow(Date.now());
    }, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [room]);

  // Coming back from a locked screen or a tab switch: the socket may have been
  // dropped silently, so treat any return to visibility as "trust nothing".
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void resync();
    };
    const onOnline = () => {
      setConnection("reconnecting");
      void resync();
    };
    const onOffline = () => setConnection("offline");

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [resync]);

  // ------------------------------------------------------------ host rescue
  // If the host's phone has gone quiet, someone still in the room takes over.
  // The database decides who wins; this only asks.
  useEffect(() => {
    if (!room) return;
    const host = members.find((m) => m.userId === room.hostId);
    if (!host || host.presence !== "disconnected") return;
    if (room.hostId === userId) return;

    const timer = setTimeout(() => {
      void claimHost(room.id).catch(() => {});
    }, HOST_STALE_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [room, members, userId]);

  // --------------------------------------------------------------- dispatch
  const dispatch = useCallback(
    async (action: unknown): Promise<DispatchResult> => {
      const currentRoom = roomRef.current;
      const currentSession = sessionRef.current;
      if (!currentRoom || !currentSession) {
        return { ok: false, error: "session_gone" };
      }

      // Minted once, reused on every retry, so a dropped connection cannot turn
      // one tap into two.
      const clientActionId = crypto.randomUUID();
      const entry: PendingAction = { clientActionId, action, sentAt: Date.now() };
      setPending((current) => [...current, entry]);

      try {
        const response = await sendAction(currentRoom.id, currentSession.id, {
          clientActionId,
          expectedRevision: currentSession.revision,
          action,
        });
        setPending((current) => current.filter((p) => p.clientActionId !== clientActionId));
        if (response.wasBehind) void resync();
        return { ok: true, revision: response.revision };
      } catch (cause) {
        setPending((current) => current.filter((p) => p.clientActionId !== clientActionId));
        const code = cause instanceof CommandError ? cause.code : "server_error";
        // A rejected move means our picture was wrong; go and get the right one.
        if (code === "stale_revision" || code === "conflict") void resync();
        else setError(code);
        return { ok: false, error: code };
      }
    },
    [resync],
  );

  // ------------------------------------------------------- derived display
  const displayState = useMemo(() => {
    if (!session) return null;
    if (pending.length === 0) return session.state;

    const mod = getModule(session.gameId);
    const seat = session.seats.find((s) => s.userId === userId) ?? null;
    if (!mod || !seat || !room) return session.state;

    /*
      Optimistic preview.

      This runs the same reducer the server will run, so the UI responds to a
      tap immediately instead of after a round trip. It is a guess, not a
      result: the seq — and therefore the random draw — cannot be known before
      the server assigns it, so an outcome that depends on chance may correct
      itself when the snapshot lands. Views render `pending` differently for
      exactly that reason.
    */
    let preview = session.state;
    try {
      for (const [index, item] of pending.entries()) {
        const ctx: ActionContext = {
          sessionId: session.id,
          seq: session.revision + index + 1,
          now: item.sentAt,
          rng: createRng(session.id, session.revision + index + 1),
          actor: seat,
          players: session.seats,
          hostUserId: room.hostId,
        };
        const parsed = mod.schemas.action.safeParse(item.action);
        if (!parsed.success) continue;
        if (!mod.authorize(preview, parsed.data, ctx).ok) continue;
        preview = mod.reduce(preview, parsed.data, ctx);
      }
    } catch {
      return session.state;
    }
    return preview;
  }, [session, pending, userId, room]);

  const decoratedMembers = useMemo(
    () =>
      members.map((m) => ({
        ...m,
        presence: presenceOf(m.lastSeenAt, now),
        isHost: room ? m.userId === room.hostId : m.isHost,
      })),
    [members, now, room],
  );

  const phase: RoomPhase = useMemo(() => {
    if (!session) return "lobby";
    if (session.status === "running") return "play";
    if (session.status === "setup") return "setup";
    if (session.status === "finished") return "result";
    return "lobby";
  }, [session]);

  const value: RoomStore = {
    room,
    members: decoratedMembers,
    session,
    displayState,
    pending: pending.map((p) => p.action),
    connection,
    phase,
    me: { userId },
    mySeat: session?.seats.find((s) => s.userId === userId) ?? null,
    isHost: room?.hostId === userId,
    error,
    dispatch,
    resync,
    clearError: () => setError(null),
  };

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}
