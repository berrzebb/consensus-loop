// SL-1: UserService — business logic layer

import type { User, CreateUserInput, UserRepository } from "../data/index.js";
import { createUser } from "../data/index.js";

export class ServiceError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export class UserService {
  constructor(private repository: UserRepository) {}

  register(input: CreateUserInput): User {
    const existing = this.repository.findAll();
    if (existing.some((u) => u.email === input.email)) {
      throw new ServiceError(
        "DUPLICATE_EMAIL",
        `Email ${input.email} is already registered`,
      );
    }
    const user = createUser(input);
    return this.repository.save(user);
  }

  getUser(id: string): User | null {
    return this.repository.findById(id);
  }

  listUsers(): User[] {
    return this.repository.findAll();
  }

  updateUser(id: string, updates: Partial<CreateUserInput>): User {
    const existing = this.repository.findById(id);
    if (!existing) {
      throw new ServiceError("NOT_FOUND", `User ${id} not found`);
    }
    if (updates.email) {
      const others = this.repository.findAll();
      if (others.some((u) => u.id !== id && u.email === updates.email)) {
        throw new ServiceError(
          "DUPLICATE_EMAIL",
          `Email ${updates.email} is already registered`,
        );
      }
    }
    return this.repository.update(id, updates);
  }

  removeUser(id: string): boolean {
    return this.repository.delete(id);
  }
}
