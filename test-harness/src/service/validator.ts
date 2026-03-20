// SL-2: Input validation logic
// [PLANTED DEFECT: test-gap] — no direct test file exists for this module

import type { CreateUserInput } from "../data/index.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MAX_LENGTH = 100;

export function validateEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

export function validateName(name: string): boolean {
  return name.length >= 1 && name.length <= NAME_MAX_LENGTH;
}

export function validateCreateInput(input: CreateUserInput): ValidationResult {
  const errors: string[] = [];

  if (!validateName(input.name)) {
    errors.push(
      input.name.length === 0
        ? "Name is required"
        : `Name must be ${NAME_MAX_LENGTH} characters or less`,
    );
  }

  if (!validateEmail(input.email)) {
    errors.push("Invalid email format");
  }

  return { valid: errors.length === 0, errors };
}
