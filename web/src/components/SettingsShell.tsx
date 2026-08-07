"use client";

import { useState } from "react";
import type { TopicSet, UnmappedAgentRow, UserDoc } from "@/lib/firestore";
import { AgentSettings } from "@/components/AgentSettings";
import { TopicSettings } from "@/components/TopicSettings";

type Props = {
  initialUsers: UserDoc[];
  initialUnmapped: UnmappedAgentRow[];
  initialTopicset: TopicSet;
  domain: string;
};

export function SettingsShell({
  initialUsers,
  initialUnmapped,
  initialTopicset,
  domain,
}: Props) {
  const [tab, setTab] = useState<"agents" | "topics">("agents");

  return (
    <div>
      <div className="mx-auto max-w-5xl px-4 pt-8 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
          Settings
        </p>
        <h1 className="mt-1 font-display text-4xl text-ink">Workspace setup</h1>
        <div className="mt-6 flex gap-2 border-b border-line pb-0">
          <button
            type="button"
            onClick={() => setTab("agents")}
            className={`rounded-t-lg px-4 py-2 text-sm font-semibold ${
              tab === "agents"
                ? "bg-white text-accent ring-1 ring-line ring-b-white"
                : "text-ink-soft hover:text-ink"
            }`}
          >
            Agents
          </button>
          <button
            type="button"
            onClick={() => setTab("topics")}
            className={`rounded-t-lg px-4 py-2 text-sm font-semibold ${
              tab === "topics"
                ? "bg-white text-accent ring-1 ring-line ring-b-white"
                : "text-ink-soft hover:text-ink"
            }`}
          >
            Topics
          </button>
        </div>
      </div>

      {tab === "agents" ? (
        <AgentSettings
          initialUsers={initialUsers}
          initialUnmapped={initialUnmapped}
          domain={domain}
          embedded
        />
      ) : (
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
          <TopicSettings initialTopicset={initialTopicset} />
        </div>
      )}
    </div>
  );
}
