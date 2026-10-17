import React from 'react';
import { Subtitles, Sparkles } from 'lucide-react';

interface NavbarProps {
  isBackendOnline: boolean;
  onReset?: () => void;
  showNewButton?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({ isBackendOnline, onReset, showNewButton }) => {
  return (
    <header className="site-header">
      <div className="brand" onClick={onReset} style={{ cursor: onReset ? 'pointer' : 'default' }}>
        <div className="brand-icon">
          <Subtitles size={17} strokeWidth={2.5} />
        </div>
        <span className="brand-name">LiveSub</span>
        <span className="brand-tag">Studio</span>
      </div>

      <div className="header-meta">
        <div className={`status-badge ${isBackendOnline ? 'online' : 'offline'}`}>
          <span className="status-dot" />
          <span>{isBackendOnline ? 'AI Backend Ready' : 'Backend Disconnected'}</span>
        </div>

        {showNewButton && onReset && (
          <button className="btn btn-secondary btn-sm" onClick={onReset}>
            <Sparkles size={13} />
            <span>New Video</span>
          </button>
        )}
      </div>
    </header>
  );
};
