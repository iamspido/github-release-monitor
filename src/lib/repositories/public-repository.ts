import type { Repository } from "@/types";

/** Removes delivery bookkeeping before repositories cross a public boundary. */
export function toPublicRepository(repository: Repository): Repository {
  const { pendingNotifications: _pendingNotifications, ...publicRepository } =
    repository;
  return publicRepository;
}
