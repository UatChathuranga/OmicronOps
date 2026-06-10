import React, { useState, useEffect, useRef } from 'react';

// Large Mock Data Generator for PostgreSQL sandbox mode (fallback)
const generateLargeMockData = () => {
  const data = {
    users: Array.from({ length: 45 }, (_, i) => ({
      id: i + 1,
      name: [
        'John Doe', 'Jane Smith', 'Bob Johnson', 'Alice Brown', 'Charlie Green',
        'David Miller', 'Emily Davis', 'Frank Wilson', 'Grace Moore', 'Henry Taylor',
        'Ivy Thomas', 'Jack Jackson', 'Kate White', 'Louis Harris', 'Mary Martin',
        'Nathan Clark', 'Olivia Lewis', 'Peter Robinson', 'Queen Walker', 'Ryan Hall'
      ][i % 20] + (i >= 20 ? ` ${Math.floor(i / 20) + 1}` : ''),
      email: `user_${i + 1}@omicron.ops`,
      role: ['admin', 'developer', 'support', 'user', 'guest'][i % 5],
      created_at: `2026-0${(i % 5) + 1}-${10 + (i % 20)}`
    })),
    orders: Array.from({ length: 35 }, (_, i) => ({
      id: 1001 + i,
      user_id: (i % 15) + 1,
      amount: parseFloat(((15.5 * (i + 1)) % 300 + 10).toFixed(2)),
      status: ['completed', 'pending', 'failed'][i % 3],
      date: `2026-05-${10 + (i % 20)}`
    })),
    products: Array.from({ length: 25 }, (_, i) => ({
      id: 101 + i,
      name: [
        'Cloud Server Small', 'Cloud Server Medium', 'Cloud Server Large',
        'Database SSD Storage', 'Redis Cache Node', 'Load Balancer HA',
        'Message Queue Instance', 'CDN Edge Zone', 'SSL Certificate Std', 'Docker Registry Private'
      ][i % 10] + (i >= 10 ? ` v${Math.floor(i / 10) + 1}` : ''),
      sku: `SKU-${i + 100}`,
      price: parseFloat(((9.99 * (i + 2)) % 150 + 5).toFixed(2)),
      stock: (i * 25 + 150) % 2000
    }))
  };
  return data;
};

const sqlKeywords = new Set([
  'select', 'from', 'where', 'limit', 'offset', 'insert', 'into', 'values',
  'update', 'set', 'delete', 'create', 'table', 'drop', 'alter', 'index',
  'join', 'left', 'right', 'inner', 'outer', 'on', 'group', 'by', 'order',
  'having', 'and', 'or', 'not', 'in', 'is', 'null', 'like', 'ilike', 'as',
  'returning', 'union', 'all', 'any', 'exists', 'true', 'false', 'commit', 'rollback'
]);

function highlightSql(text) {
  if (!text) return '';
  
  // Escape HTML entities
  let escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
    
  // Highlight SQL keywords case-insensitively
  return escaped.replace(/\b(\w+)\b/g, (match) => {
    const lower = match.toLowerCase();
    if (sqlKeywords.has(lower)) {
      return `<span class="sql-keyword">${match}</span>`;
    }
    if (/^\d+$/.test(match)) {
      return `<span class="sql-number">${match}</span>`;
    }
    return match;
  });
}

export function PostgreSqlView({ connection, tabId }) {
  const pgConfig = connection?.services?.postgres || {};
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [databases, setDatabases] = useState([]);
  const [activeDb, setActiveDb] = useState(pgConfig.database || 'postgres');
  const [activeSchema, setActiveSchema] = useState('public');
  const [tables, setTables] = useState([]);
  const [functions, setFunctions] = useState([]);
  const [selectedItem, setSelectedItem] = useState({ type: 'table', name: '' });
  const [queryText, setQueryText] = useState('');
  const [queryResults, setQueryResults] = useState(null);
  const [connectionError, setConnectionError] = useState(null);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Sidebar collapsible state
  const [tablesCollapsed, setTablesCollapsed] = useState(false);
  const [functionsCollapsed, setFunctionsCollapsed] = useState(false);

  // Resizable height state (default 150px)
  const [editorHeight, setEditorHeight] = useState(150);
  const [isResizing, setIsResizing] = useState(false);

  // Inline editing states
  const [editingCell, setEditingCell] = useState(null); // { rowIdx, col }
  const [editingValue, setEditingValue] = useState('');
  const [pendingEdits, setPendingEdits] = useState([]); // [{rowIdx, col, oldVal, newVal, primaryKeyCol, primaryKeyVal}]
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(null);

  // New row insertion states
  const [newRow, setNewRow] = useState(null); // null = hidden, {} = being edited
  const [isSavingNewRow, setIsSavingNewRow] = useState(false);
  const [newRowError, setNewRowError] = useState(null);

  // Row selection for deletion
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [isDeletingRows, setIsDeletingRows] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  // Table maintenance modal
  const [maintenanceModal, setMaintenanceModal] = useState(null); // { table, action, data, loading, error }
  const [tableMenuOpen, setTableMenuOpen] = useState(null); // table name with open menu

  // Refs for scroll sync in SQL editor
  const textareaRef = useRef(null);
  const overlayRef = useRef(null);
  const containerRef = useRef(null);

  const handleConnect = () => {
    setIsConnecting(true);
    setConnectionError(null);
    
    if (!tabId) {
      setConnectionError("No active SSH session. Please open the terminal first.");
      setIsConnecting(false);
      return;
    }

    const testQuery = "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;";
    fetch('/api/db/postgres/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tabId,
        connection,
        database: pgConfig.database || 'postgres',
        query: testQuery
      })
    })
    .then(res => {
      if (!res.ok) {
        return res.json().then(err => { throw new Error(err.error || 'Connection failed'); });
      }
      return res.json();
    })
    .then(data => {
      if (data.success && data.rows) {
        const dbNames = data.rows.map(r => r.datname).filter(Boolean);
        setDatabases(dbNames);
        setIsConnected(true);
        if (dbNames.length > 0 && !dbNames.includes(activeDb)) {
          setActiveDb(dbNames[0]);
        }
      } else {
        throw new Error(data.error || 'Failed to fetch database catalog.');
      }
    })
    .catch(err => {
      setConnectionError(err.message || 'Failed to establish connection.');
    })
    .finally(() => {
      setIsConnecting(false);
    });
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setQueryResults(null);
    setDatabases([]);
    setTables([]);
    setFunctions([]);
  };

  useEffect(() => {
    if (!isConnected || !tabId) return;
    
    setCurrentPage(1);
    setTables([]);
    setFunctions([]);
    setSelectedItem({ type: 'table', name: '' });
    setQueryResults(null);
    setQueryText('');

    // Query tables list:
    const tablesQuery = `SELECT table_name FROM information_schema.tables WHERE table_schema = '${activeSchema}' ORDER BY table_name;`;
    fetch('/api/db/postgres/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tabId,
        connection,
        database: activeDb,
        query: tablesQuery
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success && data.rows) {
        const tableNames = data.rows.map(r => r.table_name).filter(Boolean);
        setTables(tableNames);
        if (tableNames.length > 0) {
          handleItemSelect('table', tableNames[0], activeDb);
        }
      }
    })
    .catch(err => console.error("Error loading tables:", err));

    // Query routines list:
    const routinesQuery = `SELECT routine_name FROM information_schema.routines WHERE routine_schema = '${activeSchema}' ORDER BY routine_name;`;
    fetch('/api/db/postgres/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tabId,
        connection,
        database: activeDb,
        query: routinesQuery
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success && data.rows) {
        const routineNames = data.rows.map(r => r.routine_name).filter(Boolean);
        setFunctions(routineNames);
      }
    })
    .catch(err => console.error("Error loading routines:", err));
  }, [activeDb, activeSchema, isConnected, tabId]);

  const handleItemSelect = (type, name, currentDb = activeDb) => {
    setCurrentPage(1);
    setSelectedItem({ type, name });
    let query = '';
    if (type === 'table') {
      query = `SELECT * FROM "${activeSchema}"."${name}" LIMIT 10;`;
    } else {
      query = `SELECT "${activeSchema}"."${name}"();`;
    }
    setQueryText(query);
    setQueryResults(null);
    runRealQuery(query, currentDb);
  };

  const runRealQuery = (query, dbName = activeDb) => {
    if (!tabId) return;
    
    setQueryResults({ loading: true, success: true, columns: [], rows: [] });
    
    fetch('/api/db/postgres/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tabId,
        connection,
        database: dbName,
        query: query
      })
    })
    .then(res => {
      if (!res.ok) {
        return res.json().then(err => { throw new Error(err.error || 'Query execution failed'); });
      }
      return res.json();
    })
    .then(data => {
      if (data.success) {
        setQueryResults({
          success: true,
          rows: data.rows || [],
          columns: data.columns || [],
          columnTypes: data.columnTypes || {}
        });
        setPendingEdits([]);
        setSaveError(null);
        setSaveSuccess(null);
      } else {
        setQueryResults({
          success: false,
          error: data.error || 'Query returned unsuccessful status.'
        });
      }
    })
    .catch(err => {
      setQueryResults({
        success: false,
        error: err.message || 'Network error executing query.'
      });
    });
  };

  const runQuery = () => {
    setCurrentPage(1);
    runRealQuery(queryText);
  };

  // Sync scroll between textarea and highlights overlay
  const handleScroll = () => {
    if (textareaRef.current && overlayRef.current) {
      overlayRef.current.scrollTop = textareaRef.current.scrollTop;
      overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  // CSV Export Utility
  const handleExportCsv = () => {
    if (!queryResults || !queryResults.rows || queryResults.rows.length === 0) return;
    const cols = queryResults.columns;
    
    const csvContent = [
      cols.join(','),
      ...queryResults.rows.map(row => 
        cols.map(col => {
          const val = row[col] === null || row[col] === undefined ? '' : String(row[col]);
          if (val.includes(',') || val.includes('"') || val.includes('\n')) {
            return `"${val.replace(/"/g, '""')}"`;
          }
          return val;
        }).join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `query_results_${new Date().toISOString().slice(0,19).replace(/[:T]/g, '_')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ---- Inline Editing Helpers ----
  // Detect likely primary key column (first col named 'id', or first col ending in '_id', or column[0])
  const detectPkCol = (cols) => {
    if (!cols || cols.length === 0) return null;
    if (cols.includes('id')) return 'id';
    const idCol = cols.find(c => c === 'id' || c.endsWith('_id') && cols.indexOf(c) === 0);
    return idCol || cols[0];
  };

  // Validate a value against a pg type name
  const validateCellValue = (value, pgType) => {
    if (value === '' || value === null) return null; // null is always allowed
    const numTypes = ['int2','int4','int8','float4','float8','numeric','oid','money'];
    const boolTypes = ['bool'];
    const dateTypes = ['date','timestamp','timestamptz','time','timetz'];
    if (numTypes.some(t => pgType?.startsWith(t))) {
      if (isNaN(Number(value))) return 'Expected a numeric value';
    } else if (boolTypes.includes(pgType)) {
      if (!['true','false','1','0','yes','no','t','f'].includes(value.toLowerCase())) return 'Expected true or false';
    } else if (dateTypes.some(t => pgType?.startsWith(t))) {
      if (isNaN(Date.parse(value))) return 'Expected a valid date/time';
    }
    return null;
  };

  const handleCellDoubleClick = (rowIdx, col, currentVal) => {
    if (!selectedItem.name || selectedItem.type !== 'table') return; // only editable on table views
    setEditingCell({ rowIdx, col });
    setEditingValue(currentVal === null || currentVal === undefined ? '' : String(currentVal));
  };

  const commitCellEdit = (row, rowIdx, col) => {
    const cols = queryResults?.columns || [];
    const pkCol = detectPkCol(cols);
    const pkVal = pkCol ? row[pkCol] : null;
    const originalVal = row[col];
    const newVal = editingValue;
    if (String(originalVal) !== String(newVal)) {
      setPendingEdits(prev => {
        // Replace existing edit for same cell if any
        const filtered = prev.filter(e => !(e.rowIdx === rowIdx && e.col === col));
        return [...filtered, { rowIdx, col, oldVal: originalVal, newVal, primaryKeyCol: pkCol, primaryKeyVal: pkVal }];
      });
      // Optimistically update the visible result
      setQueryResults(prev => {
        const newRows = prev.rows.map((r, i) => i === rowIdx ? { ...r, [col]: newVal } : r);
        return { ...prev, rows: newRows };
      });
    }
    setEditingCell(null);
  };

  const handleSaveEdits = async () => {
    if (pendingEdits.length === 0) return;
    setIsSavingEdits(true);
    setSaveError(null);
    setSaveSuccess(null);
    const errors = [];
    for (const edit of pendingEdits) {
      try {
        const resp = await fetch('/api/db/postgres/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tabId,
            connection,
            activeDb,
            schema: activeSchema,
            tableName: selectedItem.name,
            primaryKeyCol: edit.primaryKeyCol,
            primaryKeyVal: edit.primaryKeyVal,
            columnName: edit.col,
            value: edit.newVal
          })
        });
        const data = await resp.json();
        if (!data.success) errors.push(`${edit.col}: ${data.error}`);
      } catch (e) {
        errors.push(`${edit.col}: ${e.message}`);
      }
    }
    setIsSavingEdits(false);
    if (errors.length > 0) {
      setSaveError(errors.join('\n'));
    } else {
      setSaveSuccess(`${pendingEdits.length} change(s) saved successfully.`);
      setPendingEdits([]);
    }
  };

  const handleAddRow = () => {
    if (!selectedItem.name || selectedItem.type !== 'table') return;
    // Initialise a blank row keyed by each column in current results
    const cols = queryResults?.columns || [];
    setNewRow(cols.reduce((acc, c) => ({ ...acc, [c]: '' }), {}));
    setNewRowError(null);
  };

  const handleNewRowCellChange = (col, value) => {
    setNewRow(prev => ({ ...prev, [col]: value }));
  };

  const handleCancelNewRow = () => {
    setNewRow(null);
    setNewRowError(null);
  };

  const handleSaveNewRow = async () => {
    if (!newRow) return;
    // Client-side type validation
    const cols = queryResults?.columns || [];
    const columnTypes = queryResults?.columnTypes || {};
    for (const col of cols) {
      const err = validateCellValue(newRow[col], columnTypes[col]);
      if (err) { setNewRowError(`Column "${col}": ${err}`); return; }
    }
    setIsSavingNewRow(true);
    setNewRowError(null);
    try {
      const resp = await fetch('/api/db/postgres/insert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tabId, connection, activeDb,
          schema: activeSchema,
          tableName: selectedItem.name,
          row: newRow
        })
      });
      const data = await resp.json();
      if (!data.success) throw new Error(data.error || 'Insert failed');
      // Append the returned row (with DB-generated values) to results
      setQueryResults(prev => ({
        ...prev,
        rows: [...(prev?.rows || []), data.insertedRow || newRow]
      }));
      setNewRow(null);
      setSaveSuccess('New row inserted successfully.');
    } catch (e) {
      setNewRowError(e.message);
    } finally {
      setIsSavingNewRow(false);
    }
  };

  const handleDeleteSelectedRows = async () => {
    if (selectedRows.size === 0) return;
    const cols = queryResults?.columns || [];
    const pkCol = detectPkCol(cols);
    if (!pkCol) { setDeleteError('Cannot delete: no primary key column detected.'); return; }

    const count = selectedRows.size;
    const confirmed = window.confirm(
      `Are you sure you want to permanently delete ${count} row${count > 1 ? 's' : ''} from "${selectedItem.name}"?\n\nThis cannot be undone.`
    );
    if (!confirmed) return;

    setIsDeletingRows(true);
    setDeleteError(null);
    const errors = [];
    const deletedIndices = [];

    for (const absIdx of selectedRows) {
      const row = (queryResults?.rows || [])[absIdx];
      if (!row) continue;
      const pkVal = row[pkCol];
      try {
        const resp = await fetch('/api/db/postgres/delete-row', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tabId, connection, activeDb,
            schema: activeSchema,
            tableName: selectedItem.name,
            primaryKeyCol: pkCol,
            primaryKeyVal: pkVal
          })
        });
        const data = await resp.json();
        if (data.success) { deletedIndices.push(absIdx); }
        else { errors.push(`Row ${pkVal}: ${data.error}`); }
      } catch (e) {
        errors.push(`Row ${pkVal}: ${e.message}`);
      }
    }

    if (deletedIndices.length > 0) {
      const deletedSet = new Set(deletedIndices);
      setQueryResults(prev => ({
        ...prev,
        rows: (prev?.rows || []).filter((_, i) => !deletedSet.has(i))
      }));
      setSelectedRows(new Set());
      setPendingEdits(prev => prev.filter(e => !deletedSet.has(e.rowIdx)));
    }

    setIsDeletingRows(false);
    if (errors.length > 0) {
      setDeleteError(errors.join('\n'));
    } else {
      setSaveSuccess(`${deletedIndices.length} row${deletedIndices.length > 1 ? 's' : ''} deleted successfully.`);
    }
  };

  const toggleRowSelection = (absIdx) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(absIdx)) next.delete(absIdx); else next.add(absIdx);
      return next;
    });
  };

  const toggleAllRows = (paginatedAbsIdxs) => {
    const allSelected = paginatedAbsIdxs.every(i => selectedRows.has(i));
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (allSelected) { paginatedAbsIdxs.forEach(i => next.delete(i)); }
      else { paginatedAbsIdxs.forEach(i => next.add(i)); }
      return next;
    });
  };

  // ---- Table Maintenance Actions ----
  const runMaintenanceQuery = async (table, action, query, isCommand = false) => {
    setMaintenanceModal({ table, action, data: null, loading: true, error: null });
    try {
      const resp = await fetch('/api/db/postgres/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabId, connection, activeDb, query })
      });
      const data = await resp.json();
      if (!data.success) throw new Error(data.error || 'Query failed');
      setMaintenanceModal(prev => ({ ...prev, loading: false, data, isCommand }));
    } catch (e) {
      setMaintenanceModal(prev => ({ ...prev, loading: false, error: e.message }));
    }
  };

  const handleTableAction = (table, action) => {
    setTableMenuOpen(null);
    const s = `"${activeSchema}"."${table}"`;
    switch (action) {
      case 'indexes':
        return runMaintenanceQuery(table, 'Indexes',
          `SELECT i.indexname, i.indexdef, ix.indisunique AS is_unique, ix.indisprimary AS is_primary, pg_size_pretty(pg_relation_size(c.oid)) AS size FROM pg_indexes i JOIN pg_class c ON c.relname = i.indexname JOIN pg_index ix ON ix.indexrelid = c.oid WHERE i.schemaname = '${activeSchema}' AND i.tablename = '${table}' ORDER BY i.indexname;`);
      case 'index_sizes':
        return runMaintenanceQuery(table, 'Index Sizes',
          `SELECT i.relname AS index_name, pg_size_pretty(pg_relation_size(ix.indexrelid)) AS size, ix.indisunique AS is_unique, ix.indisprimary AS is_primary FROM pg_class t JOIN pg_index ix ON t.oid = ix.indrelid JOIN pg_class i ON i.oid = ix.indexrelid JOIN pg_namespace n ON t.relnamespace = n.oid WHERE t.relname = '${table}' AND n.nspname = '${activeSchema}' ORDER BY pg_relation_size(ix.indexrelid) DESC;`);
      case 'reindex':
        if (!window.confirm(`REINDEX TABLE ${s}?\nThis locks the table briefly.`)) return;
        return runMaintenanceQuery(table, 'REINDEX', `REINDEX TABLE ${s};`, true);
      case 'vacuum':
        if (!window.confirm(`Run VACUUM on ${s}?`)) return;
        return runMaintenanceQuery(table, 'VACUUM', `VACUUM ${s};`, true);
      case 'vacuum_analyze':
        if (!window.confirm(`Run VACUUM ANALYZE on ${s}?`)) return;
        return runMaintenanceQuery(table, 'VACUUM ANALYZE', `VACUUM ANALYZE ${s};`, true);
      case 'vacuum_full':
        if (!window.confirm(`⚠️ FULL VACUUM on ${s}?\nThis acquires an exclusive lock and rewrites the entire table. May take a while.`)) return;
        return runMaintenanceQuery(table, 'VACUUM FULL', `VACUUM FULL ${s};`, true);
      case 'analyze':
        if (!window.confirm(`Run ANALYZE on ${s}?`)) return;
        return runMaintenanceQuery(table, 'ANALYZE', `ANALYZE ${s};`, true);
      case 'ddl':
        return runMaintenanceQuery(table, 'Table Structure (DDL)',
          `SELECT 'Column: ' || column_name || ' | Type: ' || data_type || CASE WHEN character_maximum_length IS NOT NULL THEN '(' || character_maximum_length || ')' ELSE '' END || CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END || CASE WHEN column_default IS NOT NULL THEN ' DEFAULT ' || column_default ELSE '' END AS definition FROM information_schema.columns WHERE table_schema = '${activeSchema}' AND table_name = '${table}' ORDER BY ordinal_position;`);
      default: break;
    }
  };

  // Drag resizer handlers
  const handleMouseDown = (e) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newHeight = e.clientY - rect.top;
      // enforce min 80px and max (containerHeight - 120px)
      if (newHeight > 80 && newHeight < rect.height - 120) {
        setEditorHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  if (!isConnected) {
    return (
      <div className="db-connect-splash">
        <div className="db-connect-card glass-panel">
          <div className="db-connect-icon">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12a7.5 7.5 0 0015 0m-15 0a7.5 7.5 0 1115 0m-15 0H3m16.5 0H21m-1.5 0H12m-8.457 3.077l1.41-.513m14.095-5.128l1.41-.513M5.106 17.785l1.15-.827m11.379-8.16l1.15-.827M8.14 21.27l.707-1.03m10.74-7.08l.707-1.03M12 21.75V21m0-18v.75m0 0a8.25 8.25 0 010 16.5m0-16.5L12 3" />
            </svg>
          </div>
          <h2>PostgreSQL Client Dashboard</h2>
          <p>Establish a secure bridge client connection to query databases and execute functions.</p>
          {connectionError && (
            <div className="query-status-banner error" style={{ margin: '12px 0', borderRadius: '4px', textAlign: 'left', padding: '10px 14px' }}>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.75rem' }}>{connectionError}</pre>
            </div>
          )}
          <div className="db-connect-details">
            <div className="db-detail-row">
              <span className="label">Database Server:</span>
              <span className="val">{connection?.host || '127.0.0.1'}:{pgConfig.port || 5432}</span>
            </div>
            <div className="db-detail-row">
              <span className="label">Default Database:</span>
              <span className="val">{pgConfig.database || 'postgres'}</span>
            </div>
            <div className="db-detail-row">
              <span className="label">User Credentials:</span>
              <span className="val">{pgConfig.username || 'postgres'}</span>
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
            ) : 'Connect Database Server'}
          </button>
        </div>
      </div>
    );
  }

  const activeRows = queryResults?.rows || [];
  const activeCols = queryResults?.columns || [];

  // Pagination calculations
  const totalRows = activeRows.length;
  const totalPages = Math.ceil(totalRows / pageSize) || 1;
  const startIndex = totalRows === 0 ? 0 : (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalRows);
  const paginatedRows = activeRows.slice(startIndex, endIndex);

  return (
    <div className="db-explorer-container">
      <style>{`
        .sql-editor-container {
          position: relative;
          width: 100%;
          background: #121216;
          border: 1px solid var(--panel-border);
          border-radius: 6px;
          overflow: hidden;
        }
        .sql-textarea {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: transparent;
          color: transparent;
          caret-color: #fff;
          border: none;
          resize: none;
          outline: none;
          font-family: 'Fira Code', 'Courier New', Courier, monospace;
          font-size: 13px;
          line-height: 1.6;
          padding: 12px;
          margin: 0;
          z-index: 2;
          white-space: pre-wrap;
          word-wrap: break-word;
          overflow-y: auto;
          box-sizing: border-box;
        }
        .sql-highlight-overlay {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: transparent;
          color: #cbd5e1;
          font-family: 'Fira Code', 'Courier New', Courier, monospace;
          font-size: 13px;
          line-height: 1.6;
          padding: 12px;
          margin: 0;
          z-index: 1;
          white-space: pre-wrap;
          word-wrap: break-word;
          overflow-y: auto;
          pointer-events: none;
          box-sizing: border-box;
        }
        .sql-keyword {
          color: #3b82f6;
          font-weight: bold;
        }
        .sql-number {
          color: #fb923c;
        }
        .vertical-resizer-bar {
          height: 5px;
          background: rgba(255,255,255,0.06);
          cursor: row-resize;
          transition: background 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          border-top: 1px solid var(--panel-border);
          border-bottom: 1px solid var(--panel-border);
          user-select: none;
        }
        .vertical-resizer-bar:hover, .vertical-resizer-bar.active {
          background: var(--accent-primary);
        }
        .vertical-resizer-bar::after {
          content: '';
          width: 20px;
          height: 2px;
          background: rgba(255,255,255,0.25);
          border-radius: 1px;
        }
        .db-sidebar-section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.72rem;
          font-weight: 700;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.6px;
          cursor: pointer;
          user-select: none;
          padding: 6px 6px;
          border-radius: 4px;
          transition: background 0.15s, color 0.15s;
        }
        .db-sidebar-section-header:hover {
          background: rgba(255,255,255,0.04);
          color: #fff;
        }
        .csv-export-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          background: rgba(255,255,255,0.07);
          border: 1px solid var(--panel-border);
          color: #e2e8f0;
          padding: 5px 10px;
          border-radius: 4px;
          font-size: 0.72rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
        }
        .csv-export-btn:hover {
          background: rgba(255,255,255,0.12);
          border-color: rgba(255,255,255,0.2);
        }
        .db-sidebar-list-inner {
          margin-bottom: 12px;
          transition: max-height 0.2s ease-out;
        }
      `}</style>

      <div className="db-sidebar glass-panel">
        <div className="db-sidebar-header">
          <div className="db-sidebar-title">Database Explorer</div>
          
          <div className="schema-select-wrapper" style={{ marginTop: '4px' }}>
            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Database</label>
            <select 
              value={activeDb} 
              onChange={(e) => setActiveDb(e.target.value)}
              style={{ width: '100%', padding: '6px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--panel-border)', borderRadius: '4px', color: '#fff', fontSize: '0.8rem', outline: 'none' }}
            >
              {databases.map(db => (
                <option key={db} value={db}>{db}</option>
              ))}
            </select>
          </div>

          <div className="schema-select-wrapper" style={{ marginTop: '8px' }}>
            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Schema</label>
            <select 
              value={activeSchema} 
              onChange={(e) => setActiveSchema(e.target.value)}
              style={{ width: '100%', padding: '6px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--panel-border)', borderRadius: '4px', color: '#fff', fontSize: '0.8rem', outline: 'none' }}
            >
              <option value="public">public</option>
              <option value="information_schema">information_schema</option>
              <option value="pg_catalog">pg_catalog</option>
            </select>
          </div>
        </div>

        <div className="db-sidebar-list" style={{ overflowY: 'auto', flexGrow: 1, padding: '12px' }}>
          
          {/* Tables Collapsible Section */}
          <div className="db-sidebar-section-header" onClick={() => setTablesCollapsed(!tablesCollapsed)}>
            <span>Tables ({tables.length})</span>
            <span style={{ fontSize: '0.6rem' }}>{tablesCollapsed ? '▶' : '▼'}</span>
          </div>
          {!tablesCollapsed && (
            <div className="db-sidebar-list-inner" style={{ paddingLeft: '4px', marginTop: '4px' }}>
              {tables.map(t => (
                <div key={t} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <button
                    className={`db-list-item ${selectedItem.type === 'table' && selectedItem.name === t ? 'active' : ''}`}
                    onClick={() => handleItemSelect('table', t)}
                    style={{ flex: 1, border: 'none', background: 'transparent', textAlign: 'left', paddingRight: '28px' }}
                  >
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <span>{t}</span>
                  </button>
                  {/* Settings gear icon */}
                  <button
                    onClick={e => { e.stopPropagation(); setTableMenuOpen(tableMenuOpen === t ? null : t); }}
                    title="Table actions"
                    style={{ position: 'absolute', right: '2px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '3px', borderRadius: '3px', display: 'flex', alignItems: 'center', opacity: tableMenuOpen === t ? 1 : undefined }}
                    className="table-gear-btn"
                  >
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </button>
                  {/* Dropdown menu */}
                  {tableMenuOpen === t && (
                    <div
                      style={{ position: 'absolute', right: 0, top: '100%', zIndex: 200, background: '#1a1d27', border: '1px solid var(--panel-border)', borderRadius: '6px', padding: '4px 0', minWidth: '180px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}
                      onClick={e => e.stopPropagation()}
                    >
                      {[
                        { id: 'indexes',       icon: '🗂', label: 'View Indexes' },
                        { id: 'index_sizes',   icon: '📊', label: 'Index Sizes' },
                        { id: 'reindex',       icon: '🔄', label: 'Reindex Table' },
                        null,
                        { id: 'vacuum',        icon: '🧹', label: 'VACUUM' },
                        { id: 'vacuum_analyze',icon: '🧹', label: 'VACUUM ANALYZE' },
                        { id: 'analyze',       icon: '📈', label: 'ANALYZE' },
                        { id: 'vacuum_full',   icon: '⚠️', label: 'VACUUM FULL (slow)' },
                        null,
                        { id: 'ddl',           icon: '📋', label: 'Table Structure (DDL)' },
                      ].map((item, i) => item === null
                        ? <div key={i} style={{ height: '1px', background: 'var(--panel-border)', margin: '4px 0' }} />
                        : (
                          <button key={item.id}
                            onClick={() => handleTableAction(t, item.id)}
                            style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', background: 'none', border: 'none', color: '#e2e8f0', padding: '7px 12px', fontSize: '0.75rem', cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          >
                            <span>{item.icon}</span><span>{item.label}</span>
                          </button>
                        )
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Functions Collapsible Section */}
          <div className="db-sidebar-section-header" onClick={() => setFunctionsCollapsed(!functionsCollapsed)} style={{ marginTop: '12px' }}>
            <span>Functions ({functions.length})</span>
            <span style={{ fontSize: '0.6rem' }}>{functionsCollapsed ? '▶' : '▼'}</span>
          </div>
          {!functionsCollapsed && (
            <div className="db-sidebar-list-inner" style={{ paddingLeft: '4px', marginTop: '4px' }}>
              {functions.map(f => (
                <button
                  key={f}
                  className={`db-list-item ${selectedItem.type === 'function' && selectedItem.name === f ? 'active' : ''}`}
                  onClick={() => handleItemSelect('function', f)}
                  style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left' }}
                >
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                  </svg>
                  <span>{f}()</span>
                </button>
              ))}
            </div>
          )}
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

      <div className="db-main-content" ref={containerRef}>
        
        {/* SQL Query Runner Panel with resizable height */}
        <div className="query-runner-panel glass-panel" style={{ height: `${editorHeight}px`, display: 'flex', flexDirection: 'column' }}>
          <div className="query-actions-row" style={{ flexShrink: 0 }}>
            <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>SQL Query Runner ({activeSchema})</span>
            <button className="run-query-btn" onClick={runQuery} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--accent-primary)', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer', fontWeight: '600' }}>
              <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
              Execute Query
            </button>
          </div>
          <div className="sql-editor-container" style={{ flexGrow: 1, position: 'relative' }}>
            <textarea
              ref={textareaRef}
              className="sql-textarea"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              onScroll={handleScroll}
              placeholder="Type your SQL query here..."
            />
            <div 
              ref={overlayRef}
              className="sql-highlight-overlay"
              dangerouslySetInnerHTML={{ __html: highlightSql(queryText) }}
            />
          </div>
        </div>

        {/* Resizer Handle */}
        <div className={`vertical-resizer-bar ${isResizing ? 'active' : ''}`} onMouseDown={handleMouseDown} />

        {queryResults?.warning && (
          <div className="query-status-banner warning" style={{ padding: '8px 16px', background: 'rgba(245, 158, 11, 0.1)', borderBottom: '1px solid rgba(245, 158, 11, 0.2)', color: '#fbbf24', fontSize: '0.75rem' }}>
            {queryResults.warning}
          </div>
        )}

        {queryResults?.success === false && (
          <div className="query-status-banner error" style={{ padding: '10px 16px', background: 'rgba(239, 68, 68, 0.1)', borderBottom: '1px solid rgba(239, 68, 68, 0.2)', color: '#f87171', fontSize: '0.75rem', fontFamily: 'monospace' }}>
            <pre style={{ margin: 0 }}>{queryResults.error}</pre>
          </div>
        )}

        {/* Results View Panel */}
        <div className="db-grid-container" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <span>Results {queryResults ? '(Custom Query)' : `(${selectedItem.type === 'table' ? 'Table' : 'Function'}: ${selectedItem.name})`}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>{activeRows.length} rows returned</span>
              {selectedItem.type === 'table' && activeCols.length > 0 && !newRow && (
                <button
                  onClick={handleAddRow}
                  style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.4)', color: '#818cf8', padding: '5px 10px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: '700', cursor: 'pointer' }}
                >
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                  Add Row
                </button>
              )}
              {selectedItem.type === 'table' && selectedRows.size > 0 && (
                <button
                  onClick={handleDeleteSelectedRows}
                  disabled={isDeletingRows}
                  style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', padding: '5px 10px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: '700', cursor: 'pointer' }}
                >
                  {isDeletingRows
                    ? <span className="spinner-small" style={{ borderColor: 'rgba(239,68,68,0.2)', borderTopColor: '#f87171', width: '10px', height: '10px' }}></span>
                    : <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>}
                  Delete {selectedRows.size} Row{selectedRows.size > 1 ? 's' : ''}
                </button>
              )}
              {selectedItem.type === 'table' && pendingEdits.length > 0 && (
                <button
                  onClick={handleSaveEdits}
                  disabled={isSavingEdits}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)', color: '#10b981', padding: '5px 10px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: '700', cursor: 'pointer' }}
                >
                  {isSavingEdits ? <span className="spinner-small" style={{ borderColor: 'rgba(16,185,129,0.2)', borderTopColor: '#10b981', width: '10px', height: '10px' }}></span> : (
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  )}
                  Save {pendingEdits.length} Change{pendingEdits.length > 1 ? 's' : ''}
                </button>
              )}
              {totalRows > 0 && (
                <button className="csv-export-btn" onClick={handleExportCsv}>
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Export CSV
                </button>
              )}
            </div>
          </div>

          {deleteError && (
            <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '4px', color: '#f87171', fontSize: '0.72rem', marginBottom: '6px', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
              {deleteError}
            </div>
          )}
          {saveError && (
            <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '4px', color: '#f87171', fontSize: '0.72rem', marginBottom: '6px', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
              {saveError}
            </div>
          )}
          {saveSuccess && (
            <div style={{ padding: '8px 12px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '4px', color: '#10b981', fontSize: '0.72rem', marginBottom: '6px' }}>
              {saveSuccess}
            </div>
          )}

          <div style={{ overflow: 'auto', background: 'rgba(0,0,0,0.1)', borderRadius: '6px', border: '1px solid var(--panel-border)', flexGrow: 1 }}>
            <table className="db-results-table">
              <thead>
                <tr>
                  {selectedItem.type === 'table' && (
                    <th style={{ width: '32px', padding: '6px 8px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        style={{ cursor: 'pointer', accentColor: 'var(--accent-primary)' }}
                        checked={paginatedRows.length > 0 && paginatedRows.every((_, pi) => selectedRows.has(startIndex + pi))}
                        onChange={() => toggleAllRows(paginatedRows.map((_, pi) => startIndex + pi))}
                        title="Select all on this page"
                      />
                    </th>
                  )}
                  {activeCols.map(col => (
                    <th key={col} title={queryResults?.columnTypes?.[col] ? `Type: ${queryResults.columnTypes[col]}` : col}>
                      {col}
                      {queryResults?.columnTypes?.[col] && (
                        <span style={{ marginLeft: '4px', fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 'normal', opacity: 0.7 }}>{queryResults.columnTypes[col]}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {queryResults?.loading ? (
                  <tr>
                    <td colSpan={activeCols.length || 1} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                        <span className="spinner-small" style={{ borderColor: 'rgba(255,255,255,0.1)', borderTopColor: 'var(--accent-primary)' }}></span>
                        <span>Executing query on database...</span>
                      </div>
                    </td>
                  </tr>
                ) : paginatedRows.length === 0 ? (
                  <tr>
                    <td colSpan={activeCols.length || 1} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                      No rows returned or table is empty.
                    </td>
                  </tr>
                ) : (
                  paginatedRows.map((row, pageIdx) => {
                    const absoluteIdx = startIndex + pageIdx;
                    return (
                      <tr
                        key={absoluteIdx}
                        style={{
                          background: selectedRows.has(absoluteIdx)
                            ? 'rgba(239,68,68,0.08)'
                            : pendingEdits.some(e => e.rowIdx === absoluteIdx)
                              ? 'rgba(251,191,36,0.05)'
                              : undefined
                        }}
                      >
                        {selectedItem.type === 'table' && (
                          <td style={{ width: '32px', padding: '6px 8px', textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={selectedRows.has(absoluteIdx)}
                              onChange={() => toggleRowSelection(absoluteIdx)}
                              style={{ cursor: 'pointer', accentColor: '#f87171' }}
                            />
                          </td>
                        )}
                        {activeCols.map(col => {
                          const isEditing = editingCell?.rowIdx === absoluteIdx && editingCell?.col === col;
                          const pgType = queryResults?.columnTypes?.[col];
                          const hasPendingEdit = pendingEdits.some(e => e.rowIdx === absoluteIdx && e.col === col);
                          const validationErr = isEditing ? validateCellValue(editingValue, pgType) : null;
                          const displayVal = row[col] === null ? <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>NULL</span> : (typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col]));
                          return (
                            <td
                              key={col}
                              onDoubleClick={() => handleCellDoubleClick(absoluteIdx, col, row[col])}
                              style={{
                                cursor: selectedItem.type === 'table' ? 'pointer' : 'default',
                                background: hasPendingEdit ? 'rgba(251,191,36,0.08)' : undefined,
                                outline: isEditing ? '2px solid var(--accent-primary)' : undefined,
                                padding: isEditing ? '0' : undefined,
                                position: 'relative'
                              }}
                              title={selectedItem.type === 'table' ? 'Double-click to edit' : undefined}
                            >
                              {isEditing ? (
                                <div style={{ position: 'relative' }}>
                                  <input
                                    autoFocus
                                    value={editingValue}
                                    onChange={e => setEditingValue(e.target.value)}
                                    onBlur={() => commitCellEdit(row, absoluteIdx, col)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') commitCellEdit(row, absoluteIdx, col);
                                      if (e.key === 'Escape') setEditingCell(null);
                                    }}
                                    style={{
                                      width: '100%', background: '#1a1d27', color: validationErr ? '#f87171' : '#fff',
                                      border: 'none', outline: 'none', padding: '6px 8px',
                                      fontFamily: 'inherit', fontSize: 'inherit', boxSizing: 'border-box'
                                    }}
                                  />
                                  {validationErr && (
                                    <div style={{ position: 'absolute', bottom: '100%', left: 0, background: '#7f1d1d', color: '#fca5a5', padding: '3px 7px', borderRadius: '3px', fontSize: '0.68rem', whiteSpace: 'nowrap', zIndex: 10 }}>
                                      ⚠ {validationErr}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                displayVal
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* New Row Editor row — rendered below the table */}
          {newRow && (
            <div style={{ marginTop: '8px', background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '6px', padding: '12px 14px' }}>
              <div style={{ fontSize: '0.72rem', color: '#818cf8', fontWeight: '700', marginBottom: '10px' }}>➕ New Row</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px', marginBottom: '10px' }}>
                {activeCols.map(col => {
                  const pgType = queryResults?.columnTypes?.[col];
                  const valErr = validateCellValue(newRow[col], pgType);
                  return (
                    <div key={col}>
                      <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '3px' }}>
                        {col}{pgType && <span style={{ marginLeft: '4px', opacity: 0.6 }}>({pgType})</span>}
                      </label>
                      <input
                        value={newRow[col]}
                        onChange={e => handleNewRowCellChange(col, e.target.value)}
                        placeholder="empty = NULL / default"
                        style={{
                          width: '100%', background: '#131520', border: `1px solid ${valErr ? '#f87171' : 'rgba(255,255,255,0.1)'}`,
                          color: valErr ? '#f87171' : '#e2e8f0', borderRadius: '4px', padding: '5px 8px',
                          fontSize: '0.75rem', outline: 'none', boxSizing: 'border-box'
                        }}
                      />
                      {valErr && <div style={{ fontSize: '0.62rem', color: '#f87171', marginTop: '2px' }}>⚠ {valErr}</div>}
                    </div>
                  );
                })}
              </div>
              {newRowError && (
                <div style={{ color: '#f87171', fontSize: '0.72rem', marginBottom: '8px', fontFamily: 'monospace' }}>⚠ {newRowError}</div>
              )}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={handleSaveNewRow}
                  disabled={isSavingNewRow}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)', color: '#10b981', padding: '6px 14px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer' }}
                >
                  {isSavingNewRow
                    ? <span className="spinner-small" style={{ borderColor: 'rgba(16,185,129,0.2)', borderTopColor: '#10b981', width: '10px', height: '10px' }}></span>
                    : <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                  Insert Row
                </button>
                <button
                  onClick={handleCancelNewRow}
                  style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', padding: '6px 14px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '600', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Database Pagination Footer Controls */}
          {totalRows > 0 && (
            <div className="db-pagination-bar" style={{ marginTop: '8px', flexShrink: 0 }}>
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
      {/* Table Maintenance Modal */}
      {maintenanceModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }} onClick={() => setMaintenanceModal(null)}>
          <div style={{ background: '#1a1d27', border: '1px solid var(--panel-border)', borderRadius: '10px', width: '100%', maxWidth: '860px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.7)' }} onClick={e => e.stopPropagation()}>
            {/* Modal header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--panel-border)', flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: '0.8rem', fontWeight: '700', color: '#fff' }}>{maintenanceModal.action}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>Table: <span style={{ color: '#818cf8' }}>{maintenanceModal.table}</span></div>
              </div>
              <button onClick={() => setMaintenanceModal(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            {/* Modal body */}
            <div style={{ overflowY: 'auto', padding: '16px 18px', flexGrow: 1 }}>
              {maintenanceModal.loading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)', padding: '20px 0' }}>
                  <span className="spinner-small" style={{ borderColor: 'rgba(255,255,255,0.1)', borderTopColor: 'var(--accent-primary)', width: '14px', height: '14px' }}></span>
                  <span>Executing...</span>
                </div>
              )}
              {maintenanceModal.error && (
                <div style={{ color: '#f87171', fontFamily: 'monospace', fontSize: '0.78rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '6px', padding: '12px' }}>
                  {maintenanceModal.error}
                </div>
              )}
              {maintenanceModal.data && !maintenanceModal.loading && (
                maintenanceModal.isCommand ? (
                  <div style={{ color: '#10b981', fontFamily: 'monospace', fontSize: '0.8rem', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '6px', padding: '12px' }}>
                    ✓ Command executed successfully. {maintenanceModal.data.rows?.[0] ? JSON.stringify(maintenanceModal.data.rows[0]) : ''}
                  </div>
                ) : maintenanceModal.action === 'Table Structure (DDL)' ? (
                  <div style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#cbd5e1', lineHeight: 1.7 }}>
                    {(maintenanceModal.data.rows || []).map((r, i) => (
                      <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{r.definition}</div>
                    ))}
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                      <thead>
                        <tr>
                          {(maintenanceModal.data.columns || []).map(col => (
                            <th key={col} style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid var(--panel-border)', whiteSpace: 'nowrap' }}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(maintenanceModal.data.rows || []).map((row, ri) => (
                          <tr key={ri} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                            {(maintenanceModal.data.columns || []).map(col => (
                              <td key={col} style={{ padding: '8px 10px', color: '#e2e8f0', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                {row[col] === null ? <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>NULL</span> : String(row[col])}
                              </td>
                            ))}
                          </tr>
                        ))}
                        {maintenanceModal.data.rows?.length === 0 && (
                          <tr><td colSpan={maintenanceModal.data.columns?.length || 1} style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)' }}>No results returned.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
