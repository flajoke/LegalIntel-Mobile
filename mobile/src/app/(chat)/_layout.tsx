import { useWindowDimensions, View } from 'react-native';
import { Drawer, getDrawerStatusFromState } from 'expo-router/drawer';
import { HistoryDrawer } from '@/features/history/HistoryDrawer';
import { useTheme } from '@/ui/theme';

export default function ChatLayout() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  return <Drawer drawerContent={props => {
    const hidden = width < 1000 && getDrawerStatusFromState(props.state) === 'closed';
    return <View style={{ flex: 1 }} aria-hidden={hidden} accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}>
      <HistoryDrawer onClose={() => props.navigation.closeDrawer()} />
    </View>;
  }} screenOptions={{
    headerShown: false, drawerType: width >= 1000 ? 'permanent' : 'front',
    drawerStyle: { width: width >= 1000 ? 300 : Math.min(width * 0.86, 340), backgroundColor: theme.sidebar },
    overlayColor: theme.scrim, swipeEdgeWidth: 32, swipeEnabled: !theme.reduceMotion,
    sceneStyle: { backgroundColor: theme.background },
  }}><Drawer.Screen name="index" options={{ title: 'LegalIntel' }} /></Drawer>;
}
