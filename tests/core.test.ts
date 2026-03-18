import { describe, it, expect } from "vitest";
import { Docupilot } from "../src/core.js";
describe("Docupilot", () => {
  it("init", () => { expect(new Docupilot().getStats().ops).toBe(0); });
  it("op", async () => { const c = new Docupilot(); await c.process(); expect(c.getStats().ops).toBe(1); });
  it("reset", async () => { const c = new Docupilot(); await c.process(); c.reset(); expect(c.getStats().ops).toBe(0); });
});
