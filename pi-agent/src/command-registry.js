/**
 * Shared handler registry so /aiia can delegate without duplicating business logic.
 */

/** @type {Map<string, (args: string, ctx: any) => Promise<void>|void>} */
const handlers = new Map();

/**
 * @param {string} name
 * @param {(args: string, ctx: any) => Promise<void>|void} handler
 */
export function registerAiiaHandler(name, handler) {
  if (!name || typeof handler !== "function") {
    throw new Error("registerAiiaHandler requires name + function");
  }
  handlers.set(String(name), handler);
}

/** @param {string} name */
export function getAiiaHandler(name) {
  return handlers.get(String(name)) || null;
}

/** @returns {string[]} */
export function listAiiaHandlers() {
  return [...handlers.keys()].sort();
}

/** Test helper */
export function clearAiiaHandlers() {
  handlers.clear();
}
