import { describe, expect, it } from "vitest";

describe("Vite local development", () => {
  it("uses the Netlify Vite plugin instead of the separate API proxy", async () => {
    const viteConfig = (await import("../../vite.config")).default;
    expect(viteConfig.server?.proxy).toBeUndefined();
    const pluginNames = ((viteConfig.plugins ?? []) as unknown as unknown[]).flat(Infinity).map((plugin: any) => plugin?.name as string | undefined);
    expect(pluginNames.some(name => name?.includes("netlify"))).toBe(true);
  }, 15_000);
});
