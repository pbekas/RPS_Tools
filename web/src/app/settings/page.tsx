import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import {
  discoverUnmappedAgents,
  getCallTopics,
  listUsers,
} from "@/lib/firestore";
import { SettingsShell } from "@/components/SettingsShell";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  if ((session.user.role || "").toLowerCase() !== "admin") redirect("/");

  const [users, unmapped, topicset] = await Promise.all([
    listUsers(),
    discoverUnmappedAgents(),
    getCallTopics(),
  ]);
  const domain = process.env.ALLOWED_EMAIL_DOMAIN || "releviumpain.com";

  return (
    <SettingsShell
      initialUsers={users}
      initialUnmapped={unmapped}
      initialTopicset={topicset}
      domain={domain}
    />
  );
}
