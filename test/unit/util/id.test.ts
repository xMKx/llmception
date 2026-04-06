import { describe, it, expect } from "vitest";
import { generateId, shortId, slugify } from "../../../src/util/id.js";

describe("generateId", () => {
  it("should return a valid UUID v4 string", () => {
    const id = generateId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("should return unique IDs on each call", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateId()));
    expect(ids.size).toBe(50);
  });
});

describe("shortId", () => {
  it("should return the first 8 characters", () => {
    expect(shortId("abcdef01-2345-6789")).toBe("abcdef01");
  });

  it("should return the full string if shorter than 8 chars", () => {
    expect(shortId("abc")).toBe("abc");
  });

  it("should handle empty string", () => {
    expect(shortId("")).toBe("");
  });
});

describe("slugify", () => {
  it("should lowercase the text", () => {
    expect(slugify("Hello")).toBe("hello");
  });

  it("should replace spaces with hyphens", () => {
    expect(slugify("hello world")).toBe("hello-world");
  });

  it("should replace special characters with hyphens", () => {
    expect(slugify("hello@world!")).toBe("hello-world");
  });

  it("should collapse multiple hyphens", () => {
    expect(slugify("hello   world")).toBe("hello-world");
  });

  it("should strip leading and trailing hyphens", () => {
    expect(slugify("  hello  ")).toBe("hello");
  });

  it("should truncate to 30 characters", () => {
    const long = "a very long string that exceeds thirty characters by quite a lot";
    expect(slugify(long).length).toBeLessThanOrEqual(30);
  });

  it("should handle empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("should handle mixed case and special chars", () => {
    expect(slugify("My Cool Project (v2.1)")).toBe("my-cool-project-v2-1");
  });
});
