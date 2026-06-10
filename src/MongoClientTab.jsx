import React, { useState, useEffect, useRef } from 'react';

// Large Mock Data Generator for MongoDB sandbox mode
const generateLargeMongoData = () => {
  return {
    app_prod: {
      users: Array.from({ length: 40 }, (_, i) => ({
        _id: `648f5e${i < 10 ? '0' + i : i}f0e219b1b1c3c4d5a`,
        username: ['alex_ops', 'support_user', 'guest_account', 'dev_john', 'qa_jane', 'manager_bob'][i % 6] + `_${i}`,
        email: `user_${i}@omicron.ops`,
        roles: [['admin', 'devops'], ['support'], ['guest'], ['developer'], ['qa']][i % 5],
        lastLogin: `2026-06-09T08:${10 + (i % 45)}:44Z`,
        settings: { theme: i % 2 === 0 ? 'dark' : 'light', notify: i % 3 === 0 }
      })),
      sessions: Array.from({ length: 35 }, (_, i) => ({
        _id: `649a1f${i < 10 ? '0' + i : i}e0a112c3b4d5e6f7a`,
        userId: `648f5e${(i % 10) < 10 ? '0' + (i % 10) : (i % 10)}f0e219b1b1c3c4d5a`,
        token: `s_88192a01bc_${i}`,
        ip: `192.168.1.${10 + i}`,
        active: i % 4 !== 0,
        expires: `2026-06-10T11:${10 + (i % 45)}:50Z`
      })),
      settings: Array.from({ length: 25 }, (_, i) => ({
        _id: `64811a${i < 10 ? '0' + i : i}22b33c44d55e66ff77`,
        key: ['maintenance_mode', 'max_connections_limit', 'rate_limit_enabled', 'debug_logging_level', 'backup_schedule_cron'][i % 5] + `_${i}`,
        value: i % 2 === 0 ? true : 150,
        updatedBy: ['alex_ops', 'system', 'admin'][i % 3],
        updatedAt: `2026-06-09T05:${10 + i}:00Z`
      }))
    },
    admin: {
      system_users: Array.from({ length: 15 }, (_, i) => ({
        _id: `00000000000000000000000${i + 1 < 10 ? '0' + (i + 1) : i + 1}`,
        user: ['root', 'admin', 'readOnly', 'backupAgent'][i % 4] + `_${i}`,
        db: 'admin',
        credentials: { hash: `$2b$10$xyz_${i}...` }
      }))
    }
  };
};

export function MongoDbView({ connection, tabId }) {
  const mongoConfig = connection?.services?.mongo || {};
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [selectedCol, setSelectedCol] = useState('users');
  const [filterStr, setFilterStr] = useState('{}');
  const [activeDb, setActiveDb] = useState('app_prod');
  const [docs, setDocs] = useState([]);
  const [expandedDocIdx, setExpandedDocIdx] = useState(null);
  const [queryWarning, setQueryWarning] = useState(null);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Initialize large mock data once
  const mockMongoCollections = useRef(null);
  if (!mockMongoCollections.current) {
    mockMongoCollections.current = generateLargeMongoData();
  }

  useEffect(() => {
    if (!isConnected) return;
    const dbCollections = mockMongoCollections.current[activeDb] || {};
    const firstCol = Object.keys(dbCollections)[0] || '';
    setSelectedCol(firstCol);
    setFilterStr('{}');
    setQueryWarning(null);
    setCurrentPage(1);
  }, [activeDb, isConnected]);

  useEffect(() => {
    if (isConnected) {
      applyFilter();
    }
  }, [selectedCol, activeDb, isConnected]);

  const handleConnect = () => {
    setIsConnecting(true);
    setTimeout(() => {
      setIsConnecting(false);
      setIsConnected(true);
    }, 1000);
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setDocs([]);
  };

  const runLocalMockFilter = (parsedFilter, remoteError = null) => {
    const dbCollections = mockMongoCollections.current[activeDb] || {};
    const collectionDocs = dbCollections[selectedCol] || [];
    
    try {
      const filterKeys = Object.keys(parsedFilter);
      if (filterKeys.length === 0) {
        setDocs(collectionDocs);
        setQueryWarning(remoteError ? `Remote connection failed (${remoteError}). Displaying local sandbox mock data.` : null);
        return;
      }
      
      const filtered = collectionDocs.filter(doc => {
        return filterKeys.every(key => {
          return String(doc[key]) === String(parsedFilter[key]);
        });
      });
      setDocs(filtered);
      setQueryWarning(remoteError ? `Remote connection failed (${remoteError}). Displaying filtered local sandbox mock data.` : null);
    } catch (err) {
      setDocs(collectionDocs);
      setQueryWarning(remoteError ? `Remote connection failed (${remoteError}). Displaying local sandbox mock data.` : null);
    }
  };

  const applyFilter = () => {
    setCurrentPage(1);
    setExpandedDocIdx(null);
    let parsedFilter = {};
    try {
      if (filterStr.trim() && filterStr.trim() !== '{}') {
        parsedFilter = JSON.parse(filterStr);
      }
    } catch (err) {
      setQueryWarning("Invalid query filter JSON. Showing all documents.");
    }

    if (tabId) {
      fetch('/api/db/mongo/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tabId,
          connection,
          activeDb,
          collection: selectedCol,
          filter: parsedFilter
        })
      })
      .then(res => {
        if (!res.ok) {
          return res.json().then(err => { throw new Error(err.error || 'Query failed'); });
        }
        return res.json();
      })
      .then(data => {
        if (data.success) {
          setDocs(data.documents);
          setQueryWarning(null);
        }
      })
      .catch(err => {
        runLocalMockFilter(parsedFilter, err.message);
      });
    } else {
      runLocalMockFilter(parsedFilter);
    }
  };

  if (!isConnected) {
    return (
      <div className="db-connect-splash">
        <div className="db-connect-card glass-panel">
          <div className="db-connect-icon">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75M3.75 13.875v3.75" />
            </svg>
          </div>
          <h2>MongoDB Browser Dashboard</h2>
          <p>Establish a secure bridge client connection to browse collections and filter documents.</p>
          <div className="db-connect-details">
            <div className="db-detail-row">
              <span className="label">Connection URI:</span>
              <span className="val">mongodb://{connection?.host || '127.0.0.1'}:{mongoConfig.port || 27017}</span>
            </div>
            <div className="db-detail-row">
              <span className="label">Default DB:</span>
              <span className="val">{mongoConfig.database || 'admin'}</span>
            </div>
            <div className="db-detail-row">
              <span className="label">Auth Mechanism:</span>
              <span className="val">{mongoConfig.username ? 'SCRAM-SHA-256' : 'None'}</span>
            </div>
          </div>
          <button 
            className="db-connect-btn" 
            onClick={handleConnect}
            disabled={isConnecting}
          >
            {isConnecting ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                <span className="spinner-small"></span>
                <span>Connecting...</span>
              </div>
            ) : 'Connect MongoDB Server'}
          </button>
        </div>
      </div>
    );
  }

  const collections = Object.keys(mockMongoCollections.current[activeDb] || {});

  // Pagination calculations
  const totalRows = docs.length;
  const totalPages = Math.ceil(totalRows / pageSize) || 1;
  const startIndex = totalRows === 0 ? 0 : (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalRows);
  const paginatedDocs = docs.slice(startIndex, endIndex);

  return (
    <div className="db-explorer-container">
      <div className="db-sidebar glass-panel">
        <div className="db-sidebar-header">
          <div className="db-sidebar-title">MongoDB Browser</div>
          
          <div className="schema-select-wrapper" style={{ marginTop: '4px' }}>
            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Database</label>
            <select 
              value={activeDb} 
              onChange={(e) => setActiveDb(e.target.value)}
              style={{ width: '100%', padding: '6px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--panel-border)', borderRadius: '4px', color: '#fff', fontSize: '0.8rem', outline: 'none' }}
            >
              <option value="app_prod">app_prod</option>
              <option value="admin">admin</option>
            </select>
          </div>
        </div>
        
        <div className="db-sidebar-list" style={{ overflowY: 'auto', flexGrow: 1, padding: '12px' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.5px' }}>
            Collections ({collections.length})
          </div>
          {collections.map(col => (
            <button
              key={col}
              className={`db-list-item ${selectedCol === col ? 'active' : ''}`}
              onClick={() => setSelectedCol(col)}
              style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left' }}
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <span>{col}</span>
            </button>
          ))}
        </div>

        <div className="pg-config-info" style={{ padding: '12px', borderTop: '1px solid var(--panel-border)', background: 'rgba(0,0,0,0.1)' }}>
          <div className="config-info-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '6px' }}>
            <span style={{ color: 'var(--text-muted)' }}>Status:</span>
            <span style={{ color: '#10b981', fontWeight: 'bold' }}>Connected</span>
          </div>
          <button 
            onClick={handleDisconnect} 
            className="haproxy-control-btn" 
            style={{ width: '100%', marginTop: '6px', background: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)', color: '#f87171' }}
          >
            Disconnect
          </button>
        </div>
      </div>

      <div className="db-main-content">
        <div className="query-runner-panel glass-panel">
          <div className="filter-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: '600' }}>Query Filter (JSON)</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input 
                type="text" 
                className="query-textarea"
                style={{ height: '36px', padding: '8px 12px', flexGrow: 1 }}
                value={filterStr}
                onChange={(e) => setFilterStr(e.target.value)}
                placeholder='e.g. {"username": "alex_ops"}'
              />
              <button 
                className="run-query-btn" 
                onClick={applyFilter}
                style={{ background: 'var(--accent-primary)', color: '#fff', border: 'none', padding: '0 16px', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer', fontWeight: '600' }}
              >
                Find
              </button>
            </div>
          </div>
        </div>

        {queryWarning && (
          <div className="query-status-banner warning" style={{ padding: '8px 16px', background: 'rgba(245, 158, 11, 0.1)', borderBottom: '1px solid rgba(245, 158, 11, 0.2)', color: '#fbbf24', fontSize: '0.75rem', marginBottom: '12px' }}>
            {queryWarning}
          </div>
        )}

        <div className="db-grid-container" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100% - 95px)', padding: '16px', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <span>Collection: {selectedCol}</span>
            <span>{docs.length} documents found</span>
          </div>
          
          <div className="mongo-docs-grid" style={{ flexGrow: 1, overflowY: 'auto' }}>
            {paginatedDocs.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px' }}>
                No documents match the specified query filter.
              </div>
            ) : (
              paginatedDocs.map((doc, idx) => (
                <div key={doc._id} className="mongo-doc-card">
                  <div 
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} 
                    onClick={() => setExpandedDocIdx(expandedDocIdx === idx ? null : idx)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontFamily: 'monospace' }}>
                      <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{expandedDocIdx === idx ? '▼' : '▶'}</span>
                      <span style={{ color: 'var(--text-muted)' }}>_id:</span>
                      <span style={{ color: 'var(--accent-secondary)' }}>ObjectId("{doc._id}")</span>
                    </div>
                    <button 
                      className="haproxy-control-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(JSON.stringify(doc, null, 2));
                      }}
                      style={{ padding: '2px 8px', fontSize: '0.7rem' }}
                    >
                      Copy
                    </button>
                  </div>
                  {expandedDocIdx === idx && (
                    <div style={{ marginTop: '12px', borderTop: '1px solid var(--panel-border)', paddingTop: '12px' }}>
                      <pre className="mongo-doc-pre">{JSON.stringify(doc, null, 2)}</pre>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Database Pagination Footer Controls */}
          {totalRows > 0 && (
            <div className="db-pagination-bar" style={{ marginTop: '16px' }}>
              <div className="pagination-info">
                Showing <span>{startIndex + 1}</span> to <span>{endIndex}</span> of <span>{totalRows}</span> entries
              </div>
              <div className="pagination-controls">
                <button
                  className="page-btn icon-btn"
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  title="First Page"
                >
                  &laquo;
                </button>
                <button
                  className="page-btn icon-btn"
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  title="Previous Page"
                >
                  &lsaquo;
                </button>

                {/* Page Number Buttons with Ellipses */}
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(pageNum => {
                    return pageNum === 1 || 
                           pageNum === totalPages || 
                           Math.abs(pageNum - currentPage) <= 2;
                  })
                  .map((pageNum, idx, arr) => {
                    const prevPage = arr[idx - 1];
                    const showEllipsis = prevPage && pageNum - prevPage > 1;

                    return (
                      <React.Fragment key={pageNum}>
                        {showEllipsis && <span className="pagination-ellipsis">...</span>}
                        <button
                          className={`page-btn ${currentPage === pageNum ? 'active' : ''}`}
                          onClick={() => setCurrentPage(pageNum)}
                        >
                          {pageNum}
                        </button>
                      </React.Fragment>
                    );
                  })}

                <button
                  className="page-btn icon-btn"
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  title="Next Page"
                >
                  &rsaquo;
                </button>
                <button
                  className="page-btn icon-btn"
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  title="Last Page"
                >
                  &raquo;
                </button>

                <div className="page-size-selector">
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                  >
                    <option value="5">5 / page</option>
                    <option value="10">10 / page</option>
                    <option value="20">20 / page</option>
                    <option value="50">50 / page</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
