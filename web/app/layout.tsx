import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '../lib/auth';
import { missingConfig } from '../lib/config';
import { Header } from '../components/Header';
import { ApiStatus } from '../components/ApiStatus';
import './globals.css';

export const metadata: Metadata = {
  title: 'Panch: AI arbitration for small cross-border disputes',
  description:
    'A panel of AI judges from different model families deliberates, cross-examines and publishes a reasoned ruling. Simulated escrow settles the funds.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <Header />
          {missingConfig.length > 0 && (
            <div className="config-banner" role="alert">
              This build is missing configuration: {missingConfig.join(', ')}.
            </div>
          )}
          <main className="container main">{children}</main>
          <footer className="site-footer">
            <div className="container footer-inner">
              <span>Panch · synthetic demo data · simulated escrow · not legal advice</span>
              <ApiStatus />
            </div>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
