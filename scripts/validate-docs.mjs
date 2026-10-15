#!/usr/bin/env node
/**
 * Structural validator for the AI-agent documentation harness.
 *
 * Checks (NOT a factual-accuracy checker — see docs/standards/markdown-authoring.md):
 *   1. Every relative Markdown link in every tracked .md file resolves to a real file/dir.
 *   2. Every required root-level doc exists.
 *   3. Every backend service + the shared package + the frontend has its own AGENTS.md.
 *   4. Every ADR under docs/decisions/ follows the NNNN-kebab-title.md naming pattern
 *      and has the required section headings.
 *
 * Usage: node scripts/validate-docs.mjs
 * Exit code 0 = all checks passed, 1 = at least one failure (prints what and where).
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.vite', '.cache', '.remember']);

/** Recursively collect every .md file under `dir`, skipping ignored directories. */
function findMarkdownFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (IGNORE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      results.push(...findMarkdownFiles(full));
    } else if (extname(entry) === '.md') {
      results.push(full);
    }
  }
  return results;
}

/** Strip fenced code blocks (``` ... ```) so links inside examples aren't checked. */
function stripCodeFences(content) {
  const lines = content.split('\n');
  let inFence = false;
  const out = [];
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push(''); // keep line count stable for accurate line numbers
      continue;
    }
    out.push(inFence ? '' : line);
  }
  return out.join('\n');
}

const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;

function isExternalOrSpecial(target) {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(target) || // any URL scheme (http:, https:, mailto:, etc.)
    target.startsWith('#') || // in-page anchor only
    target.startsWith('//')
  );
}

function checkLinksInFile(file, errors) {
  const raw = readFileSync(file, 'utf8');
  const stripped = stripCodeFences(raw);
  const lines = stripped.split('\n');

  lines.forEach((line, idx) => {
    let match;
    LINK_RE.lastIndex = 0;
    while ((match = LINK_RE.exec(line)) !== null) {
      let target = match[1].trim();
      if (!target || isExternalOrSpecial(target)) continue;

      // Strip a trailing #fragment before resolving the file path.
      const hashIdx = target.indexOf('#');
      if (hashIdx !== -1) target = target.slice(0, hashIdx);
      if (!target) continue; // was a pure same-file anchor

      const resolved = resolve(dirname(file), target);
      if (!existsSync(resolved)) {
        errors.push(`${relative(ROOT, file)}:${idx + 1}  broken link -> "${match[1]}"`);
      }
    }
  });
}

function checkRequiredRootDocs(errors) {
  const required = [
    'AGENTS.md',
    'CLAUDE.md',
    'README.md',
    'ARCHITECTURE.md',
    'MODULES.md',
    'INFRASTRUCTURE.md',
    'ENGINEERING_RULES.md',
    'TESTING.md',
    'SECURITY.md',
    'TROUBLESHOOTING.md',
  ];
  for (const f of required) {
    if (!existsSync(join(ROOT, f))) {
      errors.push(`missing required root doc: ${f}`);
    }
  }
}

function checkModuleAgentsFiles(errors) {
  const servicesDir = join(ROOT, 'backend', 'services');
  if (existsSync(servicesDir)) {
    for (const entry of readdirSync(servicesDir)) {
      const full = join(servicesDir, entry);
      if (!statSync(full).isDirectory()) continue;
      if (!existsSync(join(full, 'AGENTS.md'))) {
        errors.push(`backend/services/${entry} is missing an AGENTS.md`);
      }
    }
  }
  const requiredModuleAgents = ['backend/AGENTS.md', 'backend/packages/shared/AGENTS.md', 'frontend/AGENTS.md'];
  for (const f of requiredModuleAgents) {
    if (!existsSync(join(ROOT, f))) {
      errors.push(`missing module AGENTS.md: ${f}`);
    }
  }
}

function checkAdrs(errors) {
  const decisionsDir = join(ROOT, 'docs', 'decisions');
  if (!existsSync(decisionsDir)) return;
  const NAME_RE = /^\d{4}-[a-z0-9-]+\.md$/;
  const REQUIRED_HEADINGS = ['Status', 'Date', 'Context', 'Decision', 'Consequences'];
  for (const entry of readdirSync(decisionsDir)) {
    if (!entry.endsWith('.md')) continue;
    if (!NAME_RE.test(entry)) {
      errors.push(`docs/decisions/${entry} doesn't match the NNNN-kebab-title.md naming pattern`);
      continue;
    }
    const content = readFileSync(join(decisionsDir, entry), 'utf8');
    for (const heading of REQUIRED_HEADINGS) {
      const re = new RegExp(`(^|\\n)#{1,3}\\s*${heading}|\\*\\*${heading}`, 'i');
      if (!re.test(content)) {
        errors.push(`docs/decisions/${entry} is missing a "${heading}" section`);
      }
    }
  }
}

function main() {
  const errors = [];

  checkRequiredRootDocs(errors);
  checkModuleAgentsFiles(errors);
  checkAdrs(errors);

  const mdFiles = findMarkdownFiles(ROOT);
  for (const file of mdFiles) {
    checkLinksInFile(file, errors);
  }

  console.log(`Checked ${mdFiles.length} Markdown files.`);

  if (errors.length > 0) {
    console.error(`\n${errors.length} problem(s) found:\n`);
    for (const e of errors) console.error('  - ' + e);
    console.error('\nThis script checks structure (links resolve, required files exist) — it cannot verify factual accuracy. See docs/standards/markdown-authoring.md.');
    process.exit(1);
  }

  console.log('All structural checks passed.');
  process.exit(0);
}

main();
