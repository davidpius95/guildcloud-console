export const GUEST_SSH_VERIFICATION_SCRIPT = [
  "service=$(systemctl is-active ssh 2>/dev/null || systemctl is-active sshd 2>/dev/null || true)",
  'printf "ssh_service=%s\\n" "$service"',
  "if ss -ltn 2>/dev/null | grep -qE 'LISTEN.+(:|\\.)22(\\s|$)'; then",
  '  echo "ssh_port=listening"',
  "else",
  '  echo "ssh_port=not_listening"',
  "  exit 12",
  "fi",
].join("\n");

export function parseGuestSshVerification(status) {
  const stdout = typeof status?.["out-data"] === "string" ? status["out-data"] : "";
  const stderr = typeof status?.["err-data"] === "string" ? status["err-data"] : "";
  const combined = `${stdout}\n${stderr}`.trim();
  return {
    output: combined,
    serviceActive: /\bssh_service=active\b/.test(combined),
    portListening: /\bssh_port=listening\b/.test(combined),
  };
}
