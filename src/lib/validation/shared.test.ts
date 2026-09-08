import { describe, expect, it } from "vitest";
import { DisplayName, RoomCode, ROOM_CODE_ALPHABET } from "@/lib/validation/shared";

describe("room codes", () => {
  it("excludes every character pair people confuse", () => {
    for (const ch of ["I", "1", "L", "O", "0"]) {
      expect(ROOM_CODE_ALPHABET).not.toContain(ch);
    }
  });

  it("accepts a well-formed code and normalises case", () => {
    expect(RoomCode.parse("abc234")).toBe("ABC234");
  });

  it("rejects codes containing excluded characters", () => {
    expect(RoomCode.safeParse("ABC01L").success).toBe(false);
  });

  it("rejects wrong lengths", () => {
    expect(RoomCode.safeParse("ABC23").success).toBe(false);
    expect(RoomCode.safeParse("ABC2345").success).toBe(false);
  });
});

describe("display names", () => {
  it("trims and accepts ordinary names", () => {
    expect(DisplayName.parse("  Alex  ")).toBe("Alex");
  });

  it("rejects names that are too short or too long", () => {
    expect(DisplayName.safeParse("A").success).toBe(false);
    expect(DisplayName.safeParse("x".repeat(25)).success).toBe(false);
  });

  it("rejects control characters", () => {
    // A newline in a name breaks the player list layout and can be used to
    // fake UI text next to someone else's entry.
    expect(DisplayName.safeParse("Alex\nHost").success).toBe(false);
    expect(DisplayName.safeParse("Alex​​").success).toBe(false);
  });
});
