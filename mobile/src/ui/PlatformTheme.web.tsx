import { useEffect } from 'react';
import type { PlatformThemeProps } from './PlatformTheme';
import './scrollbars.css';

export function PlatformTheme({ theme }: PlatformThemeProps) {
  useEffect(() => {
    const root = document.documentElement;
    root.style.colorScheme = theme.dark ? 'dark' : 'light';
    root.style.backgroundColor = theme.background;
    root.style.setProperty('--legalintel-accent', theme.accent);
    root.style.setProperty('--legalintel-scrollbar', theme.scrollbar);
    root.style.setProperty('--legalintel-scrollbar-hover', theme.scrollbarHover);
  }, [theme]);
  return null;
}
