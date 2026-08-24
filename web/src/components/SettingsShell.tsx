"use client";

import { useState } from "react";
import type {
  FlagSet,
  QaRuleset,
  TopicSet,
  UserDoc,
} from "@/lib/database";
import type { ContractGroup } from "@/lib/contractTypes";
import type { AccessGrantCaps } from "@/lib/contractAccess";
import { AgentSettings } from "@/components/AgentSettings";
import { FlagSettings } from "@/components/FlagSettings";
import { RuleSettings } from "@/components/RuleSettings";
import { TopicSettings } from "@/components/TopicSettings";

type Props = {
  initialUsers: UserDoc[];
  initialTopicset: TopicSet;
  initialRuleset: QaRuleset;
  initialFlagset: FlagSet;
  domain: string;
  contractGroups?: ContractGroup[];
  teamsEnabled?: boolean;
  grantCaps?: AccessGrantCaps;
};

export function SettingsShell({
  initialUsers,
  initialTopicset,
  initialRuleset,
  initialFlagset,
  domain,
  contractGroups = [],
  teamsEnabled = false,
  grantCaps,
}: Props) {
  const [tab, setTab] = useState<"agents" | "topics" | "rules" | "flags">(
    "agents"
  );

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
              ["agents", "Users & access"],
              ["topics", "Topics"],
              ["rules", "Audit rules"],
              ["flags", "Critical flags"],
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
          domain={domain}
          contractGroups={contractGroups}
          teamsEnabled={teamsEnabled}
          grantCaps={grantCaps}
          embedded
        />
      ) : (
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
          {tab === "topics" ? (
            <TopicSettings initialTopicset={initialTopicset} />
          ) : tab === "rules" ? (
            <RuleSettings
              initialRuleset={initialRuleset}
              topics={initialTopicset.topics || []}
            />
          ) : (
            <FlagSettings initialFlagset={initialFlagset} />
          )}
        </div>
      )}
    </div>
  );
}
