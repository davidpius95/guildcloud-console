# Dev log — Tailscale MCP server: draft-07 schema dialect fix

## Problem

Every one of the 19 `mcp__tailscale__*` tools failed on call with:

```
Tool 'list_devices' has an invalid outputSchema: JSON Schema declares an
unsupported dialect ("$schema": "http://json-schema.org/draft-07/schema#").
The default validator supports JSON Schema 2020-12 only
```

This blocked real verification work earlier the same day — the Phase 3
device-enrollment pass had to fall back to calling the Tailscale API
directly (reusing the site-worker's own OAuth-token-exchange pattern) to
check devices and ACL grants.

I initially wrote this off as "a client/harness issue outside this
codebase, you'd need to reconnect the MCP server yourself." That was
wrong, and worth recording: the server is `hexsleeves/tailscale-mcp-server`
running in Docker on the Guild-A host (`/opt/tailscale-mcp`), reachable
over the same SSH access already used for the Proxmox MCP. It was fixable
all along; I just hadn't looked past the Claude Desktop config.

## Root cause

`@modelcontextprotocol/sdk`'s `toJsonSchemaCompat()` (in
`server/zod-json-schema-compat.js`) defaults to draft-7 on **both**
branches:

- the Zod v4 branch: `mapMiniTarget(undefined)` → `'draft-7'`
- the Zod v3 branch: `zodToJsonSchema()` with no `target`, which stamps
  `"$schema": "http://json-schema.org/draft-07/schema#"`

The Tailscale server registers its tools without overriding the target,
so every exported tool declares draft-07. A client whose validator only
implements 2020-12 rejects the tool outright.

Confirmed on the wire before fixing: all 19 tools carried the draft-07
`$schema`.

## Fix

A wrapper entrypoint (`/opt/tailscale-mcp/patch-json-schema.sh`) patches
`toJsonSchemaCompat` at container start so the returned schema has its
`$schema` key deleted, then `exec`s the image's original entrypoint.

Two deliberate choices:

- **Strip `$schema` rather than relabel it 2020-12.** These schemas only
  use constructs identical in both dialects (`type`/`properties`/`items`/
  `required`/`enum`), so dropping the declaration lets the client apply
  its own default without changing how anything validates. Relabelling
  would assert 2020-12 semantics the generator didn't actually produce.
- **Patch at startup, not via a bind-mounted replacement file.** The
  image is tracked as `:latest`, so mounting a patched copy of an SDK
  internal would silently shadow a future SDK version with a stale file.
  The startup patch adapts to whatever the image ships, is idempotent,
  and refuses to patch (with a loud warning, rather than silently
  producing a broken server) if the upstream signature changes.

## Mistake made along the way

The first deployment put the container into a restart loop — clean
`exit 0`, immediately, over and over. Cause: **Compose clears the image's
default `CMD` whenever `entrypoint` is overridden.** The wrapper received
no arguments, so `exec "$@"` ran nothing and exited. The patch itself had
applied correctly; only the argument passing was broken.

Fixed by restating the image's CMD explicitly in the compose file
(`bun dist/index.js --http --host 127.0.0.1 --port 3000`), with a comment
noting it is not optional. Caught it because I checked container status
after deploying instead of trusting "Started".

## Verified

- Container `Up (healthy)`, log line confirms the patch applied on a
  fresh container: `[patch-json-schema] patched ... (stripped $schema
  dialect declaration)`.
- Direct HTTP probe against the nginx endpoint: 19 tools, **0** with a
  draft-07 `$schema`; schema bodies otherwise unchanged.
- End-to-end through the **actual client transport** (`npx mcp-remote` →
  nginx → server, same args the client uses): 19 tools, **0** draft-07.
- Idempotency: on subsequent restarts the script logs `already patched;
  skipping`.

## Note

An MCP client caches the tool list at connection time, so a session that
connected *before* this fix keeps the old schemas and will keep failing
until its MCP connection is re-established. The fresh-connection probes
above are the proof that new connections are clean.

## Files changed (on the Guild-A host, not in this repo)

- `/opt/tailscale-mcp/patch-json-schema.sh` (new)
- `/opt/tailscale-mcp/docker-compose.yml` (entrypoint + command + mount;
  timestamped backup left alongside)
