import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.bigredhacks.brisa',
  appName: 'Brisa',
  webDir: 'dist-native',
  backgroundColor: '#ffffff',
  // Native WebViews may have no HTTP referrer; identify the app to tile hosts.
  appendUserAgent: 'Brisa/0.1 (+https://github.com/hacv12/BigRedHacks)',
  ios: { contentInset: 'never', preferredContentMode: 'mobile' },
  plugins: {
    SystemBars: { insetsHandling: 'css', style: 'LIGHT', hidden: false },
  },
};

export default config;
