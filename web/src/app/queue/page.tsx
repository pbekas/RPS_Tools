import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { listCalls, listUsers } from "@/lib/database";
import { SampleQueue } from "@/components/SampleQueue";

export default async function QueuePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  if ((session.user.role || "").toLowerCase() !== "admin") redirect("/");

  const [users, calls] = await Promise.all([
    listUsers(),
    listCalls({ status: "complete", limit: 400 }),
  ]);

  const dedup = new Map<string, { email: string; name?: string }>();
  for (const u of users) {
    dedup.set(u.email.toLowerCase(), {
      email: u.email.toLowerCase(),
      name: u.name,
    });
  }
  for (const c of calls) {
    const email = (c.agent_email || "").trim().toLowerCase();
    if (!email) continue;
    const existing = dedup.get(email);
    if (!existing) {
      dedup.set(email, { email, name: c.agent_name });
    } else if (!existing.name && c.agent_name) {
      existing.name = c.agent_name;
    }
  }

  return <SampleQueue agents={[...dedup.values()]} />;
}
