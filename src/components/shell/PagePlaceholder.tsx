interface PagePlaceholderProps {
  title: string;
  description: string;
  milestone: string;
}

export default function PagePlaceholder({
  title,
  description,
  milestone,
}: PagePlaceholderProps) {
  return (
    <div className="h-full overflow-y-auto px-5 py-6">
      <h1 className="text-[22px] font-semibold text-tx">{title}</h1>
      <p className="mt-1 max-w-[78ch] text-dim">{description}</p>
      <p className="note mt-4 text-[13px]">
        Not built yet — arrives in {milestone}.
      </p>
    </div>
  );
}
