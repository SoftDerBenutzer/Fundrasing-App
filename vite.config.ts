import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: true, // Listen on all local IPs
    port: 5173
  },
  plugins: [
    react(),
    process.env.NODE_ENV !== 'production' ? basicSsl() : [],
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Fundraising Map',
        short_name: 'FundMap',
        description: 'Offline Map for Door-to-Door Fundraising',
        theme_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
})
