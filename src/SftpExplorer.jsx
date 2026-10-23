import React, { useState, useEffect, useRef } from 'react';

export default function SftpExplorer({ tabId }) {
  const [currentPath, setCurrentPath] = useState('.');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [transfers, setTransfers] = useState([]);

  const transferIdRef = useRef(0);
  const xhrsRef = useRef(new Map());

  useEffect(() => {
    return () => {
      xhrsRef.current.forEach((xhr) => xhr.abort());
      xhrsRef.current.clear();
    };
  }, []);

  const addTransfer = (transfer) => {
    setTransfers((prev) => [...prev, transfer]);
  };

  const updateTransfer = (id, patch) => {
    setTransfers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const removeTransfer = (id) => {
    setTransfers((prev) => prev.filter((t) => t.id !== id));
  };

  const cancelTransfer = (id) => {
    const xhr = xhrsRef.current.get(id);
    if (xhr) xhr.abort();
    else removeTransfer(id);
  };
  
  const fileInputRef = useRef(null);

  const fetchDirectory = async (path) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sftp/list?tabId=${encodeURIComponent(tabId)}&path=${encodeURIComponent(path)}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to list directory');
      }
      const data = await res.json();
      setCurrentPath(data.currentPath);
      // Sort directories first, then files alphabetically
      const sortedFiles = data.files.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
      });
      setFiles(sortedFiles);
    } catch (err) {
      console.error('SFTP fetch error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDirectory('.');
  }, [tabId]);

  const handleGoUp = () => {
    if (currentPath === '/' || currentPath === '.') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const parentPath = '/' + parts.join('/');
    fetchDirectory(parentPath === '//' ? '/' : parentPath);
  };

  const handleFolderDoubleClick = (folderName) => {
    let targetPath;
    if (currentPath === '/') {
      targetPath = `/${folderName}`;
    } else if (currentPath === '.') {
      targetPath = folderName;
    } else {
      targetPath = `${currentPath}/${folderName}`;
    }
    fetchDirectory(targetPath);
  };

  const handleDownload = (file) => {
    const isDir = file.isDir;
    const filename = isDir ? `${file.name}.tar.gz` : file.name;
    const remoteFilePath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
    const url = `/api/sftp/${isDir ? 'download-folder' : 'download'}?tabId=${encodeURIComponent(tabId)}&path=${encodeURIComponent(remoteFilePath)}`;
    const id = ++transferIdRef.current;

    addTransfer({
      id,
      type: 'download',
      filename,
      progress: isDir ? null : 0,
      loaded: 0,
      total: isDir ? null : file.size,
      status: 'active'
    });

    const xhr = new XMLHttpRequest();
    xhrsRef.current.set(id, xhr);

    xhr.open('GET', url, true);
    xhr.responseType = 'blob';

    xhr.addEventListener('progress', (e) => {
      if (isDir) {
        updateTransfer(id, { loaded: e.loaded });
      } else if (e.lengthComputable) {
        updateTransfer(id, { progress: Math.round((e.loaded / e.total) * 100), loaded: e.loaded, total: e.total });
      } else {
        updateTransfer(id, { loaded: e.loaded, progress: Math.min(99, Math.round((e.loaded / (file.size || 1)) * 100)) });
      }
    });

    xhr.onload = () => {
      xhrsRef.current.delete(id);
      if (xhr.status >= 200 && xhr.status < 300) {
        const downloadUrl = window.URL.createObjectURL(xhr.response);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(downloadUrl);
        updateTransfer(id, { status: 'done', progress: 100 });
        setTimeout(() => removeTransfer(id), 1500);
      } else {
        const reader = new FileReader();
        reader.onload = () => {
          let message = 'Download failed';
          try {
            message = JSON.parse(reader.result).error || message;
          } catch (_) {}
          updateTransfer(id, { status: 'error', error: message });
        };
        reader.readAsText(xhr.response);
      }
    };

    xhr.onerror = () => {
      xhrsRef.current.delete(id);
      updateTransfer(id, { status: 'error', error: 'Download failed due to network error.' });
    };

    xhr.onabort = () => {
      xhrsRef.current.delete(id);
      removeTransfer(id);
    };

    xhr.send();
  };

  const handleUploadFile = (file) => {
    if (!file) return;

    const remoteFilePath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
    const url = `/api/sftp/upload?tabId=${encodeURIComponent(tabId)}&path=${encodeURIComponent(remoteFilePath)}`;
    const id = ++transferIdRef.current;

    addTransfer({
      id,
      type: 'upload',
      filename: file.name,
      progress: 0,
      loaded: 0,
      total: file.size,
      status: 'active'
    });

    const xhr = new XMLHttpRequest();
    xhrsRef.current.set(id, xhr);

    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        updateTransfer(id, { progress: Math.round((e.loaded / e.total) * 100), loaded: e.loaded });
      }
    });

    xhr.onload = () => {
      xhrsRef.current.delete(id);
      if (xhr.status >= 200 && xhr.status < 300) {
        updateTransfer(id, { status: 'done', progress: 100 });
        setTimeout(() => removeTransfer(id), 1500);
        fetchDirectory(currentPath);
      } else {
        let errMsg = 'Upload failed';
        try {
          const res = JSON.parse(xhr.responseText);
          errMsg = res.error || errMsg;
        } catch (_) {}
        updateTransfer(id, { status: 'error', error: errMsg });
      }
    };

    xhr.onerror = () => {
      xhrsRef.current.delete(id);
      updateTransfer(id, { status: 'error', error: 'Upload failed due to network error.' });
    };

    xhr.onabort = () => {
      xhrsRef.current.delete(id);
      removeTransfer(id);
    };

    xhr.send(file);
  };

  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleUploadFile(e.target.files[0]);
    }
    // Reset input value to allow uploading the same file again
    e.target.value = '';
  };

  const handleCreateFolder = async () => {
    const folderName = prompt('Enter new folder name:');
    if (!folderName) return;
    const remoteFolderPath = currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`;
    
    try {
      const response = await fetch('/api/sftp/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabId, path: remoteFolderPath })
      });
      
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to create folder');
      }
      
      fetchDirectory(currentPath);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (file) => {
    if (!confirm(`Are you sure you want to delete "${file.name}"?`)) return;
    const remoteFilePath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
    
    try {
      const response = await fetch('/api/sftp/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabId, path: remoteFilePath, isDir: file.isDir })
      });
      
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to delete');
      }
      
      fetchDirectory(currentPath);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleRename = async (file) => {
    const newName = prompt(`Rename "${file.name}" to:`, file.name);
    if (!newName || newName === file.name) return;
    
    const oldPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
    const newPath = currentPath === '/' ? `/${newName}` : `${currentPath}/${newName}`;
    
    try {
      const response = await fetch('/api/sftp/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabId, path: oldPath, newPath })
      });
      
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to rename');
      }
      
      fetchDirectory(currentPath);
    } catch (err) {
      alert(err.message);
    }
  };

  // Drag and drop handlers
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleUploadFile(e.dataTransfer.files[0]);
    }
  };

  const formatSize = (bytes) => {
    if (bytes === undefined || bytes === null) return '-';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (mtime) => {
    if (!mtime) return '-';
    return new Date(mtime).toLocaleString();
  };

  const filteredFiles = files.filter(file => 
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div 
      className="sftp-explorer"
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
    >
      {/* Transfer indicators */}
      {transfers.length > 0 && (
        <div className="sftp-transfers">
          {transfers.map((transfer) => (
            <div key={transfer.id} className="sftp-transfer glass-panel">
              <div className="sftp-transfer-header">
                <span className="sftp-transfer-name" title={transfer.filename}>
                  {transfer.type === 'upload' ? '↑ Uploading' : '↓ Downloading'} {transfer.filename}
                </span>
                <button
                  className="sftp-transfer-close"
                  onClick={() => cancelTransfer(transfer.id)}
                  title={transfer.status === 'active' ? 'Cancel' : 'Dismiss'}
                >
                  ×
                </button>
              </div>
              {transfer.status === 'error' ? (
                <div className="sftp-transfer-error">{transfer.error}</div>
              ) : (
                <>
                  <div className="sftp-progress-bar-container">
                    {transfer.progress === null ? (
                      <div className="sftp-progress-bar sftp-progress-indeterminate" />
                    ) : (
                      <div className="sftp-progress-bar" style={{ width: `${transfer.progress}%` }} />
                    )}
                  </div>
                  <div className="sftp-progress-details">
                    <span>
                      {transfer.status === 'done' ? 'Done' : transfer.progress === null ? 'Archiving…' : `${transfer.progress}%`}
                    </span>
                    <span>
                      {formatSize(transfer.loaded)}
                      {transfer.total ? ` / ${formatSize(transfer.total)}` : ''}
                    </span>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Drag overlay */}
      {dragActive && (
        <div className="sftp-overlay sftp-drag-overlay glass-panel">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16v-8m0 8l-4-4m4 4l4-4M3 12a9 9 0 1118 0 9 9 0 01-18 0z" />
          </svg>
          <p>Drop file here to upload</p>
        </div>
      )}

      {/* Toolbar */}
      <div className="sftp-toolbar">
        <button 
          className="sftp-btn" 
          onClick={handleGoUp} 
          disabled={currentPath === '/' || currentPath === '.'}
          title="Go Up"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Up
        </button>

        <button className="sftp-btn" onClick={() => fetchDirectory(currentPath)} title="Refresh">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89M9 11l3-3 3 3m-3-3v12" />
          </svg>
          Refresh
        </button>

        <button className="sftp-btn" onClick={handleCreateFolder} title="New Folder">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          New Folder
        </button>

        <button className="sftp-btn" onClick={() => fileInputRef.current?.click()} title="Upload File">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          Upload
        </button>

        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          onChange={handleFileInputChange} 
        />

        <div className="sftp-path-container">
          <input 
            type="text" 
            className="sftp-path-input input-field" 
            value={currentPath}
            onChange={(e) => setCurrentPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                fetchDirectory(currentPath);
              }
            }}
          />
        </div>

        <div className="sftp-search-container">
          <input 
            type="text" 
            className="sftp-search-input input-field" 
            placeholder="Filter files..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Directory Content */}
      <div className="sftp-content">
        {error && (
          <div className="sftp-error">
            <p>Error: {error}</p>
            <button className="action-btn" onClick={() => fetchDirectory(currentPath)}>Retry</button>
          </div>
        )}

        {loading && (
          <div className="sftp-loading">
            <div className="spinner"></div>
            <p>Loading files...</p>
          </div>
        )}

        {!loading && !error && (
          <div className="sftp-table-wrapper">
            <table className="sftp-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Size</th>
                  <th>Last Modified</th>
                  <th style={{ width: '120px', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredFiles.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="empty-row">No files found</td>
                  </tr>
                ) : (
                  filteredFiles.map((file) => (
                    <tr 
                      key={file.name}
                      onDoubleClick={() => file.isDir && handleFolderDoubleClick(file.name)}
                      className={file.isDir ? 'dir-row' : 'file-row'}
                    >
                      <td className="name-col">
                        <span className="file-icon">
                          {file.isDir ? (
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" className="folder-svg">
                              <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" className="file-svg">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                          )}
                        </span>
                        <span className="file-name-text">{file.name}</span>
                      </td>
                      <td>{file.isDir ? '-' : formatSize(file.size)}</td>
                      <td>{formatDate(file.mtime)}</td>
                      <td className="actions-col">
                        <button 
                          className="sftp-icon-btn" 
                          onClick={() => handleDownload(file)} 
                          title={file.isDir ? 'Download folder (.tar.gz)' : 'Download'}
                        >
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                        </button>
                        <button 
                          className="sftp-icon-btn" 
                          onClick={() => handleRename(file)} 
                          title="Rename"
                        >
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button 
                          className="sftp-icon-btn delete-btn" 
                          onClick={() => handleDelete(file)} 
                          title="Delete"
                        >
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
