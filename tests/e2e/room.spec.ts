import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/*
  The full round: a host and two guests, three separate browser contexts,
  standing in for three phones in the same room.

  Needs a Supabase project with the migrations applied and anonymous sign-in
  enabled, so it skips unless E2E_SUPABASE is set. If that project has Attack
  Protection on, set NEXT_PUBLIC_HCAPTCHA_SITE_KEY to hCaptcha's always-passing
  test key (10000000-ffff-ffff-ffff-000000000001) so no challenge is shown. It is the test that would
  have caught every realtime and reconnect bug this platform can have, so it
  should run in CI against a throwaway project.
*/
const LIVE = process.env.E2E_SUPABASE === "1";

test.describe("a full round", () => {
  test.skip(!LIVE, "set E2E_SUPABASE=1 with a configured Supabase project");
  test.describe.configure({ mode: "serial" });

  let host: Page;
  const guests: Page[] = [];
  const contexts: BrowserContext[] = [];
  let code = "";

  test.afterAll(async () => {
    await Promise.all(contexts.map((c) => c.close()));
  });

  test("host creates a room and gets a code", async ({ browser }) => {
    const context = await browser.newContext();
    contexts.push(context);
    host = await context.newPage();

    await host.goto("/");
    await host.getByRole("button", { name: /start a room/i }).click();
    await host.getByLabel(/your name/i).fill("Sam");
    await host.getByRole("button", { name: /create the room/i }).click();

    await host.waitForURL(/\/room\/[A-Z0-9]{6}/);
    code = host.url().split("/room/")[1]!;
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    await expect(host.getByText(/you host/i)).toBeVisible();
  });

  test("two guests join with the code", async ({ browser }) => {
    for (const name of ["Alex", "Robin"]) {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      guests.push(page);

      await page.goto(`/join/${code}`);
      await page.getByLabel(/your name/i).fill(name);
      await page.getByRole("button", { name: /^join$/i }).click();
      await page.waitForURL(new RegExp(`/room/${code}`));
    }

    // Everyone shows up on the host's screen without a reload.
    await expect(host.getByText("Alex")).toBeVisible({ timeout: 10_000 });
    await expect(host.getByText("Robin")).toBeVisible({ timeout: 10_000 });
  });

  test("rejoining does not create a second player", async () => {
    await guests[0]!.reload();
    await guests[0]!.waitForURL(new RegExp(`/room/${code}`));
    // One entry, not two: membership is a unique key, not a heuristic.
    await expect(host.getByText("Alex")).toHaveCount(1);
  });

  test("host starts the game and everyone lands in it", async () => {
    await host.getByRole("button", { name: /set up/i }).first().click();
    await host.getByRole("button", { name: /start the game/i }).click();

    for (const page of [host, ...guests]) {
      await expect(page.getByRole("button", { name: /^tap$/i })).toBeVisible({
        timeout: 10_000,
      });
    }
  });

  test("a tap reaches every other device", async () => {
    await guests[0]!.getByRole("button", { name: /^tap$/i }).click();
    // The host sees the guest's score change without doing anything.
    await expect(host.getByText("Alex").locator("..")).toContainText(/[1-9]/, {
      timeout: 10_000,
    });
  });

  test("only the host sees host controls", async () => {
    await expect(host.getByText(/host controls/i)).toBeVisible();
    for (const page of guests) {
      await expect(page.getByText(/host controls/i)).toHaveCount(0);
    }
  });

  test("a guest catches up after being offline", async () => {
    const guest = guests[1]!;
    await guest.context().setOffline(true);

    for (let i = 0; i < 5; i++) {
      await host.getByRole("button", { name: /^tap$/i }).click();
      await host.waitForTimeout(120);
    }

    await guest.context().setOffline(false);
    // No replay, no gap detection: the next snapshot is the whole truth.
    await expect(guest.getByText("Sam").locator("..")).toContainText(/[1-9]/, {
      timeout: 20_000,
    });
  });

  test("the round ends and the standings appear for everyone", async () => {
    for (let i = 0; i < 12; i++) {
      await host.getByRole("button", { name: /^tap$/i }).click().catch(() => {});
      await host.waitForTimeout(100);
    }

    for (const page of [host, ...guests]) {
      await expect(page.getByRole("heading", { name: /round over/i })).toBeVisible({
        timeout: 15_000,
      });
    }
  });

  test("the finished round shows up in history", async () => {
    await host.goto("/history");
    await expect(host.getByText("Tap Test")).toBeVisible({ timeout: 10_000 });
  });
});
