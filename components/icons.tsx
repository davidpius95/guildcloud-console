type IconProps = { className?: string };

function base(className?: string) {
  return {
    className: className ?? "h-4 w-4",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

export const IconHome = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.8V20h14V9.8" />
  </svg>
);

export const IconProjects = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.4h9A1.5 1.5 0 0 1 21 9.9v8.6a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z" />
  </svg>
);

export const IconServer = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <rect x="3" y="4" width="18" height="7" rx="1.5" />
    <rect x="3" y="13" width="18" height="7" rx="1.5" />
    <path d="M7 7.5h.01M7 16.5h.01" />
  </svg>
);

export const IconCube = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9Z" />
    <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
  </svg>
);

export const IconDatabase = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
    <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
  </svg>
);

export const IconBucket = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M4 6h16l-1.6 13.2a1.5 1.5 0 0 1-1.5 1.3H7.1a1.5 1.5 0 0 1-1.5-1.3Z" />
    <path d="M9 3h6" />
  </svg>
);

export const IconDisk = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const IconFunction = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M13 4h-1a3 3 0 0 0-3 3v10a3 3 0 0 1-3 3H5" />
    <path d="M7 12h9" />
    <path d="m17 8 4 4-4 4" />
  </svg>
);

export const IconNetwork = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="12" cy="5" r="2.2" />
    <circle cx="5" cy="19" r="2.2" />
    <circle cx="19" cy="19" r="2.2" />
    <path d="M12 7.2v4.3M12 11.5 6.4 17M12 11.5 17.6 17" />
  </svg>
);

export const IconPulse = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M3 12h4l2.5-6 4 12 2.5-6h5" />
  </svg>
);

export const IconStore = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M4 4h16l1 5a3 3 0 0 1-5.5 1.8A3 3 0 0 1 12 12a3 3 0 0 1-3.5-1.2A3 3 0 0 1 3 9Z" />
    <path d="M5 12v8h14v-8" />
  </svg>
);

export const IconWallet = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <rect x="3" y="6" width="18" height="13" rx="2" />
    <path d="M3 10h18" />
    <circle cx="17" cy="14.5" r="1" />
  </svg>
);

export const IconSettings = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 15a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V4a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7 2 2 0 0 1 0 4Z" />
  </svg>
);

export const IconSupport = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.3" />
    <path d="M12 17h.01" />
  </svg>
);

export const IconBell = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M18 8a6 6 0 0 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
    <path d="M10.3 20a2 2 0 0 0 3.4 0" />
  </svg>
);

export const IconPlus = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconChevron = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const IconArrowRight = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const IconShield = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M12 3 5 6v6c0 4.4 3 7.9 7 9 4-1.1 7-4.6 7-9V6Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export const IconLock = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <rect x="4" y="10" width="16" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 1 1 8 0v3" />
  </svg>
);

export const IconTransfer = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M4 19h16" />
  </svg>
);

export const IconCloud = ({ className }: IconProps) => (
  <svg {...base(className)} strokeWidth={1.5}>
    <path d="M7.5 18a4.5 4.5 0 0 1-.4-8.98 5.5 5.5 0 0 1 10.6-1.9A4.5 4.5 0 0 1 17 18H7.5Z" />
  </svg>
);

export const IconGrid = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <rect x="14" y="14" width="6" height="6" rx="1" />
  </svg>
);

/* Operating System & Solution Logos */

export const IconUbuntuLogo = ({ className }: IconProps) => (
  <svg className={className ?? "h-6 w-6 text-[#E95420]"} viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
    <circle cx="12" cy="4.5" r="1.8" fill="currentColor" />
    <circle cx="5.5" cy="15.8" r="1.8" fill="currentColor" />
    <circle cx="18.5" cy="15.8" r="1.8" fill="currentColor" />
    <path
      d="M12 7.5A4.5 4.5 0 1 0 16.5 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

export const IconDebianLogo = ({ className }: IconProps) => (
  <svg className={className ?? "h-6 w-6 text-[#D70A53]"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12 21.5c-4.5 0-8.5-3.5-8.5-8.5 0-6 5-10 10.5-10 4.5 0 7.5 3 7.5 6.5 0 3.5-2.5 5.5-5 5.5-1.8 0-3-1.2-3-2.8 0-2.2 2-3.2 4-3.2" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
  </svg>
);

export const IconFedoraLogo = ({ className }: IconProps) => (
  <svg className={className ?? "h-6 w-6 text-[#51A2DA]"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9Z" />
    <path d="M12 7v5a2 2 0 0 0 2 2h3" />
    <path d="M9 12h6" />
  </svg>
);

export const IconRockyLogo = ({ className }: IconProps) => (
  <svg className={className ?? "h-6 w-6 text-[#10B981]"} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2.5 20.5 7.5v9L12 21.5 3.5 16.5v-9L12 2.5Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <path d="m7.5 15.5 4.5-7 4.5 7H7.5Z" />
  </svg>
);

export const IconAlmaLogo = ({ className }: IconProps) => (
  <svg className={className ?? "h-6 w-6 text-[#00A1FF]"} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 3 4 8v8l8 5 8-5V8l-8-5Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="3.5" />
  </svg>
);

export const IconArchLogo = ({ className }: IconProps) => (
  <svg className={className ?? "h-6 w-6 text-[#1793D1]"} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 3c-1.5 3.5-3 6.8-5 10.2 1.3.4 2.7.6 4.1.6 1.8 0 3.5-.3 5.1-.9L12 3Z" />
    <path d="M3.5 20.5C5.8 19 8.6 18 12 18s6.2 1 8.5 2.5c-2.8-5.8-5.7-11.8-8.5-17.5-2.8 5.7-5.7 11.7-8.5 17.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
  </svg>
);

export const IconDockerLogo = ({ className }: IconProps) => (
  <svg className={className ?? "h-6 w-6 text-[#2496ED]"} viewBox="0 0 24 24" fill="currentColor">
    <rect x="2" y="11" width="3.5" height="3" rx="0.5" />
    <rect x="6.5" y="11" width="3.5" height="3" rx="0.5" />
    <rect x="11" y="11" width="3.5" height="3" rx="0.5" />
    <rect x="15.5" y="11" width="3.5" height="3" rx="0.5" />
    <rect x="6.5" y="7" width="3.5" height="3" rx="0.5" />
    <rect x="11" y="7" width="3.5" height="3" rx="0.5" />
    <rect x="11" y="3" width="3.5" height="3" rx="0.5" />
    <path d="M1.5 15.5c2 2 5 2.5 8.5 2.5 6 0 10.5-3 12-7-1.5 0-3.5.5-4.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const IconWordPressLogo = ({ className }: IconProps) => (
  <svg className={className ?? "h-6 w-6 text-[#21759B]"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="9.5" />
    <path d="m4 12 4.5 10M8.5 8l3.5 10M15.5 8l-3.5 10M20 12l-4.5 10" />
  </svg>
);

/** Map a human-readable label like "Ubuntu 24.04 LTS" to a catalog image id. */
export function imageIdFromLabel(label: string): string | null {
  const l = label.toLowerCase();
  if (l.includes("ubuntu")) return "ubuntu-2404";
  if (l.includes("debian")) return "debian-12";
  if (l.includes("fedora")) return "fedora-41";
  if (l.includes("rocky")) return "rocky-9";
  if (l.includes("alma")) return "alma-9";
  if (l.includes("arch")) return "arch-linux";
  if (l.includes("docker")) return "docker";
  if (l.includes("wordpress")) return "wordpress";
  return null;
}

export function OSLogo({ imageId, className }: { imageId: string; className?: string }) {
  switch (imageId) {
    case "ubuntu-2404":
      return <IconUbuntuLogo className={className} />;
    case "debian-12":
      return <IconDebianLogo className={className} />;
    case "fedora-41":
      return <IconFedoraLogo className={className} />;
    case "rocky-9":
      return <IconRockyLogo className={className} />;
    case "alma-9":
      return <IconAlmaLogo className={className} />;
    case "arch-linux":
      return <IconArchLogo className={className} />;
    case "docker":
      return <IconDockerLogo className={className} />;
    case "wordpress":
      return <IconWordPressLogo className={className} />;
    default:
      return <IconServer className={className} />;
  }
}
