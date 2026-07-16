import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import './UtilityPageShell.css';

type UtilityPageShellProps = {
  backToWorkspaceLabel: string;
  children: ReactNode;
  pageLabel: string;
};

export function UtilityPageShell({
  backToWorkspaceLabel,
  children,
  pageLabel,
}: UtilityPageShellProps) {
  return (
    <main className="utility-page-shell">
      <div className="utility-page-frame">
        <header className="utility-page-header">
          <div className="utility-page-identity">
            <span aria-hidden="true" className="utility-page-mark">TS</span>
            <div className="utility-page-title-lockup">
              <span className="utility-page-wordmark">Tabstow</span>
              <h1>{pageLabel}</h1>
            </div>
          </div>
          <a
            className="utility-page-back"
            href={chrome.runtime.getURL('/newtab.html')}
          >
            <ArrowLeft aria-hidden="true" size={16} />
            {backToWorkspaceLabel}
          </a>
        </header>
        <div className="utility-page-content">{children}</div>
      </div>
    </main>
  );
}
