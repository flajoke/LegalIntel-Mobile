import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { AccessibilityInfo, Platform, useColorScheme } from 'react-native';
import * as SystemUI from 'expo-system-ui';
import { useChatState } from '@/state/chatStore';
import { PlatformTheme } from './PlatformTheme';

const light = {
  dark: false, background: '#F7FAFD', surface: '#FFFFFF', sidebar: '#EDF3F8',
  text: '#202D3B', secondary: '#5D7185', muted: '#71869A', border: '#DCE6EF',
  accent: '#2878B6', accentSoft: '#E4F1FB', onAccent: '#FFFFFF',
  bubble: '#E8F0F7', danger: '#AC3D35', dangerSoft: '#FCEEEB',
  scrollbar: '#8DAEC9', scrollbarHover: '#527FA3',
  chrome: 'rgba(247,250,253,0.9)', scrim: 'rgba(15,31,48,0.3)',
};
const dark: typeof light = {
  dark: true, background: '#151C25', surface: '#1E2936', sidebar: '#19232F',
  text: '#EDF4FA', secondary: '#ADC0D2', muted: '#889FB5', border: '#314253',
  accent: '#8CC8F4', accentSoft: '#223D55', onAccent: '#132C40',
  bubble: '#26394B', danger: '#F6A397', dangerSoft: '#422925',
  scrollbar: '#496C8B', scrollbarHover: '#7CA7CA',
  chrome: 'rgba(21,28,37,0.92)', scrim: 'rgba(0,0,0,0.5)',
};
type Theme = typeof light & { reduceMotion: boolean; reduceTransparency: boolean };
const ThemeContext = createContext<Theme>({ ...light, reduceMotion: false, reduceTransparency: false });

export function ThemeProvider({ children }: PropsWithChildren) {
  const { data } = useChatState();
  const system = useColorScheme();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [reduceTransparency, setReduceTransparency] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    if (Platform.OS !== 'ios') return () => motion.remove();
    void AccessibilityInfo.isReduceTransparencyEnabled().then(setReduceTransparency);
    const transparency = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduceTransparency);
    return () => { motion.remove(); transparency.remove(); };
  }, []);
  const isDark = data.settings.theme === 'dark' || (data.settings.theme === 'system' && system === 'dark');
  const theme = isDark ? dark : light;
  useEffect(() => { void SystemUI.setBackgroundColorAsync(theme.background).catch(() => undefined); }, [theme.background]);
  return <ThemeContext.Provider value={{ ...theme, reduceMotion, reduceTransparency }}><PlatformTheme theme={theme} />{children}</ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);
