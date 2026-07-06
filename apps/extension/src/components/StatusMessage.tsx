type StatusTone = 'info' | 'success' | 'error';

export function StatusMessage({
  message,
  tone = 'info',
}: {
  message: string | null;
  tone?: StatusTone;
}) {
  if (!message) return null;

  return (
    <p className={`status-message status-message--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {message}
    </p>
  );
}
