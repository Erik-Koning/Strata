#!/usr/bin/env node
// Stand-in for `opencode run`, so the summarizer backend can be tested without a model.
// Reads the prompt on stdin when given "-" or as the trailing argument, like the real CLI.
import fs from "node:fs";

const args = process.argv.slice(2);
if (process.env.FAKE_OPENCODE_LOG) fs.appendFileSync(process.env.FAKE_OPENCODE_LOG, `${JSON.stringify({ args })}\n`);

const input = args
  .filter((arg) => !arg.startsWith("-"))
  .join(" ")
  .includes("{")
  ? ""
  : "";
const prompt = process.stdin.isTTY ? input : fs.readFileSync(0, "utf8");

if (prompt.includes("FAIL_ME")) {
  process.stderr.write("boom");
  process.exit(1);
}

const current = /Current summary[^:]*: (\{.*\}|none yet)/.exec(prompt)?.[1];
const prior = current && current !== "none yet" ? JSON.parse(current) : null;
const outcomes = [...prompt.matchAll(/^outcome: (.*)$/gm)].map((match) => match[1].slice(0, 60));

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
  painPoints: [],
  gaps: prior?.gaps ?? [],
};

process.stdout.write(JSON.stringify(doc));
