"use client";

/*
  hCaptcha for anonymous sign-in.

  Anonymous sign-in is what makes guest play frictionless, and it is also an
  open account factory: one unauthenticated POST creates a permanent auth user.
  A captcha is the thing standing between "guests need no account" and "a script
  mints ten thousand of them".

  Two design notes:

  * We only ever produce a token. Supabase Auth verifies it server-side against
    hCaptcha's siteverify, which is why the hCaptcha *secret* key belongs in the
    Supabase dashboard and never in this app. There is no backend verification
    step for us to write.

  * This is an imperative singleton rather than a React component. Sign-in
    happens inside plain async functions (createRoom, joinRoom, reconnect), not
    inside a component render, so a widget bound to a component lifecycle would
    have to be hoisted and plumbed through every call site. A detached
    invisible widget rendered on first use fits the actual call graph, and
    avoids a dependency whose whole job is lifecycle management we do not need.
*/

const SITE_KEY = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY;

/** How long to wait for a person to finish a challenge before giving up. */
const EXECUTE_TIMEOUT_MS = 120_000;

interface HCaptcha {
  render(
    container: HTMLElement,
    config: { sitekey: string; size: "invisible"; theme?: "dark" | "light" },
  ): string;
  /* Documented to resolve `{ response, key }` with `async: true`. Older builds
     resolve the token string directly, so the caller accepts both rather than
     failing on a shape difference at a party. */
  execute(
    widgetId: string,
    options: { async: true },
  ): Promise<{ response: string } | string>;
  reset(widgetId: string): void;
}

declare global {
  interface Window {
    hcaptcha?: HCaptcha;
    __partyHcaptchaOnLoad?: () => void;
  }
}

/** False when no site key is configured — local development, tests, CI. */
export function isCaptchaConfigured(): boolean {
  return Boolean(SITE_KEY);
}

let scriptPromise: Promise<HCaptcha> | null = null;
let widgetId: string | null = null;

function loadScript(): Promise<HCaptcha> {
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<HCaptcha>((resolve, reject) => {
    if (window.hcaptcha) {
      resolve(window.hcaptcha);
      return;
    }

    // `render=explicit` stops hCaptcha from scanning the DOM for widgets to
    // mount, so nothing appears until we ask for it.
    const script = document.createElement("script");
    script.src =
      "https://js.hcaptcha.com/1/api.js?render=explicit&onload=__partyHcaptchaOnLoad";
    script.async = true;
    script.defer = true;

    window.__partyHcaptchaOnLoad = () => {
      if (window.hcaptcha) resolve(window.hcaptcha);
      else reject(new Error("hCaptcha loaded without an API"));
    };

    script.onerror = () => {
      // Let the next attempt retry rather than caching the failure forever;
      // this is usually a blocked script or a flaky connection.
      scriptPromise = null;
      reject(new Error("Could not load hCaptcha."));
    };

    document.head.appendChild(script);
  });

  return scriptPromise;
}

function ensureWidget(hcaptcha: HCaptcha): string {
  if (widgetId !== null) return widgetId;

  const host = document.createElement("div");
  host.id = "party-hcaptcha";
  // Invisible mode still needs a real element to mount into. It is kept out of
  // the layout entirely; the challenge, when one is needed, is an overlay.
  host.style.position = "fixed";
  host.style.bottom = "0";
  host.style.left = "0";
  host.style.width = "0";
  host.style.height = "0";
  host.style.overflow = "hidden";
  document.body.appendChild(host);

  widgetId = hcaptcha.render(host, {
    sitekey: SITE_KEY as string,
    size: "invisible",
    theme: "dark",
  });
  return widgetId;
}

/**
 * Returns a fresh captcha token, or undefined when no site key is configured.
 *
 * Tokens are single-use and short-lived, so this is called immediately before
 * sign-in and the widget is reset afterwards. Most of the time hCaptcha decides
 * silently and the person sees nothing at all.
 */
export async function getCaptchaToken(): Promise<string | undefined> {
  if (!SITE_KEY) return undefined;

  const hcaptcha = await loadScript();
  const id = ensureWidget(hcaptcha);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const token = await Promise.race([
      hcaptcha
        .execute(id, { async: true })
        .then((result) => (typeof result === "string" ? result : result?.response)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("The captcha timed out. Try again.")),
          EXECUTE_TIMEOUT_MS,
        );
      }),
    ]);

    if (!token) throw new Error("hCaptcha returned no token.");
    return token;
  } catch (cause) {
    // Closing the challenge is a normal thing to do, so this has to read as a
    // thing the person can retry, not as a crash.
    throw new Error(
      cause instanceof Error && cause.message
        ? `Captcha not completed: ${cause.message}`
        : "Captcha not completed.",
    );
  } finally {
    if (timer) clearTimeout(timer);
    // A used token cannot be reused; reset so the next attempt gets a new one.
    try {
      hcaptcha.reset(id);
    } catch {
      // A reset failure is not worth failing sign-in over.
    }
  }
}
