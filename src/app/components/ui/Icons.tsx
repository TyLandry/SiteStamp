// One outline icon set at 16px, 1.5px stroke. Decorative unless a label is passed.

type IconProps = { label?: string };

function Svg({ label, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 16 16"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function TodayIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
    </Svg>
  );
}

export function ClockIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.5V8l2.5 1.5" />
    </Svg>
  );
}

export function CrewIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="6" cy="5.5" r="2.5" />
      <path d="M1.5 14c.6-2.6 2.3-4 4.5-4s3.9 1.4 4.5 4M10.5 3.2a2.4 2.4 0 0 1 0 4.6M12.2 10.4c1.2.6 2 1.8 2.3 3.6" />
    </Svg>
  );
}

export function PayrollIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
      <circle cx="8" cy="8" r="1.75" />
      <path d="M4 6v4M12 6v4" />
    </Svg>
  );
}

export function SettingsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7" />
      <circle cx="10.5" cy="4.5" r="1.5" />
      <circle cx="5.5" cy="11.5" r="1.5" />
    </Svg>
  );
}

export function PinIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 14.5s-4.5-4.2-4.5-7.7a4.5 4.5 0 0 1 9 0c0 3.5-4.5 7.7-4.5 7.7z" />
      <circle cx="8" cy="6.8" r="1.6" />
    </Svg>
  );
}

export function ChevronLeftIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10 3.5 5.5 8l4.5 4.5" />
    </Svg>
  );
}

export function ChevronRightIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m6 3.5 4.5 4.5L6 12.5" />
    </Svg>
  );
}

export function ChevronDownIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 6.5 8 10l3.5-3.5" />
    </Svg>
  );
}

export function PrintIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 6V2.5h7V6M4.5 11.5h-2v-5h11v5h-2" />
      <rect x="4.5" y="9.5" width="7" height="4.5" />
    </Svg>
  );
}
