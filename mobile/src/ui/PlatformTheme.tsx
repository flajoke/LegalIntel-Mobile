export type PlatformThemeProps = {
  theme: { dark: boolean; accent: string; background: string; scrollbar: string; scrollbarHover: string };
};

// Native surfaces use the React Native theme directly.
export function PlatformTheme(_props: PlatformThemeProps) { return null; }
