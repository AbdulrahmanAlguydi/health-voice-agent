export function shouldEnablePrototypeDiagnostics(mode: string, requested?: boolean): boolean {
  const localBuild = mode === "development" || mode === "test";
  return localBuild && requested !== false;
}
