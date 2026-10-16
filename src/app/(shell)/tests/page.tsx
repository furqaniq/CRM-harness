import PagePlaceholder from "@/components/shell/PagePlaceholder";

export default function TestLabPage() {
  return (
    <PagePlaceholder
      title="Test Lab"
      description="Workbook rows with deterministic checks and an LLM judge, pass rates per module, a diff against the previous run, and export to xlsx and JSON."
      milestone="M3"
    />
  );
}
