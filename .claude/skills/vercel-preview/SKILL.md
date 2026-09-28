---
name: vercel-preview
description: Post the Vercel preview link after every `git push` of a branch and after opening a pull request in this repo. Use it right after pushing or creating a PR, before reporting back, so the user can open the deployed app. Also use when the user asks for the preview, deploy or Vercel link.
---

# Vercel preview link

Every pushed commit in this repo gets a Vercel preview deployment (Vercel's GitHub integration,
project `harmlessharms-projects/harmless-tradeskills`). After you push a branch or open a PR, give
the user the preview link in your reply. A build takes about a minute.

## 1. The branch has a PR: read Vercel's PR comment

`vercel[bot]` comments on every PR and edits that comment on each push. Read it with the GitHub
tools (`pull_request_read`, method `get_comments`), not the REST API.

- The **Preview** link in its table is the branch preview
  (`https://harmless-tradeskills-git-<branch>-harmlessharms-projects.vercel.app`). It always serves
  the latest commit of the branch, so it stays valid across pushes.
- The **Deployment** column says whether that latest commit is `Ready`, `Building` or `Error`. The
  `Updated` time tells you whether it already covers your push. If it is still building, say so and
  post the link anyway; check again later if you have a follow-up turn.
- Never build this URL from the branch name yourself: Vercel shortens long branch names with a hash
  (e.g. `claude/keen-cerf-i9r8hu` became `claude-k-90ca24`).

## 2. No PR: ask the deployments API for the commit

```bash
node scripts/vercel-preview.mjs HEAD --timeout=300
```

It polls every 15 seconds and prints one JSON line. Run it in the background if you have other work.

- `"state":"ready"`: `url` is the preview for exactly this commit. Post it.
- `"state":"failed"`: the Vercel build failed. Say so, give `logUrl`, and treat it like a failing
  check (reproduce with `npm run build`).
- `"state":"pending"` / `"not-found"`: nothing finished within the timeout. Say the preview is still
  building, or that Vercel did not deploy this commit.
- `"state":"rate-limited"` / `"api-error"`: the public GitHub API refused (cloud sessions share IPs
  and often hit the 60 requests/hour limit). Say that the preview link could not be looked up and
  that it will appear in Vercel's comment once a PR is opened. Don't retry in a loop.

## Reply format

`Preview: <url>` plus the short commit sha it shows, e.g.
`Preview (latest on branch, ready): https://harmless-tradeskills-git-claude-k-90ca24-harmlessharms-projects.vercel.app`

## Don'ts

- Don't post the link as a PR comment: `vercel[bot]` already comments on every PR. The link goes in
  your reply to the user.
- Don't invent or guess preview URLs. Only post what the Vercel comment or the script returned.
- Don't give the `target_url` of the "Vercel" commit status: it is the Vercel dashboard, which needs
  a login.
