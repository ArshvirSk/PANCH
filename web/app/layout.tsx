import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
import { AuthProvider } from '../lib/auth';
import { missingConfig } from '../lib/config';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import './globals.css';

const description =
  'Three AI judges from different model families deliberate, cross-examine each other and publish a reasoned ruling. A simulated escrow settles the funds.';

export const metadata: Metadata = {
  title: { default: 'Panch · AI arbitration for small cross-border disputes', template: '%s · Panch' },
  description,
  applicationName: 'Panch',
  openGraph: {
    title: 'Panch · The AI panchayat for disputes no court will hear',
    description,
    type: 'website',
    siteName: 'Panch',
  },
  twitter: { card: 'summary', title: 'Panch', description },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbf8f3' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1117' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">Skip to content</a>
        <AuthProvider>
          <Header />
          {missingConfig.length > 0 && (
            <div className="config-banner" role="alert">
              This build is missing configuration: {missingConfig.join(', ')}.
            </div>
          )}
          <main id="main" className="main" tabIndex={-1}>{children}</main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
