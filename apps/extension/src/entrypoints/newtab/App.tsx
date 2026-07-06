export function App() {
  return (
    <main className="newtab-shell">
      <section className="newtab-header" aria-labelledby="tabstow-title">
        <div>
          <h1 id="tabstow-title">Tabstow</h1>
          <p>Stow, organize, and restore your browser tabs.</p>
        </div>
        <button type="button">Stow current window</button>
      </section>
      <section className="empty-state" aria-live="polite">
        No saved sessions yet.
      </section>
    </main>
  );
}
