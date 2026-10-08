# Project maintenance

Follow `.cursor/rules/project-maintenance.mdc` for this entire repository.

Keep the extension simple and dependency-free. Run `npm test` after code changes.
The user requests that future completed changes be committed and pushed to the
existing GitHub origin after verification. Report the commit and push outcome;
never claim synchronization succeeded without checking it.

Persistent pending requirements are recorded in `docs/TODO.md`. Read it for context;
implement pending items only when the user asks to proceed with them.

Knowledge organization preferences (2026-10-08): use parent context to avoid
repeating framework names in child titles, unless comparison or disambiguation
requires them. Merge overlapping ideas by object, version, conditions and meaning,
never by generic headings alone. Preserve unique old details, all source links and
manual-edit protection. Let the model order related siblings by actual workflow or
learning dependencies; do not hardcode one library's topic list as a universal order.
