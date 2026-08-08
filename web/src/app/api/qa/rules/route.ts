import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  getQaRules,
  setQaRuleActive,
  updateQaRulesetMeta,
  upsertQaRule,
} from "@/lib/database";

function requireAdmin(
  session: { user?: { email?: string | null; role?: string } } | null
) {
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if ((session.user.role || "").toLowerCase() !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const denied = requireAdmin(session);
  if (denied) return denied;
  const ruleset = await getQaRules();
  return NextResponse.json({ ruleset });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const denied = requireAdmin(session);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "upsert");

  try {
    if (action === "upsert") {
      const ruleset = await upsertQaRule({
        id: String(body.id || ""),
        label: String(body.label || ""),
        description: body.description ? String(body.description) : "",
        category: body.category ? String(body.category) : "Process",
        weight:
          body.weight !== undefined && body.weight !== ""
            ? Number(body.weight)
            : 1,
        auto_fail: !!body.auto_fail,
        pass_criteria: body.pass_criteria ? String(body.pass_criteria) : "",
        active: body.active !== false,
      });
      return NextResponse.json({ ok: true, ruleset });
    }
    if (action === "set_active") {
      const ruleset = await setQaRuleActive(String(body.id || ""), !!body.active);
      return NextResponse.json({ ok: true, ruleset });
    }
    if (action === "update_meta") {
      const ruleset = await updateQaRulesetMeta({
        name: body.name !== undefined ? String(body.name) : undefined,
        description:
          body.description !== undefined ? String(body.description) : undefined,
        auto_fail_quality_cap:
          body.auto_fail_quality_cap !== undefined
            ? Number(body.auto_fail_quality_cap)
            : undefined,
        empathy_pass_threshold:
          body.empathy_pass_threshold !== undefined
            ? Number(body.empathy_pass_threshold)
            : undefined,
        transfer_soft_limit:
          body.transfer_soft_limit !== undefined
            ? Number(body.transfer_soft_limit)
            : undefined,
        transfer_auto_fail_at:
          body.transfer_auto_fail_at !== undefined
            ? Number(body.transfer_auto_fail_at)
            : undefined,
      });
      return NextResponse.json({ ok: true, ruleset });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Save failed" },
      { status: 400 }
    );
  }
}
