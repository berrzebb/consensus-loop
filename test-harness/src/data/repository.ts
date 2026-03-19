// DL-2: UserRepository interface and in-memory implementation

import type { User, CreateUserInput } from "./user.js";
import { createUser } from "./user.js";

export interface UserRepository {
  findById(id: string): User | null;
  findAll(): User[];
  save(user: User): User;
  update(id: string, updates: Partial<CreateUserInput>): User;
  delete(id: string): boolean;
}

export class RepositoryError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}

export class InMemoryUserRepository implements UserRepository {
  private store = new Map<string, User>();

  findById(id: string): User | null {
    return this.store.get(id) ?? null;
  }

  findAll(): User[] {
    return Array.from(this.store.values());
  }

  save(user: User): User {
    if (this.store.has(user.id)) {
      throw new RepositoryError(
        "DUPLICATE_ID",
        `User with id ${user.id} already exists`,
      );
    }
    this.store.set(user.id, { ...user });
    return user;
  }

  update(id: string, updates: Partial<CreateUserInput>): User {
    const existing = this.store.get(id);
    if (!existing) {
      throw new RepositoryError(
        "NOT_FOUND",
        `User with id ${id} not found`,
      );
    }
    const updated: User = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.store.set(id, updated);
    return updated;
  }

  delete(id: string): boolean {
    return this.store.delete(id);
  }
}

export { createUser };
