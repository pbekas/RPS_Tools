import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import {
  getUser,
  setUserModules,
  upsertUser,
} from "@/lib/database";
import { ALL_TOOLSET_IDS, isSupervisor } from "@/lib/permissions";
import { resolveTimeClockAccess } from "@/lib/timeClockAccess";

/** First-time Workspace sign-in: employee account that can punch. */
const DEFAULT_AGENT_MODULES = ["time_clock"];

function allowedDomains(): string[] {
  const multi = (process.env.ALLOWED_EMAIL_DOMAINS || "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  if (multi.length) return multi;
  const single = (process.env.ALLOWED_EMAIL_DOMAIN || "releviumpain.com")
    .trim()
    .toLowerCase();
  return single ? [single] : ["releviumpain.com"];
}

function bootstrapAdminEmails(): Set<string> {
  const raw = (process.env.BOOTSTRAP_ADMIN_EMAILS || "").trim();
  const fromEnv = raw
    ? raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
    : [];
  // Owner + common relevium aliases — ensure Pete has both tool sets.
  const defaults = [
    "pb@octanesolutiongroup.com",
    "pb@releviumpain.com",
    "pete@releviumpain.com",
    "pete.bekas@releviumpain.com",
  ];
  return new Set([...defaults, ...fromEnv]);
}

function emailAllowed(email: string): boolean {
  const domains = allowedDomains();
  return domains.some((d) => email.endsWith(`@${d}`));
}

const domains = allowedDomains();
const primaryDomain = domains[0] || "releviumpain.com";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      authorization: {
        params: {
          // Only lock Google hosted-domain when a single domain is configured.
          ...(domains.length === 1 ? { hd: primaryDomain } : {}),
          prompt: "select_account",
        },
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ user }) {
      const email = (user.email || "").toLowerCase();
      if (!emailAllowed(email)) return false;
      try {
        const existing = await getUser(email);
        if (existing && existing.active === false) return false;
        const bootstrap = bootstrapAdminEmails().has(email);
        if (!existing) {
          await upsertUser({
            email,
            name: user.name || email,
            role: bootstrap ? "Admin" : "Agent",
          });
          await setUserModules(
            email,
            bootstrap ? [...ALL_TOOLSET_IDS] : [...DEFAULT_AGENT_MODULES]
          );
        } else {
          if (user.name && existing.name !== user.name) {
            await upsertUser({
              email,
              name: user.name,
              role: existing.role || "Agent",
            });
          }
          if (bootstrap) {
            const role = (existing.role || "").toLowerCase();
            if (role !== "admin") {
              await upsertUser({
                email,
                name: existing.name || user.name || email,
                role: "Admin",
              });
            }
          } else if (!Array.isArray(existing.modules) || !existing.modules.length) {
            await setUserModules(email, ["call_qa"]);
          }
        }
      } catch {
        // Allow login even if DB briefly fails; role resolves later
      }
      return true;
    },
    async jwt({ token }) {
      const email = (token.email || "").toLowerCase();
      if (email) {
        try {
          const u = await getUser(email);
          token.role = u?.role || "Agent";
          token.name = u?.name || token.name;
          token.modules = Array.isArray(u?.modules) ? u.modules : [];
          const access = await resolveTimeClockAccess({
            email,
            role: token.role as string,
            modules: token.modules as string[],
          });
          token.timeClockManager = access.isManager;
          token.timeClockAdmin = access.isAdmin;
          token.teamManager =
            access.isAdmin ||
            access.isTeamSupervisor ||
            isSupervisor({ role: token.role as string });
        } catch {
          token.role = token.role || "Agent";
          token.modules = token.modules || [];
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = token.email as string;
        session.user.name = (token.name as string) || session.user.name;
        session.user.role = (token.role as string) || "Agent";
        session.user.modules = Array.isArray(token.modules) ? token.modules : [];
        session.user.timeClockManager = Boolean(token.timeClockManager);
        session.user.timeClockAdmin = Boolean(token.timeClockAdmin);
        session.user.teamManager = Boolean(token.teamManager);
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
