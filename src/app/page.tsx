import { COLORS, LAYOUT } from "@/design/tokens";

const SWATCHES: {
  name: keyof typeof COLORS;
  label: string;
  className: string;
  dark?: boolean;
}[] = [
  { name: "bg", label: "bg", className: "bg-bg" },
  { name: "s1", label: "surface", className: "bg-s1" },
  { name: "s3", label: "CRM rail", className: "bg-s3" },
  { name: "s4", label: "hover", className: "bg-s4" },
  { name: "o5", label: "CRM orange", className: "bg-o5", dark: true },
  { name: "o3", label: "CRM light", className: "bg-o3", dark: true },
  { name: "y4", label: "ring yellow", className: "bg-y4", dark: true },
  { name: "tx", label: "text", className: "bg-tx", dark: true },
];

const MEASUREMENTS = [
  { label: "Icon rail", value: `${LAYOUT.rail}px` },
  { label: "Collapsible panel", value: `${LAYOUT.panel}px` },
  { label: "Artifact threshold", value: "20 KB" },
  { label: "Compaction trigger", value: "75% of window" },
  { label: "Subagent depth", value: "2" },
  { label: "Max parallel subagents", value: "6" },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-12">
      <h1 className="text-[34px] leading-tight font-bold">Maple Harness</h1>
      <p className="mt-1 text-dim">
        Agent harness for the Maple mortgage CRM. Scaffold is up; milestones
        follow <code>plan.md</code>.
      </p>

      <h2 className="mt-12 border-t border-bd pt-6 text-[22px] font-semibold">
        Design tokens
      </h2>
      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(118px,1fr))] gap-2">
        {SWATCHES.map((s) => (
          <div
            key={s.name}
            className={`${s.className} rounded-[10px] border border-bd px-2.5 pb-2 pt-8 text-[11.5px] ${
              s.dark ? "text-bg" : "text-tx"
            }`}
          >
            {s.label} <code className="text-inherit opacity-80">{COLORS[s.name]}</code>
          </div>
        ))}
      </div>

      <h2 className="mt-12 border-t border-bd pt-6 text-[22px] font-semibold">
        Prompt box
      </h2>
      <div className="prompt-ring mt-3">
        <div className="rounded-2xl bg-s2 px-3.5 py-3">
          <div className="min-h-11 text-faint">
            Ask Maple, or type / for skills and @ for an agent
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="pill">Attach</span>
            <span className="pill">@ agent</span>
            <span className="pill">/ skill</span>
            <span className="flex-1" />
            <span className="pill">Worker model</span>
            <span className="pill">Auto</span>
            <span className="send">↑</span>
          </div>
        </div>
      </div>

      <h2 className="mt-12 border-t border-bd pt-6 text-[22px] font-semibold">
        Tunable defaults
      </h2>
      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-3">
        {MEASUREMENTS.map((m) => (
          <div key={m.label} className="rounded-[14px] border border-bd bg-s2 p-3.5">
            <div className="text-2xl font-bold">{m.value}</div>
            <small className="text-dim">{m.label}</small>
          </div>
        ))}
      </div>
    </main>
  );
}
