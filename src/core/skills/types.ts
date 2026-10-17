/** One skill as stored on disk: frontmatter plus body (spec §6). */
export interface SkillFile {
  name: string;
  description: string;
  body: string;
  errors: string[];
  warnings: string[];
}

/** A skill row in the list view. Invalid files are shown too, with their errors. */
export interface SkillEntry {
  name: string;
  description: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  chars: number;
  lines: number;
}

/** What the editor saves. The name is also the folder name. */
export interface SkillDraft {
  name: string;
  description: string;
  body: string;
}

/** Result of the UI's Test action: validation plus what would be injected. */
export interface SkillTestResult {
  name: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  chars: number;
  lines: number;
  approxTokens: number;
  preview: string;
}

export interface SkillImportResult {
  added: string[];
  updated: string[];
}

export interface SkillExport {
  fileName: string;
  text: string;
}
