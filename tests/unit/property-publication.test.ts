import { beforeEach, describe, expect, it } from "vitest";
import { getRepository, resetRepositoryForTests } from "@/data/repository";
import { store } from "@/data/store";
import { rentalToV2 } from "@/features/rentals/v2";
import { getViewingSchedule, saveViewingSchedule } from "@/features/showings/availability";
import { getViewingScheduleDraft, saveViewingScheduleDraft } from "@/features/showings/draft";
const id = "20000000-0000-4000-8000-000000000001";
const calendar = { timezone: "America/Vancouver" as const, openWeekdays: [], dateOverrides: [{ date: "2026-10-20", available: true }] };
beforeEach(() => {
  process.env.DATA_BACKEND = "memory";
  store.reset(); resetRepositoryForTests();
  globalThis.__tingtingViewingDrafts = new Map();
  globalThis.__tingtingPropertyViewingSchedules = new Map();
});

describe("unified property publication", () => {
  it("saves calendar edits privately and restores them on reload without exposing dates", async () => {
    const draft = await saveViewingScheduleDraft(id, calendar, null, null, "admin");
    expect((await getViewingSchedule(id)).dateOverrides).toEqual([]);
    expect(await getViewingScheduleDraft(id)).toEqual(draft);
    expect(draft.dateOverrides).toEqual(calendar.dateOverrides);
    expect(draft.updatedAt).not.toBeNull();
  });
  it("publishes the rental and calendar through one action and permits subsequent edits", async () => {
    const repository = getRepository();
    const rental = await repository.getRental(id);
    const draft = await saveViewingScheduleDraft(id, calendar, null, null, "admin");
    const published = await repository.publishRentalWithViewingSchedule(id, rental.updatedAt, draft.updatedAt!, draft.publishedUpdatedAt, "admin");
    expect(published.rental.status).toBe("published");
    expect((await getViewingSchedule(id)).dateOverrides).toEqual(calendar.dateOverrides);
    expect(published.viewingSchedule.publishedUpdatedAt).toBe((await getViewingSchedule(id)).updatedAt);
    const next = await saveViewingScheduleDraft(id, { ...calendar, dateOverrides: [] }, published.viewingSchedule.updatedAt,
      published.viewingSchedule.publishedUpdatedAt, "admin");
    expect(next.dateOverrides).toEqual([]);
    expect((await getViewingSchedule(id)).dateOverrides).toEqual(calendar.dateOverrides);
  });
  it("does not publish calendar changes when property validation fails", async () => {
    const repository = getRepository();
    const before = await repository.getPublicRentalBySlug("howe-street-one-bedroom");
    const rental = await repository.getRental(id);
    const changed = await repository.updateRental(id, { ...rentalToV2(rental), title: "Private new title" }, rental.updatedAt, "admin");
    const draft = await saveViewingScheduleDraft(id, calendar, null, null, "admin");
    await expect(repository.publishRentalWithViewingSchedule(id, changed.updatedAt, draft.updatedAt!, draft.publishedUpdatedAt, "admin"))
      .rejects.toMatchObject({ status: 400 });
    expect((await getViewingSchedule(id)).dateOverrides).toEqual([]);
    expect((await repository.getPublicRentalBySlug("howe-street-one-bedroom"))?.title).toBe(before?.title);
    expect((await getViewingScheduleDraft(id)).dateOverrides).toEqual(calendar.dateOverrides);
  });
  it("rejects stale rental, draft, and live-calendar versions without partial publication", async () => {
    const repository = getRepository();
    const rental = await repository.getRental(id);
    const first = await saveViewingScheduleDraft(id, calendar, null, null, "admin");
    await expect(repository.publishRentalWithViewingSchedule(id, "stale", first.updatedAt!, first.publishedUpdatedAt, "admin")).rejects.toMatchObject({ status: 409 });
    const next = await saveViewingScheduleDraft(id, { ...calendar, dateOverrides: [] }, first.updatedAt, first.publishedUpdatedAt, "admin");
    await expect(repository.publishRentalWithViewingSchedule(id, rental.updatedAt, first.updatedAt!, first.publishedUpdatedAt, "admin")).rejects.toMatchObject({ status: 409 });
    await saveViewingSchedule(id, { ...calendar, dateOverrides: [] }, next.publishedUpdatedAt);
    await expect(repository.publishRentalWithViewingSchedule(id, rental.updatedAt, next.updatedAt!, next.publishedUpdatedAt, "admin")).rejects.toMatchObject({ status: 409 });
    expect((await getViewingSchedule(id)).dateOverrides).toEqual([]);
    await expect(saveViewingScheduleDraft(id, calendar, first.updatedAt, first.publishedUpdatedAt, "admin")).rejects.toMatchObject({ status: 409 });
  });
});
