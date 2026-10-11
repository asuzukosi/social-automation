## What does this PR do?

<!-- Brief description of the change and why it's needed -->

## Type of change

- [ ] New feature
- [ ] Bug fix
- [ ] Documentation update
- [ ] Refactoring
- [ ] New skill (`skills/*/SKILL.md`)
- [ ] Test fix
- [ ] Other

## Runtime context

<!-- Which context does this change affect? -->
- [ ] Browser script (DevTools console on x.com)
- [ ] Node.js / CLI / MCP server
- [ ] API server (Express + database)

## Checklist

- [ ] Tests pass (`vitest run`)
- [ ] No mocks/stubs/fakes introduced (real implementations only)
- [ ] Browser scripts: tested in DevTools console, uses `data-testid` selectors
- [ ] New skills: follows `skills/TEMPLATE.md` format, added to `skills/index.json`
- [ ] Rate limiting: automation has 1–3s delays between actions
- [ ] Author credit present (`// by nichxbt`) in new source files
- [ ] ESM imports only (no `require`)
- [ ] CLAUDE.md is still accurate (no outdated references)
- [ ] Documentation updated if behavior changed
