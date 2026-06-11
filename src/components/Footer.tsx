const ICP_RECORD_NO = import.meta.env.VITE_ICP_RECORD_NO || '';
const ICP_RECORD_URL = import.meta.env.VITE_ICP_RECORD_URL || '';

export default function Footer() {
  if (!ICP_RECORD_NO) return null;

  return (
    <footer
      className="border-t py-4 text-center text-xs"
      style={{ borderColor: 'var(--border-light)', color: 'var(--text-muted)' }}
    >
      <a
        href={ICP_RECORD_URL || '#'}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline"
        style={{ color: 'var(--text-muted)' }}
      >
        {ICP_RECORD_NO}
      </a>
    </footer>
  );
}
