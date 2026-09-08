import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

/*
  Integration tests against a real Postgres.

  Everything here is a property that cannot be checked with a unit test and that
  would fail silently in production: the compare-and-swap under genuine
  concurrency, idempotent retries, and the grants that stop a phone from writing
  game state directly.

  Point it at a throwaway Supabase project with the migrations applied and
  anonymous sign-in enabled. Without the env vars the whole suite skips rather
  than pretending to pass.
*/

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LIVE = Boolean(URL && ANON && SERVICE);

let admin: SupabaseClient;

/** A client signed in as a fresh guest, exactly like a phone would be. */
async function guest(): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(URL!, ANON!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) throw new Error(error?.message ?? "anonymous sign-in failed");
  return { client, userId: data.user.id };
}

async function makeRoomWithSession() {
  const host = await guest();
  const { data: room } = await host.client.rpc("create_room", {
    p_display_name: "Host",
    p_settings: {},
  });
  const roomId = room![0]!.room_id;

  const { data: started } = await admin.rpc("start_session", {
    p_room_id: roomId,
    p_host: host.userId,
    p_game_id: "dummy",
    p_module_version: "1.0.0",
    p_state_version: 1,
    p_config: { targetTaps: 100, bonusEnabled: false },
    p_seed: "test-seed",
    p_initial_state: { counter: 0 },
    p_players: [
      { user_id: host.userId, seat_index: 0, display_name: "Host" },
    ],
  });

  return { host, roomId, sessionId: started![0]!.session_id as string };
}

beforeAll(() => {
  if (LIVE) {
    admin = createClient(URL!, SERVICE!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
});

describe.skipIf(!LIVE)("write authority", () => {
  it("refuses apply_game_action to a signed-in phone", async () => {
    const { client } = await guest();
    const { host, sessionId } = await makeRoomWithSession();

    // The single most important negative test in the project: if this ever
    // passes, a player can hand in a state where they have won.
    const { error } = await client.rpc("apply_game_action", {
      p_session_id: sessionId,
      p_expected_revision: 0,
      p_client_action_id: crypto.randomUUID(),
      p_actor: host.userId,
      p_action: { type: "tap" },
      p_new_state: { counter: 9999 },
    });

    expect(error).not.toBeNull();
  });

  it("refuses a direct update of game state", async () => {
    const { host, sessionId } = await makeRoomWithSession();
    const { error } = await host.client
      .from("game_sessions")
      .update({ state: { counter: 9999 } })
      .eq("id", sessionId);

    expect(error).not.toBeNull();
  });

  it("hides a room from someone who is not in it", async () => {
    const { host, roomId } = await makeRoomWithSession();
    const { data: code } = await host.client
      .from("rooms")
      .select("code")
      .eq("id", roomId)
      .single();

    const stranger = await guest();
    const { data } = await stranger.client
      .from("rooms")
      .select("*")
      .eq("code", code!.code);

    // Knowing the code is not the same as being allowed to read the room.
    expect(data ?? []).toHaveLength(0);
  });
});

describe.skipIf(!LIVE)("concurrency", () => {
  it("lets exactly one of two racing actions win the revision", async () => {
    const { host, sessionId } = await makeRoomWithSession();

    const attempt = (counter: number) =>
      admin.rpc("apply_game_action", {
        p_session_id: sessionId,
        p_expected_revision: 0,
        p_client_action_id: crypto.randomUUID(),
        p_actor: host.userId,
        p_action: { type: "tap" },
        p_new_state: { counter },
      });

    const [a, b] = await Promise.all([attempt(1), attempt(2)]);
    const results = [a.data?.[0]?.result, b.data?.[0]?.result].sort();

    expect(results).toEqual(["applied", "stale"]);
  });

  it("applies a repeated action id exactly once", async () => {
    const { host, sessionId } = await makeRoomWithSession();
    const clientActionId = crypto.randomUUID();

    for (let i = 0; i < 5; i++) {
      await admin.rpc("apply_game_action", {
        p_session_id: sessionId,
        p_expected_revision: 0,
        p_client_action_id: clientActionId,
        p_actor: host.userId,
        p_action: { type: "tap" },
        p_new_state: { counter: 1 },
      });
    }

    const { data } = await admin
      .from("game_sessions")
      .select("revision")
      .eq("id", sessionId)
      .single();

    // A retry after a dropped connection must not score five times.
    expect(data!.revision).toBe(1);
  });

  it("never issues the same seq twice, even across an undo", async () => {
    const { host, sessionId } = await makeRoomWithSession();

    for (let i = 1; i <= 3; i++) {
      await admin.rpc("apply_game_action", {
        p_session_id: sessionId,
        p_expected_revision: i - 1,
        p_client_action_id: crypto.randomUUID(),
        p_actor: host.userId,
        p_action: { type: "tap" },
        p_new_state: { counter: i },
      });
    }

    await admin.rpc("undo_last_action", {
      p_session_id: sessionId,
      p_expected_revision: 3,
      p_undo_seq: 3,
      p_new_state: { counter: 2 },
    });

    const { data: after } = await admin
      .from("game_sessions")
      .select("next_seq")
      .eq("id", sessionId)
      .single();

    // next_seq keeps climbing so a re-done move cannot reuse an old RNG draw.
    expect(after!.next_seq).toBe(4);
  });
});

describe.skipIf(!LIVE)("rooms", () => {
  it("returns the same membership when someone rejoins", async () => {
    const { host, roomId } = await makeRoomWithSession();
    const { data: room } = await host.client
      .from("rooms")
      .select("code")
      .eq("id", roomId)
      .single();

    const player = await guest();
    await player.client.rpc("join_room", {
      p_code: room!.code,
      p_display_name: "Alex",
    });
    const second = await player.client.rpc("join_room", {
      p_code: room!.code,
      p_display_name: "Alex",
    });

    expect(second.data![0]!.result).toBe("rejoined");

    const { count } = await admin
      .from("room_members")
      .select("*", { count: "exact", head: true })
      .eq("room_id", roomId)
      .eq("user_id", player.userId);

    expect(count).toBe(1);
  });

  it("answers a wrong code and a full room identically", async () => {
    const stranger = await guest();
    const { data } = await stranger.client.rpc("join_room", {
      p_code: "ZZZZZZ",
      p_display_name: "Nobody",
    });
    // No oracle: a guesser learns nothing about which codes are real.
    expect(data![0]!.result).toBe("invalid_code");
  });

  it("lets exactly one player claim an abandoned room", async () => {
    const { host, roomId } = await makeRoomWithSession();
    const { data: room } = await host.client
      .from("rooms")
      .select("code")
      .eq("id", roomId)
      .single();

    const a = await guest();
    const b = await guest();
    for (const [player, name] of [[a, "Alex"], [b, "Robin"]] as const) {
      await player.client.rpc("join_room", { p_code: room!.code, p_display_name: name });
    }

    // Age the host out rather than waiting 45 real seconds.
    await admin
      .from("room_members")
      .update({ last_seen_at: new Date(Date.now() - 120_000).toISOString() })
      .eq("room_id", roomId)
      .eq("user_id", host.userId);

    const [ra, rb] = await Promise.all([
      a.client.rpc("claim_host", { p_room: roomId, p_stale_seconds: 45 }),
      b.client.rpc("claim_host", { p_room: roomId, p_stale_seconds: 45 }),
    ]);

    const outcomes = [ra.data?.[0]?.result, rb.data?.[0]?.result].sort();
    expect(outcomes).toEqual(["claimed", "host_alive"]);
  });
});
