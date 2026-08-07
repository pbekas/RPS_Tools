"use client";

import { useState } from "react";
import type {
  QaRuleset,
  TopicSet,
  UnmappedAgentRow,
  UserDoc,
} from "@/lib/firestore";
import { AgentSettings } from "@/components/AgentSettings";
import { RuleSettings } from "@/components/RuleSettings";
import { TopicSettings } from "@/components/TopicSettings";

type Props = {
  initialUsers: UserDoc[];
  initialUnmapped: UnmappedAgentRow[];
  initialTopicset: TopicSet;
  initialRuleset: QaRuleset;
  domain: string;
};

export function SettingsShell({
  initialUsers,
  initialUnmapped,
  initialTopicset,
  initialRuleset,
  domain,
}: Props) {
  const [tab, setTab] = useState<"agents" | "topics" | "rules">("agents");

  return (
    <div>
      <div className="mx-auto max-w-5xl px-4 pt-8 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
          Settings
        </p>
        <h1 className="mt-1 font-display text-4xl text-ink">Workspace setup</h1>
        <div className="mt-6 flex flex-wrap gap-2 border-b border-line pb-0">
          {(
            [
              ["agents", "Agents"],
              ["topics", "Topics"],
              ["rules", "Audit rules"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-t-lg px-4 py-2 text-sm font-semibold ${
                tab === id
                  ? "bg-white text-accent ring-1 ring-line ring-b-white"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
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
          {tab === "topics" ? (
            <TopicSettings initialTopicset={initialTopicset} />
          ) : (
            <RuleSettings initialRuleset={initialRuleset} />
          )}
        </div>
      )}
    </div>
  );
}
