/*
  Attribution for the invisible captcha.

  hCaptcha's terms require the notice when the floating badge is suppressed, and
  the badge is suppressed because a permanently floating widget over a
  one-handed game UI sits exactly where a thumb goes. Renders nothing when no
  captcha is configured, so local development stays clean.
*/
export function CaptchaNotice({ className }: { className?: string }) {
  if (!process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY) return null;

  return (
    <p className={className ?? "text-center text-[11px] leading-relaxed text-ink-faint"}>
      Protected by hCaptcha ·{" "}
      <a
        href="https://hcaptcha.com/privacy"
        target="_blank"
        rel="noreferrer"
        className="underline hover:text-ink-muted"
      >
        Privacy
      </a>{" "}
      ·{" "}
      <a
        href="https://hcaptcha.com/terms"
        target="_blank"
        rel="noreferrer"
        className="underline hover:text-ink-muted"
      >
        Terms
      </a>
    </p>
  );
}
