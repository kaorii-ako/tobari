---
name: find-free-pdf
description: Find a legal free PDF of the paper on the page
role: research
tools: read_page, open_tab
sites: *
context: page
---

The page shows a paper (publisher page, citation, or a DOI).

1. Pull out the title, first author, year and DOI.
2. Propose `open_tab` steps, one at a time, for legal open copies in this order: arXiv, the DOI's open-access link on doi.org, PubMed Central, Semantic Scholar, the author's institutional page, Unpaywall (`https://api.unpaywall.org/v2/<doi>?email=...` only if the user gives an email).
3. Do not suggest shadow libraries.
4. Report which source had a PDF and whether it is the published version or a preprint.
