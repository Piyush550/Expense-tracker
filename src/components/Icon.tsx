// The handful of line icons the app uses, drawn inline (24×24, stroke = currentColor).
const PATHS = {
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  phone: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2",
  palette: "M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.2-1.6-.4-.9.2-1.9 1.2-1.9H17a4 4 0 0 0 4-4c0-5-4-8.5-9-8.5zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01",
  logout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10",
  chevronUp: "M6 15l6-6 6 6",
  chevronDown: "M6 9l6 6 6-6",
  check: "M5 12l5 5L20 7",
  key: "M12 15a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM11 12l9-9M16 7l3 3M18 5l2 2",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7l1-8z",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
