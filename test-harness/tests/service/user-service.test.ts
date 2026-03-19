// SL-3: Service layer integration tests

import { describe, it, expect, beforeEach } from "vitest";
import { UserService, ServiceError } from "../../src/service/index.js";
import { InMemoryUserRepository } from "../../src/data/index.js";
import type { CreateUserInput } from "../../src/data/index.js";

describe("UserService", () => {
  let service: UserService;

  beforeEach(() => {
    const repo = new InMemoryUserRepository();
    service = new UserService(repo);
  });

  describe("register", () => {
    it("creates and persists a user", () => {
      const input: CreateUserInput = {
        name: "Alice",
        email: "alice@example.com",
      };
      const user = service.register(input);
      expect(user.id).toBeTruthy();
      expect(user.name).toBe("Alice");
      expect(service.getUser(user.id)).not.toBeNull();
    });

    it("throws DUPLICATE_EMAIL for same email", () => {
      const input: CreateUserInput = {
        name: "Alice",
        email: "alice@example.com",
      };
      service.register(input);
      expect(() => service.register({ ...input, name: "Bob" })).toThrowError(
        ServiceError,
      );
    });
  });

  describe("getUser", () => {
    it("returns null for missing user", () => {
      expect(service.getUser("no-such-id")).toBeNull();
    });
  });

  describe("updateUser", () => {
    it("merges partial fields", () => {
      const user = service.register({
        name: "Alice",
        email: "alice@example.com",
      });
      const updated = service.updateUser(user.id, { name: "Alicia" });
      expect(updated.name).toBe("Alicia");
      expect(updated.email).toBe("alice@example.com");
    });

    it("throws NOT_FOUND for missing user", () => {
      expect(() =>
        service.updateUser("no-such-id", { name: "X" }),
      ).toThrowError(ServiceError);
    });

    it("throws DUPLICATE_EMAIL on email conflict", () => {
      service.register({ name: "Alice", email: "alice@example.com" });
      const bob = service.register({ name: "Bob", email: "bob@example.com" });
      expect(() =>
        service.updateUser(bob.id, { email: "alice@example.com" }),
      ).toThrowError(ServiceError);
    });
  });

  describe("removeUser", () => {
    it("returns false for missing user", () => {
      expect(service.removeUser("no-such-id")).toBe(false);
    });

    it("returns true and removes existing user", () => {
      const user = service.register({
        name: "Alice",
        email: "alice@example.com",
      });
      expect(service.removeUser(user.id)).toBe(true);
      expect(service.getUser(user.id)).toBeNull();
    });
  });

  describe("listUsers", () => {
    it("returns all registered users", () => {
      service.register({ name: "Alice", email: "alice@example.com" });
      service.register({ name: "Bob", email: "bob@example.com" });
      expect(service.listUsers()).toHaveLength(2);
    });
  });

  describe("full lifecycle", () => {
    it("register → get → update → list → remove", () => {
      const user = service.register({
        name: "Alice",
        email: "alice@example.com",
      });
      expect(service.getUser(user.id)).not.toBeNull();
      service.updateUser(user.id, { name: "Alicia" });
      expect(service.listUsers()).toHaveLength(1);
      expect(service.removeUser(user.id)).toBe(true);
      expect(service.listUsers()).toHaveLength(0);
    });
  });
});
