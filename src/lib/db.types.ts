/*
  Database types.

  Hand-written to match `supabase/migrations/*`. Once a Supabase project exists,
  regenerate with:

      supabase gen types typescript --project-id <ref> > src/lib/db.types.ts

  Keep the two in step: this file is what stops a typo in a column name from
  becoming a runtime error at a party.
*/

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type RoomStatus = "lobby" | "in_game" | "closed";
export type SessionStatus = "setup" | "running" | "finished" | "aborted";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          avatar_key: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          avatar_key?: string | null;
        };
        Update: {
          display_name?: string;
          avatar_key?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      rooms: {
        Row: {
          id: string;
          code: string;
          status: RoomStatus;
          host_id: string;
          created_by: string;
          settings: Json;
          created_at: string;
          last_activity_at: string;
          closed_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      room_members: {
        Row: {
          id: string;
          room_id: string;
          user_id: string;
          display_name: string;
          is_spectator: boolean;
          joined_at: string;
          last_seen_at: string;
          left_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      game_sessions: {
        Row: {
          id: string;
          room_id: string;
          game_id: string;
          module_version: string;
          state_version: number;
          status: SessionStatus;
          config: Json;
          seed: string;
          initial_state: Json;
          state: Json;
          revision: number;
          next_seq: number;
          created_at: string;
          started_at: string | null;
          finished_at: string | null;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      session_players: {
        Row: {
          session_id: string;
          user_id: string;
          seat_index: number;
          display_name: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      game_actions: {
        Row: {
          id: number;
          session_id: string;
          seq: number;
          actor_user_id: string | null;
          action: Json;
          client_action_id: string;
          revision_after: number;
          acted_at: string;
          undone_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      match_results: {
        Row: {
          id: string;
          session_id: string | null;
          room_id: string | null;
          room_code: string;
          game_id: string;
          module_version: string;
          summary: Json;
          finished_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      match_result_players: {
        Row: {
          id: string;
          result_id: string;
          user_id: string | null;
          display_name: string;
          placement: number | null;
          score: number | null;
          payload: Json;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      create_room: {
        Args: { p_display_name: string; p_settings?: Json };
        Returns: { room_id: string; code: string }[];
      };
      join_room: {
        Args: { p_code: string; p_display_name: string };
        Returns: {
          result:
            | "joined"
            | "rejoined"
            | "invalid_code"
            | "invalid_name"
            | "name_taken"
            | "rate_limited";
          room_id: string | null;
          room_status: RoomStatus | null;
          is_spectator: boolean | null;
        }[];
      };
      leave_room: {
        Args: { p_room: string };
        Returns: {
          result: "left" | "closed" | "host_transferred" | "not_found";
          new_host: string | null;
        }[];
      };
      heartbeat: { Args: { p_room: string }; Returns: undefined };
      transfer_host: {
        Args: { p_room: string; p_to: string };
        Returns: "ok" | "not_host" | "not_a_member";
      };
      claim_host: {
        Args: { p_room: string; p_stale_seconds?: number };
        Returns: {
          result: "claimed" | "host_alive" | "not_a_member";
          host_id: string | null;
        }[];
      };
      start_session: {
        Args: {
          p_room_id: string;
          p_host: string;
          p_game_id: string;
          p_module_version: string;
          p_state_version: number;
          p_config: Json;
          p_seed: string;
          p_initial_state: Json;
          p_players: Json;
        };
        Returns: {
          result: "started" | "not_found" | "not_host" | "room_busy" | "already_running";
          session_id: string | null;
          revision: number | null;
        }[];
      };
      apply_game_action: {
        Args: {
          p_session_id: string;
          p_expected_revision: number;
          p_client_action_id: string;
          p_actor: string | null;
          p_action: Json;
          p_new_state: Json;
          p_new_status?: SessionStatus | null;
          p_acted_at?: string;
        };
        Returns: {
          result: "applied" | "duplicate" | "stale" | "rate_limited";
          revision: number | null;
          seq: number | null;
        }[];
      };
      undo_last_action: {
        Args: {
          p_session_id: string;
          p_expected_revision: number;
          p_undo_seq: number;
          p_new_state: Json;
        };
        Returns: {
          result: "undone" | "stale" | "nothing_to_undo";
          revision: number | null;
          undone_seq: number | null;
        }[];
      };
      finish_session: {
        Args: {
          p_session_id: string;
          p_expected_revision: number;
          p_final_state: Json;
          p_summary: Json;
          p_players: Json;
        };
        Returns: {
          result: "finished" | "already_finished" | "stale" | "not_found";
          result_id: string | null;
          revision: number | null;
        }[];
      };
      abort_session: {
        Args: { p_session_id: string; p_actor: string };
        Returns: "aborted" | "not_host" | "not_found";
      };
      migrate_session_state: {
        Args: {
          p_session_id: string;
          p_expected_revision: number;
          p_new_state: Json;
          p_new_initial_state: Json;
          p_state_version: number;
          p_module_version: string;
        };
        Returns: { result: "migrated" | "stale"; revision: number | null }[];
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
