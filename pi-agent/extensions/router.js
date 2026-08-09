export default function (pi) {
  pi.on("before_provider_request", (event, ctx) => {
    const payload = event.payload || {};
    let targetModel = "high"; // default

    const input = payload.input || payload.messages || [];
    if (input.length > 0) {
      const lastMsg = input[input.length - 1];
      if (lastMsg && lastMsg.role === "user") {
        let text = "";
        if (typeof lastMsg.content === "string") {
          text = lastMsg.content;
        } else if (Array.isArray(lastMsg.content)) {
          text = lastMsg.content.map(c => c.text || "").join("");
        }

        // Cost saving: Route short, simple initial requests to 'low'
        // If there is no long context and the prompt is short, use 'low'
        if (input.length <= 3 && text.length < 100) {
          targetModel = "low";
        }
      }
    }

    return { ...payload, model: targetModel };
  });
}
