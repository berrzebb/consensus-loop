// AL-1: HTTP route handlers
// [PLANTED DEFECT: security-drift] — input passed directly to service without validation

import type { UserService } from "../service/index.js";
import type { CreateUserInput } from "../data/index.js";

export interface Request {
  method: string;
  path: string;
  body?: unknown;
  params?: Record<string, string>;
}

export interface Response {
  status: number;
  body: {
    data?: unknown;
    error?: { code: string; message: string };
  };
}

export type RouteHandler = (req: Request) => Response;

export function createRoutes(
  service: UserService,
): Record<string, RouteHandler> {
  return {
    "POST /users": (req: Request): Response => {
      // DEFECT: no validation — raw input passed directly
      const input = req.body as CreateUserInput;
      const user = service.register(input);
      return { status: 201, body: { data: user } };
    },

    "GET /users": (): Response => {
      const users = service.listUsers();
      return { status: 200, body: { data: users } };
    },

    "GET /users/:id": (req: Request): Response => {
      const id = req.params?.id;
      if (!id) {
        return {
          status: 400,
          body: { error: { code: "MISSING_ID", message: "User ID required" } },
        };
      }
      const user = service.getUser(id);
      if (!user) {
        return {
          status: 404,
          body: { error: { code: "NOT_FOUND", message: `User ${id} not found` } },
        };
      }
      return { status: 200, body: { data: user } };
    },

    "PUT /users/:id": (req: Request): Response => {
      const id = req.params?.id;
      if (!id) {
        return {
          status: 400,
          body: { error: { code: "MISSING_ID", message: "User ID required" } },
        };
      }
      // DEFECT: no validation on update input either
      const updates = req.body as Partial<CreateUserInput>;
      const user = service.updateUser(id, updates);
      return { status: 200, body: { data: user } };
    },

    "DELETE /users/:id": (req: Request): Response => {
      const id = req.params?.id;
      if (!id) {
        return {
          status: 400,
          body: { error: { code: "MISSING_ID", message: "User ID required" } },
        };
      }
      const deleted = service.removeUser(id);
      if (!deleted) {
        return {
          status: 404,
          body: { error: { code: "NOT_FOUND", message: `User ${id} not found` } },
        };
      }
      return { status: 204, body: {} };
    },
  };
}
