// DL-3: Data layer integration tests

import { describe, it, expect, beforeEach } from "vitest";
import { createUser, InMemoryUserRepository, RepositoryError } from "../../src/data/index.js";
import type { User, CreateUserInput } from "../../src/data/index.js";

describe("createUser", () => {
  const input: CreateUserInput = { name: "Alice", email: "alice@example.com" };

  it("produces a valid User with all fields", () => {
    const user = createUser(input);
    expect(user.id).toBeTruthy();
    expect(user.name).toBe("Alice");
    expect(user.email).toBe("alice@example.com");
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);
  });

  it("generates unique IDs per call", () => {
    const a = createUser(input);
    const b = createUser(input);
    expect(a.id).not.toBe(b.id);
  });

  it("sets createdAt and updatedAt equal on creation", () => {
    const user = createUser(input);
    expect(user.createdAt.getTime()).toBe(user.updatedAt.getTime());
  });
});

describe("InMemoryUserRepository", () => {
  let repo: InstanceType<typeof InMemoryUserRepository>;
  let testUser: User;

  beforeEach(() => {
    repo = new InMemoryUserRepository();
    testUser = createUser({ name: "Bob", email: "bob@example.com" });
  });

  it("save + findById round-trip", () => {
    repo.save(testUser);
    const found = repo.findById(testUser.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Bob");
  });

  it("save rejects duplicate ID", () => {
    repo.save(testUser);
    expect(() => repo.save(testUser)).toThrowError(RepositoryError);
  });

  it("findAll returns all stored users", () => {
    const user2 = createUser({ name: "Carol", email: "carol@example.com" });
    repo.save(testUser);
    repo.save(user2);
    expect(repo.findAll()).toHaveLength(2);
  });

  it("update sets updatedAt to a later time", async () => {
    repo.save(testUser);
    await new Promise((r) => setTimeout(r, 10));
    const updated = repo.update(testUser.id, { name: "Bobby" });
    expect(updated.name).toBe("Bobby");
    expect(updated.updatedAt.getTime()).toBeGreaterThan(
      updated.createdAt.getTime(),
    );
  });

  it("update non-existent throws RepositoryError", () => {
    expect(() => repo.update("no-such-id", { name: "X" })).toThrowError(
      RepositoryError,
    );
  });

  it("delete returns true for existing user", () => {
    repo.save(testUser);
    expect(repo.delete(testUser.id)).toBe(true);
    expect(repo.findById(testUser.id)).toBeNull();
  });

  it("delete returns false for non-existent user", () => {
    expect(repo.delete("no-such-id")).toBe(false);
  });

  it("empty repository returns empty array", () => {
    expect(repo.findAll()).toEqual([]);
  });

  it("full lifecycle: create → save → find → update → delete", async () => {
    const user = createUser({ name: "Dave", email: "dave@example.com" });
    repo.save(user);
    expect(repo.findById(user.id)).not.toBeNull();

    await new Promise((r) => setTimeout(r, 10));
    repo.update(user.id, { email: "dave2@example.com" });
    const updated = repo.findById(user.id);
    expect(updated!.email).toBe("dave2@example.com");

    expect(repo.delete(user.id)).toBe(true);
    expect(repo.findById(user.id)).toBeNull();
  });
});
