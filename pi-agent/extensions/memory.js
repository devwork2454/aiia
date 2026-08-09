/**
 * AIIA memory extension — injects active memories into the real Pi context and
 * exposes /memory + a memory tool. SQLite lives in this same Node process.
 *
 * Env: AIIA_DB (default ~/.config/aiia/aiia.db)
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../src/memory-store.js";

function dbPath() {
  return process.env.AIIA_DB || join(homedir(), ".config", "aiia", "aiia.db");
}

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function memoryExtension(pi) {
  const store = new MemoryStore(dbPath());

  // Inject top-N active memories every turn (Ebbinghaus-ranked, lazy).
  // Pi contract: `context` handler receives { messages } and returns
  // { messages } to REPLACE the context. We append a system memory message.
  pi.on("context", async (event) => {
    const memories = store.active({ threshold: 0.15, limit: 10 });
    if (memories.length === 0) return;
    const memoryStr = `[AIIA active memories]\n- ${memories.join("\n- ")}`;
    const newMessages = [...(event.messages ?? [])];
    if (newMessages.length > 0 && newMessages[0].role === "system") {
      newMessages[0] = { ...newMessages[0], content: `${memoryStr}\n\n${newMessages[0].content}` };
    } else {
      newMessages.unshift({ role: "system", content: memoryStr });
    }
    return { messages: newMessages };
  });

  // Slash command: /memory add|list|rm
  pi.registerCommand("memory", {
    description: "Manage AIIA long-term memories (add|list|rm)",
    async run(args, ctx) {
      const [sub, ...rest] = String(args || "").trim().split(/\s+/);
      if (sub === "add") {
        const content = rest.join(" ");
        if (!content) return ctx?.ui?.notify?.("usage: /memory add <text>");
        const id = store.add({ content });
        return ctx?.ui?.notify?.(`memory #${id} saved`);
      }
      if (sub === "rm") {
        const id = Number(rest[0]);
        if (Number.isNaN(id)) return ctx?.ui?.notify?.("usage: /memory rm <id>");
        const ok = store.remove(id);
        return ctx?.ui?.notify?.(ok ? "removed" : "not found");
      }
      const items = store.list({ limit: 20 });
      return ctx?.ui?.notify?.(
        items.length ? items.map((m) => `#${m.id} [${m.category}] ${m.content}`).join("\n") : "(empty)",
      );
    },
  });

  // Tool the model can call to persist a memory it deems important.
  pi.registerTool({
    name: "remember",
    label: "Remember",
    description: "Persist a durable user preference or fact to long-term memory.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "The fact/preference to remember" },
        category: { type: "string", description: "coding_style|user_preference|build_fix" },
      },
      required: ["content"],
    },
    async execute(_id, params) {
      const memId = store.add({ content: params.content, category: params.category || "user_preference" });
      return { content: [{ type: "text", text: `Saved memory #${memId}` }], details: { memId } };
    },
  });

  pi.on?.("session_shutdown", () => store.close());
}
