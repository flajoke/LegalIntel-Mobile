import { useState, type ComponentProps, type PropsWithChildren } from 'react';
import { Image, Modal, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { BlurView } from 'expo-blur';
import { useTheme } from './theme';

export type IconName = ComponentProps<typeof Feather>['name'];
export function Icon({ name, size = 21, color }: { name: IconName; size?: number; color?: string }) {
  const theme = useTheme();
  return <Feather name={name} size={size} color={color ?? theme.text} accessible={false}
    aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}
export function LegalMark({ size = 40 }: { size?: number }) {
  return <Image accessible={false} source={require('../../assets/logo.png')} resizeMode="contain"
    style={{ width: size, height: size }} />;
}
export function IconButton({ name, label, onPress, disabled, accent, style }: {
  name: IconName; label: string; onPress: () => void; disabled?: boolean; accent?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
    disabled={disabled} onPress={onPress} hitSlop={4} style={({ pressed }) => [styles.iconButton,
      { backgroundColor: accent ? theme.accent : pressed ? theme.bubble : 'transparent', opacity: disabled ? 0.35 : pressed ? 0.7 : 1,
        transform: [{ scale: pressed ? 0.96 : 1 }] }, style]}>
    <Icon name={name} color={accent ? theme.onAccent : theme.text} />
  </Pressable>;
}
export function Button({ children, onPress, secondary = false, danger = false, disabled = false }: PropsWithChildren<{
  onPress: () => void; secondary?: boolean; danger?: boolean; disabled?: boolean;
}>) {
  const theme = useTheme();
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled }}
    style={({ pressed }) => [styles.button, { backgroundColor: danger ? theme.dangerSoft : secondary ? theme.bubble : theme.accent,
      opacity: disabled ? 0.4 : pressed ? 0.75 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
    <Text style={{ color: danger ? theme.danger : secondary ? theme.text : theme.onAccent, fontWeight: '600', fontSize: 16, textAlign: 'center' }}>{children}</Text>
  </Pressable>;
}
export function Chrome({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const theme = useTheme();
  return <View style={[{ overflow: 'hidden', backgroundColor: theme.reduceTransparency || Platform.OS === 'android' ? theme.background : theme.chrome }, style]}>
    {!theme.reduceTransparency && Platform.OS !== 'android'
      ? <BlurView intensity={35} tint={theme.dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} pointerEvents="none" /> : null}
    {children}
  </View>;
}
export function Dialog({ visible, title, children, onClose }: PropsWithChildren<{ visible: boolean; title: string; onClose: () => void }>) {
  const theme = useTheme();
  return <Modal transparent visible={visible} animationType={theme.reduceMotion ? 'none' : 'fade'} onRequestClose={onClose}>
    <View style={[styles.dialogBackdrop, { backgroundColor: theme.scrim }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Закрыть окно" />
      <View accessibilityViewIsModal style={[styles.dialogCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.dialogTitle}><Text accessibilityRole="header" style={{ flex: 1, fontSize: 21, fontWeight: '600', color: theme.text }}>{title}</Text>
          <IconButton name="x" label="Закрыть" onPress={onClose} /></View>
        {children}
      </View>
    </View>
  </Modal>;
}
export function ConfirmButton({ label, title, description, action, disabled }: {
  label: string; title: string; description: string; action: () => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const theme = useTheme();
  return <><Button danger disabled={disabled} onPress={() => setOpen(true)}>{label}</Button>
    <Dialog visible={open} title={title} onClose={() => setOpen(false)}>
      <Text style={{ fontSize: 16, lineHeight: 24, color: theme.secondary, marginBottom: 22 }}>{description}</Text>
      <View style={{ gap: 10 }}><Button danger onPress={() => { setOpen(false); action(); }}>Удалить</Button>
        <Button secondary onPress={() => setOpen(false)}>Отмена</Button></View>
    </Dialog></>;
}
const styles = StyleSheet.create({
  iconButton: { minWidth: 44, minHeight: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  button: { minHeight: 50, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  dialogBackdrop: { flex: 1, justifyContent: 'center', padding: 24 },
  dialogCard: { width: '100%', maxWidth: 520, maxHeight: '92%', alignSelf: 'center', borderRadius: 26, padding: 22, borderWidth: StyleSheet.hairlineWidth },
  dialogTitle: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
});
