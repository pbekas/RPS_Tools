import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  getUser,
  listCalls,
  listFeedbackForAgent,
  setRollingFeedback,
  type UserDoc,
} from "@/lib/database";

function bedrockClient() {
  return new BedrockRuntimeClient({
    region: process.env.AWS_REGION || "us-east-1",
  });
}

export async function generateCoachingForAgent(agentEmail: string): Promise<{
  user: UserDoc;
  report: string;
}> {
  const email = agentEmail.trim().toLowerCase();
  const user = await getUser(email);
  if (!user) throw new Error(`User not found: ${email}`);

  const calls = await listCalls({
    agentEmail: email,
    status: "complete",
    limit: 100,
    requireMinDuration: true,
  });

  if (!calls.length) {
    const report = "No completed calls in the recent window to coach on.";
    const updated = await setRollingFeedback(email, report);
    return { user: updated, report };
  }

  const talk = calls.reduce((s, c) => s + Number(c.duration_seconds || 0), 0);
  const empathyVals = calls.map((c) => Number(c.ai_empathy_score || 0));
  const avgEmpathy =
    empathyVals.reduce((a, b) => a + b, 0) / Math.max(empathyVals.length, 1);
  const summaries = calls.map((c) => String(c.ai_summary || "")).filter(Boolean);
  const managerNotes = calls
    .map((c) => String(c.manager_feedback || "").trim())
    .filter(Boolean);
  const feedbackRows = await listFeedbackForAgent(email, 50);
  for (const fb of feedbackRows) {
    if (fb.text?.trim()) managerNotes.push(fb.text.trim());
  }

  const feedbackBlock =
    managerNotes.map((n) => `- ${n}`).join("\n") || "(none)";
  const summaryBlock = summaries.map((s) => `- ${s}`).join("\n") || "(none)";
  const agentName = user.name || email;

  const prompt = `You are a phone-skills coach for Relevium Pain Specialists (medical office).

Agent: ${agentName}
Calls in period: ${calls.length}
Average empathy score (1-10): ${avgEmpathy.toFixed(1)}
Total talk time: ${Math.floor(talk / 60)} minutes

Manager feedback notes:
${feedbackBlock}

AI call summaries:
${summaryBlock}

Write a concise "Coaching Report" with:
1) Two specific strengths
2) Two specific areas for improvement
3) One short practice tip for the next week

Tone: direct, kind, actionable. No fluff. Do not invent facts not supported by the notes/summaries.`;

  const modelId =
    process.env.BEDROCK_COACHING_MODEL_ID ||
    process.env.BEDROCK_MODEL_ID ||
    "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

  const resp = await bedrockClient().send(
    new ConverseCommand({
      modelId,
      system: [
        {
          text: "You write concise coaching reports for medical office phone agents.",
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
