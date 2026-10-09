import type { CSSProperties } from "react";
const paths = {
  terminal: "m5 7 5 5-5 5m8 0h6",
  sessions: "M4 4h16v12H8l-4 4V4m4 4h8m-8 4h5",
  folder: "M3 7V5h6l2 2h10v13H3V7Z",
  file: "M5 3h9l5 5v13H5V3Zm9 0v6h5M9 13h6m-6 4h6",
  code: "m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18",
  chat: "M4 4h16v13H9l-5 4V4Z",
  sun: "M12 3V1m0 22v-2M3 12H1m22 0h-2M5.6 5.6 4.2 4.2m15.6 15.6-1.4-1.4m0-12.8 1.4-1.4M4.2 19.8l1.4-1.4M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z",
  moon: "M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z",
  plus: "M12 5v14M5 12h14",
  refresh:
    "M20 7v5h-5M4 17v-5h5M5.1 8a8 8 0 0 1 13.6-3L20 7M4 17l1.3 2A8 8 0 0 0 19 16",
  close: "m6 6 12 12M6 18 18 6",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  chevron: "m9 5 7 7-7 7",
  save: "M4 3h14l3 3v15H3V3h1Zm3 0v6h10V3M7 21v-8h10v8",
  send: "M12 19V5m-7 7 7-7 7 7",
  stop: "M6 6h12v12H6Z",
  copy: "M9 9h12v12H9Zm-6 6V3h12",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  logout: "M9 3H3v18h6m5-14 5 5-5 5m-7-5h12",
  activity: "M2 12h4l3-8 6 16 3-8h4",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6",
  search: "m16 16 5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
};
export type IconName = keyof typeof paths;
export function Icon({
  name,
  className = "",
  style,
}: {
  name: IconName;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={"icon " + className}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
