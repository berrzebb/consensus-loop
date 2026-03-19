// SL-2: Direct tests for src/service/validator.ts

import { describe, it, expect } from "vitest";
import {
  validateEmail,
  validateName,
  validateCreateInput,
} from "../../src/service/index.js";

describe("validateEmail", () => {
  it("accepts valid email formats", () => {
    expect(validateEmail("user@example.com")).toBe(true);
    expect(validateEmail("user.name+tag@sub.domain.org")).toBe(true);
    expect(validateEmail("a@b.co")).toBe(true);
  });

  it("rejects missing @", () => {
    expect(validateEmail("userexample.com")).toBe(false);
  });

  it("rejects no domain", () => {
    expect(validateEmail("user@")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(validateEmail("")).toBe(false);
  });
});

describe("validateName", () => {
  it("accepts name of length 1", () => {
    expect(validateName("A")).toBe(true);
  });

  it("accepts name of length 100", () => {
    expect(validateName("A".repeat(100))).toBe(true);
  });

  it("rejects empty name", () => {
    expect(validateName("")).toBe(false);
  });

  it("rejects name over 100 chars", () => {
    expect(validateName("A".repeat(101))).toBe(false);
  });
});

describe("validateCreateInput", () => {
  it("returns valid for good input", () => {
    const result = validateCreateInput({
      name: "Alice",
      email: "alice@example.com",
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("collects all errors for bad input", () => {
    const result = validateCreateInput({
      name: "",
      email: "not-an-email",
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors).toContain("Name is required");
    expect(result.errors).toContain("Invalid email format");
  });
});
