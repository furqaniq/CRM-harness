import { NextResponse } from "next/server";
import {
  SkillError,
  getAppSkillStore,
  type SkillDraft,
  type SkillEntry,
} from "@/core/skills";

function fsErrorCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

function failure(error: unknown): NextResponse {
  if (error instanceof SkillError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  const code = fsErrorCode(error);
  if (code === "EROFS" || code === "EACCES" || code === "EPERM") {
    return NextResponse.json(
      {
        error:
          "The skills folder is read-only on this deployment — editing works on a local checkout until storage lands.",
      },
      { status: 400 },
    );
  }
  return NextResponse.json({ error: "That request could not be completed." }, { status: 500 });
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SkillError(`"${field}" is required.`);
  }
  return value;
}

function parseDraft(value: unknown): SkillDraft {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SkillError("A skill object is required.");
  }
  const record = value as Record<string, unknown>;
  return {
    name: requireString(record.name, "name"),
    description: requireString(record.description, "description"),
    body: typeof record.body === "string" ? record.body : "",
  };
}

export async function GET(): Promise<NextResponse> {
  try {
    const store = getAppSkillStore();
    return NextResponse.json({ skills: await store.list(), dir: store.dirLabel() });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const store = getAppSkillStore();

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }

  try {
    const body = (payload ?? {}) as Record<string, unknown>;
    switch (body.action) {
      case "get": {
        const name = requireString(body.name, "name");
        const skill = await store.get(name);
        if (skill === null) {
          return NextResponse.json({ error: `No skill named "${name}".` }, { status: 404 });
        }
        return NextResponse.json({ skill });
      }
      case "save": {
        const entry: SkillEntry = await store.save(parseDraft(body.skill));
        return NextResponse.json({ entry, skills: await store.list() });
      }
      case "remove": {
        await store.remove(requireString(body.name, "name"));
        return NextResponse.json({ skills: await store.list() });
      }
      case "test": {
        const result = await store.test(requireString(body.name, "name"));
        return NextResponse.json({ result });
      }
      case "import": {
        const result = await store.importText(requireString(body.text, "text"));
        return NextResponse.json({ ...result, skills: await store.list() });
      }
      case "export": {
        return NextResponse.json(await store.exportOne(requireString(body.name, "name")));
      }
      case "exportAll": {
        return NextResponse.json(await store.exportAll());
      }
      default:
        return NextResponse.json(
          {
            error:
              "Unknown action — expected get, save, remove, test, import, export or exportAll.",
          },
          { status: 400 },
        );
    }
  } catch (error) {
    return failure(error);
  }
}
