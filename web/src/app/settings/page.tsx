import { redirect } from "next/navigation";
import { requireModule } from "@/lib/requireAccess";
import { isAdminRole } from "@/lib/permissions";
import { getCallFlags, getCallTopics, getQaRules } from "@/lib/database";
import { SettingsShell } from "@/components/SettingsShell";

export default async function SettingsPage() {
  const session = await requireModule("call_qa");
  if (!isAdminRole(session.user.role)) redirect("/");

  const [topicset, ruleset, flagset] = await Promise.all([
    getCallTopics(),
    getQaRules(),
    getCallFlags(),
  ]);

  return (
    <SettingsShell
      initialTopicset={topicset}
      initialRuleset={ruleset}
      initialFlagset={flagset}
    />
  );
}
