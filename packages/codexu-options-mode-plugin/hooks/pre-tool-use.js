#!/usr/bin/env node

// PreToolUse hook for request_user_input.
//
// In `auto` mode, picks the first option of each question and returns a
// synthetic RequestUserInputResponse via the PreToolUse `syntheticResponse`
// sentinel. The codex tool dispatcher short-circuits the request_user_input
// handler and surfaces the value to the model as if the tool had succeeded
// normally. See:
//   https://github.com/gim-home/codex docs/implementation/patch-surface.md §14 invariant 28.
//
// Behavior contract:
//   - mode !== 'auto'             -> no-op (empty JSON).
//   - mode === 'auto' and any question lacks options -> no-op + warning log.
//   - mode === 'auto' and all questions have >=1 option -> synthetic response
//     with each question's first option label as the answer.

const { getOptionsMode, appendLog } = require('./config');

function readStdin(callback) {
  let input = '';
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => callback(input));
}

function parseInput(raw) {
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}

function buildSyntheticAnswers(questions) {
  const answers = {};
  for (const question of questions) {
    if (!question || typeof question.id !== 'string') return null;
    const options = Array.isArray(question.options) ? question.options : null;
    if (!options || options.length === 0) return null;
    const first = options[0];
    if (!first || typeof first.label !== 'string') return null;
    answers[question.id] = { answers: [first.label] };
  }
  return answers;
}

readStdin(raw => {
  let input;
  try {
    input = parseInput(raw);
  } catch (e) {
    return;
  }

  let mode;
  try {
    mode = getOptionsMode(input.session_id);
  } catch (e) {
    return;
  }

  if (mode !== 'auto') return;

  const toolInput = input && input.tool_input;
  const questions = toolInput && Array.isArray(toolInput.questions)
    ? toolInput.questions
    : null;

  if (!questions || questions.length === 0) {
    try { appendLog('WARN pre-tool-use auto: request_user_input received no questions; falling back to human input'); } catch (e) {}
    return;
  }

  const answers = buildSyntheticAnswers(questions);
  if (!answers) {
    try { appendLog('WARN pre-tool-use auto: request_user_input question is missing options/label; falling back to human input'); } catch (e) {}
    return;
  }

  const out = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      syntheticResponse: { answers }
    }
  };
  process.stdout.write(JSON.stringify(out));
});
