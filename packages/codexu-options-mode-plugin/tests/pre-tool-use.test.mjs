import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const config = require("../hooks/config.js");
const hookPath = fileURLToPath(new URL("../hooks/pre-tool-use.js", import.meta.url));

const tempRoots = [];

async function withPluginData() {
  const root = await mkdtemp(path.join(tmpdir(), "codex-options-pre-tool-use-"));
  tempRoots.push(root);
  process.env.PLUGIN_DATA = root;
  delete process.env.OPTIONS_DEFAULT_MODE;
  return root;
}

function runHook(root, payload) {
  const result = spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, PLUGIN_DATA: root },
  });

  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return result.stdout;
}

afterEach(async () => {
  delete process.env.PLUGIN_DATA;
  delete process.env.OPTIONS_DEFAULT_MODE;
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const samplePayload = (sessionId, questions) => ({
  hook_event_name: "PreToolUse",
  session_id: sessionId,
  tool_name: "request_user_input",
  tool_use_id: "tu-1",
  tool_input: { questions },
});

const sampleQuestions = () => [
  {
    id: "q1",
    header: "Pick approach",
    question: "Which approach?",
    options: [
      { label: "Recommended", description: "Default" },
      { label: "Alternative", description: "Other" },
    ],
  },
  {
    id: "q2",
    header: "Pick scope",
    question: "Which scope?",
    options: [
      { label: "Narrow", description: "Default" },
      { label: "Broad", description: "Other" },
    ],
  },
];

describe("PreToolUse request_user_input hook", () => {
  test("is a no-op when options-mode is off", async () => {
    const root = await withPluginData();
    const sessionId = "session-off";
    config.setOptionsMode(sessionId, "off");

    expect(runHook(root, samplePayload(sessionId, sampleQuestions()))).toBe("");
  });

  test("is a no-op when options-mode is on (non-auto)", async () => {
    const root = await withPluginData();
    const sessionId = "session-on";
    config.setOptionsMode(sessionId, "on");

    expect(runHook(root, samplePayload(sessionId, sampleQuestions()))).toBe("");
  });

  test("is a no-op when options-mode is strict (only auto intercepts)", async () => {
    const root = await withPluginData();
    const sessionId = "session-strict";
    config.setOptionsMode(sessionId, "strict");

    expect(runHook(root, samplePayload(sessionId, sampleQuestions()))).toBe("");
  });

  test("auto mode picks the first option of each question", async () => {
    const root = await withPluginData();
    const sessionId = "session-auto";
    config.setOptionsMode(sessionId, "auto");

    const stdout = runHook(root, samplePayload(sessionId, sampleQuestions()));
    expect(stdout).not.toBe("");

    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        syntheticResponse: {
          answers: {
            q1: { answers: ["Recommended"] },
            q2: { answers: ["Narrow"] },
          },
        },
      },
    });
  });

  test("auto mode no-ops when a question has empty options", async () => {
    const root = await withPluginData();
    const sessionId = "session-auto-empty";
    config.setOptionsMode(sessionId, "auto");

    const payload = samplePayload(sessionId, [
      {
        id: "q1",
        header: "Free-form",
        question: "What?",
        options: [],
      },
    ]);

    expect(runHook(root, payload)).toBe("");
  });

  test("auto mode no-ops when a question is missing options entirely", async () => {
    const root = await withPluginData();
    const sessionId = "session-auto-missing";
    config.setOptionsMode(sessionId, "auto");

    const payload = samplePayload(sessionId, [
      {
        id: "q1",
        header: "Free-form",
        question: "What?",
      },
    ]);

    expect(runHook(root, payload)).toBe("");
  });

  test("auto mode no-ops when the tool input has no questions array", async () => {
    const root = await withPluginData();
    const sessionId = "session-auto-noquestions";
    config.setOptionsMode(sessionId, "auto");

    const payload = {
      hook_event_name: "PreToolUse",
      session_id: sessionId,
      tool_name: "request_user_input",
      tool_use_id: "tu-1",
      tool_input: {},
    };

    expect(runHook(root, payload)).toBe("");
  });
});
