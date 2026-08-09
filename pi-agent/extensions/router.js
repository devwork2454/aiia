export default function (pi) {
  pi.on("before_provider_request", (event, ctx) => {
    const payload = event.payload || {};
    let targetModel = "high"; // default

    const input = payload.input || payload.messages || [];
    if (input.length > 0) {
      const lastMsg = input[input.length - 1];
      if (lastMsg && lastMsg.role === "user") {
        let hasVision = false;
        let totalTextLength = 0;
        for (const msg of input) {
          if (typeof msg.content === "string") {
            totalTextLength += msg.content.length;
          } else if (Array.isArray(msg.content)) {
            for (const c of msg.content) {
              if (c.type === "image_url") hasVision = true;
              if (c.text) totalTextLength += c.text.length;
            }
          }
        }

        // Cost saving: Route short, simple initial requests to 'low'
        // If there is no long context and the prompt is short, use 'low'
        if (!hasVision && input.length <= 3 && totalTextLength < 500) {
          targetModel = "low";
        }
      }
    }

    return { ...payload, model: targetModel };
  });
}
