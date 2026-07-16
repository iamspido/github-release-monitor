import { scheduleLoginMethodRemoval } from "@/lib/auth/login-method-removal-queue";

describe("login method removal queue", () => {
  it("serializes removals for the same user", async () => {
    const events: string[] = [];
    let finishFirstRemoval: (() => void) | undefined;

    const firstRemoval = scheduleLoginMethodRemoval("user-1", async () => {
      events.push("first:start");
      await new Promise<void>((resolve) => {
        finishFirstRemoval = resolve;
      });
      events.push("first:end");
    });
    const secondRemoval = scheduleLoginMethodRemoval("user-1", async () => {
      events.push("second:start");
    });

    await vi.waitFor(() => expect(events).toEqual(["first:start"]));
    finishFirstRemoval?.();
    await Promise.all([firstRemoval, secondRemoval]);

    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("does not block removals for another user", async () => {
    let finishFirstRemoval: (() => void) | undefined;
    const firstRemoval = scheduleLoginMethodRemoval(
      "user-1",
      () =>
        new Promise<void>((resolve) => {
          finishFirstRemoval = resolve;
        }),
    );
    const otherUserRemoval = vi.fn(async () => undefined);

    await scheduleLoginMethodRemoval("user-2", otherUserRemoval);

    expect(otherUserRemoval).toHaveBeenCalledOnce();
    finishFirstRemoval?.();
    await firstRemoval;
  });
});
