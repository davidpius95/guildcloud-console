#!/bin/sh
# Strip the draft-07 $schema declaration from tool schemas emitted by the
# MCP SDK.
#
# Why: @modelcontextprotocol/sdk's toJsonSchemaCompat() defaults to
# draft-7 on BOTH of its branches (mapMiniTarget() falls back to
# "draft-7", and the zod-to-json-schema branch stamps
# "http://json-schema.org/draft-07/schema#"). This server never overrides
# the target, so every tool it exports declares draft-07. Strict clients
# whose validator only implements JSON Schema 2020-12 reject the tool
# outright - which made all 19 tailscale tools unusable with the error
# "invalid outputSchema: ... unsupported dialect".
#
# Removing the dialect declaration (rather than relabelling it 2020-12)
# is deliberate: these schemas only use constructs that are identical in
# both dialects (type/properties/items/required/enum), so dropping
# $schema lets the client apply its own default without changing how any
# schema actually validates. Relabelling would assert 2020-12 semantics
# the generator did not actually produce.
#
# Applied at container start rather than bind-mounting a patched file,
# because the image is tracked as :latest - a static mount would silently
# shadow a future SDK version with this stale copy. This adapts instead,
# and refuses to patch (loudly) if upstream changes shape.
set -e

TARGET="/app/node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-json-schema-compat.js"
MARKER="__origToJsonSchemaCompat"
SIG="export function toJsonSchemaCompat(schema, opts) {"

if [ ! -f "$TARGET" ]; then
  echo "[patch-json-schema] WARN: $TARGET missing - SDK layout changed upstream; NOT patched. Strict clients will reject these tools." >&2
elif grep -q "$MARKER" "$TARGET"; then
  echo "[patch-json-schema] already patched; skipping"
elif ! grep -qF "$SIG" "$TARGET"; then
  echo "[patch-json-schema] WARN: expected signature not found - refusing to patch blindly. Strict clients will reject these tools." >&2
else
  PATCH_TARGET="$TARGET" /usr/local/bin/bun -e '
const fs = require("fs");
const p = process.env.PATCH_TARGET;
const sig = "export function toJsonSchemaCompat(schema, opts) {";
const repl =
  "export function toJsonSchemaCompat(schema, opts) { const r = __origToJsonSchemaCompat(schema, opts); if (r && typeof r === \"object\") delete r[\"$schema\"]; return r; }\n" +
  "function __origToJsonSchemaCompat(schema, opts) {";
const s = fs.readFileSync(p, "utf8");
if (!s.includes(sig)) process.exit(3);
fs.writeFileSync(p, s.replace(sig, repl));
'
  echo "[patch-json-schema] patched $TARGET (stripped \$schema dialect declaration)"
fi

exec /usr/local/bin/docker-entrypoint.sh "$@"
