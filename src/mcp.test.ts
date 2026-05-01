import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("mcp server starts without duplicate tool registration", async () => {
  const distDir = path.dirname(fileURLToPath(import.meta.url));
  const mcpPath = path.join(distDir, "mcp.js");
  const child = spawn(process.execPath, [mcpPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  const settled = await Promise.race([
    new Promise<{ kind: "exit"; code: number | null }>((resolve) => {
      child.once("exit", (code) => resolve({ kind: "exit", code }));
    }),
    new Promise<{ kind: "running" }>((resolve) => {
      setTimeout(() => resolve({ kind: "running" }), 250);
    }),
  ]);

  if (settled.kind === "exit" && settled.code !== 0) {
    assert.fail(`mcp server exited early with code ${settled.code ?? "null"}: ${stderr}`);
  }

  if (!child.killed && settled.kind === "running") {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    });
  }
});
