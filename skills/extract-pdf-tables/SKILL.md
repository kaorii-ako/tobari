---
name: extract-pdf-tables
description: Pull every table out of a PDF as Markdown and CSV
role: analyst
tools: read_page, extract_table, save_file
sites: *
context: pdf, file
---

Find every table in the attached PDF or the PDF in the current tab.

For each table:
- Give it a heading with the page number and the caption if there is one.
- Output it as a Markdown table. Keep the original column order and units.
- Merge rows that the PDF split across lines. Leave a cell empty rather than guess.

If the user asks for CSV, offer one `save_file` step per table named `<pdf-name>-p<page>-<n>.csv`.
Say which tables you could not reconstruct cleanly (for example scanned pages with no text layer).
