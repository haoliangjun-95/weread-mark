/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

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
