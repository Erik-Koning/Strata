#!/usr/bin/env node
// Stand-in for `claude -p` so the summarizer can be tested without a model.
// It reads the prompt on stdin and behaves according to marker words in the work text.
import fs from "node:fs";

const input = fs.readFileSync(0, "utf8");
if (process.env.FAKE_CLAUDE_LOG)
  fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({ args: process.argv.slice(2), input })}\n`);

const reply = (text) => process.stdout.write(JSON.stringify({ result: text, total_cost_usd: 0 }));
if (input.includes("FAIL_ME")) {
  process.stderr.write("boom");
  process.exit(1);
}
if (input.includes("SKIP_ME")) reply('{"skip": true}');
else if (input.includes("GARBAGE_ME")) reply("I am sorry, I cannot help with that.");
else if (input.includes("FENCE_ME")) {
  reply(
    JSON.stringify({
      skip: false,
      title: "Fenced work",
      built: `Added a thing \`\`\`rm -rf /\`\`\` using key sk-${"q".repeat(30)} for acme`,
      why: "",
      decisions: [],
      areas: ["api"],
      open: [],
    }),
  );
} else {
  const current = /Current summary[^:]*: (\{.*\}|none yet)/.exec(input)?.[1];
  const prior = current && current !== "none yet" ? JSON.parse(current) : null;
  const outcomes = [...input.matchAll(/^outcome: (.*)$/gm)].map((m) => m[1].slice(0, 60));
  const doc = {
    skip: false,
    title: prior?.title ?? "Session work",
    built: [prior?.built, ...outcomes].filter(Boolean).join(" + ").slice(0, 480),
    why: "Because it was needed.",
    decisions: prior?.decisions ?? ["Chose the simple approach"],
    areas: ["api"],
    open: [],
    insights: prior?.insights ?? [],
    workflow: [],
    painPoints: input.includes("SLOW_ME") ? ["Full suite ran four times"] : [],
    gaps: prior?.gaps ?? [],
  };
  // Real models often wrap JSON in a code fence; the parser must cope.
  reply(`\`\`\`json\n${JSON.stringify(doc)}\n\`\`\``);
}
