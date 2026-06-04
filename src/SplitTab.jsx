import React, { useState, useRef, useEffect } from 'react';
import TerminalTab from './TerminalTab';

export default function SplitTab({
  tab,
  connections,
  otherTerminalTabs,
  onDetachTab,
  onCloseSubTab,
  onAddSubTab,
  onAddConnectionToSplit
}) {
  const [broadcastCommand, setBroadcastCommand] = useState('');
  const [broadcastTargets, setBroadcastTargets] = useState(new Set());
  const socketSendersRef = useRef({});
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const addMenuRef = useRef(null);
  const [isSignalMenuOpen, setIsSignalMenuOpen] = useState(false);
  const signalMenuRef = useRef(null);

  // Close dropdowns on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (addMenuRef.current && !addMenuRef.current.contains(event.target)) {
        setIsAddMenuOpen(false);
      }
      if (signalMenuRef.current && !signalMenuRef.current.contains(event.target)) {
        setIsSignalMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Automatically add all sub-tabs to broadcast targets when sub-tabs list changes
  useEffect(() => {
    setBroadcastTargets(prev => {
      const next = new Set(prev);
      // Add any subTabs that aren't already in the targets
      tab.subTabs.forEach(st => {
        if (!prev.has(st.id)) {
          next.add(st.id);
        }
      });
      // Remove any targets that are no longer in the subTabs
      const subTabIds = new Set(tab.subTabs.map(st => st.id));
      for (const id of next) {
        if (!subTabIds.has(id)) {
          next.delete(id);
        }
      }
      return next;
    });
  }, [tab.subTabs]);

  const handleRegisterSocket = (subTabId, sendFunc) => {
    if (sendFunc) {
      socketSendersRef.current[subTabId] = sendFunc;
    } else {
      delete socketSendersRef.current[subTabId];
    }
  };

  const handleToggleBroadcastTarget = (subTabId) => {
    setBroadcastTargets(prev => {
      const next = new Set(prev);
      if (next.has(subTabId)) {
        next.delete(subTabId);
      } else {
        next.add(subTabId);
      }
      return next;
    });
  };

  const handleToggleAllBroadcastTargets = () => {
    if (broadcastTargets.size === tab.subTabs.length) {
      // Clear all
      setBroadcastTargets(new Set());
    } else {
      // Select all
      setBroadcastTargets(new Set(tab.subTabs.map(st => st.id)));
    }
  };

  const handleSendSignal = (signal) => {
    broadcastTargets.forEach(subTabId => {
      const sendFunc = socketSendersRef.current[subTabId];
      if (sendFunc) {
        sendFunc(signal);
      }
    });
  };

  const handleBroadcastSubmit = (e) => {
    e.preventDefault();
    if (!broadcastCommand.trim()) return;

    // Send the command string + Enter carriage return to all selected socket senders
    handleSendSignal(broadcastCommand + '\r');

    setBroadcastCommand('');
  };

  const handleBroadcastKeyDown = (e) => {
    // If Ctrl+C is pressed inside the broadcast input
    if (e.ctrlKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      handleSendSignal('\x03');
    }
    // If Ctrl+D is pressed inside the broadcast input
    else if (e.ctrlKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      handleSendSignal('\x04');
    }
    // If Ctrl+Z is pressed inside the broadcast input
    else if (e.ctrlKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      handleSendSignal('\x1a');
    }
    // If Ctrl+O is pressed inside the broadcast input
    else if (e.ctrlKey && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      handleSendSignal('\x0f');
    }
    // If Ctrl+X is pressed inside the broadcast input
    else if (e.ctrlKey && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      handleSendSignal('\x18');
    }
    // If Escape is pressed inside the broadcast input
    else if (e.key === 'Escape') {
      e.preventDefault();
      handleSendSignal('\x1b');
    }
  };

  const getGridDimensions = (count) => {
    if (count <= 1) return { cols: 1, rows: 1 };
    if (count === 2) return { cols: 2, rows: 1 };
    if (count <= 4) return { cols: 2, rows: 2 };
    if (count <= 6) return { cols: 3, rows: 2 };
    if (count <= 9) return { cols: 3, rows: 3 };
    if (count <= 12) return { cols: 4, rows: 3 };
    if (count <= 16) return { cols: 4, rows: 4 };
    if (count <= 20) return { cols: 5, rows: 4 };
    return { cols: 6, rows: Math.ceil(count / 6) };
  };

  const subTabsCount = tab.subTabs.length;
  const { cols, rows } = getGridDimensions(subTabsCount);
  
  let gridClass = 'split-grid';
  if (subTabsCount > 2) {
    gridClass += ' compact-headers';
  }

  const gridStyle = {
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gridTemplateRows: `repeat(${rows}, 1fr)`
  };

  return (
    <div className="split-tab-container">
      {/* Broadcast Bar */}
      <div className="broadcast-bar glass-panel">
        <button
          type="button"
          className="btn-secondary select-all-btn"
          onClick={handleToggleAllBroadcastTargets}
          disabled={tab.subTabs.length === 0}
        >
          {broadcastTargets.size === tab.subTabs.length ? 'Deselect All' : 'Select All'}
        </button>

        {/* Add Session dropdown inside menu bar */}
        <div className="add-session-dropdown-container" ref={addMenuRef}>
          <button
            type="button"
            className="btn-primary add-session-menu-btn"
            onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
            disabled={tab.subTabs.length >= 24}
            title={tab.subTabs.length >= 24 ? "Maximum 24 sessions reached" : "Add session to grid"}
          >
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="14" height="14">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            <span>Add Session</span>
          </button>
          
          {isAddMenuOpen && (
            <div className="add-session-menu-dropdown glass-panel">
              <div className="add-action-group">
                <label className="add-action-label">Pull Open Tab</label>
                <select
                  className="form-select add-console-select"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      onAddSubTab(e.target.value);
                      setIsAddMenuOpen(false);
                    }
                  }}
                >
                  <option value="" disabled>Choose session...</option>
                  {otherTerminalTabs.length === 0 ? (
                    <option disabled>No standalone tabs open</option>
                  ) : (
                    otherTerminalTabs.map(ot => (
                      <option key={ot.id} value={ot.id}>{ot.title}</option>
                    ))
                  )}
                </select>
              </div>

              <div className="add-action-group">
                <label className="add-action-label">Saved Connection</label>
                <select
                  className="form-select add-console-select"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      const conn = connections.find(c => c.id === e.target.value);
                      if (conn) {
                        onAddConnectionToSplit(conn);
                      }
                      setIsAddMenuOpen(false);
                    }
                  }}
                >
                  <option value="" disabled>Choose host...</option>
                  {connections.length === 0 ? (
                    <option disabled>No connections</option>
                  ) : (
                    connections.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.host})</option>
                    ))
                  )}
                </select>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleBroadcastSubmit} className="broadcast-form">
          <input
            type="text"
            className="broadcast-input form-input"
            placeholder="Type command to broadcast (Ctrl+C, Ctrl+O, Ctrl+X, Esc supported)..."
            value={broadcastCommand}
            onChange={(e) => setBroadcastCommand(e.target.value)}
            onKeyDown={handleBroadcastKeyDown}
            disabled={broadcastTargets.size === 0}
          />
          <div className="add-session-dropdown-container" ref={signalMenuRef}>
            <button
              type="button"
              className="btn-secondary signal-menu-btn"
              onClick={() => setIsSignalMenuOpen(!isSignalMenuOpen)}
              disabled={broadcastTargets.size === 0}
              title="Send special control keys to marked tabs"
            >
              <span>Send Key</span>
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="10" height="10">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            
            {isSignalMenuOpen && (
              <div className="add-session-menu-dropdown signal-menu-dropdown glass-panel">
                <div 
                  className="context-menu-item" 
                  onClick={() => {
                    handleSendSignal('\x03');
                    setIsSignalMenuOpen(false);
                  }}
                >
                  <span>Ctrl + C (Interrupt)</span>
                </div>
                <div 
                  className="context-menu-item" 
                  onClick={() => {
                    handleSendSignal('\x0f');
                    setIsSignalMenuOpen(false);
                  }}
                >
                  <span>Ctrl + O (Output)</span>
                </div>
                <div 
                  className="context-menu-item" 
                  onClick={() => {
                    handleSendSignal('\x18');
                    setIsSignalMenuOpen(false);
                  }}
                >
                  <span>Ctrl + X (Exit)</span>
                </div>
                <div 
                  className="context-menu-item" 
                  onClick={() => {
                    handleSendSignal('\x1b');
                    setIsSignalMenuOpen(false);
                  }}
                >
                  <span>Escape (Esc)</span>
                </div>
              </div>
            )}
          </div>
          <button
            type="submit"
            className="btn-primary broadcast-send-btn"
            disabled={!broadcastCommand.trim() || broadcastTargets.size === 0}
          >
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9-7-9-7-9 7 9 7z" />
            </svg>
            Broadcast ({broadcastTargets.size})
          </button>
        </form>
      </div>

      {/* Grid of Terminals */}
      <div className={gridClass} style={gridStyle}>
        {tab.subTabs.map(subTab => (
          <div key={subTab.id} className="split-grid-cell glass-panel">
            <div className="split-cell-header">
              <div className="split-cell-header-left">
                <label className="split-cell-broadcast-checkbox">
                  <input
                    type="checkbox"
                    checked={broadcastTargets.has(subTab.id)}
                    onChange={() => handleToggleBroadcastTarget(subTab.id)}
                  />
                  <span className="checkbox-label">Broadcast</span>
                </label>
                <span className="split-cell-title" title={subTab.title}>{subTab.title}</span>
              </div>
              <div className="split-cell-actions">
                <button
                  className="split-cell-btn"
                  onClick={() => onDetachTab(subTab.id)}
                  title="Detach back to top tab bar"
                >
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="12" height="12">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
                  </svg>
                  <span>Detach</span>
                </button>
                <button
                  className="split-cell-btn close-btn"
                  onClick={() => onCloseSubTab(subTab.id)}
                  title="Close session"
                >
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="12" height="12">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="split-cell-terminal">
              <TerminalTab
                tab={subTab}
                onStatusChange={() => {}}
                onRegisterSocket={handleRegisterSocket}
              />
            </div>
          </div>
        ))}

        {/* Add Console grid card if subTabs count is less than 4 */}
        {subTabsCount < 4 && (
          <div className="split-grid-cell add-console-cell glass-panel">
            <div className="add-console-container">
              <div className="add-console-header-row">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="18" height="18" className="add-console-icon-small">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <h3 className="add-console-title">Add Session ({subTabsCount}/24)</h3>
              </div>
              
              <div className="add-console-actions">
                <div className="add-action-group">
                  <label className="add-action-label">Pull Open Tab</label>
                  <select
                    className="form-select add-console-select"
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) {
                        onAddSubTab(e.target.value);
                        e.target.value = '';
                      }
                    }}
                  >
                    <option value="" disabled>Choose session...</option>
                    {otherTerminalTabs.length === 0 ? (
                      <option disabled>No standalone tabs open</option>
                    ) : (
                      otherTerminalTabs.map(ot => (
                        <option key={ot.id} value={ot.id}>{ot.title}</option>
                      ))
                    )}
                  </select>
                </div>

                <div className="add-action-group">
                  <label className="add-action-label">Saved Connection</label>
                  <select
                    className="form-select add-console-select"
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) {
                        const conn = connections.find(c => c.id === e.target.value);
                        if (conn) {
                          onAddConnectionToSplit(conn);
                        }
                        e.target.value = '';
                      }
                    }}
                  >
                    <option value="" disabled>Choose host...</option>
                    {connections.length === 0 ? (
                      <option disabled>No connections</option>
                    ) : (
                      connections.map(c => (
                        <option key={c.id} value={c.id}>{c.name} ({c.host})</option>
                      ))
                    )}
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
