#!/usr/bin/env node
/**
 * Prints the Vercel preview URL for a commit, waiting until the deployment finishes.
 *
 *   node scripts/vercel-preview.mjs [commit-ish] [--timeout=300]
 *
 * Vercel's GitHub integration records every deployment as a GitHub deployment; its status carries
 * the preview URL. Reads the public GitHub API (GITHUB_TOKEN is used when set and valid). Without a
 * token GitHub allows 60 requests an hour per IP, which shared cloud IPs often exhaust.
 * Prints one JSON line. Exit codes: 0 ready, 1 deployment failed, 2 timed out or no deployment
 * found, 3 GitHub API error (e.g. rate limited).
 */
import { execSync } from 'node:child_process';

const REPO = 'HarmlessHarm/harmless-tradeskills';
const args = process.argv.slice(2);
const ref = args.find((a) => !a.startsWith('--')) ?? 'HEAD';
const timeoutSec = Number(args.find((a) => a.startsWith('--timeout='))?.split('=')[1] ?? 300);
const sha = execSync(`git rev-parse ${ref}`, { encoding: 'utf8' }).trim();

const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'vercel-preview-script' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function api(path) {
  const url = `https://api.github.com/repos/${REPO}${path}`;
  let res = await fetch(url, { headers });
  if (res.status === 401 && headers.Authorization) {
    // A stale or foreign token: the repo is public, so carry on without it.
    delete headers.Authorization;
    res = await fetch(url, { headers });
  }
  if (!res.ok) {
    const body = await res.text();
    const rateLimited = res.status === 429 || (res.status === 403 && /rate limit/i.test(body));
    console.log(JSON.stringify({ state: rateLimited ? 'rate-limited' : 'api-error', sha, status: res.status, message: body.slice(0, 200) }));
    process.exit(3);
  }
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deadline = Date.now() + timeoutSec * 1000;

while (true) {
  const deployments = await api(`/deployments?sha=${sha}&per_page=10`);
  const vercel = deployments.filter((d) => d.creator?.login === 'vercel[bot]');
  for (const d of vercel) {
    const [status] = await api(`/deployments/${d.id}/statuses?per_page=1`);
    if (status?.state === 'success') {
      console.log(JSON.stringify({ state: 'ready', sha, environment: d.environment, url: status.environment_url || status.target_url }));
      process.exit(0);
    }
    if (status?.state === 'failure' || status?.state === 'error') {
      console.log(JSON.stringify({ state: 'failed', sha, environment: d.environment, logUrl: status.log_url || status.target_url }));
      process.exit(1);
    }
  }
  if (Date.now() > deadline) {
    console.log(JSON.stringify({ state: vercel.length ? 'pending' : 'not-found', sha }));
    process.exit(2);
  }
  await sleep(15_000);
}
