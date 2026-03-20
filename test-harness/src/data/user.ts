// DL-1: User entity type and factory

import { randomUUID } from "node:crypto";

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateUserInput = Omit<User, "id" | "createdAt" | "updatedAt">;

export function createUser(input: CreateUserInput): User {
  const now = new Date();
  return {
    id: randomUUID(),
    name: input.name,
    email: input.email,
    createdAt: now,
    updatedAt: now,
  };
}
