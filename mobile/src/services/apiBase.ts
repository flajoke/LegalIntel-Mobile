import Constants from 'expo-constants';
import { Platform } from 'react-native';

export class ApiError extends Error {}
export function normalizeApiUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new ApiError('Введите адрес вида http://192.168.1.10:8000'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new ApiError('Укажите только http(s)://адрес:порт, без пути, пароля и параметров.');
  }
  return url.origin;
}
export function defaultApiUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) return configured;
  if (Platform.OS === 'web' && typeof window !== 'undefined') return `http://${window.location.hostname}:8000`;
  const hostname = Constants.expoConfig?.hostUri?.split(':')[0] ?? '';
  if (hostname && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)) return `http://${hostname}:8000`;
  return Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://127.0.0.1:8000';
}
