import { v4 as uuidv4 } from "uuid";

/** Generate a UUID v4 identifier. */
export function generateId(): string {
  return uuidv4();
}

/** Return the first 8 characters of an ID. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** Convert text to a URL-friendly slug (lowercase, max 30 chars). */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}
