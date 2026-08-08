import { requireModule } from "@/lib/requireAccess";
import { discoverUnmappedAgents, listUsers } from "@/lib/database";
import { AgentSettings } from "@/components/AgentSettings";

export default async function UsersPage() {
  await requireModule("users");

  const [users, unmapped] = await Promise.all([
    listUsers(),
    discoverUnmappedAgents(),
  ]);
  const domain = process.env.ALLOWED_EMAIL_DOMAIN || "releviumpain.com";

  return (
    <div>
      <div className="mx-auto max-w-5xl px-4 pt-8 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
          Directory
        </p>
        <h1 className="mt-1 font-display text-4xl text-ink">Users</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-soft">
          Team accounts, roles, and Vonage extension mapping. Module access can
          grow beyond Call QA as we add more tools.
        </p>
      </div>
      <AgentSettings
        initialUsers={users}
        initialUnmapped={unmapped}
        domain={domain}
        embedded
      />
    </div>
  );
}
