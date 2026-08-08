import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import {
  discoverUnmappedAgents,
  getCallFlags,
  getCallTopics,
  getQaRules,
  listUsers,
} from "@/lib/database";
import { SettingsShell } from "@/components/SettingsShell";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  if ((session.user.role || "").toLowerCase() !== "admin") redirect("/");

  const [users, unmapped, topicset, ruleset, flagset] = await Promise.all([
    listUsers(),
    discoverUnmappedAgents(),
    getCallTopics(),
    getQaRules(),
    getCallFlags(),
  ]);
  const domain = process.env.ALLOWED_EMAIL_DOMAIN || "releviumpain.com";

  return (
    <SettingsShell
      initialUsers={users}
      initialUnmapped={unmapped}
      initialTopicset={topicset}
      initialRuleset={ruleset}
      initialFlagset={flagset}
      domain={domain}
    />
  );
}
