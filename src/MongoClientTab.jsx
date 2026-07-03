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
        settings: JSON.stringify({ theme: i % 2 === 0 ? 'dark' : 'light', notify: i % 3 === 0 })
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
        credentials: `{ hash: "$2b$10$xyz_${i}..." }`
      }))
    }
  };
};

const mongoKeywords = new Set([
  'db', 'find', 'findOne', 'aggregate', 'insertOne', 'insertMany', 'updateOne', 'updateMany',
  'deleteOne', 'deleteMany', 'limit', 'skip', 'sort', 'count', 'project', 'match', 'group',
  'ObjectId', 'ISODate', 'NumberInt', 'NumberLong', 'NumberDecimal', 'Timestamp'
]);

function highlightMongo(text) {
  if (!text) return '';
  let escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  const strings = [];
  escaped = escaped.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"|'(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\'])*')/g, (match) => {
    const idx = strings.length;
    strings.push(match);
    return `___STR_PLACEHOLDER_${idx}___`;
  });

  escaped = escaped.replace(/\b(\w+)\b/g, (match) => {
    if (mongoKeywords.has(match)) {
      return `<span class="mongo-keyword">${match}</span>`;
    }
    if (/^\d+$/.test(match)) {
      return `<span class="mongo-number">${match}</span>`;
    }
    if (['true', 'false', 'null'].includes(match)) {
      return `<span class="mongo-boolean">${match}</span>`;
    }
    return match;
  });

  strings.forEach((str, idx) => {
    escaped = escaped.replace(`___STR_PLACEHOLDER_${idx}___`, `<span class="mongo-string">${str}</span>`);
  });

  return escaped;
}

function highlightBsonJson(jsonText) {
  if (!jsonText) return '';
  let escaped = jsonText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(?=\s*:))|("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*")|(\b(true|false|null)\b)|(\b-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?\b)/g, (match) => {
    let cls = 'mongo-number';
    if (/^"/.test(match)) {
      if (/:$/.test(match) || escaped[escaped.indexOf(match) + match.length] === ':') {
        cls = 'mongo-key';
      } else {
        cls = 'mongo-string';
      }
    } else if (/true|false/.test(match)) {
      cls = 'mongo-boolean';
    } else if (/null/.test(match)) {
      cls = 'mongo-null';
    }
    
    if (cls === 'mongo-key') {
      return `<span style="color: #93c5fd; font-weight: 500;">${match}</span>`;
    } else if (cls === 'mongo-string') {
      return `<span style="color: #86efac;">${match}</span>`;
    } else if (cls === 'mongo-number') {
      return `<span style="color: #fdba74;">${match}</span>`;
    } else if (cls === 'mongo-boolean') {
      return `<span style="color: #f472b6; font-weight: bold;">${match}</span>`;
    } else if (cls === 'mongo-null') {
      return `<span style="color: #94a3b8; font-style: italic;">${match}</span>`;
    }
    return match;
  });
}

function BsonTreeNode({ label, value, path = '', index, onEdit, onDelete, isRoot = false }) {
  const [isExpanded, setIsExpanded] = useState(isRoot ? (index === 0) : false);

  const toggleExpand = (e) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  let type = typeof value;
  let typeLabel = '';
  let displayValue = '';
  let isExpandable = false;

  if (value === null) {
    type = 'null';
    typeLabel = 'Null';
    displayValue = 'null';
  } else if (Array.isArray(value)) {
    type = 'array';
    typeLabel = `Array [${value.length}]`;
    isExpandable = true;
  } else if (type === 'object') {
    if (value.$oid) {
      type = 'objectid';
      typeLabel = 'ObjectId';
      displayValue = `ObjectId("${value.$oid}")`;
    } else if (value.$date) {
      type = 'date';
      typeLabel = 'Date';
      displayValue = `ISODate("${value.$date}")`;
    } else {
      typeLabel = `Object {${Object.keys(value).length}}`;
      isExpandable = true;
    }
  } else {
    if (type === 'string') {
      typeLabel = 'String';
      displayValue = `"${value}"`;
    } else if (type === 'number') {
      typeLabel = Number.isInteger(value) ? 'Int32' : 'Double';
      displayValue = String(value);
    } else if (type === 'boolean') {
      typeLabel = 'Boolean';
      displayValue = String(value);
    }
  }

  return (
    <div className="bson-tree-row" style={{ marginLeft: isRoot ? '0' : '16px' }}>
      <div 
        className="bson-tree-node-header" 
        onClick={isExpandable ? toggleExpand : undefined}
      >
        {isExpandable ? (
          <span className={`bson-tree-arrow ${isExpanded ? 'expanded' : ''}`}>▶</span>
        ) : (
          <span className="bson-tree-spacer" />
        )}
        
        {isExpandable ? (
          <span className="bson-tree-icon">{type === 'array' ? '📂' : '📁'}</span>
        ) : (
          <span className="bson-tree-icon">📄</span>
        )}

        <span className="bson-tree-key">{label}</span>
        <span className="bson-tree-colon">:</span>

        {displayValue && (
          <span className={`bson-tree-value type-${type}`}>
            {displayValue}
          </span>
        )}

        <span className="bson-tree-type-label">({typeLabel})</span>

        {isRoot && (
          <div className="bson-tree-actions" onClick={e => e.stopPropagation()}>
            <button 
              className="bson-tree-action-btn" 
              onClick={() => onEdit(value)}
              title="Edit Document (JSON)"
            >
              ✏️ Edit
            </button>
            <button 
              className="bson-tree-action-btn btn-delete" 
              onClick={() => onDelete(index)}
              title="Delete Document"
            >
              🗑️ Delete
            </button>
          </div>
        )}
      </div>

      {isExpandable && isExpanded && (
        <div className="bson-tree-node-children" style={{ marginLeft: '12px', paddingLeft: '8px' }}>
          {type === 'array' ? (
            value.map((item, idx) => (
              <BsonTreeNode
                key={idx}
                label={String(idx)}
                value={item}
                path={`${path}[${idx}]`}
                index={index}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))
          ) : (
            Object.entries(value).map(([key, val]) => (
              <BsonTreeNode
                key={key}
                label={key}
                value={val}
                path={path ? `${path}.${key}` : key}
                index={index}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function BsonTreeView({ documents, onEdit, onDelete, startIndex = 0 }) {
  if (!documents || documents.length === 0) {
    return (
      <div style={{ padding: '20px', color: 'var(--text-muted)', textAlign: 'center', fontSize: '0.8rem' }}>
        No documents found.
      </div>
    );
  }

  return (
    <div className="bson-tree-container" style={{ height: '100%', overflow: 'auto', boxSizing: 'border-box' }}>
      {documents.map((doc, idx) => {
        const absIdx = startIndex + idx;
        return (
          <BsonTreeNode
            key={doc._id || absIdx}
            label={`{ ${absIdx} }`}
            value={doc}
            path=""
            index={absIdx}
            onEdit={onEdit}
            onDelete={onDelete}
            isRoot={true}
          />
        );
      })}
    </div>
  );
}

function RawTextView({ documents }) {
  const prettyJson = JSON.stringify(documents, null, 2);
  return (
    <pre style={{
      margin: 0,
      padding: '12px',
      background: '#111115',
      color: '#cbd5e1',
      fontSize: '0.8rem',
      fontFamily: "'Fira Code', 'Courier New', Courier, monospace",
      overflow: 'auto',
      height: '100%',
      boxSizing: 'border-box',
      lineHeight: '1.5',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all'
    }}>
      <code dangerouslySetInnerHTML={{ __html: highlightBsonJson(prettyJson) }} />
    </pre>
  );
}

export function MongoDbView({ connection, tabId }) {
  const mongoConfig = connection?.services?.mongo || {};
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [databases, setDatabases] = useState([]);
  const [activeDb, setActiveDb] = useState(mongoConfig.database || 'app_prod');
  const [collections, setCollections] = useState([]);
  const [selectedItem, setSelectedItem] = useState({ type: 'collection', name: '' });
  const [queryText, setQueryText] = useState('{}');
  const [queryResults, setQueryResults] = useState(null);
  const [connectionError, setConnectionError] = useState(null);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loadedSkip, setLoadedSkip] = useState(0);

  // Sidebar collapsible states
  const [collectionsCollapsed, setCollectionsCollapsed] = useState(false);
  const [savedQueriesCollapsed, setSavedQueriesCollapsed] = useState(false);

  // Resizable panels
  const [editorHeight, setEditorHeight] = useState(150);
  const [isResizing, setIsResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

  // Inline editing states
  const [editingCell, setEditingCell] = useState(null);
  const [editingValue, setEditingValue] = useState('');
  const [pendingEdits, setPendingEdits] = useState([]);
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(null);

  // Abort controller ref for running queries
  const abortControllerRef = useRef(null);

  // Database / Collection Creation Modal states
  const [createDbModalOpen, setCreateDbModalOpen] = useState(false);
  const [newDbName, setNewDbName] = useState('');
  const [createDbError, setCreateDbError] = useState(null);
  const [isCreatingDb, setIsCreatingDb] = useState(false);

  const [createColModalOpen, setCreateColModalOpen] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [createColError, setCreateColError] = useState(null);
  const [isCreatingCol, setIsCreatingCol] = useState(false);


  // New row insertion states
  const [newRow, setNewRow] = useState(null);
  const [isSavingNewRow, setIsSavingNewRow] = useState(false);
  const [newRowError, setNewRowError] = useState(null);

  // Row selection for deletion
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [isDeletingRows, setIsDeletingRows] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  // Saved queries states
  const [savedQueries, setSavedQueries] = useState([]);
  const [saveQueryModalOpen, setSaveQueryModalOpen] = useState(false);
  const [newSavedQueryName, setNewSavedQueryName] = useState('');
  const [saveQueryError, setSaveQueryError] = useState(null);

  // JSON Document Modal View/Edit states
  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);
  const [selectedDocForJson, setSelectedDocForJson] = useState(null);
  const [jsonDocText, setJsonDocText] = useState('');
  const [jsonModalError, setJsonModalError] = useState(null);
  const [isSavingJsonDoc, setIsSavingJsonDoc] = useState(false);
  const [isJsonModalMaximized, setIsJsonModalMaximized] = useState(false);

  // Tabs states
  const [tabs, setTabsList] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const activeTabIdRef = useRef(activeTabId);
  const [viewMode, setViewMode] = useState('tree');
  const [queryDuration, setQueryDuration] = useState(null);

  // Collection Search
  const [collectionSearch, setCollectionSearch] = useState('');
  const [activeQueryCollection, setActiveQueryCollection] = useState('');
  const [collectionMenuOpen, setCollectionMenuOpen] = useState(null);
  const [maintenanceModal, setMaintenanceModal] = useState(null);
  const [cloneModal, setCloneModal] = useState(null);
  const [csvImportModal, setCsvImportModal] = useState(null);

  // Initialize large mock data once for sandbox mode
  const mockMongoCollections = useRef(null);
  if (!mockMongoCollections.current) {
    mockMongoCollections.current = generateLargeMongoData();
  }

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  // Fetch saved queries on mount
  useEffect(() => {
    fetchSavedQueries();
  }, []);

  const fetchSavedQueries = () => {
    fetch('/api/db/mongo/queries')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setSavedQueries(data);
        }
      })
      .catch(err => console.error('Error fetching saved queries:', err));
  };

  const handleSaveQuery = (name, query) => {
    fetch('/api/db/mongo/queries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, query })
    })
      .then(res => {
        if (!res.ok) throw new Error('Failed to save query');
        return res.json();
      })
      .then(newQuery => {
        setSavedQueries(prev => [newQuery, ...prev]);
        setSaveQueryModalOpen(false);
        setNewSavedQueryName('');
        setSaveQueryError(null);
      })
      .catch(err => {
        setSaveQueryError(err.message);
      });
  };

  const handleDeleteSavedQuery = (id, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this saved query?')) return;
    
    fetch(`/api/db/mongo/queries/${id}`, {
      method: 'DELETE'
    })
      .then(res => {
        if (!res.ok) throw new Error('Failed to delete query');
        setSavedQueries(prev => prev.filter(q => q.id !== id));
      })
      .catch(err => console.error('Error deleting query:', err));
  };

  const loadSavedQuery = (q) => {
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (activeTab && activeTab.type === 'query') {
      setQueryText(q.query);
      setTabsList(prev => prev.map(t => {
        if (t.id === activeTabId) {
          return { ...t, queryText: q.query, title: q.name };
        }
        return t;
      }));
    } else {
      const tabKey = `query-tab-${Date.now()}`;
      const newTab = {
        id: tabKey,
        type: 'query',
        title: q.name,
        collectionName: collections[0] || 'users',
        selectedItem: { type: 'query', name: '' },
        queryText: q.query,
        queryResults: null,
        currentPage: 1,
        pageSize: 50,
        pendingEdits: [],
        newRow: null,
        selectedRows: new Set(),
        editingCell: null,
        editingValue: '',
        saveError: null,
        saveSuccess: null,
        newRowError: null,
        deleteError: null,
        viewMode: 'tree',
        queryDuration: null
      };

      setTabsList(prev => [...prev, newTab]);
      setActiveTabId(tabKey);
      setActiveQueryCollection(collections[0] || 'users');

      setSelectedItem({ type: 'query', name: '' });
      setQueryText(q.query);
      setQueryResults(null);
      setCurrentPage(1);
      setPageSize(50);
      setPendingEdits([]);
      setNewRow(null);
      setSelectedRows(new Set());
      setEditingCell(null);
      setEditingValue('');
      setSaveError(null);
      setSaveSuccess(null);
      setNewRowError(null);
      setDeleteError(null);
      setViewMode('tree');
      setQueryDuration(null);
    }
  };

  // Sync active states back to the tabs list in real-time
  useEffect(() => {
    if (!activeTabId) return;
    setTabsList(prev => prev.map(t => {
      if (t.id === activeTabId) {
        return {
          ...t,
          selectedItem,
          queryText,
          queryResults,
          currentPage,
          pageSize,
          pendingEdits,
          newRow,
          selectedRows,
          editingCell,
          editingValue,
          saveError,
          saveSuccess,
          newRowError,
          deleteError,
          viewMode,
          queryDuration
        };
      }
      return t;
    }));
  }, [
    activeTabId,
    selectedItem,
    queryText,
    queryResults,
    currentPage,
    pageSize,
    pendingEdits,
    newRow,
    selectedRows,
    editingCell,
    editingValue,
    saveError,
    saveSuccess,
    newRowError,
    deleteError,
    viewMode,
    queryDuration
  ]);

  const textareaRef = useRef(null);
  const overlayRef = useRef(null);
  const containerRef = useRef(null);

  const fetchDatabases = () => {
    if (!tabId) {
      setDatabases(Object.keys(mockMongoCollections.current));
      return;
    }
    fetch('/api/db/mongo/databases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tabId, connection })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success && data.databases) {
        setDatabases(data.databases);
      }
    })
    .catch(err => console.error("Error loading databases:", err));
  };

  const fetchCollections = (db) => {
    if (!tabId) {
      const cols = Object.keys(mockMongoCollections.current[db] || {});
      setCollections(cols);
      return;
    }
    fetch('/api/db/mongo/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tabId, connection, activeDb: db })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success && data.collections) {
        setCollections(data.collections);
      }
    })
    .catch(err => console.error("Error loading collections:", err));
  };

  const handleConnect = () => {
    setIsConnecting(true);
    setConnectionError(null);

    if (!tabId) {
      setTimeout(() => {
        setIsConnected(true);
        setIsConnecting(false);
        setDatabases(Object.keys(mockMongoCollections.current));
        setActiveDb('app_prod');
        fetchCollections('app_prod');
      }, 1000);
      return;
    }

    fetch('/api/db/mongo/databases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tabId, connection })
    })
    .then(async res => {
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error || 'Failed to list databases.';
        // If it is an authorization/privilege failure, do not block connection. Fall back to configured DB.
        const isAuthzErr = errMsg.toLowerCase().includes('not authorized') || 
                           errMsg.toLowerCase().includes('unauthorized') || 
                           errMsg.toLowerCase().includes('listdatabases') || 
                           errMsg.toLowerCase().includes('privilege') ||
                           errMsg.toLowerCase().includes('command list');
        if (isAuthzErr) {
          const fallbackDb = mongoConfig.database || 'admin';
          return { success: true, databases: [fallbackDb] };
        }
        throw new Error(errMsg);
      }
      return res.json();
    })
    .then(data => {
      if (data.success && data.databases) {
        setDatabases(data.databases);
        setIsConnected(true);
        const defaultDb = mongoConfig.database || (data.databases.includes('admin') ? 'admin' : data.databases[0]);
        setActiveDb(defaultDb);
        fetchCollections(defaultDb);
      } else {
        throw new Error(data.error || 'Failed to list databases.');
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
    setCollections([]);
    setTabsList([]);
    setActiveTabId(null);
  };

  const handleCreateDatabase = () => {
    if (!newDbName.trim()) {
      setCreateDbError("Database name is required.");
      return;
    }
    setIsCreatingDb(true);
    setCreateDbError(null);

    if (!tabId) {
      // Sandbox mode
      setTimeout(() => {
        const db = newDbName.trim();
        mockMongoCollections.current[db] = { init: [] };
        setDatabases(Object.keys(mockMongoCollections.current));
        setActiveDb(db);
        setCollections(['init']);
        setSelectedItem({ type: 'collection', name: 'init' });
        setIsCreatingDb(false);
        setCreateDbModalOpen(false);
        setNewDbName('');
      }, 800);
      return;
    }

    fetch('/api/db/mongo/create-database', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tabId, connection, dbName: newDbName.trim() })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        fetchDatabases();
        setActiveDb(newDbName.trim());
        fetchCollections(newDbName.trim());
        setSelectedItem({ type: 'collection', name: 'init' });
        setCreateDbModalOpen(false);
        setNewDbName('');
      } else {
        setCreateDbError(data.error || 'Failed to create database.');
      }
    })
    .catch(err => {
      setCreateDbError(err.message || 'Failed to create database.');
    })
    .finally(() => {
      setIsCreatingDb(false);
    });
  };

  const handleCreateCollection = () => {
    if (!newColName.trim()) {
      setCreateColError("Collection name is required.");
      return;
    }
    setIsCreatingCol(true);
    setCreateColError(null);

    if (!tabId) {
      // Sandbox mode
      setTimeout(() => {
        const col = newColName.trim();
        if (!mockMongoCollections.current[activeDb]) {
          mockMongoCollections.current[activeDb] = {};
        }
        mockMongoCollections.current[activeDb][col] = [];
        setCollections(Object.keys(mockMongoCollections.current[activeDb]));
        setSelectedItem({ type: 'collection', name: col });
        setIsCreatingCol(false);
        setCreateColModalOpen(false);
        setNewColName('');
      }, 800);
      return;
    }

    fetch('/api/db/mongo/create-collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tabId, connection, activeDb, collectionName: newColName.trim() })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        fetchCollections(activeDb);
        setSelectedItem({ type: 'collection', name: newColName.trim() });
        setCreateColModalOpen(false);
        setNewColName('');
      } else {
        setCreateColError(data.error || 'Failed to create collection.');
      }
    })
    .catch(err => {
      setCreateColError(err.message || 'Failed to create collection.');
    })
    .finally(() => {
      setIsCreatingCol(false);
    });
  };

  useEffect(() => {
    if (!isConnected) return;
    fetchCollections(activeDb);
  }, [activeDb, isConnected]);

  const loadTabState = (targetTab) => {
    setSelectedItem(targetTab.selectedItem || { type: 'query', name: '' });
    setQueryText(targetTab.queryText || '{}');
    setQueryResults(targetTab.queryResults || null);
    setCurrentPage(targetTab.currentPage || 1);
    setPageSize(targetTab.pageSize || 50);
    setLoadedSkip(targetTab.loadedSkip || 0);
    setPendingEdits(targetTab.pendingEdits || []);
    setNewRow(targetTab.newRow || null);
    setSelectedRows(targetTab.selectedRows || new Set());
    setEditingCell(targetTab.editingCell || null);
    setEditingValue(targetTab.editingValue || '');
    setSaveError(targetTab.saveError || null);
    setSaveSuccess(targetTab.saveSuccess || null);
    setNewRowError(targetTab.newRowError || null);
    setDeleteError(targetTab.deleteError || null);
    setViewMode(targetTab.viewMode || 'tree');
    setQueryDuration(targetTab.queryDuration || null);
    if (targetTab.type === 'query') {
      setActiveQueryCollection(targetTab.collectionName || collections[0] || 'users');
    }
  };

  const handleTabClick = (targetTabId) => {
    if (activeTabId === targetTabId) return;
    const targetTab = tabs.find(t => t.id === targetTabId);
    if (targetTab) {
      setActiveTabId(targetTabId);
      loadTabState(targetTab);
    }
  };

  const openOrSelectTab = (type, name) => {
    const tabKey = `${type}-${name}`;
    const existingTab = tabs.find(t => t.id === tabKey);
    if (existingTab) {
      setActiveTabId(tabKey);
      loadTabState(existingTab);
      return;
    }

    const query = type === 'collection' ? `db.getCollection('${name}').find({})` : '{}';
    const newTab = {
      id: tabKey,
      type: type,
      title: name,
      collectionName: name,
      selectedItem: { type, name },
      queryText: query,
      queryResults: { loading: true, success: true, documents: [] },
      currentPage: 1,
      pageSize: 50,
      loadedSkip: 0,
      pendingEdits: [],
      newRow: null,
      selectedRows: new Set(),
      editingCell: null,
      editingValue: '',
      saveError: null,
      saveSuccess: null,
      newRowError: null,
      deleteError: null,
      viewMode: 'tree',
      queryDuration: null
    };

    setTabsList(prev => [...prev, newTab]);
    setActiveTabId(tabKey);

    setSelectedItem({ type, name });
    setQueryText(query);
    setQueryResults({ loading: true, success: true, documents: [] });
    setCurrentPage(1);
    setPageSize(50);
    setLoadedSkip(0);
    setPendingEdits([]);
    setNewRow(null);
    setSelectedRows(new Set());
    setEditingCell(null);
    setEditingValue('');
    setSaveError(null);
    setSaveSuccess(null);
    setNewRowError(null);
    setDeleteError(null);
    setViewMode('tree');
    setQueryDuration(null);

    runRealQueryForTab(query, tabKey, name, 0);
  };

  const openNewQueryTab = () => {
    const queryNum = tabs.filter(t => t.type === 'query').length + 1;
    const tabKey = `query-tab-${Date.now()}`;
    const defaultCol = collections[0] || 'users';
    
    const defaultQuery = `db.getCollection('${defaultCol}').find({})`;
    const newTab = {
      id: tabKey,
      type: 'query',
      title: `Query ${queryNum}`,
      collectionName: defaultCol,
      selectedItem: { type: 'query', name: '' },
      queryText: defaultQuery,
      queryResults: null,
      currentPage: 1,
      pageSize: 50,
      loadedSkip: 0,
      pendingEdits: [],
      newRow: null,
      selectedRows: new Set(),
      editingCell: null,
      editingValue: '',
      saveError: null,
      saveSuccess: null,
      newRowError: null,
      deleteError: null,
      viewMode: 'tree',
      queryDuration: null
    };

    setTabsList(prev => [...prev, newTab]);
    setActiveTabId(tabKey);
    setActiveQueryCollection(defaultCol);

    setSelectedItem({ type: 'query', name: '' });
    setQueryText(defaultQuery);
    setQueryResults(null);
    setCurrentPage(1);
    setPageSize(50);
    setLoadedSkip(0);
    setPendingEdits([]);
    setNewRow(null);
    setSelectedRows(new Set());
    setEditingCell(null);
    setEditingValue('');
    setSaveError(null);
    setSaveSuccess(null);
    setNewRowError(null);
    setDeleteError(null);
    setViewMode('tree');
    setQueryDuration(null);
  };

  const closeTab = (tabIdToClose, e) => {
    e.stopPropagation();
    const index = tabs.findIndex(t => t.id === tabIdToClose);
    if (index === -1) return;

    const nextTabs = tabs.filter(t => t.id !== tabIdToClose);
    setTabsList(nextTabs);

    if (activeTabId === tabIdToClose) {
      if (nextTabs.length > 0) {
        const nextActiveIndex = Math.max(0, index - 1);
        const nextActiveTab = nextTabs[nextActiveIndex];
        setActiveTabId(nextActiveTab.id);
        loadTabState(nextActiveTab);
      } else {
        setActiveTabId(null);
        setSelectedItem({ type: 'query', name: '' });
        setQueryText('{}');
        setQueryResults(null);
      }
    }
  };

  const updateTabResults = (targetTabId, resultsData) => {
    setTabsList(prev => prev.map(t => {
      if (t.id === targetTabId) {
        return {
          ...t,
          queryResults: resultsData,
          pendingEdits: [],
          saveError: null,
          saveSuccess: null
        };
      }
      return t;
    }));
  };

  const runLocalMockFilter = (parsedFilter, targetTabId, colName, remoteError = null, startTime = null) => {
    const start = startTime || performance.now();
    const dbCollections = mockMongoCollections.current[activeDb] || {};
    const collectionDocs = dbCollections[colName] || [];
    
    try {
      const filterKeys = Object.keys(parsedFilter);
      let results;
      if (filterKeys.length === 0) {
        results = {
          success: true,
          documents: collectionDocs,
          warning: remoteError ? `Remote connection failed (${remoteError}). Displaying local sandbox mock data.` : null
        };
      } else {
        const filtered = collectionDocs.filter(doc => {
          return filterKeys.every(key => {
            return String(doc[key]) === String(parsedFilter[key]);
          });
        });
        results = {
          success: true,
          documents: filtered,
          warning: remoteError ? `Remote connection failed (${remoteError}). Displaying filtered local sandbox mock data.` : null
        };
      }
      
      const duration = Math.round(performance.now() - start);
      updateTabResults(targetTabId, results);
      if (activeTabIdRef.current === targetTabId) {
        setQueryResults(results);
        setQueryDuration(duration);
        setTabsList(prev => prev.map(t => {
          if (t.id === targetTabId) {
            return { ...t, queryResults: results, queryDuration: duration };
          }
          return t;
        }));
      }
    } catch (err) {
      const results = {
        success: true,
        documents: collectionDocs,
        warning: remoteError ? `Remote connection failed (${remoteError}). Displaying local sandbox mock data.` : null
      };
      const duration = Math.round(performance.now() - start);
      updateTabResults(targetTabId, results);
      if (activeTabIdRef.current === targetTabId) {
        setQueryResults(results);
        setQueryDuration(duration);
        setTabsList(prev => prev.map(t => {
          if (t.id === targetTabId) {
            return { ...t, queryResults: results, queryDuration: duration };
          }
          return t;
        }));
      }
    }
  };

  const runRealQueryForTab = (queryToRun, targetTabId, colName, skipVal = 0) => {
    let parsedFilter = {};
    let isCommand = false;
    let cleanQuery = queryToRun.trim();
    const startTime = performance.now();

    if (cleanQuery.startsWith('rs.') || (cleanQuery.startsWith('db.') && !cleanQuery.includes('.find('))) {
      isCommand = true;
    } else {
      try {
        const findMatch = cleanQuery.match(/db\.(?:getCollection\(['"]([^'"]+)['"]\)|([a-zA-Z0-9_.-]+))\.find\s*\(([\s\S]*)\)/);
        if (findMatch) {
          const parsedCol = findMatch[1] || findMatch[2];
          if (parsedCol) {
            colName = parsedCol;
          }
          cleanQuery = findMatch[3].trim();
          if (!cleanQuery) {
            cleanQuery = '{}';
          }
        }

        if (cleanQuery && cleanQuery !== '{}') {
          try {
            parsedFilter = JSON.parse(cleanQuery);
          } catch (e) {
            // Allow relaxed JS object syntax
            parsedFilter = Function('"use strict";return (' + cleanQuery + ')')();
          }
        }
      } catch (err) {
        if (cleanQuery.startsWith('db.')) {
          isCommand = true;
        } else {
          const errorState = { success: false, error: "Invalid JSON/JS object syntax: " + err.message };
          updateTabResults(targetTabId, errorState);
          if (activeTabIdRef.current === targetTabId) setQueryResults(errorState);
          return;
        }
      }
    }

    const loadingState = { loading: true, success: true, documents: [] };
    updateTabResults(targetTabId, loadingState);
    if (activeTabIdRef.current === targetTabId) {
      setQueryResults(loadingState);
    }

    if (!tabId) {
      runLocalMockFilter(isCommand ? {} : parsedFilter, targetTabId, colName, null, startTime);
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    fetch('/api/db/mongo/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abortControllerRef.current.signal,
      body: JSON.stringify({
        tabId,
        connection,
        activeDb,
        collection: colName,
        filter: isCommand ? undefined : parsedFilter,
        isCommand,
        commandText: isCommand ? queryToRun.trim() : undefined,
        skip: skipVal,
        limit: 500
      })
    })
    .then(res => {
      if (!res.ok) {
        return res.json().then(err => { throw new Error(err.error || 'Query execution failed'); });
      }
      return res.json();
    })
    .then(data => {
      const duration = Math.round(performance.now() - startTime);
      const resultsData = data.success ? {
        success: true,
        documents: data.documents || [],
        totalCount: data.totalCount || 0
      } : {
        success: false,
        error: data.error || 'Query returned unsuccessful status.'
      };

      updateTabResults(targetTabId, resultsData);
      if (activeTabIdRef.current === targetTabId) {
        setQueryResults(resultsData);
        setQueryDuration(duration);
        setLoadedSkip(skipVal);
        setTabsList(prev => prev.map(t => {
          if (t.id === targetTabId) {
            return { 
              ...t, 
              loadedSkip: skipVal, 
              queryResults: resultsData,
              queryDuration: duration
            };
          }
          return t;
        }));
        setPendingEdits([]);
        setSaveError(null);
        setSaveSuccess(null);
      }
    })
    .catch(err => {
      if (err.name === 'AbortError') {
        const errorState = { success: false, error: "Query execution cancelled by user." };
        updateTabResults(targetTabId, errorState);
        if (activeTabIdRef.current === targetTabId) setQueryResults(errorState);
        return;
      }
      runLocalMockFilter(isCommand ? {} : parsedFilter, targetTabId, colName, err.message, startTime);
    });
  };

  const handleCancelQuery = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    const cancelledState = { success: false, error: "Query execution cancelled by user." };
    updateTabResults(activeTabId, cancelledState);
    if (activeTabIdRef.current === activeTabId) {
      setQueryResults(cancelledState);
    }
  };

  const runQuery = () => {
    setCurrentPage(1);
    setLoadedSkip(0);
    const colName = selectedItem.type === 'collection' ? selectedItem.name : activeQueryCollection;
    runRealQueryForTab(queryText, activeTabId, colName, 0);
  };

  const handleScroll = () => {
    if (textareaRef.current && overlayRef.current) {
      overlayRef.current.scrollTop = textareaRef.current.scrollTop;
      overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  // JSON Export Utility
  const handleExportJson = () => {
    let parsedFilter = {};
    let isCommand = false;
    let cleanQuery = queryText.trim();

    if (cleanQuery.startsWith('rs.') || (cleanQuery.startsWith('db.') && !cleanQuery.includes('.find('))) {
      isCommand = true;
    } else {
      try {
        const findMatch = cleanQuery.match(/db\.[a-zA-Z0-9_.-]+\.find\s*\(([\s\S]*)\)/);
        if (findMatch) {
          cleanQuery = findMatch[1].trim();
          if (!cleanQuery) {
            cleanQuery = '{}';
          }
        }

        if (cleanQuery && cleanQuery !== '{}') {
          try {
            parsedFilter = JSON.parse(cleanQuery);
          } catch (e) {
            parsedFilter = Function('"use strict";return (' + cleanQuery + ')')();
          }
        }
      } catch (err) {
        if (cleanQuery.startsWith('db.')) {
          isCommand = true;
        }
      }
    }

    const colName = selectedItem.type === 'collection' ? selectedItem.name : activeQueryCollection;
    
    setIsExporting(true);
    fetch('/api/db/mongo/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tabId,
        connection,
        activeDb,
        collection: colName,
        filter: isCommand ? undefined : parsedFilter,
        isCommand,
        commandText: isCommand ? queryText.trim() : undefined,
        skip: 0,
        limit: 0
      })
    })
    .then(res => {
      if (!res.ok) {
        return res.json().then(err => { throw new Error(err.error || 'Failed to fetch documents for export'); });
      }
      return res.json();
    })
    .then(data => {
      const docsList = data.documents || [];
      if (docsList.length === 0) {
        alert("No documents found to export.");
        return;
      }
      
      const jsonContent = JSON.stringify(docsList, null, 2);

      const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `mongo_results_${colName}_${new Date().toISOString().slice(0,19).replace(/[:T]/g, '_')}.json`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    })
    .catch(err => {
      alert("Export failed: " + err.message);
    })
    .finally(() => {
      setIsExporting(false);
    });
  };

  // ---- Collection Settings and Maintenance Helpers ----
  const runMaintenanceQuery = async (colName, action, queryToRun, isCommand = false) => {
    setMaintenanceModal({ collection: colName, action, data: null, loading: true, error: null, isCommand });
    try {
      if (!tabId) {
        // Mock sandbox data
        let mockResult = [];
        if (action === 'Indexes') {
          mockResult = [{ v: 2, key: { _id: 1 }, name: '_id_' }];
        } else if (action === 'Collection Stats') {
          mockResult = [{ ns: `db.${colName}`, size: 40960, count: 125, avgObjSize: 327, storageSize: 16384 }];
        } else {
          mockResult = [{ result: `${action} completed successfully` }];
        }
        setMaintenanceModal({ collection: colName, action, data: { success: true, documents: mockResult }, loading: false, error: null, isCommand });
        return;
      }

      const resp = await fetch('/api/db/mongo/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tabId,
          connection,
          activeDb,
          collection: colName,
          isCommand: true,
          commandText: queryToRun
        })
      });
      const data = await resp.json();
      if (!data.success) throw new Error(data.error || 'Command failed');
      setMaintenanceModal({ collection: colName, action, data, loading: false, error: null, isCommand });
    } catch (e) {
      setMaintenanceModal({ collection: colName, action, data: null, loading: false, error: e.message, isCommand });
    }
  };

  const handleCollectionAction = (colName, action) => {
    setCollectionMenuOpen(null);
    switch (action) {
      case 'indexes':
        return runMaintenanceQuery(colName, 'Indexes', `db.${colName}.getIndexes()`);
      case 'stats':
        return runMaintenanceQuery(colName, 'Collection Stats', `db.runCommand({ collStats: "${colName}" })`);
      case 'compact':
        if (!window.confirm(`Run compact on collection ${colName}?\nThis rebuilds indices and frees unused storage space.`)) return;
        return runMaintenanceQuery(colName, 'Compact Collection', `db.runCommand({ compact: "${colName}" })`, true);
      case 'reindex':
        if (!window.confirm(`Run reIndex on collection ${colName}?\nThis will rebuild all indexes on the collection.`)) return;
        return runMaintenanceQuery(colName, 'Reindex Collection', `db.runCommand({ reIndex: "${colName}" })`, true);
      case 'clone':
        setCloneModal({ source: colName, target: `${colName}_copy`, isOpen: true });
        break;
      case 'import_csv':
        setCsvImportModal({ collection: colName, text: '', isOpen: true, error: null, importing: false });
        break;
      default:
        break;
    }
  };

  const handleCloneSubmit = async () => {
    if (!cloneModal || !cloneModal.target.trim()) return;
    setCloneModal(prev => ({ ...prev, loading: true }));
    try {
      if (!tabId) {
        setCollections(prev => [...prev, cloneModal.target.trim()]);
        setCloneModal(null);
        alert("Collection cloned successfully (sandbox mode)!");
        return;
      }

      const resp = await fetch('/api/db/mongo/clone-collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tabId,
          connection,
          activeDb,
          source: cloneModal.source,
          target: cloneModal.target.trim()
        })
      });
      const data = await resp.json();
      if (!data.success) throw new Error(data.error || 'Failed to clone collection');
      setCloneModal(null);
      fetchCollections(activeDb);
      alert("Collection cloned successfully!");
    } catch (e) {
      alert("Clone failed: " + e.message);
      setCloneModal(prev => ({ ...prev, loading: false }));
    }
  };

  const handleCsvImportSubmit = async () => {
    if (!csvImportModal || !csvImportModal.text.trim()) return;
    setCsvImportModal(prev => ({ ...prev, importing: true, error: null }));
    try {
      const lines = csvImportModal.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length < 2) {
        throw new Error("CSV data must contain at least a header row and one data row.");
      }

      const parseCsvLine = (line) => {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        result.push(current.trim());
        return result;
      };

      const headers = parseCsvLine(lines[0]);
      const documents = [];

      for (let i = 1; i < lines.length; i++) {
        const values = parseCsvLine(lines[i]);
        const doc = {};
        headers.forEach((header, index) => {
          let val = values[index] || '';
          if (val.startsWith('"') && val.endsWith('"')) {
            val = val.substring(1, val.length - 1);
          }
          if (val.toLowerCase() === 'true') {
            doc[header] = true;
          } else if (val.toLowerCase() === 'false') {
            doc[header] = false;
          } else if (!isNaN(val) && val !== '') {
            doc[header] = Number(val);
          } else {
            doc[header] = val;
          }
        });
        documents.push(doc);
      }

      if (!tabId) {
        alert(`Imported ${documents.length} documents successfully (sandbox mode)!`);
        setCsvImportModal(null);
        const colName = selectedItem.type === 'collection' ? selectedItem.name : activeQueryCollection;
        if (colName === csvImportModal.collection) {
          runQuery();
        }
        return;
      }

      const resp = await fetch('/api/db/mongo/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tabId,
          connection,
          activeDb,
          collection: csvImportModal.collection,
          documents
        })
      });
      const data = await resp.json();
      if (!data.success) throw new Error(data.error || 'Failed to import documents');
      alert(`Imported ${data.insertedCount} documents successfully!`);
      setCsvImportModal(null);

      const colName = selectedItem.type === 'collection' ? selectedItem.name : activeQueryCollection;
      if (colName === csvImportModal.collection) {
        runQuery();
      }
    } catch (e) {
      setCsvImportModal(prev => ({ ...prev, importing: false, error: e.message }));
    }
  };

  const handleCsvFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setCsvImportModal(prev => ({ ...prev, text: event.target.result, error: null }));
    };
    reader.onerror = () => {
      setCsvImportModal(prev => ({ ...prev, error: "Failed to read CSV file." }));
    };
    reader.readAsText(file);
  };

  // ---- Inline Editing Helpers ----
  const handleCellDoubleClick = (rowIdx, col, currentVal) => {
    setEditingCell({ rowIdx, col });
    setEditingValue(currentVal === null || currentVal === undefined 
      ? '' 
      : (typeof currentVal === 'object' ? JSON.stringify(currentVal) : String(currentVal)));
  };

  const commitCellEdit = (row, rowIdx, col) => {
    const pkVal = row['_id'];
    const originalVal = row[col];
    const newVal = editingValue;
    if (String(originalVal) !== String(newVal)) {
      setPendingEdits(prev => {
        const filtered = prev.filter(e => !(e.rowIdx === rowIdx && e.col === col));
        return [...filtered, { rowIdx, col, oldVal: originalVal, newVal, primaryKeyCol: '_id', primaryKeyVal: pkVal }];
      });
      setQueryResults(prev => {
        const newDocs = prev.documents.map((r, i) => i === rowIdx ? { ...r, [col]: newVal } : r);
        return { ...prev, documents: newDocs };
      });
    }
    setEditingCell(null);
  };

  const updateLocalMock = (colName, id, columnName, value) => {
    const dbCollections = mockMongoCollections.current[activeDb] || {};
    const docsList = dbCollections[colName] || [];
    const doc = docsList.find(d => String(d._id) === String(id));
    if (doc) {
      doc[columnName] = value;
    }
  };

  const insertLocalMock = (colName, doc) => {
    const dbCollections = mockMongoCollections.current[activeDb] || {};
    dbCollections[colName] = dbCollections[colName] || [];
    dbCollections[colName].push(doc);
  };

  const deleteLocalMock = (colName, id) => {
    const dbCollections = mockMongoCollections.current[activeDb] || {};
    dbCollections[colName] = (dbCollections[colName] || []).filter(d => String(d._id) !== String(id));
  };

  const handleSaveEdits = async () => {
    if (pendingEdits.length === 0) return;
    setIsSavingEdits(true);
    setSaveError(null);
    setSaveSuccess(null);
    const errors = [];
    const colName = selectedItem.type === 'collection' ? selectedItem.name : activeQueryCollection;

    for (const edit of pendingEdits) {
      if (!tabId) {
        updateLocalMock(colName, edit.primaryKeyVal, edit.col, edit.newVal);
        continue;
      }
      try {
        const resp = await fetch('/api/db/mongo/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tabId,
            connection,
            activeDb,
            collection: colName,
            id: edit.primaryKeyVal,
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
    const cols = queryResults?.documents.length > 0
      ? [...new Set(queryResults.documents.flatMap(doc => Object.keys(doc)))]
      : ['_id', 'name', 'value'];
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
    setIsSavingNewRow(true);
    setNewRowError(null);
    const colName = selectedItem.type === 'collection' ? selectedItem.name : activeQueryCollection;

    try {
      if (!tabId) {
        const newDoc = { ...newRow, _id: newRow._id || `649a2f${Math.floor(Math.random()*1000000)}f0e219b1b1c3c4d5a` };
        Object.keys(newDoc).forEach(k => {
          try {
            newDoc[k] = JSON.parse(newDoc[k]);
          } catch(e) {}
        });
        insertLocalMock(colName, newDoc);
        setQueryResults(prev => ({
          ...prev,
          documents: [...(prev?.documents || []), newDoc]
        }));
        setNewRow(null);
        setSaveSuccess('New document inserted successfully in Sandbox.');
        return;
      }

      const resp = await fetch('/api/db/mongo/insert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tabId, connection, activeDb,
          collection: colName,
          row: newRow
        })
      });
      const data = await resp.json();
      if (!data.success) throw new Error(data.error || 'Insert failed');
      setQueryResults(prev => ({
        ...prev,
        documents: [...(prev?.documents || []), data.insertedRow]
      }));
      setNewRow(null);
      setSaveSuccess('New document inserted successfully.');
    } catch (e) {
      setNewRowError(e.message);
    } finally {
      setIsSavingNewRow(false);
    }
  };

  const handleDeleteSelectedRows = async (singleIndex = null) => {
    const targets = singleIndex !== null ? new Set([singleIndex]) : selectedRows;
    if (targets.size === 0) return;
    const count = targets.size;
    const colName = selectedItem.type === 'collection' ? selectedItem.name : activeQueryCollection;
    const confirmed = window.confirm(
      `Are you sure you want to permanently delete ${count} document${count > 1 ? 's' : ''} from "${colName}"?\n\nThis cannot be undone.`
    );
    if (!confirmed) return;

    setIsDeletingRows(true);
    setDeleteError(null);
    const errors = [];
    const deletedIndices = [];

    for (const absIdx of targets) {
      const row = (queryResults?.documents || [])[absIdx];
      if (!row) continue;
      const pkVal = row['_id'];

      if (!tabId) {
        deleteLocalMock(colName, pkVal);
        deletedIndices.push(absIdx);
        continue;
      }

      try {
        const resp = await fetch('/api/db/mongo/delete-row', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tabId, connection, activeDb,
            collection: colName,
            id: pkVal
          })
        });
        const data = await resp.json();
        if (data.success) { deletedIndices.push(absIdx); }
        else { errors.push(`Document ${pkVal}: ${data.error}`); }
      } catch (e) {
        errors.push(`Document ${pkVal}: ${e.message}`);
      }
    }

    if (deletedIndices.length > 0) {
      const deletedSet = new Set(deletedIndices);
      setQueryResults(prev => ({
        ...prev,
        documents: (prev?.documents || []).filter((_, i) => !deletedSet.has(i))
      }));
      setSelectedRows(new Set());
      setPendingEdits(prev => prev.filter(e => !deletedSet.has(e.rowIdx)));
    }

    setIsDeletingRows(false);
    if (errors.length > 0) {
      setDeleteError(errors.join('\n'));
    } else {
      setSaveSuccess(`${deletedIndices.length} document${deletedIndices.length > 1 ? 's' : ''} deleted successfully.`);
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

  const handleMouseDown = (e) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newHeight = e.clientY - rect.top;
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

  const handleSidebarMouseDown = (e) => {
    e.preventDefault();
    setIsResizingSidebar(true);
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizingSidebar) return;
      const newWidth = e.clientX;
      if (newWidth > 150 && newWidth < 600) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
    };

    if (isResizingSidebar) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar]);

  if (!isConnected) {
    return (
      <div className="db-connect-splash">
        <div className="db-connect-card glass-panel">
          <div className="db-connect-icon">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75M3.75 13.875v3.75" />
            </svg>
          </div>
          <h2>MongoDB Client Dashboard</h2>
          <p>Establish a secure bridge client connection to browse databases, collections and query documents.</p>
          {connectionError && (
            <div className="query-status-banner error" style={{ margin: '12px 0', borderRadius: '4px', textAlign: 'left', padding: '10px 14px' }}>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.75rem' }}>{connectionError}</pre>
            </div>
          )}
          <div className="db-connect-details">
            <div className="db-detail-row">
              <span className="label">Database Server:</span>
              <span className="val">{connection?.host || '127.0.0.1'}:{mongoConfig.port || 27017}</span>
            </div>
            <div className="db-detail-row">
              <span className="label">Default Database:</span>
              <span className="val">{mongoConfig.database || 'admin'}</span>
            </div>
            <div className="db-detail-row">
              <span className="label">User Credentials:</span>
              <span className="val">{mongoConfig.username || 'None'}</span>
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

  const goToPage = (pageNum) => {
    const targetStartIndex = (pageNum - 1) * pageSize;
    const targetEndIndex = targetStartIndex + pageSize;

    const activeRows = queryResults?.documents || [];
    const isLoaded = targetStartIndex >= loadedSkip && targetEndIndex <= (loadedSkip + activeRows.length);

    if (isLoaded) {
      setCurrentPage(pageNum);
      setTabsList(prev => prev.map(t => {
        if (t.id === activeTabId) {
          return { ...t, currentPage: pageNum };
        }
        return t;
      }));
    } else {
      const targetSkip = Math.floor(targetStartIndex / 500) * 500;
      const colName = selectedItem.type === 'collection' ? selectedItem.name : activeQueryCollection;
      
      const loadingState = { loading: true, success: true, documents: [] };
      setQueryResults(loadingState);

      runRealQueryForTab(queryText, activeTabId, colName, targetSkip);
      setCurrentPage(pageNum);
      setTabsList(prev => prev.map(t => {
        if (t.id === activeTabId) {
          return { ...t, currentPage: pageNum, loadedSkip: targetSkip };
        }
        return t;
      }));
    }
  };

  const activeRows = queryResults?.documents || [];
  let activeCols = [];
  if (activeRows.length > 0) {
    const keys = [...new Set(activeRows.flatMap(row => Object.keys(row)))];
    const idIdx = keys.indexOf('_id');
    if (idIdx > -1) {
      keys.splice(idIdx, 1);
      activeCols = ['_id', ...keys];
    } else {
      activeCols = keys;
    }
  }

  // Pagination calculations
  const totalRows = queryResults?.totalCount || activeRows.length;
  const totalPages = Math.ceil(totalRows / pageSize) || 1;
  const startIndex = totalRows === 0 ? 0 : (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalRows);
  
  const localStartIndex = Math.max(0, startIndex - loadedSkip);
  const localEndIndex = Math.min(localStartIndex + pageSize, activeRows.length);
  const paginatedRows = activeRows.slice(localStartIndex, localEndIndex);

  return (
    <div className="db-explorer-container">
      <style>{`
        .mongo-editor-container {
          position: relative;
          width: 100%;
          background: #121216;
          border: 1px solid var(--panel-border);
          border-radius: 6px;
          overflow: hidden;
        }
        .mongo-textarea {
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
        .mongo-highlight-overlay {
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
        .mongo-keyword {
          color: #3b82f6;
          font-weight: bold;
        }
        .mongo-string {
          color: #10b981;
        }
        .mongo-number {
          color: #fb923c;
        }
        .mongo-boolean {
          color: #ec4899;
          font-weight: bold;
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
        .horizontal-resizer-bar {
          width: 4px;
          background: rgba(255,255,255,0.06);
          cursor: col-resize;
          transition: background 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          border-left: 1px solid var(--panel-border);
          border-right: 1px solid var(--panel-border);
          user-select: none;
          flex-shrink: 0;
          height: 100%;
        }
        .horizontal-resizer-bar:hover, .horizontal-resizer-bar.active {
          background: var(--accent-primary);
        }
        .horizontal-resizer-bar::after {
          content: '';
          width: 2px;
          height: 20px;
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

        /* Bson Tree View Styles */
        .bson-tree-container {
          padding: 8px;
          font-family: 'Fira Code', 'Courier New', Courier, monospace;
          font-size: 0.78rem;
          color: #cbd5e1;
        }
        .bson-tree-row {
          display: flex;
          flex-direction: column;
          margin: 2px 0;
        }
        .bson-tree-node-header {
          display: flex;
          align-items: center;
          padding: 4px 6px;
          cursor: pointer;
          border-radius: 4px;
          transition: background 0.15s;
          user-select: none;
        }
        .bson-tree-node-header:hover {
          background: rgba(255, 255, 255, 0.05);
        }
        .bson-tree-arrow {
          display: inline-block;
          width: 14px;
          text-align: center;
          margin-right: 4px;
          font-size: 0.65rem;
          color: var(--text-muted);
          transition: transform 0.15s ease;
        }
        .bson-tree-arrow.expanded {
          transform: rotate(90deg);
          color: #fff;
        }
        .bson-tree-spacer {
          display: inline-block;
          width: 14px;
          margin-right: 4px;
        }
        .bson-tree-icon {
          margin-right: 6px;
          font-size: 0.85rem;
        }
        .bson-tree-key {
          color: #93c5fd;
          font-weight: 500;
        }
        .bson-tree-colon {
          color: var(--text-muted);
          margin-right: 6px;
        }
        .bson-tree-value {
          font-weight: 400;
        }
        .bson-tree-value.type-string {
          color: #86efac;
        }
        .bson-tree-value.type-number {
          color: #fdba74;
        }
        .bson-tree-value.type-boolean {
          color: #f472b6;
          font-weight: bold;
        }
        .bson-tree-value.type-null {
          color: #94a3b8;
          font-style: italic;
        }
        .bson-tree-value.type-objectid {
          color: #c084fc;
        }
        .bson-tree-value.type-date {
          color: #2dd4bf;
        }
        .bson-tree-type-label {
          color: var(--text-muted);
          font-size: 0.68rem;
          margin-left: 8px;
          opacity: 0.75;
        }
        .bson-tree-node-children {
          border-left: 1px dashed rgba(255, 255, 255, 0.15);
        }
        .bson-tree-actions {
          margin-left: auto;
          display: flex;
          gap: 6px;
          opacity: 0;
          transition: opacity 0.15s ease;
        }
        .bson-tree-node-header:hover .bson-tree-actions {
          opacity: 1;
        }
        .bson-tree-action-btn {
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid var(--panel-border);
          border-radius: 3px;
          color: #e2e8f0;
          padding: 1px 6px;
          font-size: 0.65rem;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
        }
        .bson-tree-action-btn:hover {
          background: var(--accent-primary);
          color: #fff;
        }
        .bson-tree-action-btn.btn-delete:hover {
          background: #ef4444;
          color: #fff;
        }

        /* Sidebar Connection Tree Styles */
        .bson-sidebar-tree {
          font-size: 0.76rem;
          color: #cbd5e1;
        }
        .sidebar-tree-node-wrapper {
          margin: 1px 0;
        }
        .sidebar-tree-node {
          display: flex;
          align-items: center;
          padding: 5px 6px;
          border-radius: 4px;
          cursor: pointer;
          transition: background 0.1s, color 0.1s;
          user-select: none;
        }
        .sidebar-tree-node:hover {
          background: rgba(255, 255, 255, 0.04);
        }
        .sidebar-tree-node.active {
          background: rgba(59, 130, 246, 0.15);
          color: #60a5fa;
          font-weight: 500;
        }
        .sidebar-tree-node.disabled-node {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .sidebar-tree-node.disabled-node:hover {
          background: transparent;
        }
        .tree-node-arrow {
          display: inline-block;
          width: 14px;
          text-align: center;
          margin-right: 4px;
          font-size: 0.6rem;
          color: var(--text-muted);
        }
        .tree-node-spacer {
          display: inline-block;
          width: 14px;
          margin-right: 4px;
        }
        .tree-node-icon {
          margin-right: 6px;
          font-size: 0.8rem;
        }
        .tree-node-label {
          flex-grow: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .sidebar-tree-children {
          margin-left: 12px;
          padding-left: 6px;
          border-left: 1px solid rgba(255, 255, 255, 0.07);
        }
        .collection-gear-btn {
          opacity: 0;
          transition: opacity 0.1s;
        }
        .sidebar-tree-node:hover .collection-gear-btn {
          opacity: 1;
        }
        .collection-dropdown-menu {
          background: #1a1d27;
          border: 1px solid var(--panel-border);
          border-radius: 6px;
          padding: 4px 0;
          min-width: 180px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        }
        .dropdown-divider {
          height: 1px;
          background: var(--panel-border);
          margin: 4px 0;
        }
        .dropdown-item-btn {
          display: flex;
          align-items: center;
          width: 100%;
          background: none;
          border: none;
          color: #e2e8f0;
          padding: 7px 12px;
          font-size: 0.75rem;
          cursor: pointer;
          text-align: left;
          transition: background 0.1s;
        }
        .dropdown-item-btn:hover {
          background: rgba(255,255,255,0.06);
        }
      `}</style>

      <div className="db-sidebar glass-panel" style={{ width: `${sidebarWidth}px`, flexShrink: 0 }}>
        <div className="db-sidebar-header">
          <div className="db-sidebar-title">MongoDB Explorer</div>
          
        {/* Database Select Dropdown Removed in favor of connection tree */}
      </div>

      <div className="db-sidebar-list" style={{ overflow: 'auto', flexGrow: 1, padding: '12px' }}>
        
        {/* Robo3T Connection Tree */}
        <div className="bson-sidebar-tree">
          {/* Connection Node */}
          <div className="sidebar-tree-node connection-node" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span className="tree-node-arrow">▼</span>
              <span className="tree-node-icon">🔌</span>
              <span className="tree-node-label" style={{ fontWeight: '600' }}>
                {connection?.name || 'Local MongoDB'}
              </span>
            </div>
            <button 
              onClick={(e) => { e.stopPropagation(); setCreateDbError(null); setNewDbName(''); setCreateDbModalOpen(true); }}
              title="Create Database"
              style={{
                background: 'rgba(59,130,246,0.15)',
                border: '1px solid rgba(59,130,246,0.3)',
                color: '#60a5fa',
                fontSize: '0.62rem',
                padding: '2px 6px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                transition: 'background 0.15s'
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(59,130,246,0.3)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(59,130,246,0.15)'}
            >
              <span>+</span> DB
            </button>
          </div>
          
          {/* Databases under Connection */}
          <div className="sidebar-tree-children">
            {databases.map(db => {
              const isDbActive = activeDb === db;
              return (
                <div key={db} className="sidebar-tree-node-wrapper">
                  <div 
                    className={`sidebar-tree-node db-node ${isDbActive ? 'active' : ''}`}
                    onClick={() => {
                      if (activeDb !== db) {
                        setActiveDb(db);
                      }
                    }}
                  >
                    <span className="tree-node-arrow">{isDbActive ? '▼' : '▶'}</span>
                    <span className="tree-node-icon">🗄️</span>
                    <span className="tree-node-label">{db}</span>
                  </div>
                  
                  {isDbActive && (
                    <div className="sidebar-tree-children">
                      {/* Collections Folder */}
                      <div className="sidebar-tree-node-wrapper">
                        <div 
                          className="sidebar-tree-node folder-node"
                          onClick={() => setCollectionsCollapsed(!collectionsCollapsed)}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: '8px' }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            <span className="tree-node-arrow">{collectionsCollapsed ? '▶' : '▼'}</span>
                            <span className="tree-node-icon">{collectionsCollapsed ? '📁' : '📂'}</span>
                            <span className="tree-node-label">Collections ({collections.length})</span>
                          </div>
                          <button 
                            onClick={(e) => { e.stopPropagation(); setCreateColError(null); setNewColName(''); setCreateColModalOpen(true); }}
                            title="Create Collection"
                            style={{
                              background: 'rgba(16,185,129,0.15)',
                              border: '1px solid rgba(16,185,129,0.3)',
                              color: '#10b981',
                              fontSize: '0.62rem',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontWeight: 'bold',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px',
                              transition: 'background 0.15s'
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(16,185,129,0.3)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'rgba(16,185,129,0.15)'}
                          >
                            <span>+</span> Col
                          </button>
                        </div>
                        
                        {!collectionsCollapsed && (
                          <div className="sidebar-tree-children">
                            <div style={{ padding: '2px 4px 6px 4px' }}>
                              <input
                                type="text"
                                placeholder="Filter collections..."
                                value={collectionSearch}
                                onChange={e => setCollectionSearch(e.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '4px 6px',
                                  background: 'rgba(0,0,0,0.3)',
                                  border: '1px solid var(--panel-border)',
                                  borderRadius: '4px',
                                  color: '#fff',
                                  fontSize: '0.7rem',
                                  outline: 'none',
                                  boxSizing: 'border-box'
                                }}
                              />
                            </div>
                            
                            {collections.filter(c => c.toLowerCase().includes(collectionSearch.toLowerCase())).map(c => {
                              const isColSelected = selectedItem.type === 'collection' && selectedItem.name === c;
                              return (
                                <div key={c} style={{ position: 'relative', display: 'flex', flexDirection: 'column', width: '100%' }}>
                                  <div 
                                    className={`sidebar-tree-node collection-node ${isColSelected ? 'active' : ''}`}
                                    onClick={() => openOrSelectTab('collection', c)}
                                  >
                                    <span className="tree-node-spacer" />
                                    <span className="tree-node-icon">📋</span>
                                    <span className="tree-node-label">{c}</span>
                                    
                                    <button
                                      onClick={e => { 
                                        e.stopPropagation(); 
                                        setCollectionMenuOpen(collectionMenuOpen === c ? null : c); 
                                      }}
                                      title="Collection actions"
                                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                                      className="collection-gear-btn"
                                    >
                                      ⚙️
                                    </button>
                                  </div>
                                  
                                  {collectionMenuOpen === c && (
                                    <div
                                      className="collection-dropdown-menu"
                                      style={{ position: 'absolute', left: '20px', top: '100%', zIndex: 200 }}
                                      onClick={e => e.stopPropagation()}
                                    >
                                      {[
                                        { id: 'indexes',       icon: '🗂️', label: 'View Indexes' },
                                        { id: 'stats',         icon: '📊', label: 'Collection Stats' },
                                        { id: 'compact',       icon: '🧹', label: 'Compact Collection' },
                                        { id: 'reindex',       icon: '🔄', label: 'Reindex Collection' },
                                        null,
                                        { id: 'clone',         icon: '👯', label: 'Clone Collection' },
                                        { id: 'import_csv',    icon: '📥', label: 'Import CSV / Restore' },
                                      ].map((item, i) => item === null
                                        ? <div key={i} className="dropdown-divider" />
                                        : (
                                          <button key={item.id}
                                            onClick={() => handleCollectionAction(c, item.id)}
                                            className="dropdown-item-btn"
                                          >
                                            <span className="mr-2">{item.icon}</span><span>{item.label}</span>
                                          </button>
                                        )
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      
                      {/* System nodes */}
                      <div className="sidebar-tree-node folder-node disabled-node">
                        <span className="tree-node-arrow">▶</span>
                        <span className="tree-node-icon">📁</span>
                        <span className="tree-node-label">System Collections (0)</span>
                      </div>
                      <div className="sidebar-tree-node folder-node disabled-node">
                        <span className="tree-node-arrow">▶</span>
                        <span className="tree-node-icon">📁</span>
                        <span className="tree-node-label">Functions (0)</span>
                      </div>
                      <div className="sidebar-tree-node folder-node disabled-node">
                        <span className="tree-node-arrow">▶</span>
                        <span className="tree-node-icon">📁</span>
                        <span className="tree-node-label">Users (0)</span>
                      </div>
                      <div className="sidebar-tree-node folder-node disabled-node">
                        <span className="tree-node-arrow">▶</span>
                        <span className="tree-node-icon">📁</span>
                        <span className="tree-node-label">Roles (0)</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Saved Queries Section */}
        <div className="db-sidebar-section-header" onClick={() => setSavedQueriesCollapsed(!savedQueriesCollapsed)} style={{ marginTop: '16px' }}>
          <span>Saved Queries ({savedQueries.length})</span>
          <span style={{ fontSize: '0.6rem' }}>{savedQueriesCollapsed ? '▶' : '▼'}</span>
        </div>
        {!savedQueriesCollapsed && (
          <div className="db-sidebar-list-inner" style={{ paddingLeft: '4px', marginTop: '4px' }}>
            {savedQueries.map(q => (
              <div key={q.id} style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}>
                <button
                  className="db-list-item"
                  onClick={() => loadSavedQuery(q)}
                  style={{ flex: 1, border: 'none', background: 'transparent', textAlign: 'left', paddingRight: '24px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}
                  title={`Click to load:\n\n${q.query}`}
                >
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <span>{q.name}</span>
                </button>
                <button
                  onClick={(e) => handleDeleteSavedQuery(q.id, e)}
                  title="Delete saved query"
                  style={{ position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', opacity: 0.6, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px' }}
                  onMouseEnter={e => e.currentTarget.style.opacity = 1}
                  onMouseLeave={e => e.currentTarget.style.opacity = 0.6}
                >
                  ✕
                </button>
              </div>
            ))}
            {savedQueries.length === 0 && (
              <div style={{ padding: '6px 12px', fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                No saved queries
              </div>
            )}
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

      {/* Horizontal resizer bar */}
      <div 
        className={`horizontal-resizer-bar ${isResizingSidebar ? 'active' : ''}`}
        onMouseDown={handleSidebarMouseDown}
      />

      <div className="db-main-content" ref={containerRef} style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, height: '100%' }}>
        
        {/* Tab Bar */}
        <div className="pg-tabs-bar" style={{
          display: 'flex',
          alignItems: 'center',
          background: 'rgba(0,0,0,0.2)',
          borderBottom: '1px solid var(--panel-border)',
          flexShrink: 0,
          overflowX: 'auto',
          padding: '0 8px',
          gap: '4px',
          height: '36px',
          boxSizing: 'border-box'
        }}>
          {tabs.map(tab => (
            <div
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '0 12px',
                height: '35px',
                background: activeTabId === tab.id ? 'var(--panel-bg)' : 'transparent',
                borderBottom: activeTabId === tab.id ? '2px solid var(--accent-primary)' : '2px solid transparent',
                cursor: 'pointer',
                userSelect: 'none',
                transition: 'background 0.15s, border-color 0.15s',
                borderTopLeftRadius: '4px',
                borderTopRightRadius: '4px',
                color: activeTabId === tab.id ? '#fff' : 'var(--text-muted)',
                fontSize: '0.75rem',
                fontWeight: activeTabId === tab.id ? '600' : 'normal',
                boxSizing: 'border-box',
                whiteSpace: 'nowrap'
              }}
              className="pg-tab-item"
            >
              <span>{tab.type === 'collection' ? '📋' : '⚡'}</span>
              <span>{tab.title}</span>
              <button
                onClick={(e) => closeTab(tab.id, e)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'inherit',
                  cursor: 'pointer',
                  padding: '2px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '50%',
                  width: '14px',
                  height: '14px',
                  opacity: 0.6,
                  transition: 'opacity 0.15s, background 0.15s'
                }}
                className="pg-tab-close-btn"
                onMouseEnter={e => {
                  e.currentTarget.style.opacity = '1';
                  e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.opacity = '0.6';
                  e.currentTarget.style.background = 'none';
                }}
              >
                ✕
              </button>
            </div>
          ))}
          
          <button
            onClick={openNewQueryTab}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '6px 10px',
              fontSize: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'color 0.15s'
            }}
            title="Open new query tab"
            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>+</span>
            <span>New Query</span>
          </button>
        </div>

        {tabs.length === 0 ? (
          <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', gap: '8px' }}>
            <span>No active tabs</span>
            <span style={{ fontSize: '0.75rem' }}>Select a collection from the sidebar or click "+ New Query" to start browsing.</span>
            <button 
              onClick={openNewQueryTab} 
              style={{
                marginTop: '12px',
                background: 'var(--accent-primary)',
                border: 'none',
                borderRadius: '4px',
                color: '#fff',
                padding: '6px 16px',
                fontSize: '0.75rem',
                cursor: 'pointer',
                fontWeight: '600'
              }}
            >
              Open New Query Tab
            </button>
          </div>
        ) : (
          <>
            {/* MongoDB Query Editor Panel with resizable height */}
            <div className="query-runner-panel glass-panel" style={{ height: `${editorHeight}px`, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
              <div className="query-actions-row" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: '600', marginRight: 'auto' }}>MongoDB Query Runner</span>
                
                {tabs.find(t => t.id === activeTabId)?.type === 'query' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--panel-border)', borderRadius: '4px', padding: '4px 8px', height: '28px', boxSizing: 'border-box' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Collection:</span>
                    <select
                      value={activeQueryCollection}
                      onChange={e => {
                        setActiveQueryCollection(e.target.value);
                        setTabsList(prev => prev.map(t => {
                          if (t.id === activeTabId) {
                            return { ...t, collectionName: e.target.value };
                          }
                          return t;
                        }));
                      }}
                      style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '0.75rem', outline: 'none', fontWeight: '600' }}
                    >
                      {collections.map(col => (
                        <option key={col} value={col} style={{ background: '#1a1d27' }}>{col}</option>
                      ))}
                    </select>
                  </div>
                )}

                {queryResults?.loading ? (
                  <button 
                    className="cancel-query-btn" 
                    onClick={handleCancelQuery} 
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '6px', 
                      background: 'rgba(239, 68, 68, 0.2)', 
                      border: '1px solid rgba(239, 68, 68, 0.5)', 
                      color: '#ef4444', 
                      padding: '6px 12px', 
                      borderRadius: '4px', 
                      fontSize: '0.75rem', 
                      cursor: 'pointer', 
                      fontWeight: '600' 
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                    </svg>
                    Stop
                  </button>
                ) : (
                  <button 
                    className="run-query-btn" 
                    onClick={runQuery} 
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--accent-primary)', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer', fontWeight: '600' }}
                  >
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    Find
                  </button>
                )}
                {tabs.find(t => t.id === activeTabId)?.type === 'query' && (
                  <button 
                    className="save-query-btn" 
                    onClick={() => {
                      setNewSavedQueryName('');
                      setSaveQueryError(null);
                      setSaveQueryModalOpen(true);
                    }}
                    disabled={queryResults?.loading || !queryText.trim()}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.07)', border: '1px solid var(--panel-border)', color: '#fff', padding: '6px 12px', borderRadius: '4px', fontSize: '0.75rem', cursor: (queryResults?.loading || !queryText.trim()) ? 'not-allowed' : 'pointer', fontWeight: '600' }}
                  >
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
                      <path d="M17 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>
                    </svg>
                    Save Query
                  </button>
                )}
              </div>
              <div className="mongo-editor-container" style={{ flexGrow: 1, position: 'relative' }}>
                <textarea
                  ref={textareaRef}
                  className="mongo-textarea"
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  onScroll={handleScroll}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      runQuery();
                    }
                  }}
                  placeholder='e.g. {"username": "alex_ops"}'
                />
                <div 
                  ref={overlayRef}
                  className="mongo-highlight-overlay"
                  dangerouslySetInnerHTML={{ __html: highlightMongo(queryText) }}
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
                <span>
                  Documents {queryResults ? `(${selectedItem.type === 'collection' ? 'Collection' : 'Query'}: ${selectedItem.type === 'collection' ? selectedItem.name : activeQueryCollection})` : ''}
                  {queryDuration !== null && (
                    <span style={{ marginLeft: '12px', color: '#10b981', background: 'rgba(16,185,129,0.1)', padding: '2px 6px', borderRadius: '3px', fontSize: '0.7rem' }}>
                      Fetched {activeRows.length} records in {queryDuration}ms
                    </span>
                  )}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {/* Segmented View Mode Switcher */}
                  <div style={{ display: 'flex', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--panel-border)', borderRadius: '4px', padding: '2px', marginRight: '6px' }}>
                    {[
                      { mode: 'tree', label: '🌳 Tree' },
                      { mode: 'table', label: '📊 Table' },
                      { mode: 'text', label: '📝 Text' }
                    ].map(b => (
                      <button
                        key={b.mode}
                        onClick={() => setViewMode(b.mode)}
                        style={{
                          background: viewMode === b.mode ? 'var(--accent-primary)' : 'transparent',
                          border: 'none',
                          color: viewMode === b.mode ? '#fff' : 'var(--text-muted)',
                          padding: '3px 8px',
                          borderRadius: '3px',
                          fontSize: '0.68rem',
                          fontWeight: '600',
                          cursor: 'pointer',
                          transition: 'background 0.15s, color 0.15s'
                        }}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>

                  <span>{queryResults?.totalCount !== undefined ? `${queryResults.totalCount} total documents matching filter (loaded batch of ${activeRows.length})` : `${activeRows.length} documents found`}</span>
                  {activeCols.length > 0 && !newRow && (
                    <button
                      onClick={handleAddRow}
                      style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.4)', color: '#818cf8', padding: '5px 10px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: '700', cursor: 'pointer' }}
                    >
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                      Insert Doc
                    </button>
                  )}
                  {selectedRows.size > 0 && viewMode === 'table' && (
                    <button
                      onClick={() => handleDeleteSelectedRows()}
                      disabled={isDeletingRows}
                      style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', padding: '5px 10px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: '700', cursor: 'pointer' }}
                    >
                      {isDeletingRows
                        ? <span className="spinner-small" style={{ borderColor: 'rgba(239,68,68,0.2)', borderTopColor: '#f87171', width: '10px', height: '10px' }}></span>
                        : <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>}
                      Delete {selectedRows.size} Doc{selectedRows.size > 1 ? 's' : ''}
                    </button>
                  )}
                  {pendingEdits.length > 0 && viewMode === 'table' && (
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
                    <button className="csv-export-btn" onClick={handleExportJson} disabled={isExporting}>
                      {isExporting ? (
                        <span className="spinner-small" style={{ borderColor: 'var(--text-muted)', borderTopColor: 'var(--accent)', width: '10px', height: '10px', marginRight: '6px' }}></span>
                      ) : (
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                        </svg>
                      )}
                      {isExporting ? 'Exporting...' : 'Export JSON'}
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
                {viewMode === 'tree' ? (
                  queryResults?.loading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', color: 'var(--text-muted)', padding: '40px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="spinner-small" style={{ borderColor: 'rgba(255,255,255,0.1)', borderTopColor: 'var(--accent-primary)' }}></span>
                        <span>Querying documents...</span>
                      </div>
                      <button 
                        onClick={handleCancelQuery}
                        style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', padding: '4px 10px', borderRadius: '4px', fontSize: '0.7rem', cursor: 'pointer' }}
                      >
                        Cancel Query
                      </button>
                    </div>
                  ) : paginatedRows.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px' }}>
                      No documents returned or collection is empty.
                    </div>
                  ) : (
                    <BsonTreeView 
                      documents={paginatedRows} 
                      onEdit={(doc, idx) => {
                        setSelectedDocForJson(doc);
                        setJsonDocText(JSON.stringify(doc, null, 2));
                        setJsonModalError(null);
                        setIsJsonModalOpen(true);
                      }}
                      onDelete={(absIdx) => handleDeleteSelectedRows(absIdx)}
                      startIndex={startIndex}
                    />
                  )
                ) : viewMode === 'text' ? (
                  queryResults?.loading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', color: 'var(--text-muted)', padding: '40px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="spinner-small" style={{ borderColor: 'rgba(255,255,255,0.1)', borderTopColor: 'var(--accent-primary)' }}></span>
                        <span>Querying documents...</span>
                      </div>
                      <button 
                        onClick={handleCancelQuery}
                        style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', padding: '4px 10px', borderRadius: '4px', fontSize: '0.7rem', cursor: 'pointer' }}
                      >
                        Cancel Query
                      </button>
                    </div>
                  ) : paginatedRows.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px' }}>
                      No documents returned or collection is empty.
                    </div>
                  ) : (
                    <RawTextView documents={paginatedRows} />
                  )
                ) : (
                  <table className="db-results-table">
                    <thead>
                      <tr>
                        <th style={{ width: '32px', padding: '6px 8px', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            style={{ cursor: 'pointer', accentColor: 'var(--accent-primary)' }}
                            checked={paginatedRows.length > 0 && paginatedRows.every((_, pi) => selectedRows.has(startIndex + pi))}
                            onChange={() => toggleAllRows(paginatedRows.map((_, pi) => startIndex + pi))}
                            title="Select all on this page"
                          />
                        </th>
                        <th style={{ width: '80px', textAlign: 'center' }}>Actions</th>
                        {activeCols.map(col => (
                          <th key={col}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {queryResults?.loading ? (
                        <tr>
                          <td colSpan={activeCols.length + 2 || 2} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '30px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className="spinner-small" style={{ borderColor: 'rgba(255,255,255,0.1)', borderTopColor: 'var(--accent-primary)' }}></span>
                                <span>Querying documents...</span>
                              </div>
                              <button 
                                onClick={handleCancelQuery}
                                style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', padding: '4px 10px', borderRadius: '4px', fontSize: '0.7rem', cursor: 'pointer' }}
                              >
                                Cancel Query
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : paginatedRows.length === 0 ? (
                        <tr>
                          <td colSpan={activeCols.length + 2 || 2} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                            No documents returned or collection is empty.
                          </td>
                        </tr>
                      ) : (
                        paginatedRows.map((row, pageIdx) => {
                          const absoluteIdx = startIndex + pageIdx;
                          return (
                            <tr
                              key={row._id || absoluteIdx}
                              style={{
                                background: selectedRows.has(absoluteIdx)
                                  ? 'rgba(239,68,68,0.08)'
                                  : pendingEdits.some(e => e.rowIdx === absoluteIdx)
                                    ? 'rgba(251,191,36,0.05)'
                                    : undefined
                              }}
                            >
                              <td style={{ width: '32px', padding: '6px 8px', textAlign: 'center' }}>
                                <input
                                  type="checkbox"
                                  checked={selectedRows.has(absoluteIdx)}
                                  onChange={() => toggleRowSelection(absoluteIdx)}
                                  style={{ cursor: 'pointer', accentColor: '#f87171' }}
                                />
                              </td>
                              <td style={{ width: '80px', padding: '6px 8px', textAlign: 'center' }}>
                                <button
                                  onClick={() => {
                                    setSelectedDocForJson(row);
                                    setJsonDocText(JSON.stringify(row, null, 2));
                                    setJsonModalError(null);
                                    setIsJsonModalOpen(true);
                                  }}
                                  title="View/Edit JSON"
                                  style={{
                                    background: 'rgba(59,130,246,0.15)',
                                    border: '1px solid rgba(59,130,246,0.4)',
                                    color: '#60a5fa',
                                    padding: '3px 8px',
                                    borderRadius: '4px',
                                    fontSize: '0.68rem',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                  }}
                                >
                                  <span>JSON</span>
                                </button>
                              </td>
                              {activeCols.map(col => {
                                const isEditing = editingCell?.rowIdx === absoluteIdx && editingCell?.col === col;
                                const hasPendingEdit = pendingEdits.some(e => e.rowIdx === absoluteIdx && e.col === col);
                                const displayVal = row[col] === null || row[col] === undefined 
                                  ? <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>null</span> 
                                  : (typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col]));
                                
                                return (
                                  <td
                                    key={col}
                                    onDoubleClick={() => handleCellDoubleClick(absoluteIdx, col, row[col])}
                                    style={{
                                      cursor: 'pointer',
                                      background: hasPendingEdit ? 'rgba(251,191,36,0.08)' : undefined,
                                      outline: isEditing ? '2px solid var(--accent-primary)' : undefined,
                                      padding: isEditing ? '0' : undefined,
                                      position: 'relative'
                                    }}
                                    title="Double-click to edit"
                                  >
                                    {isEditing ? (
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
                                          width: '100%', background: '#1a1d27', color: '#fff',
                                          border: 'none', outline: 'none', padding: '6px 8px',
                                          fontFamily: 'inherit', fontSize: 'inherit', boxSizing: 'border-box'
                                        }}
                                      />
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
                )}
              </div>

              {/* New Document Editor Panel */}
              {newRow && (
                <div style={{ marginTop: '8px', background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '6px', padding: '12px 14px' }}>
                  <div style={{ fontSize: '0.72rem', color: '#818cf8', fontWeight: '700', marginBottom: '10px' }}>➕ New Document</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px', marginBottom: '10px' }}>
                    {activeCols.map(col => (
                      <div key={col}>
                        <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '3px' }}>{col}</label>
                        <input
                          value={newRow[col] || ''}
                          onChange={e => handleNewRowCellChange(col, e.target.value)}
                          placeholder={col === '_id' ? 'Omit to auto-generate' : 'Value (JSON or String)'}
                          style={{
                            width: '100%', background: '#131520', border: '1px solid rgba(255,255,255,0.1)',
                            color: '#e2e8f0', borderRadius: '4px', padding: '5px 8px',
                            fontSize: '0.75rem', outline: 'none', boxSizing: 'border-box'
                          }}
                        />
                      </div>
                    ))}
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
                      Insert Doc
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
                      onClick={() => goToPage(1)}
                      disabled={currentPage === 1}
                      title="First Page"
                    >
                      &laquo;
                    </button>
                    <button
                      className="page-btn icon-btn"
                      onClick={() => goToPage(Math.max(1, currentPage - 1))}
                      disabled={currentPage === 1}
                      title="Previous Page"
                    >
                      &lsaquo;
                    </button>

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
                              onClick={() => goToPage(pageNum)}
                            >
                              {pageNum}
                            </button>
                          </React.Fragment>
                        );
                      })}

                    <button
                      className="page-btn icon-btn"
                      onClick={() => goToPage(Math.min(totalPages, currentPage + 1))}
                      disabled={currentPage === totalPages}
                      title="Next Page"
                    >
                      &rsaquo;
                    </button>
                    <button
                      className="page-btn icon-btn"
                      onClick={() => goToPage(totalPages)}
                      disabled={currentPage === totalPages}
                      title="Last Page"
                    >
                      &raquo;
                    </button>

                    <div className="page-size-selector">
                      <select
                        value={pageSize}
                        onChange={(e) => {
                          const newSize = Number(e.target.value);
                          setPageSize(newSize);
                          setCurrentPage(1);
                          setLoadedSkip(0);
                          setTabsList(prev => prev.map(t => {
                            if (t.id === activeTabId) {
                              return { ...t, pageSize: newSize, currentPage: 1, loadedSkip: 0 };
                            }
                            return t;
                          }));
                          const colName = selectedItem.type === 'collection' ? selectedItem.name : activeQueryCollection;
                          runRealQueryForTab(queryText, activeTabId, colName, 0);
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
          </>
        )}
      </div>

      {/* Save Query Modal */}
      {saveQueryModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div className="glass-panel" style={{ background: '#1a1d27', border: '1px solid var(--panel-border)', borderRadius: '8px', width: '100%', maxWidth: '460px', padding: '20px', boxShadow: '0 10px 40px rgba(0,0,0,0.6)' }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#fff', marginBottom: '14px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '8px' }}>
              Save Query
            </div>
            
            {saveQueryError && (
              <div style={{ color: '#ef4444', fontSize: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', padding: '8px', borderRadius: '4px', marginBottom: '12px' }}>
                {saveQueryError}
              </div>
            )}
            
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '6px' }}>Query Name</label>
              <input
                type="text"
                placeholder="e.g. Find Users in Admin group"
                value={newSavedQueryName}
                onChange={e => setNewSavedQueryName(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--panel-border)', borderRadius: '4px', color: '#fff', fontSize: '0.8rem', outline: 'none', boxSizing: 'border-box' }}
                autoFocus
              />
            </div>
            
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '6px' }}>Query Filter</label>
              <pre style={{ margin: 0, padding: '8px 12px', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--panel-border)', borderRadius: '4px', color: '#a7f3d0', fontSize: '0.7rem', overflow: 'auto', maxHeight: '120px', fontFamily: 'monospace' }}>
                {queryText}
              </pre>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={() => setSaveQueryModalOpen(false)}
                style={{ background: 'none', border: '1px solid var(--panel-border)', color: 'var(--text-muted)', padding: '6px 12px', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleSaveQuery(newSavedQueryName, queryText)}
                disabled={!newSavedQueryName.trim()}
                style={{ background: 'var(--accent-primary)', border: 'none', color: '#fff', padding: '6px 12px', borderRadius: '4px', fontSize: '0.75rem', cursor: !newSavedQueryName.trim() ? 'not-allowed' : 'pointer', fontWeight: '600' }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* JSON Document View/Edit Modal */}
      {isJsonModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div className="glass-panel" style={{
            background: '#1a1d27',
            border: '1px solid var(--panel-border)',
            borderRadius: '8px',
            width: '100%',
            maxWidth: isJsonModalMaximized ? 'none' : '640px',
            height: isJsonModalMaximized ? 'calc(100% - 48px)' : 'auto',
            display: 'flex',
            flexDirection: 'column',
            padding: '20px',
            boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
            boxSizing: 'border-box'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '8px', flexShrink: 0 }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#fff' }}>
                View / Edit Document (JSON)
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={() => setIsJsonModalMaximized(!isJsonModalMaximized)}
                  style={{
                    background: 'none',
                    border: '1px solid var(--panel-border)',
                    color: '#fff',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '0.7rem',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontWeight: '600'
                  }}
                  title={isJsonModalMaximized ? "Restore Size" : "Maximize Modal"}
                >
                  <span>{isJsonModalMaximized ? '🗗 Restore' : '🗖 Maximize'}</span>
                </button>
                <button 
                  onClick={() => setIsJsonModalOpen(false)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1rem', cursor: 'pointer', padding: '4px' }}
                  title="Close"
                >
                  ✕
                </button>
              </div>
            </div>
            
            {jsonModalError && (
              <div style={{ color: '#ef4444', fontSize: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', padding: '8px', borderRadius: '4px', marginBottom: '12px', whiteSpace: 'pre-wrap', fontFamily: 'monospace', flexShrink: 0 }}>
                {jsonModalError}
              </div>
            )}
            
            <div style={{ marginBottom: '16px', flexGrow: isJsonModalMaximized ? 1 : 0, display: 'flex', flexDirection: 'column' }}>
              <textarea
                value={jsonDocText}
                onChange={e => setJsonDocText(e.target.value)}
                style={{
                  width: '100%',
                  height: isJsonModalMaximized ? '100%' : '350px',
                  flexGrow: isJsonModalMaximized ? 1 : 0,
                  background: '#121216',
                  border: '1px solid var(--panel-border)',
                  borderRadius: '4px',
                  color: '#e2e8f0',
                  fontSize: '0.8rem',
                  fontFamily: "'Fira Code', 'Courier New', Courier, monospace",
                  padding: '12px',
                  boxSizing: 'border-box',
                  outline: 'none',
                  resize: isJsonModalMaximized ? 'none' : 'vertical',
                  lineHeight: '1.5'
                }}
                spellCheck="false"
              />
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                Note: Editing <code style={{ color: '#a7f3d0' }}>_id</code> is not allowed; original value will be preserved.
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setIsJsonModalOpen(false)}
                  style={{ background: 'none', border: '1px solid var(--panel-border)', color: 'var(--text-muted)', padding: '6px 12px', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setIsSavingJsonDoc(true);
                    setJsonModalError(null);
                    
                    let parsedDoc;
                    try {
                      parsedDoc = JSON.parse(jsonDocText);
                    } catch (e) {
                      setJsonModalError("JSON Parse Error: " + e.message);
                      setIsSavingJsonDoc(false);
                      return;
                    }

                    const originalId = selectedDocForJson._id;

                    if (!tabId) {
                      // Sandbox local update
                      setQueryResults(prev => {
                        if (!prev?.documents) return prev;
                        return {
                          ...prev,
                          documents: prev.documents.map(doc => doc._id === originalId ? parsedDoc : doc)
                        };
                      });
                      setIsJsonModalOpen(false);
                      setIsSavingJsonDoc(false);
                      return;
                    }

                    fetch('/api/db/mongo/replace-doc', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        tabId,
                        connection,
                        activeDb,
                        collection: selectedItem.type === 'collection' ? selectedItem.name : activeQueryCollection,
                        id: originalId,
                        document: parsedDoc
                      })
                    })
                    .then(res => {
                      if (!res.ok) {
                        return res.json().then(err => { throw new Error(err.error || 'Failed to replace document'); });
                      }
                      return res.json();
                    })
                    .then(data => {
                      if (data.success) {
                        setQueryResults(prev => {
                          if (!prev?.documents) return prev;
                          return {
                            ...prev,
                            documents: prev.documents.map(doc => doc._id === originalId ? parsedDoc : doc)
                          };
                        });
                        setIsJsonModalOpen(false);
                      } else {
                        setJsonModalError(data.error || 'Replace failed');
                      }
                    })
                    .catch(err => {
                      setJsonModalError(err.message);
                    })
                    .finally(() => {
                      setIsSavingJsonDoc(false);
                    });
                  }}
                  disabled={isSavingJsonDoc}
                  style={{
                    background: 'var(--accent-primary)',
                    border: 'none',
                    color: '#fff',
                    padding: '6px 16px',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    cursor: isSavingJsonDoc ? 'not-allowed' : 'pointer',
                    fontWeight: '600',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  {isSavingJsonDoc && <span className="spinner-small"></span>}
                  <span>Save Document</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MongoDB Maintenance / Indexes / Stats Modal */}
      {maintenanceModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }} onClick={() => { if (!maintenanceModal.loading) setMaintenanceModal(null); }}>
          <div className="glass-panel" style={{
            background: '#1a1d27',
            border: '1px solid var(--panel-border)',
            borderRadius: '8px',
            width: '100%',
            maxWidth: '680px',
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column',
            padding: '20px',
            boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
            boxSizing: 'border-box'
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '8px', flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: '0.9rem', fontWeight: '700', color: '#fff' }}>{maintenanceModal.action}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>Collection: <span style={{ color: 'var(--accent)' }}>{maintenanceModal.collection}</span></div>
              </div>
              <button 
                onClick={() => setMaintenanceModal(null)}
                disabled={maintenanceModal.loading}
                style={{ background: 'none', border: 'none', color: maintenanceModal.loading ? '#475569' : 'var(--text-muted)', fontSize: '1rem', cursor: maintenanceModal.loading ? 'not-allowed' : 'pointer', padding: '4px' }}
                title={maintenanceModal.loading ? "Cannot close while running" : "Close"}
              >
                ✕
              </button>
            </div>

            {maintenanceModal.loading && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', gap: '12px' }}>
                <span className="spinner-large" style={{ width: '28px', height: '28px' }}></span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Executing command on server...</span>
              </div>
            )}

            {maintenanceModal.error && (
              <div style={{ color: '#ef4444', fontSize: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', padding: '12px', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '4px', overflowY: 'auto', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                {maintenanceModal.error}
              </div>
            )}

            {maintenanceModal.data && !maintenanceModal.loading && (
              <div style={{ overflowY: 'auto', flexGrow: 1, paddingRight: '4px' }}>
                {maintenanceModal.action === 'Indexes' ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--panel-border)', color: 'var(--text-muted)' }}>
                        <th style={{ padding: '8px' }}>Name</th>
                        <th style={{ padding: '8px' }}>Key Definition</th>
                        <th style={{ padding: '8px' }}>Unique</th>
                        <th style={{ padding: '8px' }}>Version</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(maintenanceModal.data.documents || []).map((idx, index) => (
                        <tr key={index} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <td style={{ padding: '8px', fontWeight: 'bold', color: '#e2e8f0' }}>{idx.name}</td>
                          <td style={{ padding: '8px', color: '#10b981', fontFamily: 'monospace' }}>{JSON.stringify(idx.key)}</td>
                          <td style={{ padding: '8px' }}>{idx.unique ? 'Yes ✅' : 'No'}</td>
                          <td style={{ padding: '8px', color: 'var(--text-muted)' }}>{idx.v}</td>
                        </tr>
                      ))}
                      {(maintenanceModal.data.documents || []).length === 0 && (
                        <tr>
                          <td colSpan="4" style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)' }}>No indexes found.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                ) : maintenanceModal.action === 'Collection Stats' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {[
                      { label: 'Namespace', val: maintenanceModal.data.documents?.[0]?.ns || `db.${maintenanceModal.collection}` },
                      { label: 'Total Documents', val: maintenanceModal.data.documents?.[0]?.count ?? 0 },
                      { label: 'Data Size', val: `${((maintenanceModal.data.documents?.[0]?.size || 0) / 1024).toFixed(2)} KB` },
                      { label: 'Avg Object Size', val: `${((maintenanceModal.data.documents?.[0]?.avgObjSize || 0)).toFixed(2)} bytes` },
                      { label: 'Storage Size', val: `${((maintenanceModal.data.documents?.[0]?.storageSize || 0) / 1024).toFixed(2)} KB` },
                      { label: 'Total Indexes', val: maintenanceModal.data.documents?.[0]?.nindexes ?? Object.keys(maintenanceModal.data.documents?.[0]?.indexSizes || {}).length },
                      { label: 'Total Index Size', val: `${((maintenanceModal.data.documents?.[0]?.totalIndexSize || 0) / 1024).toFixed(2)} KB` },
                    ].map((item, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.04)' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: '600' }}>{item.label}</span>
                        <span style={{ fontSize: '0.72rem', color: '#fff', fontFamily: 'monospace', fontWeight: 'bold' }}>{item.val}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <pre style={{ margin: 0, padding: '12px', background: '#121216', border: '1px solid var(--panel-border)', borderRadius: '4px', color: '#a7f3d0', fontSize: '0.75rem', fontFamily: 'monospace', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(maintenanceModal.data, null, 2)}
                  </pre>
                )}
              </div>
            )}
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px', borderTop: '1px solid var(--panel-border)', paddingTop: '10px', flexShrink: 0 }}>
              <button
                onClick={() => setMaintenanceModal(null)}
                disabled={maintenanceModal.loading}
                style={{ background: 'var(--accent)', border: 'none', color: '#fff', padding: '6px 16px', borderRadius: '4px', fontSize: '0.75rem', cursor: maintenanceModal.loading ? 'not-allowed' : 'pointer', fontWeight: '600' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clone Collection Modal */}
      {cloneModal && cloneModal.isOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div className="glass-panel" style={{
            background: '#1a1d27',
            border: '1px solid var(--panel-border)',
            borderRadius: '8px',
            width: '100%',
            maxWidth: '420px',
            padding: '20px',
            boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
            boxSizing: 'border-box'
          }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#fff', marginBottom: '14px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '8px' }}>
              Clone Collection
            </div>
            
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
              Cloning from <span style={{ color: 'var(--accent)', fontWeight: 'bold' }}>{cloneModal.source}</span>.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' }}>
              <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: '600' }}>Target Collection Name</label>
              <input
                type="text"
                value={cloneModal.target}
                onChange={e => setCloneModal(prev => ({ ...prev, target: e.target.value }))}
                placeholder="e.g. users_backup"
                style={{
                  width: '100%',
                  padding: '8px',
                  background: '#121216',
                  border: '1px solid var(--panel-border)',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '0.78rem',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={() => setCloneModal(null)}
                disabled={cloneModal.loading}
                style={{ background: 'none', border: '1px solid var(--panel-border)', color: 'var(--text-muted)', padding: '6px 12px', borderRadius: '4px', fontSize: '0.75rem', cursor: cloneModal.loading ? 'not-allowed' : 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleCloneSubmit}
                disabled={cloneModal.loading || !cloneModal.target.trim()}
                style={{
                  background: 'var(--accent)',
                  border: 'none',
                  color: '#fff',
                  padding: '6px 16px',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  cursor: (cloneModal.loading || !cloneModal.target.trim()) ? 'not-allowed' : 'pointer',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                {cloneModal.loading && <span className="spinner-small"></span>}
                <span>Clone Collection</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {csvImportModal && csvImportModal.isOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div className="glass-panel" style={{
            background: '#1a1d27',
            border: '1px solid var(--panel-border)',
            borderRadius: '8px',
            width: '100%',
            maxWidth: '600px',
            display: 'flex',
            flexDirection: 'column',
            padding: '20px',
            boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
            boxSizing: 'border-box'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '8px', flexShrink: 0 }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#fff' }}>
                Import CSV / Restore into <span style={{ color: 'var(--accent)' }}>{csvImportModal.collection}</span>
              </span>
              <button 
                onClick={() => setCsvImportModal(null)}
                disabled={csvImportModal.importing}
                style={{ background: 'none', border: 'none', color: csvImportModal.importing ? '#475569' : 'var(--text-muted)', fontSize: '1rem', cursor: csvImportModal.importing ? 'not-allowed' : 'pointer', padding: '4px' }}
              >
                ✕
              </button>
            </div>

            {csvImportModal.error && (
              <div style={{ color: '#ef4444', fontSize: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', padding: '8px', borderRadius: '4px', marginBottom: '12px', whiteSpace: 'pre-wrap', flexShrink: 0 }}>
                {csvImportModal.error}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px', flexShrink: 0 }}>
              <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: '600' }}>Select CSV File</label>
              <input
                type="file"
                accept=".csv"
                onChange={handleCsvFileChange}
                disabled={csvImportModal.importing}
                style={{
                  fontSize: '0.75rem',
                  color: '#e2e8f0',
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px dashed var(--panel-border)',
                  padding: '8px',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              />
            </div>

            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '8px', flexShrink: 0 }}>
              Or paste CSV records below. First line must contain column headers. Values containing commas or newlines should be wrapped in double quotes. Numbers and booleans will be automatically parsed.
            </div>

            <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
              <textarea
                placeholder="id,name,age,active&#10;1,John Doe,29,true&#10;2,Jane Smith,34,false"
                value={csvImportModal.text}
                onChange={e => setCsvImportModal(prev => ({ ...prev, text: e.target.value }))}
                style={{
                  width: '100%',
                  height: '250px',
                  background: '#121216',
                  border: '1px solid var(--panel-border)',
                  borderRadius: '4px',
                  color: '#e2e8f0',
                  fontSize: '0.8rem',
                  fontFamily: "monospace",
                  padding: '12px',
                  boxSizing: 'border-box',
                  outline: 'none',
                  resize: 'vertical'
                }}
                disabled={csvImportModal.importing}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', flexShrink: 0 }}>
              <button
                onClick={() => setCsvImportModal(null)}
                disabled={csvImportModal.importing}
                style={{ background: 'none', border: '1px solid var(--panel-border)', color: 'var(--text-muted)', padding: '6px 12px', borderRadius: '4px', fontSize: '0.75rem', cursor: csvImportModal.importing ? 'not-allowed' : 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleCsvImportSubmit}
                disabled={csvImportModal.importing || !csvImportModal.text.trim()}
                style={{
                  background: 'var(--accent)',
                  border: 'none',
                  color: '#fff',
                  padding: '6px 16px',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  cursor: (csvImportModal.importing || !csvImportModal.text.trim()) ? 'not-allowed' : 'pointer',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                {csvImportModal.importing && <span className="spinner-small"></span>}
                <span>Import Data</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Create Database Modal */}
      {createDbModalOpen && (
        <div 
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}
          onClick={() => { if (!isCreatingDb) setCreateDbModalOpen(false); }}
        >
          <div className="glass-panel" style={{
            background: '#1a1d27',
            border: '1px solid var(--panel-border)',
            borderRadius: '8px',
            width: '100%',
            maxWidth: '400px',
            display: 'flex',
            flexDirection: 'column',
            padding: '20px',
            boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
            boxSizing: 'border-box'
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '8px' }}>
              <div style={{ fontSize: '0.9rem', fontWeight: '700', color: '#fff' }}>Create New Database</div>
              <button 
                onClick={() => setCreateDbModalOpen(false)}
                disabled={isCreatingDb}
                style={{ background: 'none', border: 'none', color: isCreatingDb ? '#475569' : 'var(--text-muted)', fontSize: '1rem', cursor: isCreatingDb ? 'not-allowed' : 'pointer', padding: '4px' }}
              >
                ✕
              </button>
            </div>

            {createDbError && (
              <div style={{ color: '#ef4444', fontSize: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', padding: '8px', borderRadius: '4px', marginBottom: '12px' }}>
                {createDbError}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
              <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: '600' }}>Database Name</label>
              <input
                type="text"
                placeholder="e.g. orders_db"
                value={newDbName}
                onChange={e => setNewDbName(e.target.value)}
                disabled={isCreatingDb}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !isCreatingDb && newDbName.trim()) {
                    handleCreateDatabase();
                  }
                }}
                style={{
                  width: '100%',
                  background: '#121216',
                  border: '1px solid var(--panel-border)',
                  borderRadius: '4px',
                  color: '#e2e8f0',
                  fontSize: '0.8rem',
                  padding: '8px 10px',
                  boxSizing: 'border-box',
                  outline: 'none'
                }}
                autoFocus
              />
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                Note: In MongoDB, a database is initialized by creating its first collection. An initial 'init' collection will be automatically created.
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={() => setCreateDbModalOpen(false)}
                disabled={isCreatingDb}
                style={{ background: 'none', border: '1px solid var(--panel-border)', color: 'var(--text-muted)', padding: '6px 12px', borderRadius: '4px', fontSize: '0.75rem', cursor: isCreatingDb ? 'not-allowed' : 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateDatabase}
                disabled={isCreatingDb || !newDbName.trim()}
                style={{
                  background: 'var(--accent-primary)',
                  border: 'none',
                  color: '#fff',
                  padding: '6px 16px',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  cursor: (isCreatingDb || !newDbName.trim()) ? 'not-allowed' : 'pointer',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                {isCreatingDb && <span className="spinner-small"></span>}
                <span>Create Database</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Collection Modal */}
      {createColModalOpen && (
        <div 
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}
          onClick={() => { if (!isCreatingCol) setCreateColModalOpen(false); }}
        >
          <div className="glass-panel" style={{
            background: '#1a1d27',
            border: '1px solid var(--panel-border)',
            borderRadius: '8px',
            width: '100%',
            maxWidth: '400px',
            display: 'flex',
            flexDirection: 'column',
            padding: '20px',
            boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
            boxSizing: 'border-box'
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '8px' }}>
              <div>
                <div style={{ fontSize: '0.9rem', fontWeight: '700', color: '#fff' }}>Create New Collection</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>Database: <span style={{ color: 'var(--accent)' }}>{activeDb}</span></div>
              </div>
              <button 
                onClick={() => setCreateColModalOpen(false)}
                disabled={isCreatingCol}
                style={{ background: 'none', border: 'none', color: isCreatingCol ? '#475569' : 'var(--text-muted)', fontSize: '1rem', cursor: isCreatingCol ? 'not-allowed' : 'pointer', padding: '4px' }}
              >
                ✕
              </button>
            </div>

            {createColError && (
              <div style={{ color: '#ef4444', fontSize: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', padding: '8px', borderRadius: '4px', marginBottom: '12px' }}>
                {createColError}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
              <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: '600' }}>Collection Name</label>
              <input
                type="text"
                placeholder="e.g. users"
                value={newColName}
                onChange={e => setNewColName(e.target.value)}
                disabled={isCreatingCol}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !isCreatingCol && newColName.trim()) {
                    handleCreateCollection();
                  }
                }}
                style={{
                  width: '100%',
                  background: '#121216',
                  border: '1px solid var(--panel-border)',
                  borderRadius: '4px',
                  color: '#e2e8f0',
                  fontSize: '0.8rem',
                  padding: '8px 10px',
                  boxSizing: 'border-box',
                  outline: 'none'
                }}
                autoFocus
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={() => setCreateColModalOpen(false)}
                disabled={isCreatingCol}
                style={{ background: 'none', border: '1px solid var(--panel-border)', color: 'var(--text-muted)', padding: '6px 12px', borderRadius: '4px', fontSize: '0.75rem', cursor: isCreatingCol ? 'not-allowed' : 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateCollection}
                disabled={isCreatingCol || !newColName.trim()}
                style={{
                  background: 'var(--accent-primary)',
                  border: 'none',
                  color: '#fff',
                  padding: '6px 16px',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  cursor: (isCreatingCol || !newColName.trim()) ? 'not-allowed' : 'pointer',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                {isCreatingCol && <span className="spinner-small"></span>}
                <span>Create Collection</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
