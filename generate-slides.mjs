#!/usr/bin/env node
// Fire the 10 "vibe-coding principles" prompts at the BranDoIt API in one batch.
// Run:  node --env-file=mcp/.env generate-slides.mjs
// Token is read from mcp/.env (BRANDOIT_API_TOKEN). Nothing secret lives in this file.

const API_URL =
  process.env.BRANDOIT_API_URL ||
  "https://us-central1-brandoit.cloudfunctions.net/agentGenerateImage";
const TOKEN = process.env.BRANDOIT_API_TOKEN || "";

if (!TOKEN) {
  console.error("BRANDOIT_API_TOKEN not set. Run with: node --env-file=mcp/.env generate-slides.mjs");
  process.exit(1);
}

const prompts = [
  `"So what?" Don't just show something works. Explain why it matters who it helps and what someone should learn from it`,
  `"Push past the first draft" The goal is not getting AI to make something. It's directing the AI critiquing it improving it and making real choices. First output is a draft not a deliverable`,
  `"Story beats output" A dashboard app or reflection needs a point. The strong projects carry a clear narrative about what the viewer should notice compare decide or understand`,
  `"You are the editor and QA" AI ships broken charts weak layouts and bad assumptions. Verify push back test links inspect behavior and make the tool fix its own work`,
  `"Audience context matters" A project should not assume the viewer already knows what they're looking at. Add labels guidance and enough framing so someone else can actually use it`,
  `"Specific language gets better AI" Knowing terms like toggle sidebar filter responsive layout API auth and chart type helps you direct the model. When vocabulary fails screenshots and examples are the workaround`,
  `"Domain expertise is the human edge" The best work pairs AI building speed with your own judgment about the subject. AI can make charts. It usually can't decide what actually matters in your field`,
  `"Feed less smarter" Don't dump everything into context. Summaries sampled data cleaned CSVs and tight constraints often beat giant uploads`,
  `"Prompting has structure" Use the 4Ts of Traits Tasks Tones and Targets. Then strengthen prompts with examples visual aids critique lists variables and room for the model to pause or ask questions`,
  `"User testing is part of the work" Don't only test whether it works for you. Use the LLM to role-play different users challenge your assumptions and find what's confusing before you submit`,
];

const body = {
  prompts,
  saveToGallery: true,
  settings: { aspectRatio: "16:9" },
};

console.log(`Sending ${prompts.length} prompts to BranDoIt (30-90s each, batched)...`);

const resp = await fetch(API_URL, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

if (!resp.ok) {
  console.error(`API error ${resp.status}: ${await resp.text()}`);
  process.exit(1);
}

const data = await resp.json();
const results = data.results || [];
results.forEach((r, i) => {
  const title = prompts[i].match(/^"([^"]+)"/)?.[1] || `#${i + 1}`;
  console.log(`\n${i + 1}. ${title}`);
  console.log(r.ok ? `   ${r.imageUrl}` : `   FAILED: ${r.error || "unknown error"}`);
});

console.log(`\nDone. ${results.filter((r) => r.ok).length}/${results.length} generated. They're also in your BranDoIt gallery.`);
