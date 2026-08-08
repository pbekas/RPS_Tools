"use client";

import { useState } from "react";
import type { FlagSet, QaRuleset, TopicSet } from "@/lib/database";
import { FlagSettings } from "@/components/FlagSettings";
import { RuleSettings } from "@/components/RuleSettings";
import { TopicSettings } from "@/components/TopicSettings";

type Props = {
  initialTopicset: TopicSet;
  initialRuleset: QaRuleset;
  initialFlagset: FlagSet;
};

export function SettingsShell({
  initialTopicset,
  initialRuleset,
  initialFlagset,
}: Props) {
  const [tab, setTab] = useState<"topics" | "rules" | "flags">("topics");

  return (
    <div>
      <div className="mx-auto max-w-5xl px-4 pt-8 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
          Call QA
        </p>
        <h1 className="mt-1 font-display text-4xl text-ink">Settings</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-soft">
          Topics, audit rules, and critical flags for call scoring. Team accounts
          live under Users.
        </p>
        <div className="mt-6 flex flex-wrap gap-2 border-b border-line pb-0">
          {(
            [
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

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {tab === "topics" ? (
          <TopicSettings initialTopicset={initialTopicset} />
        ) : tab === "rules" ? (
          <RuleSettings initialRuleset={initialRuleset} />
        ) : (
          <FlagSettings initialFlagset={initialFlagset} />
        )}
      </div>
    </div>
  );
}
