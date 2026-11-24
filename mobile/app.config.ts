import type { ExpoConfig } from 'expo/config';

// HTTP is allowed only for local development. Set APP_ENV=production for a
// release with HTTPS. These native settings take effect after prebuild/rebuild.
const localDevelopment = process.env.APP_ENV !== 'production';

const config: ExpoConfig = {
  name: 'LegalIntel',
  slug: 'legalintel',
  scheme: 'legalintel',
  version: '0.6.0',
  orientation: 'default',
  userInterfaceStyle: 'automatic',
  icon: './assets/logo.png',
  ios: {
    bundleIdentifier: 'com.legalintel.mobile',
    supportsTablet: true,
    infoPlist: {
      NSLocalNetworkUsageDescription: 'Подключение к локальному серверу LegalIntel на вашем компьютере.',
      NSAppTransportSecurity: localDevelopment
        ? { NSAllowsArbitraryLoads: true, NSAllowsLocalNetworking: true }
        : { NSAllowsArbitraryLoads: false },
    },
  },
  android: {
    package: 'com.legalintel.mobile',
    softwareKeyboardLayoutMode: 'resize',
  },
  web: { bundler: 'metro', output: 'single', favicon: './assets/logo.png' },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-secure-store',
    ['expo-splash-screen', {
      image: './assets/logo.png', imageWidth: 100,
      resizeMode: 'contain', backgroundColor: '#F7FAFD',
      dark: { image: './assets/logo.png', backgroundColor: '#151C25' },
    }],
    ['expo-build-properties', { android: { usesCleartextTraffic: localDevelopment } }],
  ],
};

export default config;
