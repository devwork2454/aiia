export default function debugRenderer(pi) {
  if (typeof pi.registerMessageRenderer === "function") {
    pi.registerMessageRenderer("assistant", (msg) => {
      require("fs").appendFileSync("/tmp/pi-debug.log", JSON.stringify({role: msg.role, customType: msg.customType}) + "\n");
      return undefined;
    });
  }
}
