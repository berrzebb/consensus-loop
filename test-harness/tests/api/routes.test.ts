// AL-3: API integration tests (full stack)

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryUserRepository } from "../../src/data/index.js";
import { UserService } from "../../src/service/index.js";
import { createRoutes, wrapHandler } from "../../src/api/index.js";
import type { RouteHandler, Request, Response } from "../../src/api/index.js";

describe("API Routes", () => {
  let routes: Record<string, RouteHandler>;

  beforeEach(() => {
    const repo = new InMemoryUserRepository();
    const service = new UserService(repo);
    const raw = createRoutes(service);
    // Wrap all handlers with error handling
    routes = Object.fromEntries(
      Object.entries(raw).map(([key, handler]) => [key, wrapHandler(handler)]),
    );
  });

  function call(route: string, req: Partial<Request> = {}): Response {
    const handler = routes[route];
    if (!handler) throw new Error(`Route not found: ${route}`);
    return handler({ method: "GET", path: "/", ...req });
  }

  describe("POST /users", () => {
    it("creates user and returns 201", () => {
      const res = call("POST /users", {
        body: { name: "Alice", email: "alice@example.com" },
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty("id");
    });

    it("returns 409 for duplicate email", () => {
      const body = { name: "Alice", email: "alice@example.com" };
      call("POST /users", { body });
      const res = call("POST /users", { body: { ...body, name: "Bob" } });
      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe("DUPLICATE_EMAIL");
    });
  });

  describe("GET /users", () => {
    it("returns empty list initially", () => {
      const res = call("GET /users");
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it("returns all users after creation", () => {
      call("POST /users", {
        body: { name: "Alice", email: "alice@example.com" },
      });
      call("POST /users", {
        body: { name: "Bob", email: "bob@example.com" },
      });
      const res = call("GET /users");
      expect(res.body.data).toHaveLength(2);
    });
  });

  describe("GET /users/:id", () => {
    it("returns user by ID", () => {
      const created = call("POST /users", {
        body: { name: "Alice", email: "alice@example.com" },
      });
      const id = (created.body.data as { id: string }).id;
      const res = call("GET /users/:id", { params: { id } });
      expect(res.status).toBe(200);
      expect((res.body.data as { name: string }).name).toBe("Alice");
    });

    it("returns 404 for missing user", () => {
      const res = call("GET /users/:id", { params: { id: "no-such-id" } });
      expect(res.status).toBe(404);
    });

    it("returns 400 for missing ID param", () => {
      const res = call("GET /users/:id", { params: {} });
      expect(res.status).toBe(400);
    });
  });

  describe("PUT /users/:id", () => {
    it("updates user and returns 200", () => {
      const created = call("POST /users", {
        body: { name: "Alice", email: "alice@example.com" },
      });
      const id = (created.body.data as { id: string }).id;
      const res = call("PUT /users/:id", {
        params: { id },
        body: { name: "Alicia" },
      });
      expect(res.status).toBe(200);
      expect((res.body.data as { name: string }).name).toBe("Alicia");
    });

    it("returns 404 for missing user", () => {
      const res = call("PUT /users/:id", {
        params: { id: "no-such-id" },
        body: { name: "X" },
      });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /users/:id", () => {
    it("returns 204 for existing user", () => {
      const created = call("POST /users", {
        body: { name: "Alice", email: "alice@example.com" },
      });
      const id = (created.body.data as { id: string }).id;
      const res = call("DELETE /users/:id", { params: { id } });
      expect(res.status).toBe(204);
    });

    it("returns 404 for missing user", () => {
      const res = call("DELETE /users/:id", {
        params: { id: "no-such-id" },
      });
      expect(res.status).toBe(404);
    });
  });

  describe("full lifecycle", () => {
    it("CRUD through routes end-to-end", () => {
      // Create
      const created = call("POST /users", {
        body: { name: "Alice", email: "alice@example.com" },
      });
      expect(created.status).toBe(201);
      const id = (created.body.data as { id: string }).id;

      // Read
      const read = call("GET /users/:id", { params: { id } });
      expect(read.status).toBe(200);

      // Update
      const updated = call("PUT /users/:id", {
        params: { id },
        body: { name: "Alicia" },
      });
      expect(updated.status).toBe(200);

      // List
      const list = call("GET /users");
      expect(list.body.data).toHaveLength(1);

      // Delete
      const deleted = call("DELETE /users/:id", { params: { id } });
      expect(deleted.status).toBe(204);

      // Verify gone
      const gone = call("GET /users/:id", { params: { id } });
      expect(gone.status).toBe(404);
    });
  });
});
