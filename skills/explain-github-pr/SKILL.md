---
name: explain-github-pr
description: Explain what a GitHub pull request changes, why, and what to check in review
role: research
tools: read_page
sites: github.com
context: page
---

The page is a GitHub pull request (conversation, files, or commits tab).

Explain:
1. What the PR changes, in two or three sentences a reviewer can trust.
2. Why, using the description and linked issues. If the reason is not stated, say that.
3. The risky parts: migrations, public API changes, auth or security code, concurrency, deleted tests.
4. What is unclear or missing (tests, docs, a changelog entry).
5. Review status: approvals, requested changes, failing checks, if visible.

If only part of the diff is loaded, say which files you saw.
