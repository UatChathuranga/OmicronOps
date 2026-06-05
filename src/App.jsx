import React, { useState, useEffect, useRef } from 'react';
import TerminalTab from './TerminalTab';
import SplitTab from './SplitTab';
import './App.css';
import pkg from '../package.json';
import logo from '../build/icon.png';

// Robust RFC 4180-compliant CSV parser helper
function parseCSV(text) {
  const lines = [];
  let row = [''];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push('');
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      lines.push(row.map(cell => cell.trim()));
      row = [''];
    } else {
      row[row.length - 1] += char;
    }
  }
  if (row.length > 1 || row[0] !== '') {
    lines.push(row.map(cell => cell.trim()));
  }
  return lines;
}

export default function App() {
  const productName = pkg.build?.productName || "OmicronSSH";
  const { version } = pkg;
  // Connections state
  const [connections, setConnections] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const hasInitializedCollapsedRef = useRef(false);

  // Tabs state
  // Start with a default Dashboard tab
  const [tabs, setTabs] = useState([
    { id: 'dashboard-home', title: 'Dashboard', type: 'dashboard', status: 'dashboard' }
  ]);
  const [activeTabId, setActiveTabId] = useState('dashboard-home');

  // Modal form state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create'); // 'create' or 'edit'
  const [editingId, setEditingId] = useState(null);
  const [groupSelectMode, setGroupSelectMode] = useState('select'); // 'select' or 'new'
  
  // Sidebar state
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null); // { x: number, y: number, tab: object }

  // Bulk Import state
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importFileName, setImportFileName] = useState('');
  const [importRowsCount, setImportRowsCount] = useState(0);
  const [importError, setImportError] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  
  // Group inline renaming state
  const [editingGroupName, setEditingGroupName] = useState(null);
  const [newGroupInputValue, setNewGroupInputValue] = useState('');
  
  const [formData, setFormData] = useState({
    name: '',
    host: '',
    port: '22',
    username: 'root',
    authMethod: 'password',
    password: '',
    privateKey: '',
    group: 'Default'
  });

  // Quick connect form state
  const [quickConnectData, setQuickConnectData] = useState({
    host: '',
    port: '22',
    username: 'root',
    authMethod: 'password',
    password: '',
    privateKey: ''
  });

  // Fetch connections on load
  const fetchConnections = async () => {
    try {
      const res = await fetch('/api/connections');
      if (res.ok) {
        const data = await res.json();
        setConnections(data);

        // On initial app launch, set all connection groups to collapsed
        if (!hasInitializedCollapsedRef.current) {
          hasInitializedCollapsedRef.current = true;
          const initialCollapsed = {};
          data.forEach(conn => {
            const groupName = conn.group || 'Default';
            initialCollapsed[groupName] = true;
          });
          setCollapsedGroups(initialCollapsed);
        }
      }
    } catch (err) {
      console.error('Failed to fetch connections:', err);
    }
  };

  const startRenameGroup = (groupName, e) => {
    if (e) e.stopPropagation();
    if (groupName === 'Default') {
      alert("The 'Default' group cannot be renamed.");
      return;
    }
    setEditingGroupName(groupName);
    setNewGroupInputValue(groupName);
  };

  const saveGroupRename = async (oldName) => {
    const trimmed = newGroupInputValue.trim();
    if (!trimmed) {
      alert("Group name cannot be empty.");
      setEditingGroupName(null);
      return;
    }
    if (trimmed.toLowerCase() === oldName.toLowerCase()) {
      setEditingGroupName(null);
      return;
    }
    
    try {
      const response = await fetch('/api/groups/rename', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldName, newName: trimmed })
      });
      if (!response.ok) {
        throw new Error('Failed to rename group');
      }
      fetchConnections();
    } catch (error) {
      console.error(error);
      alert('Error renaming group: ' + error.message);
    } finally {
      setEditingGroupName(null);
    }
  };

  const handleDeleteGroup = async (groupName, e) => {
    if (e) e.stopPropagation();
    if (groupName === 'Default') {
      alert("The 'Default' group cannot be deleted.");
      return;
    }
    const confirmDelete = confirm(`Are you sure you want to delete the group "${groupName}"? This will delete all connections in this group.`);
    if (!confirmDelete) return;

    try {
      const response = await fetch(`/api/groups?name=${encodeURIComponent(groupName)}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        throw new Error('Failed to delete group');
      }
      fetchConnections();
    } catch (error) {
      console.error(error);
      alert('Error deleting group: ' + error.message);
    }
  };

  useEffect(() => {
    fetchConnections();
  }, []);

  // Prevent page reload via browser shortcuts globally
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isR = e.key.toLowerCase() === 'r';
      const isF5 = e.key === 'F5';
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;

      if ((isCtrlOrMeta && isR) || isF5) {
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Close context menu on window clicks
  useEffect(() => {
    const handleWindowClick = () => {
      setContextMenu(null);
    };
    window.addEventListener('click', handleWindowClick);
    return () => {
      window.removeEventListener('click', handleWindowClick);
    };
  }, []);

  // CRUD handlers
  const handleOpenCreateModal = () => {
    setModalMode('create');
    setGroupSelectMode('select');
    setFormData({
      name: '',
      host: '',
      port: '22',
      username: 'root',
      authMethod: 'password',
      password: '',
      privateKey: '',
      group: 'Default'
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (conn, e) => {
    e.stopPropagation(); // Prevent trigger connection launch
    setModalMode('edit');
    setEditingId(conn.id);
    setGroupSelectMode('select');
    setFormData({
      name: conn.name,
      host: conn.host,
      port: conn.port.toString(),
      username: conn.username,
      authMethod: conn.authMethod,
      password: conn.password || '',
      privateKey: conn.privateKey || '',
      group: conn.group || 'Default'
    });
    setIsModalOpen(true);
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    try {
      const url = modalMode === 'create' ? '/api/connections' : `/api/connections/${editingId}`;
      const method = modalMode === 'create' ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (res.ok) {
        setIsModalOpen(false);
        fetchConnections();
      } else {
        const errData = await res.json();
        alert(`Error: ${errData.error}`);
      }
    } catch (err) {
      alert(`Request failed: ${err.message}`);
    }
  };

  const handleDeleteConnection = async (id, name, e) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete "${name}"?`)) return;

    try {
      const res = await fetch(`/api/connections/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchConnections();
      } else {
        alert('Failed to delete connection.');
      }
    } catch (err) {
      alert(`Request failed: ${err.message}`);
    }
  };

  // Tab operations
  const handleOpenTab = (conn) => {
    // Check if tab already exists for this connection to prevent duplicates
    const existing = tabs.find(t => t.connectionId === conn.id);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }

    const newTabId = `tab-${Date.now()}`;
    const newTab = {
      id: newTabId,
      title: conn.name,
      type: 'terminal',
      connectionId: conn.id,
      status: 'connecting'
    };

    setTabs([...tabs, newTab]);
    setActiveTabId(newTabId);
  };

  const handleOpenQuickConnectTab = (e) => {
    e.preventDefault();
    if (!quickConnectData.host || !quickConnectData.username) {
      alert('Host and Username are required.');
      return;
    }

    const newTabId = `tab-${Date.now()}`;
    const title = `${quickConnectData.username}@${quickConnectData.host}:${quickConnectData.port}`;
    const newTab = {
      id: newTabId,
      title,
      type: 'terminal',
      quickConnectDetails: { ...quickConnectData },
      status: 'connecting'
    };

    setTabs([...tabs, newTab]);
    setActiveTabId(newTabId);

    // Reset quick connect form host
    setQuickConnectData({
      ...quickConnectData,
      host: '',
      password: '',
      privateKey: ''
    });
  };

  const handleOpenNewDashboardTab = () => {
    const newTabId = `dashboard-${Date.now()}`;
    const newTab = {
      id: newTabId,
      title: 'Dashboard',
      type: 'dashboard',
      status: 'dashboard'
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(newTabId);
  };

  const handleDuplicateTab = (tabToDuplicate) => {
    if (tabToDuplicate.type !== 'terminal') return;

    const newTabId = `tab-${Date.now()}`;
    const newTab = {
      ...tabToDuplicate,
      id: newTabId,
      title: tabToDuplicate.title,
      status: 'connecting'
    };

    setTabs([...tabs, newTab]);
    setActiveTabId(newTabId);
  };

  const handleCreateSplitTab = () => {
    const newTabId = `split-${Date.now()}`;
    const newTab = {
      id: newTabId,
      title: 'Split Console',
      type: 'split',
      status: 'connected',
      subTabs: []
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(newTabId);
  };

  const handleOpenGroupInSplit = (conns, groupName) => {
    if (conns.length === 0) return;
    
    // Limit to 24 max
    const targets = conns.slice(0, 24);
    if (conns.length > 24) {
      alert('A split tab can hold a maximum of 24 sessions. Only the first 24 servers in the group will be opened.');
    }
    
    const subTabs = targets.map((conn, idx) => ({
      id: `tab-${Date.now()}-${idx}-${conn.id}`,
      title: conn.name,
      type: 'terminal',
      connectionId: conn.id,
      status: 'connecting'
    }));
    
    const newTabId = `split-${Date.now()}`;
    const newTab = {
      id: newTabId,
      title: `${groupName} Grid`,
      type: 'split',
      status: 'connected',
      subTabs
    };
    
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTabId);
  };

  const handleMoveTabToSplit = (termTabId, splitTabId) => {
    const termTab = tabs.find(t => t.id === termTabId);
    if (!termTab) return;

    if (splitTabId === 'new') {
      const newSplitTabId = `split-${Date.now()}`;
      const newSplitTab = {
        id: newSplitTabId,
        title: 'Split Console',
        type: 'split',
        status: 'connected',
        subTabs: [termTab]
      };
      setTabs(prev => prev.filter(t => t.id !== termTabId).concat(newSplitTab));
      setActiveTabId(newSplitTabId);
    } else {
      setTabs(prev => prev.map(t => {
        if (t.id === splitTabId) {
          if (t.subTabs.length >= 24) {
            alert('Maximum 24 sessions allowed per split tab.');
            return t;
          }
          return { ...t, subTabs: [...t.subTabs, termTab] };
        }
        return t;
      }).filter(t => t.id !== termTabId));
      setActiveTabId(splitTabId);
    }
  };

  const handleDetachTabFromSplit = (subTabId, splitTabId) => {
    let detachedTab = null;
    setTabs(prev => {
      const updated = prev.map(t => {
        if (t.id === splitTabId) {
          detachedTab = t.subTabs.find(st => st.id === subTabId);
          return {
            ...t,
            subTabs: t.subTabs.filter(st => st.id !== subTabId)
          };
        }
        return t;
      });
      if (detachedTab) {
        return [...updated, detachedTab];
      }
      return updated;
    });
  };

  const handleCloseSubTab = (subTabId, splitTabId) => {
    setTabs(prev => prev.map(t => {
      if (t.id === splitTabId) {
        return {
          ...t,
          subTabs: t.subTabs.filter(st => st.id !== subTabId)
        };
      }
      return t;
    }));
  };

  const handleAddSubTabToSplit = (termTabId, splitTabId) => {
    const termTab = tabs.find(t => t.id === termTabId);
    if (!termTab) return;
    setTabs(prev => prev.map(t => {
      if (t.id === splitTabId) {
        if (t.subTabs.length >= 24) {
          alert('Maximum 24 sessions allowed per split tab.');
          return t;
        }
        return { ...t, subTabs: [...t.subTabs, termTab] };
      }
      return t;
    }).filter(t => t.id !== termTabId));
  };

  const handleAddConnectionToSplit = (conn, splitTabId) => {
    const newSubTabId = `tab-${Date.now()}`;
    const newSubTab = {
      id: newSubTabId,
      title: conn.name,
      type: 'terminal',
      connectionId: conn.id,
      status: 'connecting'
    };
    setTabs(prev => prev.map(t => {
      if (t.id === splitTabId) {
        if (t.subTabs.length >= 24) {
          alert('Maximum 24 sessions allowed per split tab.');
          return t;
        }
        return { ...t, subTabs: [...t.subTabs, newSubTab] };
      }
      return t;
    }));
  };

  const handleTabContextMenu = (e, tab) => {
    e.preventDefault();
    if (tab.type !== 'terminal' && tab.type !== 'split') return;
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      tab
    });
  };

  const handleCloseTab = (tabId, e) => {
    if (e) e.stopPropagation();
    const updatedTabs = tabs.filter(t => t.id !== tabId);
    
    if (updatedTabs.length === 0) {
      // Always keep at least one dashboard tab
      setTabs([{ id: 'dashboard-home', title: 'Dashboard', type: 'dashboard', status: 'dashboard' }]);
      setActiveTabId('dashboard-home');
    } else {
      setTabs(updatedTabs);
      if (activeTabId === tabId) {
        // Switch to the last tab in list
        setActiveTabId(updatedTabs[updatedTabs.length - 1].id);
      }
    }
  };

  const handleOpenImportModal = () => {
    setIsImportModalOpen(true);
    setImportFile(null);
    setImportFileName('');
    setImportRowsCount(0);
    setImportError(null);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setImportFileName(file.name);
    setImportError(null);
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      try {
        const rows = parseCSV(text);
        if (rows.length === 0) {
          throw new Error('The CSV file is empty.');
        }
        
        // Find isHeader
        const firstLine = rows[0] || [];
        const isHeader = firstLine.some(h => {
          const norm = h.toLowerCase().replace(/_/g, ' ').trim();
          return norm === 'host title' || norm === 'ip' || norm === 'username';
        });
        
        const dataRowsCount = isHeader ? rows.length - 1 : rows.length;
        if (dataRowsCount <= 0) {
          throw new Error('No data rows found in the CSV file.');
        }
        
        setImportRowsCount(dataRowsCount);
        setImportFile(text);
      } catch (err) {
        setImportError(err.message);
        setImportFile(null);
        setImportRowsCount(0);
      }
    };
    reader.onerror = () => {
      setImportError('Failed to read the file.');
      setImportFile(null);
      setImportRowsCount(0);
    };
    reader.readAsText(file);

    // Reset input value to allow uploading the same file again
    e.target.value = '';
  };

  const handleImportSubmit = async (e) => {
    e.preventDefault();
    if (!importFile || isImporting) return;
    
    setIsImporting(true);
    setImportError(null);
    
    try {
      const rows = parseCSV(importFile);
      
      let hostTitleIdx = -1;
      let ipIdx = -1;
      let portIdx = -1;
      let usernameIdx = -1;
      let passwordIdx = -1;
      let sshKeyIdx = -1;
      let groupIdx = -1;

      const firstLine = rows[0] || [];
      const isHeader = firstLine.some(h => {
        const norm = h.toLowerCase().replace(/_/g, ' ').trim();
        return norm === 'host title' || norm === 'ip' || norm === 'username';
      });

      let dataRows = rows;
      if (isHeader) {
        const headers = firstLine.map(h => h.toLowerCase().replace(/_/g, ' ').trim());
        hostTitleIdx = headers.indexOf('host title');
        ipIdx = headers.indexOf('ip');
        portIdx = headers.indexOf('port');
        usernameIdx = headers.indexOf('username');
        passwordIdx = headers.indexOf('password');
        sshKeyIdx = headers.indexOf('ssh key');
        groupIdx = headers.indexOf('group');
        dataRows = rows.slice(1);
      } else {
        hostTitleIdx = 0;
        ipIdx = 1;
        portIdx = 2;
        usernameIdx = 3;
        passwordIdx = 4;
        sshKeyIdx = 5;
        groupIdx = 6;
      }

      const parsedConnections = [];
      for (const row of dataRows) {
        if (row.length === 0 || (row.length === 1 && row[0] === '')) continue;
        
        // Host (IP) is strictly required
        const host = row[ipIdx] || '';
        if (!host) continue;

        const name = row[hostTitleIdx] || host;
        const port = row[portIdx] || '22';
        const username = row[usernameIdx] || 'root';
        const password = row[passwordIdx] || '';
        const ssh_key = row[sshKeyIdx] || '';
        const authMethod = ssh_key ? 'key' : 'password';
        const group = (groupIdx !== -1 && groupIdx < row.length ? row[groupIdx] : '') || '';

        parsedConnections.push({
          name,
          host,
          port,
          username,
          authMethod,
          password,
          privateKey: ssh_key,
          group: group.trim()
        });
      }

      if (parsedConnections.length === 0) {
        throw new Error('No valid connections found. Check that the "ip" or host field is filled.');
      }

      const response = await fetch('/api/connections/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connections: parsedConnections
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to save connections.');
      }

      // Success! Fetch connections and close modal
      await fetchConnections();
      setIsImportModalOpen(false);
      
      // Reset state
      setImportFile(null);
      setImportFileName('');
      setImportRowsCount(0);
    } catch (err) {
      setImportError(err.message);
    } finally {
      setIsImporting(false);
    }
  };

  const handleTabStatusChange = (tabId, newStatus) => {
    setTabs(prevTabs =>
      prevTabs.map(t => (t.id === tabId ? { ...t, status: newStatus } : t))
    );
  };

  // Group Collapsing
  const toggleGroupCollapse = (groupName) => {
    setCollapsedGroups(prev => ({
      ...prev,
      [groupName]: !prev[groupName]
    }));
  };

  // Organize connections by group and search query
  const filteredConnections = connections.filter(conn => {
    const term = searchQuery.toLowerCase();
    return (
      conn.name.toLowerCase().includes(term) ||
      conn.host.toLowerCase().includes(term) ||
      conn.username.toLowerCase().includes(term) ||
      (conn.group && conn.group.toLowerCase().includes(term))
    );
  });

  const groupedConnections = filteredConnections.reduce((groups, conn) => {
    const groupName = conn.group || 'Default';
    if (!groups[groupName]) {
      groups[groupName] = [];
    }
    groups[groupName].push(conn);
    return groups;
  }, {});

  const existingGroups = Array.from(
    new Set(connections.map(c => c.group || 'Default'))
  ).filter(g => g !== 'Default');

  return (
    <div className="app-container">
      {/* SIDEBAR */}
      <div className={`sidebar glass-panel ${isSidebarVisible ? '' : 'hidden'}`}>
        <div className="sidebar-header">
          <div className="logo-section">
            <img src={logo} alt="Logo" className="logo-img" />
            <span>{productName}</span>
          </div>
          <div className="header-actions">
            <button className="bulk-import-btn" onClick={handleOpenImportModal} title="Bulk Import CSV">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </button>
            <button className="add-conn-btn" onClick={handleOpenCreateModal} title="Add Connection">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </div>

        <div className="sidebar-search-container">
          <div className="search-input-wrapper">
            <svg className="search-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              className="search-input"
              placeholder="Search connections..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="sidebar-content">
          {Object.keys(groupedConnections).length === 0 ? (
            <div className="empty-sidebar">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <p>No connections found.<br />Create a new connection to get started.</p>
            </div>
          ) : (
            Object.entries(groupedConnections).map(([groupName, conns]) => {
              const isCollapsed = !!collapsedGroups[groupName];
              return (
                <div className="group-container" key={groupName}>
                  <div className="group-header" onClick={() => toggleGroupCollapse(groupName)}>
                    <div className="group-title-wrapper">
                      <svg className={`group-arrow ${isCollapsed ? 'collapsed' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                      </svg>
                      {editingGroupName === groupName ? (
                        <input
                          type="text"
                          className="group-rename-input"
                          value={newGroupInputValue}
                          onChange={(e) => setNewGroupInputValue(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={() => saveGroupRename(groupName)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              saveGroupRename(groupName);
                            } else if (e.key === 'Escape') {
                              setEditingGroupName(null);
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <span>{groupName}</span>
                      )}
                    </div>
                    <div className="group-actions">
                      <span className="group-count">{conns.length}</span>
                      <button
                        type="button"
                        className="group-action-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenGroupInSplit(conns, groupName);
                        }}
                        title={`Open all ${conns.length} servers in a split console tab`}
                      >
                        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="12" height="12">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                        </svg>
                      </button>
                      {groupName !== 'Default' && (
                        <>
                          <button
                            type="button"
                            className="group-action-btn"
                            onClick={(e) => startRenameGroup(groupName, e)}
                            title={`Rename group "${groupName}"`}
                          >
                            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="11" height="11">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="group-action-btn delete-btn"
                            onClick={(e) => handleDeleteGroup(groupName, e)}
                            title={`Delete group "${groupName}"`}
                          >
                            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="11" height="11">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  
                  <div className={`group-list ${isCollapsed ? 'collapsed' : ''}`}>
                    {conns.map(conn => {
                      const isActive = tabs.some(t => t.connectionId === conn.id && t.id === activeTabId);
                      return (
                        <div
                          className={`connection-item ${isActive ? 'active' : ''}`}
                          key={conn.id}
                          onClick={() => handleOpenTab(conn)}
                        >
                          <div className="conn-info">
                            <div className="conn-icon-wrapper">
                              <svg className="conn-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                              </svg>
                            </div>
                            <div className="conn-details">
                              <span className="conn-name">{conn.name}</span>
                              <span className="conn-host">{conn.username}@{conn.host}:{conn.port}</span>
                            </div>
                          </div>
                          <div className="conn-actions">
                            <button
                              className="conn-action-btn"
                              onClick={(e) => handleOpenEditModal(conn, e)}
                              title="Edit Connection"
                            >
                              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            </button>
                            <button
                              className="conn-action-btn delete-btn"
                              onClick={(e) => handleDeleteConnection(conn.id, conn.name, e)}
                              title="Delete Connection"
                            >
                              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="sidebar-footer">
          <button className="sidebar-about-btn" onClick={() => setIsAboutModalOpen(true)}>
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="14" height="14">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>About {productName}</span>
          </button>
        </div>
      </div>

      {/* MAIN WORKSPACE */}
      <div className="main-workspace">
        {/* TAB BAR */}
        <div className="tab-bar-container">
          <button 
            className="sidebar-toggle-btn" 
            onClick={() => setIsSidebarVisible(!isSidebarVisible)}
            title={isSidebarVisible ? "Hide Sidebar" : "Show Sidebar"}
          >
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
              {isSidebarVisible ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7M20 19l-7-7 7-7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
          <div className="tabs-list">
            {tabs.map(tab => (
              <div
                key={tab.id}
                className={`tab-item ${activeTabId === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTabId(tab.id)}
                onContextMenu={(e) => handleTabContextMenu(e, tab)}
              >
                <div className={`tab-status-glow ${tab.status}`} />
                <span className="tab-title">
                  {tab.type === 'split' ? `${tab.title} (${tab.subTabs.length})` : tab.title}
                </span>
                <button
                  className="tab-close-btn"
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  title="Close Tab"
                >
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
            <button className="new-tab-btn" onClick={handleOpenNewDashboardTab} title="New Dashboard Tab">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </button>
            <button className="new-tab-btn new-split-tab-btn" onClick={handleCreateSplitTab} title="New Split Console Grid Tab">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="14" height="14">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            </button>
          </div>
        </div>

        {/* TAB CONTENTS */}
        <div className="tab-content-container">
          {tabs.map(tab => (
            <div
              key={tab.id}
              className={`tab-panel ${activeTabId === tab.id ? 'active' : ''}`}
            >
              {tab.type === 'dashboard' ? (
                <div className="dashboard-view">
                  <div className="dashboard-hero">
                    <h1>SSH Connection Hub</h1>
                    <p>Open multiple terminal sessions, manage saved connections, and access your servers instantly using password or keyfile authentication.</p>
                  </div>

                  <div className="dashboard-grid">
                    {/* Quick Connect Panel */}
                    <div className="dashboard-card glass-panel">
                      <div className="dashboard-card-title">
                        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span>Quick Connection</span>
                      </div>
                      
                      <form className="quick-connect-form" onSubmit={handleOpenQuickConnectTab}>
                        <div className="form-row">
                          <div className="form-group">
                            <label className="form-label">Host / IP</label>
                            <input
                              type="text"
                              className="form-input"
                              placeholder="e.g. 192.168.1.100"
                              required
                              value={quickConnectData.host}
                              onChange={(e) => setQuickConnectData({ ...quickConnectData, host: e.target.value })}
                            />
                          </div>
                          <div className="form-group small">
                            <label className="form-label">Port</label>
                            <input
                              type="number"
                              className="form-input"
                              required
                              value={quickConnectData.port}
                              onChange={(e) => setQuickConnectData({ ...quickConnectData, port: e.target.value })}
                            />
                          </div>
                        </div>

                        <div className="form-group">
                          <label className="form-label">Username</label>
                          <input
                            type="text"
                            className="form-input"
                            required
                            value={quickConnectData.username}
                            onChange={(e) => setQuickConnectData({ ...quickConnectData, username: e.target.value })}
                          />
                        </div>

                        <div className="form-group">
                          <label className="form-label">Authentication Method</label>
                          <select
                            className="form-select"
                            value={quickConnectData.authMethod}
                            onChange={(e) => setQuickConnectData({ ...quickConnectData, authMethod: e.target.value })}
                          >
                            <option value="password">Password</option>
                            <option value="key">Private Key</option>
                          </select>
                        </div>

                        {quickConnectData.authMethod === 'password' ? (
                          <div className="form-group">
                            <label className="form-label">Password</label>
                            <input
                              type="password"
                              className="form-input"
                              placeholder="Password"
                              value={quickConnectData.password}
                              onChange={(e) => setQuickConnectData({ ...quickConnectData, password: e.target.value })}
                            />
                          </div>
                        ) : (
                          <div className="form-group">
                            <label className="form-label">Private Key Content</label>
                            <textarea
                              className="form-textarea"
                              rows={4}
                              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                              value={quickConnectData.privateKey}
                              onChange={(e) => setQuickConnectData({ ...quickConnectData, privateKey: e.target.value })}
                            />
                          </div>
                        )}

                        <button type="submit" className="connect-submit-btn">
                          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                          </svg>
                          Connect Now
                        </button>
                      </form>
                    </div>

                    {/* Saved Connections / Recent Panel */}
                    <div className="dashboard-card glass-panel">
                      <div className="dashboard-card-title">
                        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                        </svg>
                        <span>Saved Connections</span>
                      </div>

                      <div className="recent-connections-list">
                        {connections.length === 0 ? (
                          <div className="no-recent-conns">
                            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <p>No saved connections yet.<br />Add servers to access them quickly.</p>
                          </div>
                        ) : (
                          connections.slice(0, 5).map(conn => (
                            <div
                              key={conn.id}
                              className="recent-conn-item"
                              onClick={() => handleOpenTab(conn)}
                            >
                              <div className="recent-conn-left">
                                <div className="recent-conn-badge">
                                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                  </svg>
                                </div>
                                <div className="recent-conn-meta">
                                  <span className="recent-conn-name">{conn.name}</span>
                                  <span className="recent-conn-host">{conn.username}@{conn.host}:{conn.port}</span>
                                </div>
                              </div>
                              <div className="recent-conn-arrow">
                                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                                </svg>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : tab.type === 'split' ? (
                <SplitTab
                  tab={tab}
                  connections={connections}
                  otherTerminalTabs={tabs.filter(t => t.type === 'terminal')}
                  onDetachTab={(subTabId) => handleDetachTabFromSplit(subTabId, tab.id)}
                  onCloseSubTab={(subTabId) => handleCloseSubTab(subTabId, tab.id)}
                  onAddSubTab={(subTabId) => handleAddSubTabToSplit(subTabId, tab.id)}
                  onAddConnectionToSplit={(conn) => handleAddConnectionToSplit(conn, tab.id)}
                />
              ) : (
                <TerminalTab
                  tab={tab}
                  onStatusChange={handleTabStatusChange}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* CREATE/EDIT MODAL OVERLAY */}
      <div className={`modal-overlay ${isModalOpen ? 'open' : ''}`}>
        <div className="modal-container glass-panel">
          <div className="modal-header">
            <div className="modal-title">
              {modalMode === 'create' ? 'Add New SSH Connection' : 'Edit SSH Connection'}
            </div>
            <button className="modal-close-btn" onClick={() => setIsModalOpen(false)}>
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <form onSubmit={handleFormSubmit}>
            <div className="modal-body">
              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label className="form-label">Connection Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. My Ubuntu Server"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="form-row" style={{ marginBottom: '14px' }}>
                <div className="form-group">
                  <label className="form-label">Host / IP</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. 192.168.1.100"
                    required
                    value={formData.host}
                    onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                  />
                </div>
                <div className="form-group small">
                  <label className="form-label">Port</label>
                  <input
                    type="number"
                    className="form-input"
                    required
                    value={formData.port}
                    onChange={(e) => setFormData({ ...formData, port: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-row" style={{ marginBottom: '14px' }}>
                <div className="form-group">
                  <label className="form-label">Username</label>
                  <input
                    type="text"
                    className="form-input"
                    required
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Group / Folder</span>
                    <button 
                      type="button" 
                      className="text-link-btn"
                      onClick={() => {
                        const nextMode = groupSelectMode === 'select' ? 'new' : 'select';
                        setGroupSelectMode(nextMode);
                        if (nextMode === 'select') {
                          setFormData({ ...formData, group: 'Default' });
                        } else {
                          setFormData({ ...formData, group: '' });
                        }
                      }}
                    >
                      {groupSelectMode === 'select' ? '+ Create New' : 'Select Existing'}
                    </button>
                  </label>
                  {groupSelectMode === 'select' ? (
                    <select
                      className="form-select"
                      value={formData.group || 'Default'}
                      onChange={(e) => setFormData({ ...formData, group: e.target.value })}
                    >
                      <option value="Default">Default</option>
                      {existingGroups.map(g => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Production"
                      required
                      value={formData.group}
                      onChange={(e) => setFormData({ ...formData, group: e.target.value })}
                      autoFocus
                    />
                  )}
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label className="form-label">Authentication Method</label>
                <select
                  className="form-select"
                  value={formData.authMethod}
                  onChange={(e) => setFormData({ ...formData, authMethod: e.target.value })}
                >
                  <option value="password">Password</option>
                  <option value="key">Private Key</option>
                </select>
              </div>

              {formData.authMethod === 'password' ? (
                <div className="form-group">
                  <label className="form-label">Password</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder={modalMode === 'edit' ? 'Keep existing password (********)' : 'Enter password'}
                    required={modalMode === 'create'}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  />
                </div>
              ) : (
                <div className="form-group">
                  <label className="form-label">Private Key Content</label>
                  <textarea
                    className="form-textarea"
                    rows={4}
                    placeholder={modalMode === 'edit' ? 'Keep existing key (********)' : '-----BEGIN OPENSSH PRIVATE KEY-----'}
                    required={modalMode === 'create'}
                    value={formData.privateKey}
                    onChange={(e) => setFormData({ ...formData, privateKey: e.target.value })}
                  />
                </div>
              )}
            </div>
            
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                {modalMode === 'create' ? 'Save Connection' : 'Update Connection'}
              </button>
            </div>
          </form>
        </div>
      </div>
      {/* ABOUT MODAL OVERLAY */}
      <div className={`modal-overlay ${isAboutModalOpen ? 'open' : ''}`}>
        <div className="modal-container glass-panel about-modal">
          <div className="modal-header">
            <div className="modal-title">About {productName}</div>
            <button className="modal-close-btn" onClick={() => setIsAboutModalOpen(false)}>
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="modal-body about-modal-body">
            <div className="about-logo-wrapper">
              <img src={logo} alt={`${productName} Logo`} className="about-logo-img" />
            </div>
            <h2>{productName}</h2>
            <div className="about-version">Version {version}</div>
            
            <p className="about-description">
              A premium, lightweight, glassmorphic desktop SSH & SFTP client for Linux. 
              {productName} provides a tabbed interactive shell terminal alongside a standard 
              file manager for secure transfers with real-time progress indicators.
            </p>
            
            <div className="about-meta-grid">
              <div className="about-meta-row">
                <span className="about-meta-label">Creator</span>
                <span className="about-meta-value">
                  <a href="https://github.com/UatChathuranga" target="_blank" rel="noopener noreferrer">
                    @UatChathuranga
                  </a>
                </span>
              </div>
              <div className="about-meta-row">
                <span className="about-meta-label">License</span>
                <span className="about-meta-value">MIT Open Source License</span>
              </div>
            </div>
          </div>
          <div className="modal-footer" style={{ borderTop: 'none', paddingTop: 0 }}>
            <button type="button" className="btn-primary" onClick={() => setIsAboutModalOpen(false)} style={{ width: '100%' }}>
              Close
            </button>
          </div>
        </div>
      </div>

       {contextMenu && (
        <div 
          className="tab-context-menu"
          style={{ 
            top: contextMenu.y, 
            left: contextMenu.x,
            position: 'fixed',
            zIndex: 9999
          }}
        >
          {contextMenu.tab.type === 'terminal' && (
            <>
              <div 
                className="context-menu-item"
                onClick={() => {
                  handleDuplicateTab(contextMenu.tab);
                  setContextMenu(null);
                }}
              >
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="14" height="14">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                </svg>
                <span>Duplicate Session</span>
              </div>
              <div 
                className="context-menu-item"
                onClick={() => {
                  handleMoveTabToSplit(contextMenu.tab.id, 'new');
                  setContextMenu(null);
                }}
              >
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="14" height="14">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
                <span>Move to New Split Tab</span>
              </div>
              {tabs.filter(t => t.type === 'split').map((st, idx) => (
                <div 
                  key={st.id}
                  className="context-menu-item"
                  onClick={() => {
                    handleMoveTabToSplit(contextMenu.tab.id, st.id);
                    setContextMenu(null);
                  }}
                >
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="14" height="14">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Move to Split Tab ({st.subTabs.length})</span>
                </div>
              ))}
            </>
          )}
          <div 
            className="context-menu-item close"
            onClick={() => {
              handleCloseTab(contextMenu.tab.id);
              setContextMenu(null);
            }}
          >
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="14" height="14">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            <span>Close Tab</span>
          </div>
        </div>
      )}

      {/* BULK IMPORT MODAL OVERLAY */}
      <div className={`modal-overlay ${isImportModalOpen ? 'open' : ''}`}>
        <div className="modal-container glass-panel bulk-import-modal">
          <div className="modal-header">
            <div className="modal-title">Bulk Import Connections</div>
            <button className="modal-close-btn" onClick={() => setIsImportModalOpen(false)}>
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <form onSubmit={handleImportSubmit}>
            <div className="modal-body">
              {importError && (
                <div className="error-banner" style={{ marginBottom: '14px' }}>
                  {importError}
                </div>
              )}

              <div className="csv-format-help" style={{ marginBottom: '16px' }}>
                <span className="help-label">Required CSV Column Order:</span>
                <code className="format-code">host title, ip, port, username, password, ssh_key, group</code>
                <p className="help-text">
                  Columns can be in any order if headers are present. If headers are missing, please match the column order exactly (with group as an optional 7th column).
                </p>
              </div>

              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label className="form-label">Select CSV File</label>
                <div className="file-upload-wrapper">
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="file-upload-input"
                    id="csv-file-input"
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                  />
                  <label htmlFor="csv-file-input" className="file-upload-label-btn">
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="20" height="20">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span>{importFileName ? 'Change CSV File' : 'Choose CSV File'}</span>
                  </label>
                  {importFileName && (
                    <div className="file-upload-info">
                      <span className="file-name-text">{importFileName}</span>
                      <span className="file-rows-badge">{importRowsCount} connection{importRowsCount !== 1 ? 's' : ''} detected</span>
                    </div>
                  )}
                </div>
              </div>


            </div>

            <div className="modal-footer">
              <button 
                type="button" 
                className="btn-secondary" 
                onClick={() => setIsImportModalOpen(false)}
                disabled={isImporting}
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="btn-primary"
                disabled={!importFile || isImporting}
              >
                {isImporting ? 'Importing...' : `Import ${importRowsCount ? importRowsCount : ''} Session${importRowsCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
