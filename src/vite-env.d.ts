/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

interface ImportMetaEnv {
  readonly VITE_WEREAD_API_URL: string;
  readonly VITE_COVER_PROXY: string;
  readonly VITE_SKILL_VERSION: string;
  readonly VITE_ICP_RECORD_NO: string;
  readonly VITE_ICP_RECORD_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
