import { router } from 'expo-router';
import { HistoryDrawer } from '@/features/history/HistoryDrawer';

// Accessibility alternative to the animated drawer. No screen translation.
export default function HistoryScreen() {
  return <HistoryDrawer showClose onClose={() => router.canGoBack() ? router.back() : router.replace('/')} />;
}
