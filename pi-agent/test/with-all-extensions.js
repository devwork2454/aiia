/** Call from before(); use returned restore() in after(). */
export function enableAllExtensions() {
  const prev = process.env.AIIA_EXTENSIONS;
  process.env.AIIA_EXTENSIONS = 'all';
  return () => {
    if (prev === undefined) delete process.env.AIIA_EXTENSIONS;
    else process.env.AIIA_EXTENSIONS = prev;
  };
}
