import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  getUser,
  listCallLogs,
  listCalls,
  listFeedbackForAgent,
  listUsers,
  setRollingFeedback,
  type UserDoc,
} from "@/lib/database";
import {
  coachingReasonsForRow,
  formatCoachingSignals,
  topFailedRulesForCalls,
} from "@/lib/coachingQueue";
import { criticalFlagLabels, failedRuleLabels } from "@/lib/format";
import { buildAgentScorecard, filterCallsSince } from "@/lib/scorecard";

function bedrockClient() {
  return new BedrockRuntimeClient({
    region: process.env.AWS_REGION || "us-east-1",
  });
}

const COACHING_WINDOW_DAYS = 14;

export async function generateCoachingForAgent(agentEmail: string): Promise<{
  user: UserDoc;
  report: string;
}> {
  const email = agentEmail.trim().toLowerCase();
  const user = await getUser(email);
  if (!user) throw new Error(`User not found: ${email}`);

  const sinceMs = Date.now() - COACHING_WINDOW_DAYS * 86_400_000;

  const [agentCalls, windowCallsRaw, logs, users] = await Promise.all([
    listCalls({
      agentEmail: email,
      status: "complete",
      limit: 100,
      requireMinDuration: true,
    }),
    listCalls({ status: "complete", limit: 800, sinceMs }),
    listCallLogs({ limit: 2000, days: COACHING_WINDOW_DAYS }),
    listUsers(),
  ]);

  const windowCalls = filterCallsSince(windowCallsRaw, sinceMs);
  const scorecard = buildAgentScorecard({
    logs,
    calls: windowCalls,
    users,
  });
  const row = scorecard.rows.find((r) => r.email === email) || null;

  const recentAgentCalls = agentCalls.filter((c) => {
    const t = c.call_date ? Date.parse(String(c.call_date)) : 0;
    return !t || t >= sinceMs;
  });
  const promptCalls = recentAgentCalls.length ? recentAgentCalls : agentCalls;

  if (!promptCalls.length && (!row || row.cdrCalls === 0)) {
    const report = "No completed calls in the recent window to coach on.";
    const updated = await setRollingFeedback(email, report);
    return { user: updated, report };
  }

  const topFailedRules = topFailedRulesForCalls(promptCalls, 5);
  const missRate = row?.cdrCalls
    ? row.missedBucket / row.cdrCalls
    : 0;
  const reasons = row
    ? coachingReasonsForRow(row, topFailedRules)
    : ["Limited scorecard mapping — coach from QA notes only"];

  const signals = formatCoachingSignals({
    tier: row?.tier || "solid",
    answerRate: row?.answerRate ?? 0,
    missRate,
    cdrCalls: row?.cdrCalls ?? 0,
    qaCalls: row?.qaCalls ?? promptCalls.length,
    avgQuality: row?.avgQuality ?? null,
    avgEmpathy: row?.avgEmpathy ?? null,
    fcrRate: row?.fcrRate ?? null,
    criticalFlags: row?.criticalFlags ?? 0,
    reasons,
    topFailedRules,
  });

  const talk = promptCalls.reduce(
    (s, c) => s + Number(c.duration_seconds || 0),
    0
  );
  const empathyVals = promptCalls
    .map((c) => c.ai_empathy_score)
    .filter((n): n is number => typeof n === "number");
  const avgEmpathy = empathyVals.length
    ? empathyVals.reduce((a, b) => a + b, 0) / empathyVals.length
    : null;

  const callSnippets = promptCalls.slice(0, 12).map((c) => {
    const fails = failedRuleLabels(c);
    const flags = criticalFlagLabels(c);
    const bits = [
      c.ai_summary?.trim() || "(no summary)",
      typeof c.quality_score === "number" ? `Q=${c.quality_score}` : null,
      typeof c.ai_empathy_score === "number"
        ? `E=${c.ai_empathy_score}`
        : null,
      fails.length ? `failed: ${fails.join(", ")}` : null,
      flags.length ? `flags: ${flags.join(", ")}` : null,
    ].filter(Boolean);
    return `- ${bits.join(" · ")}`;
  });

  const managerNotes = promptCalls
    .map((c) => String(c.manager_feedback || "").trim())
    .filter(Boolean);
  const feedbackRows = await listFeedbackForAgent(email, 50);
  for (const fb of feedbackRows) {
    if (fb.text?.trim()) managerNotes.push(fb.text.trim());
  }

  const feedbackBlock =
    managerNotes.map((n) => `- ${n}`).join("\n") || "(none)";
  const summaryBlock = callSnippets.join("\n") || "(none)";
  const agentName = user.name || email;
  const tier = row?.tier || "solid";
  const isRockStar = tier === "rock_star";
  const isCoach = tier === "coach";

  const structure = isRockStar
    ? `Write a concise "Recognition & stretch" coaching report with:
1) Keep doing — two specific strengths grounded in the ops/QA signals
2) Stretch next — one advanced habit to raise the bar further
3) One short practice tip for the next week

Tone: affirming, specific, still actionable. Do not invent problems.`
    : isCoach
      ? `Write a concise "Coaching Report" with:
1) Keep doing — one real strength (even if small)
2) Fix next — two specific, prioritized fixes tied to miss rate, quality/empathy, flags, or failed rules above
3) One short practice tip for the next week

Tone: direct, kind, actionable. Lead with the highest-impact fix.`
      : `Write a concise "Coaching Report" with:
1) Keep doing — two specific strengths
2) Fix next — two specific areas for improvement
3) One short practice tip for the next week

Tone: direct, kind, actionable. No fluff.`;

  const prompt = `You are a phone-skills coach for Relevium Pain Specialists (medical office).

Agent: ${agentName}
Window: last ${COACHING_WINDOW_DAYS} days
QA calls in prompt: ${promptCalls.length}
Average empathy (QA sample): ${avgEmpathy != null ? avgEmpathy.toFixed(1) : "n/a"}
Total talk time (QA sample): ${Math.floor(talk / 60)} minutes

Ops + QA scorecard signals:
${signals}

Manager feedback notes:
${feedbackBlock}

Recent call signals (summary · scores · fails · flags):
${summaryBlock}

${structure}

Do not invent facts not supported by the signals/notes/summaries. Prefer ops metrics and failed rules over vague narrative.`;

  const modelId =
    process.env.BEDROCK_COACHING_MODEL_ID ||
    process.env.BEDROCK_MODEL_ID ||
    "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

  const resp = await bedrockClient().send(
    new ConverseCommand({
      modelId,
      system: [
        {
          text: "You write concise coaching reports for medical office phone agents. Ground every point in ops access metrics, QA scores, critical flags, or failed rules when available.",
        },
      ],
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: { temperature: 0.4, maxTokens: 2048 },
    })
  );

  const parts = resp.output?.message?.content || [];
  const report = parts
    .map((p) => ("text" in p && p.text ? p.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!report) throw new Error("Empty coaching response from Bedrock");

  const updated = await setRollingFeedback(email, report);
  return { user: updated, report };
}
