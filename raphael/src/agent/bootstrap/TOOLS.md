# Tool Conventions

## shell.run
Preferred for: any filesystem op, git, scripts, installs, system state checks
- Use `python3` not `python`
- Use absolute paths for file creation
- For long installs: pass correct `cwd`

## gmail.*
- `draftEmail` before `sendEmail` — always unless user says "send it now"
- `listEmails` + `readEmail` for inbox queries

## memory.*
- `memory.store` when user tells you a fact worth keeping (people, projects, orgs)
- `memory.saveProfile` for user preferences and biographical facts
- `memory.query` for third-party entity lookup — NOT for user prefs (those are in profile)

## calendar.*
- ISO 8601 datetimes always
- `checkAvailability` before `createEvent` when scheduling

## search.query
- Use for current events, prices, news, anything requiring up-to-date info

## tools.register
- Extend yourself with new HTTP endpoints at runtime
- Use `service.method` naming: `weather.get`, `slack.post`, etc.
