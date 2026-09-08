"use client";

import { getBrowserClient } from "@/lib/supabase/browser";
import { getCaptchaToken, isCaptchaConfigured } from "@/platform/auth/captcha";

/*
  Identity.

  A guest is a real Supabase user created by anonymous sign-in, not a made-up
  token. That one decision removes a whole category of problems: `auth.uid()`
  means the same thing for a guest as for a registered account, so RLS, RPCs
  and Realtime need no special guest path; reconnecting is a lookup on a unique
  key rather than a guess; and nobody can claim someone else's seat by typing
  their name, because the name was never the credential.

  Requires "Anonymous sign-ins" to be enabled in the Supabase project. If
  Attack Protection -> Captcha is also on there, a captcha token has to travel
  with the sign-in or every guest is refused — so the two settings have to be
  turned on together with NEXT_PUBLIC_HCAPTCHA_SITE_KEY in place.
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

  // Only a brand new guest needs a captcha. A reconnect took the branch above
  // and never sees one, which is why this costs at most one challenge per
  // device rather than one per game.
  const captchaToken = await getCaptchaToken();

  const { data, error } = await supabase.auth.signInAnonymously(
    captchaToken ? { options: { captchaToken } } : undefined,
  );

  if (error || !data.user) {
    throw new Error(describeSignInFailure(error?.message));
  }

  return { userId: data.user.id, isAnonymous: data.user.is_anonymous ?? true };
}

/**
 * Turns Supabase's auth errors into something actionable.
 *
 * The captcha mismatch is worth calling out by name: with protection enabled in
 * Supabase but no site key in the app, every guest is refused and the message
 * from the API alone does not say why.
 */
function describeSignInFailure(message: string | undefined): string {
  if (message && /captcha/i.test(message)) {
    return isCaptchaConfigured()
      ? `The captcha was rejected. ${message}`
      : "Supabase requires a captcha, but NEXT_PUBLIC_HCAPTCHA_SITE_KEY is not set in this deployment.";
  }
  return (
    message ??
    "Could not create a guest session. Is anonymous sign-in enabled in Supabase?"
  );
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
