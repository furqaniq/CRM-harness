"use client";

import { useCallback, useEffect, useState } from "react";
import type { SkillDraft, SkillEntry, SkillTestResult } from "@/core/skills";

interface ApiResponse {
  error?: string;
  skills?: SkillEntry[];
  dir?: string;
  entry?: SkillEntry;
  skill?: SkillDraft & { errors: string[]; warnings: string[] };
  result?: SkillTestResult;
  added?: string[];
  updated?: string[];
  fileName?: string;
  text?: string;
}

const EMPTY_DRAFT: SkillDraft = { name: "", description: "", body: "" };

async function callApi(payload: unknown): Promise<ApiResponse> {
  const response = await fetch("/api/skills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await response.json().catch(() => ({}))) as ApiResponse;
  if (!response.ok) throw new Error(data.error ?? "That request could not be completed.");
  return data;
}

function download(fileName: string, text: string) {
  const type = fileName.endsWith(".json") ? "application/json" : "text/markdown";
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function SkillsWorkspace() {
  const [skills, setSkills] = useState<SkillEntry[] | null>(null);
  const [dir, setDir] = useState("skills/");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [draft, setDraft] = useState<SkillDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [testResult, setTestResult] = useState<SkillTestResult | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");

  const load = useCallback(() => {
    fetch("/api/skills", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load the skills folder.");
        return response.json() as Promise<{ skills: SkillEntry[]; dir: string }>;
      })
      .then((data) => {
        setSkills(data.skills);
        setDir(data.dir);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : "Could not load the skills folder.");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run(label: string, payload: unknown, onSuccess?: (data: ApiResponse) => void) {
    setBusy(label);
    setNotice(null);
    try {
      const data = await callApi(payload);
      if (data.skills) setSkills(data.skills);
      onSuccess?.(data);
    } catch (error) {
      setNotice({ tone: "bad", text: error instanceof Error ? error.message : "That request failed." });
    } finally {
      setBusy(null);
    }
  }

  function select(skill: SkillEntry) {
    setSelected(skill.name);
    setIsNew(false);
    setTestResult(null);
    setNotice(null);
    void run(`select:${skill.name}`, { action: "get", name: skill.name }, (data) => {
      if (!data.skill) return;
      setDraft({
        name: data.skill.name,
        description: data.skill.description,
        body: data.skill.body,
      });
    });
  }

  function startNew() {
    setSelected(null);
    setIsNew(true);
    setDraft(EMPTY_DRAFT);
    setTestResult(null);
    setNotice(null);
  }

  async function save() {
    setBusy("save");
    setNotice(null);
    try {
      const data = await callApi({ action: "save", skill: draft });
      if (data.skills) setSkills(data.skills);
      setSelected(draft.name);
      setIsNew(false);
      setTestResult(null);
      setNotice({ tone: "ok", text: `Saved "${draft.name}".` });
    } catch (error) {
      setNotice({ tone: "bad", text: error instanceof Error ? error.message : "That skill could not be saved." });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    if (selected === null) return;
    setBusy("test");
    setNotice(null);
    try {
      const data = await callApi({ action: "test", name: selected });
      if (data.result) setTestResult(data.result);
    } catch (error) {
      setNotice({ tone: "bad", text: error instanceof Error ? error.message : "That skill could not be tested." });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (selected === null) return;
    if (!window.confirm(`Delete the skill "${selected}"? Its folder and SKILL.md are removed.`)) return;
    await run("remove", { action: "remove", name: selected }, () => {
      setSelected(null);
      setIsNew(false);
      setDraft(EMPTY_DRAFT);
      setTestResult(null);
      setNotice({ tone: "ok", text: "Skill deleted." });
    });
  }

  async function exportOne() {
    if (selected === null) return;
    await run(`export:${selected}`, { action: "export", name: selected }, (data) => {
      if (data.fileName && data.text !== undefined) {
        download(data.fileName, data.text);
        setNotice({ tone: "ok", text: `Exported ${data.fileName}.` });
      }
    });
  }

  async function exportAll() {
    await run("exportAll", { action: "exportAll" }, (data) => {
      if (data.fileName && data.text !== undefined) {
        download(data.fileName, data.text);
        setNotice({ tone: "ok", text: `Exported ${data.fileName}.` });
      }
    });
  }

  function submitImport() {
    void run("import", { action: "import", text: importText }, (data) => {
      const added = data.added ?? [];
      const updated = data.updated ?? [];
      const parts = [
        added.length > 0 ? `added ${added.join(", ")}` : "",
        updated.length > 0 ? `updated ${updated.join(", ")}` : "",
      ].filter(Boolean);
      setImportText("");
      setImportOpen(false);
      setNotice({ tone: "ok", text: `Import finished — ${parts.join("; ") || "nothing changed"}.` });
    });
  }

  if (loadError) {
    return (
      <div className="h-full overflow-y-auto px-5 py-6">
        <p className="note text-[13px] text-bad">{loadError}</p>
      </div>
    );
  }

  if (!skills) {
    return (
      <div className="h-full overflow-y-auto px-5 py-6">
        <p className="text-[13.5px] text-dim">Loading skills…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-4 px-5 pt-6">
        <div>
          <h1 className="text-[22px] font-semibold text-tx">Skills</h1>
          <p className="mt-1 max-w-[78ch] text-[13.5px] text-dim">
            One folder per skill in <span className="font-mono text-tx">{dir}</span>. Only names and
            descriptions sit in the prompt; bodies load on demand through <span className="font-mono text-tx">read_skill</span>.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            className="pill"
            onClick={() => {
              setImportOpen(!importOpen);
              setNotice(null);
            }}
          >
            Import
          </button>
          <button type="button" className="pill" onClick={() => void exportAll()} disabled={busy !== null}>
            Export all
          </button>
          <button type="button" className="pill border-o5/60 text-o5" onClick={startNew}>
            New skill
          </button>
        </div>
      </div>

      {notice && (
        <div className="mx-5 mt-4">
          <p className={`note text-[13px] ${notice.tone === "ok" ? "text-ok" : "text-bad"}`} role="status">
            {notice.text}
          </p>
        </div>
      )}

      {importOpen && (
        <div className="mx-5 mt-4 rounded-xl border border-bd bg-s2 p-4">
          <label className="block text-[13px] text-dim" htmlFor="skill-import">
            Paste a SKILL.md file or a JSON bundle
          </label>
          <textarea
            id="skill-import"
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            rows={8}
            spellCheck={false}
            placeholder={'---\nname: never-delete\ndescription: Refuse destructive requests plainly.\n---\n\nBody…'}
            className="mt-2 w-full rounded-lg border border-bd bg-s1 p-3 font-mono text-[12.5px] text-tx placeholder:text-faint"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="pill border-o5/60 text-o5 disabled:opacity-50"
              disabled={busy === "import" || importText.trim() === ""}
              onClick={submitImport}
            >
              {busy === "import" ? "Importing…" : "Import"}
            </button>
            <button type="button" className="pill" onClick={() => setImportOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mt-5 grid min-h-0 flex-1 gap-4 overflow-hidden px-5 pb-8 md:grid-cols-[280px_1fr]">
        <div className="min-h-0 overflow-y-auto">
          {skills.length === 0 ? (
            <p className="text-[13.5px] text-dim">
              No skills yet. Create one here or import a SKILL.md — each skill is a folder with a
              frontmatter name and description plus the body the model loads when it needs it.
            </p>
          ) : (
            <ul className="grid gap-2">
              {skills.map((skill) => (
                <li key={skill.name}>
                  <button
                    type="button"
                    className={`w-full rounded-lg border px-3 py-2 text-left ${
                      selected === skill.name ? "border-o5/60 bg-s2" : "border-bd bg-s1"
                    }`}
                    onClick={() => select(skill)}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${skill.valid ? "bg-ok" : "bg-bad"}`}
                        aria-hidden
                      />
                      <span className="font-mono text-[13px] text-tx">{skill.name}</span>
                      <span className="ml-auto text-[11px] text-faint">{skill.chars} ch</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-dim">
                      {skill.description || skill.errors[0] || "—"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto">
          {selected === null && !isNew ? (
            <p className="text-[13.5px] text-dim">Pick a skill to edit, or create a new one.</p>
          ) : (
            <div className="grid gap-3 rounded-xl border border-bd bg-s2 p-4">
              <div className="grid gap-1">
                <label className="text-[12.5px] text-dim" htmlFor="skill-name">
                  Name (folder)
                </label>
                <input
                  id="skill-name"
                  value={draft.name}
                  disabled={!isNew}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="entity-resolution"
                  spellCheck={false}
                  className="rounded-lg border border-bd bg-s1 px-3 py-2 font-mono text-[13px] text-tx placeholder:text-faint disabled:opacity-70"
                />
                {!isNew && (
                  <p className="text-[11.5px] text-faint">
                    Renaming means creating a new folder — make the new skill first, then delete this one.
                  </p>
                )}
              </div>

              <div className="grid gap-1">
                <label className="text-[12.5px] text-dim" htmlFor="skill-description">
                  Description (goes into the prompt)
                </label>
                <input
                  id="skill-description"
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  placeholder="Search before write; ask when several records match."
                  className="rounded-lg border border-bd bg-s1 px-3 py-2 text-[13px] text-tx placeholder:text-faint"
                />
              </div>

              <div className="grid gap-1">
                <label className="text-[12.5px] text-dim" htmlFor="skill-body">
                  Body (loaded on demand)
                </label>
                <textarea
                  id="skill-body"
                  value={draft.body}
                  onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                  rows={16}
                  spellCheck={false}
                  className="rounded-lg border border-bd bg-s1 p-3 font-mono text-[12.5px] text-tx placeholder:text-faint"
                  placeholder={"# Entity resolution\n\n- Search before any write…"}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="pill border-o5/60 text-o5 disabled:opacity-50"
                  disabled={busy !== null || draft.name.trim() === "" || draft.description.trim() === ""}
                  onClick={() => void save()}
                >
                  {busy === "save" ? "Saving…" : isNew ? "Create skill" : "Save"}
                </button>
                <button
                  type="button"
                  className="pill disabled:opacity-50"
                  disabled={busy !== null || selected === null}
                  onClick={() => void test()}
                >
                  {busy === "test" ? "Testing…" : "Test"}
                </button>
                <button
                  type="button"
                  className="pill disabled:opacity-50"
                  disabled={busy !== null || selected === null}
                  onClick={() => void exportOne()}
                >
                  Export
                </button>
                <button
                  type="button"
                  className="pill text-bad disabled:opacity-50"
                  disabled={busy !== null || selected === null}
                  onClick={() => void remove()}
                >
                  Delete
                </button>
              </div>

              {testResult && (
                <div className="rounded-lg border border-bd bg-s1 p-3">
                  <p className={`text-[13px] ${testResult.valid ? "text-ok" : "text-bad"}`}>
                    {testResult.valid ? "Valid skill" : "This skill is not usable yet"}
                  </p>
                  <p className="mt-1 text-[12.5px] text-dim">
                    {testResult.chars} characters · {testResult.lines} lines · about{" "}
                    {testResult.approxTokens} tokens when loaded
                  </p>
                  {testResult.errors.map((error) => (
                    <p key={error} className="mt-1 text-[12.5px] text-bad">
                      {error}
                    </p>
                  ))}
                  {testResult.warnings.map((warning) => (
                    <p key={warning} className="mt-1 text-[12.5px] text-y4">
                      {warning}
                    </p>
                  ))}
                  {testResult.preview && (
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[12px] text-dim">
                      {testResult.preview}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
