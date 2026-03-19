// AL-2: Centralized error mapping
// [PLANTED DEFECT: scope-mismatch] — evidence will claim middleware.ts was changed

import type { Response, RouteHandler } from "./routes.js";
import { ServiceError } from "../service/index.js";

const STATUS_MAP: Record<string, number> = {
  NOT_FOUND: 404,
  DUPLICATE_EMAIL: 409,
  VALIDATION_FAILED: 400,
  DUPLICATE_ID: 409,
};

export function handleError(error: unknown): Response {
  if (error instanceof ServiceError) {
    const status = STATUS_MAP[error.code] ?? 500;
    return {
      status,
      body: { error: { code: error.code, message: error.message } },
    };
  }

  return {
    status: 500,
    body: { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } },
  };
}

export function wrapHandler(handler: RouteHandler): RouteHandler {
  return (req) => {
    try {
      return handler(req);
    } catch (error) {
      return handleError(error);
    }
  };
}
