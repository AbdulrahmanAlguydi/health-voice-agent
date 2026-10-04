import { afterEach, describe, expect, it, vi } from "vitest";

const originalPort = process.env.PORT;

afterEach(() => {
  if (originalPort === undefined) delete process.env.PORT;
  else process.env.PORT = originalPort;
  vi.resetModules();
});

describe("Vite development API proxy", () => {
  it("uses the same configured PORT as the API server", async () => {
    process.env.PORT = "43127";
    vi.resetModules();

    const viteConfig = (await import("../../vite.config")).default;
    const resolvedConfig = typeof viteConfig === "function"
      ? await viteConfig({ command: "serve", mode: "development", isSsrBuild: false, isPreview: false })
      : viteConfig;
    const apiProxy = resolvedConfig.server?.proxy?.["/api"];
    const target = typeof apiProxy === "string" ? apiProxy : apiProxy?.target;

    expect(target).toBe("http://localhost:43127");
  });
});
