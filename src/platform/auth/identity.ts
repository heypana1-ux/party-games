"use client";

import { getBrowserClient } from "@/lib/supabase/browser";

/*
  Identity.

  A guest is a real Supabase user created by anonymous sign-in, not a made-up
  token. That one decision removes a whole category of problems: `auth.uid()`
  means the same thing for a guest as for a registered account, so RLS, RPCs
  and Realtime need no special guest path; reconnecting is a lookup on a unique
  key rather than a guess; and nobody can claim someone else's seat by typing
  their name, because the name was never the credential.

  Requires "Anonymous sign-ins" to be enabled in the Supabase project.
*/

export interface Identity {
  readonly userId: string;
  readonly isAnonymous: boolean;
}

/** Returns the current identity, creating a guest one if there is none. */
export async function ensureIdentity(): Promise<Identity> {
  const supabase = getBrowserClient();

  const { data: existing } = await supabase.auth.getUser();
  if (existing.user) {
    return {
      userId: existing.user.id,
      isAnonymous: existing.user.is_anonymous ?? false,
    };
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    throw new Error(
      error?.message ??
        "Could not create a guest session. Is anonymous sign-in enabled in Supabase?",
    );
  }

  return { userId: data.user.id, isAnonymous: data.user.is_anonymous ?? true };
}

export async function getIdentity(): Promise<Identity | null> {
  const { data } = await getBrowserClient().auth.getUser();
  if (!data.user) return null;
  return { userId: data.user.id, isAnonymous: data.user.is_anonymous ?? false };
}

/**
 * Turns the current guest into a registered account, keeping the same user id.
 *
 * Because the id does not change, every room the guest was in and every result
 * they appear in stay theirs — an upgrade, not a migration.
 */
export async function upgradeGuest(email: string, password: string) {
  const supabase = getBrowserClient();
  const { error } = await supabase.auth.updateUser({ email, password });
  return error ? { error: error.message } : {};
}

export async function signOut() {
  await getBrowserClient().auth.signOut();
}
