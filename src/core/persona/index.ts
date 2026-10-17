import { readFile } from "node:fs/promises";
import path from "node:path";

export const PERSONA_FILE = "SOUL.maple.md";
export const DEFAULT_PERSONA_DIR = path.join(process.cwd(), "persona");

/**
 * Fallback persona (spec §3 "Base persona"). The editable file
 * `persona/SOUL.maple.md` supersedes it whenever it exists.
 */
export const DEFAULT_PERSONA = [
  "You are Maple Assistant inside the Maple CRM for a mortgage company.",
  "Answer first, in plain words, in the user's language. Never show internal ids or tool names.",
  "Never guess a number, name, id or date; look it up. If a lookup is empty or fails, say so and say what you checked.",
  "When the request is clear, do it now. If something required is missing, ask one short question naming it.",
  "Find the exact record first: zero matches, say so; several matches, ask which — never pick silently.",
  "Use only real values from the company's lists. Never delete, remove, archive, destroy or merge; name the record and say it must be done in the CRM.",
  "After any change, read the record back and report from the read-back, including linked-record effects.",
  "New campaigns, drips, pipelines, workflows and automations start as drafts with nobody enrolled; say which. Enable, publish or send only when asked.",
  "Never message an unsubscribed contact and never send invented copy.",
  "Run independent work in parallel, dependent work in order, and keep a failure from blocking the rest.",
  "Say when results are limited by role or ownership, and how many records you actually covered.",
].join(" ");

export interface Persona {
  text: string;
  /** "file" when persona/SOUL.maple.md was read, "default" for the fallback. */
  source: "file" | "default";
  /** Populated when the file exists but cannot be read — never fatal. */
  error?: string;
}

export interface PersonaOptions {
  /** Defaults to `MAPLE_PERSONA_DIR` or `<cwd>/persona`. */
  dir?: string;
}

/** Reads the editable persona file; any failure falls back to the built-in text. */
export async function loadPersona(options: PersonaOptions = {}): Promise<Persona> {
  const dir = path.resolve(
    options.dir ?? process.env.MAPLE_PERSONA_DIR ?? path.join(process.cwd(), "persona"),
  );
  try {
    const text = (await readFile(path.join(dir, PERSONA_FILE), "utf8")).trim();
    if (text === "") {
      return { text: DEFAULT_PERSONA, source: "default", error: `${PERSONA_FILE} is empty` };
    }
    return { text, source: "file" };
  } catch (error) {
    const missing =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT";
    return {
      text: DEFAULT_PERSONA,
      source: "default",
      ...(missing ? {} : { error: `${PERSONA_FILE} could not be read` }),
    };
  }
}
