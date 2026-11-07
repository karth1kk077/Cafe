import type { ReactNode } from "react";

/**
 * One hand-drawn icon family: 24px grid, 1.7 stroke, round caps and joins.
 * Emoji and unicode glyphs are never used as UI icons — they render
 * differently on every platform and carry no shared weight.
 */
export interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

function Svg({
  children,
  size = 20,
  className,
  strokeWidth = 1.7,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

export function CoffeeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 8.5h12v5.5a4.5 4.5 0 0 1-4.5 4.5h-3A4.5 4.5 0 0 1 5 14V8.5Z" />
      <path d="M17 9.5h1.1a2.4 2.4 0 0 1 0 4.8H17" />
      <path d="M3.5 21h15" />
      <path d="M8 3v2.2M12 2.2v2.8" />
    </Svg>
  );
}

/** Cup and steam mark used as the product's logo. */
export function BrandCupIcon(props: IconProps) {
  return (
    <Svg {...props} strokeWidth={1.6}>
      <path d="M4.5 9h11v5.4a4.6 4.6 0 0 1-4.6 4.6H9.1a4.6 4.6 0 0 1-4.6-4.6V9Z" />
      <path d="M15.5 10h1.2a2.3 2.3 0 0 1 0 4.6h-1.2" />
      <path d="M3 20.5h14" />
      <path d="M7.4 3.2c-1 1.2-1 2.3 0 3.4M11 2.4c-1 1.2-1 2.3 0 3.4" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6.8" />
      <path d="m16.2 16.2 4.3 4.3" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8" />
    </Svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4.8V11h-6.2" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m4.8 12.6 4.9 4.9L19.4 6.7" />
    </Svg>
  );
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.4 2.8 2.8 5.4-6" />
    </Svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.6 21.4 20H2.6L12 3.6Z" />
      <path d="M12 9.2v4.6" />
      <path d="M12 17.2h.01" />
    </Svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.8h.01" />
    </Svg>
  );
}

export function ReceiptIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 3.5h12v17l-2.5-1.6L13 20.5l-2.5-1.6L8 20.5 6 19V3.5Z" />
      <path d="M9 8h6M9 11.5h6M9 15h3.5" />
    </Svg>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M18 8.8a6 6 0 0 0-12 0c0 6.2-2.6 6.4-2.6 8.2h17.2c0-1.8-2.6-2-2.6-8.2Z" />
      <path d="M10 20.4h4" />
    </Svg>
  );
}

export function BellOffIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M18 8.8a6 6 0 0 0-9.4-4.9M6 9.6c0 5.7-2.6 5.9-2.6 7.4h13" />
      <path d="M10 20.4h4" />
      <path d="M3.4 3.4 20.6 20.6" />
    </Svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function MinusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12h14" />
    </Svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9.2" cy="8" r="3.2" />
      <path d="M3.4 19.6a5.8 5.8 0 0 1 11.6 0" />
      <path d="M16 5.2a3 3 0 0 1 0 5.6" />
      <path d="M17.4 14.4a6 6 0 0 1 3.2 5.2" />
    </Svg>
  );
}

export function GridIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.4" />
    </Svg>
  );
}

export function MenuBookIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 5.6A2.6 2.6 0 0 1 6.6 3H20v15H6.6A2.6 2.6 0 0 0 4 20.6V5.6Z" />
      <path d="M4 20.6A2.6 2.6 0 0 1 6.6 18H20" />
      <path d="M8 7h8M8 11h5" />
    </Svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 2.6v2.6M12 18.8v2.6M4.3 6.4l1.8 1.8M17.9 15.8l1.8 1.8M2.6 12h2.6M18.8 12h2.6M4.3 17.6l1.8-1.8M17.9 8.2l1.8-1.8" />
    </Svg>
  );
}

export function ClipboardIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2" />
      <path d="M9 4.5V3.2h6v1.3" />
      <path d="M9 10h6M9 13.5h6M9 17h3.5" />
    </Svg>
  );
}

export function LogOutIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3.5" />
      <path d="m9.5 16.5-4.5-4.5 4.5-4.5" />
      <path d="M15 12H5" />
    </Svg>
  );
}

export function LogInIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.5 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3.5" />
      <path d="m15 8 4 4-4 4" />
      <path d="M19 12H9" />
    </Svg>
  );
}

export function QrCodeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
      <path d="M14 14h2.5v2.5H14zM19 14h1.5M14 19h1.5M19 19h1.5" />
    </Svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="9" width="11.5" height="11.5" rx="2" />
      <path d="M5.5 15H4.4a1 1 0 0 1-1-1V4.4a1 1 0 0 1 1-1H14a1 1 0 0 1 1 1v1.1" />
    </Svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5v11.5" />
      <path d="m7.2 10.2 4.8 4.8 4.8-4.8" />
      <path d="M4 20.5h16" />
    </Svg>
  );
}

export function PrinterIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.5 9V3.5h11V9" />
      <rect x="3.5" y="9" width="17" height="8" rx="2" />
      <path d="M7 17h10v3.5H7z" />
    </Svg>
  );
}

export function ExternalLinkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 4h6v6" />
      <path d="m20 4-8.5 8.5" />
      <path d="M18 13.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5.5" />
    </Svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 12h16" />
      <path d="m14 6 6 6-6 6" />
    </Svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 12H4" />
      <path d="m10 6-6 6 6 6" />
    </Svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m9 5.5 6.5 6.5L9 18.5" />
    </Svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.2 1.9" />
    </Svg>
  );
}

export function UtensilsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 3.2v7a2 2 0 0 0 4 0v-7" />
      <path d="M9 10.2v10.6" />
      <path d="M17 3.2v17.6" />
      <path d="M17 3.2c2.3 1.1 2.9 4.6 0 6.4" />
    </Svg>
  );
}

export function ConciergeBellIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 19.5h18" />
      <path d="M5.2 19.5a6.8 6.8 0 0 1 13.6 0" />
      <path d="M12 5.5v3.2" />
      <circle cx="12" cy="4.2" r="1.1" />
    </Svg>
  );
}

export function ShoppingBagIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 8h12l1 13H5L6 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </Svg>
  );
}

export function ScanIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 8.5V5.4a1.4 1.4 0 0 1 1.4-1.4H8.5" />
      <path d="M15.5 4h3.1A1.4 1.4 0 0 1 20 5.4v3.1" />
      <path d="M20 15.5v3.1a1.4 1.4 0 0 1-1.4 1.4h-3.1" />
      <path d="M8.5 20H5.4A1.4 1.4 0 0 1 4 18.6v-3.1" />
      <path d="M4 12h16" />
    </Svg>
  );
}

export function LeafIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 4.2C11.8 4.2 7 8.2 7 13.8a5.2 5.2 0 0 0 5.2 5.2C18 19 20 11.8 20 4.2Z" />
      <path d="M4.2 21c1-5.2 4.2-8.4 9.2-10.4" />
    </Svg>
  );
}

export function SparkleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
    </Svg>
  );
}
