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
import { listContractGroups } from "@/lib/contractsDb";
import { SettingsShell } from "@/components/SettingsShell";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  if ((session.user.role || "").toLowerCase() !== "admin") redirect("/");

  const [users, unmapped, topicset, ruleset, flagset, groups] = await Promise.all([
    listUsers(),
    discoverUnmappedAgents(),
    getCallTopics(),
    getQaRules(),
    getCallFlags(),
    process.env.DB_BACKEND?.trim().toLowerCase() === "postgres"
      ? listContractGroups().catch(() => [])
      : Promise.resolve([]),
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
      contractGroups={groups}
      teamsEnabled={process.env.DB_BACKEND?.trim().toLowerCase() === "postgres"}
    />
  );
}
