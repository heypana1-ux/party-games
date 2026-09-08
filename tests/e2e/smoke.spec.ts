import { expect, test } from "@playwright/test";

/*
  Runs without a backend. Covers the parts of the shell a broken deploy breaks
  first: does it render on a phone, is the primary action reachable with a
  thumb, and does the join field behave.
*/

test.describe("shell", () => {
  test("landing page offers exactly two ways in", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /start a room/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /join with a code/i })).toBeVisible();
  });

  test("never scrolls sideways on a phone", async ({ page }) => {
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("primary action sits in the thumb zone", async ({ page }) => {
    await page.goto("/");
    const button = page.getByRole("button", { name: /start a room/i });
    const box = await button.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    // Bottom half of the screen, and at least 48px tall.
    expect(box!.y).toBeGreaterThan(viewport!.height / 2);
    expect(box!.height).toBeGreaterThanOrEqual(48);
  });

  test("join field accepts only room-code characters", async ({ page }) => {
    await page.goto("/join");
    const code = page.getByLabel(/room code/i);
    // O, I, L and 0/1 are not in the alphabet and must be dropped as typed,
    // so a misread code becomes a short code rather than a failed attempt.
    await code.fill("");
    await code.pressSequentially("aOb1Ic2L34");
    await expect(code).toHaveValue("ABC234");
  });

  test("join stays disabled until the form is usable", async ({ page }) => {
    await page.goto("/join");
    const submit = page.getByRole("button", { name: /^join$/i });
    await expect(submit).toBeDisabled();
    await page.getByLabel(/room code/i).fill("ABC234");
    await expect(submit).toBeDisabled();
    await page.getByLabel(/your name/i).fill("Alex");
    await expect(submit).toBeEnabled();
  });

  test("a deep link pre-fills the code", async ({ page }) => {
    await page.goto("/join/ABC234");
    await expect(page.getByLabel(/room code/i)).toHaveValue("ABC234");
  });

  test("catalogue lists the registered games", async ({ page }) => {
    await page.goto("/games");
    await expect(page.getByRole("heading", { name: /games/i })).toBeVisible();
    await expect(page.getByText("Tap Test")).toBeVisible();
  });

  test("offline page explains itself", async ({ page }) => {
    await page.goto("/offline");
    await expect(page.getByRole("heading", { name: /offline/i })).toBeVisible();
  });

  /*
    With no site key configured the captcha must be entirely absent — not
    merely hidden. This is the path local development and CI take, and a stray
    third-party script request here would mean the skip logic had regressed.
  */
  test("no captcha is loaded when none is configured", async ({ page }) => {
    test.skip(
      Boolean(process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY),
      "a site key is configured, so the captcha is expected",
    );

    const captchaRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("hcaptcha.com")) captchaRequests.push(request.url());
    });

    await page.goto("/join");
    await expect(page.getByText(/protected by hcaptcha/i)).toHaveCount(0);

    await page.getByLabel(/room code/i).fill("ABC234");
    await page.getByLabel(/your name/i).fill("Alex");
    await page.getByRole("button", { name: /^join$/i }).click();
    await page.waitForTimeout(1500);

    expect(captchaRequests).toEqual([]);
  });

  test("manifest is installable", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.ok()).toBe(true);
    const manifest = await response.json();
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  });
});
