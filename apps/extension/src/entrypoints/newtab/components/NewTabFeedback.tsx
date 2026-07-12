type Props = {
  message: string | null;
  tone: 'info' | 'success' | 'error';
};

export function NewTabFeedback({ message, tone }: Props) {
  if (!message) return null;

  return (
    <p
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={`newtab-feedback status-message status-message--${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {message}
    </p>
  );
}
