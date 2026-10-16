import PromptBox from "@/components/chat/PromptBox";

export default function ChatPage() {
  return (
    <div className="flex h-full flex-col gap-3 px-4 pb-3.5 pt-3">
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-o5 text-lg font-extrabold text-[#1a1205]">
            M
          </div>
          <p className="text-[15px] text-tx">Maple is ready.</p>
          <p className="mt-1 text-[13.5px] text-dim">
            Ask about a pipeline, contact or campaign. Type / for skills and @
            for an agent.
          </p>
        </div>
      </div>

      <PromptBox />
    </div>
  );
}
