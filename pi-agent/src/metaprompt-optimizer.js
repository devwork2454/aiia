import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildRuleBasedDraft } from "./context-card.js";

/**
 * Reads the last N bytes of the trajectories.jsonl file to prevent context overflow.
 */
function getRecentTrajectories(cwd) {
  const trajFile = join(resolve(cwd), ".agent", "trajectories.jsonl");
  if (!existsSync(trajFile)) return "";
  const content = readFileSync(trajFile, "utf8");
  // Keep last 30,000 characters to stay within reasonable token limits
  if (content.length > 30000) {
    return content.slice(-30000);
  }
  return content;
}

/**
 * Uses LLM to extract project metadata from trajectories.
 */
export async function buildLLMDraft(cwd, ctx) {
  const trajectories = getRecentTrajectories(cwd);
  const ruleBased = buildRuleBasedDraft(cwd);

  if (!trajectories) {
    console.log("[Metaprompt Optimizer] No trajectories found. Falling back to rule-based.");
    return ruleBased;
  }

  const baseUrl = ctx?.model?.baseUrl || "http://127.0.0.1:4000/v1";
  const modelId = ctx?.model?.id || "high";

  const systemPrompt = `You are the L7 Metaprompt Optimizer.
Your task is to analyze the agent's recent trajectory log and extract a JSON profile of the user and project.
Output MUST be raw valid JSON ONLY, matching this schema:
{
  "intent": "String summarizing the main goal of this project",
  "stack": ["Array of programming languages/frameworks observed"],
  "user_tags": ["Array of user behavior traits or roles"],
  "prefer_tools": ["Array of tools the user successfully uses or likes"],
  "avoid_tools": ["Array of tools that caused errors or the user dislikes"],
  "noise_deny": ["Array of specific negative constraints or rules to always obey (e.g., 'Never use var', 'Do not rewrite whole files')"]
}
Do not use markdown blocks. Output pure JSON.`;

  const payload = {
    model: modelId,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Trajectories:\n${trajectories}` }
    ],
    temperature: 0.2
  };

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY || "dummy"}`
      },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      let text = data?.choices?.[0]?.message?.content || "";
      text = text.replace(/```json/g, "").replace(/```/g, "").trim();
      const llmDraft = JSON.parse(text);
      
      return {
        ...ruleBased, // merge with rule-based so we don't lose static hints
        ...llmDraft,
        confidence: 0.9 // Higher confidence because it's LLM generated
      };
    } else {
      throw new Error(`LLM API returned status ${res.status}`);
    }
  } catch (err) {
    console.error("[Metaprompt Optimizer] Failed to build LLM draft:", err);
    return ruleBased;
  }
}
