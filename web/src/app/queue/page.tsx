import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { listUsers } from "@/lib/database";
import { isMappedAgentUser } from "@/lib/qa";
import { SampleQueue } from "@/components/SampleQueue";

export default async function QueuePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  if ((session.user.role || "").toLowerCase() !== "admin") redirect("/");

  const users = await listUsers();
  const agents = users.filter(isMappedAgentUser).map((u) => ({
    email: u.email.toLowerCase(),
    name: u.name,
  }));

  return <SampleQueue agents={agents} />;
}
