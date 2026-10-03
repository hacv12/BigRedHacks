import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.bigredhacks.brisa',
  appName: 'Brisa',
  webDir: 'dist-native',
  backgroundColor: '#ffffff',
  ios: { contentInset: 'never', preferredContentMode: 'mobile' },
  plugins: {
    SystemBars: { insetsHandling: 'css', style: 'LIGHT', hidden: false },
  },
};

export default config;
