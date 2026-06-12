import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import SftpExplorer from './SftpExplorer';
import ServiceClientTab from './ServiceClientTab';
import 'xterm/css/xterm.css';
import { getSession, registerSession } from './sessionRegistry';

const cleanCommandPrompt = (lineText) => {
  const match = lineText.match(/.*[\$#>%]\s*(.*)$/);
  if (match) {
    return match[1].trim();
  }
  return null;
};

export default function TerminalTab({ tab, connections, onStatusChange, onRegisterSocket, isSplit, macros = [], onRefreshMacros, isActive }) {
  const containerRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const socketRef = useRef(null);

  const existingSession = getSession(tab.id);
  const [status, setStatus] = useState(existingSession ? existingSession.status : 'connecting');
  const [errorMsg, setErrorMsg] = useState(null);
  const [viewMode, setViewMode] = useState('terminal'); // 'terminal' or 'files'
  const [fontSize, setFontSize] = useState(12);

  // Macros states
  const [isMacrosDropdownOpen, setIsMacrosDropdownOpen] = useState(false);
  const [isSaveMacroOpen, setIsSaveMacroOpen] = useState(false);
  const [saveMacroFormData, setSaveMacroFormData] = useState({ name: '', command: '', delay: 1, delays: null });
  const [runningMacroInfo, setRunningMacroInfo] = useState(null); // { name, currentStep, totalSteps, currentCommand }
  const incomingBufferRef = useRef('');
  const activeMacroRef = useRef(null); // { lines, currentIndex, delayMs, timeoutId, waitingForMarker }

  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(false);
  const recordedStepsRef = useRef([]);
  const lastOutputTimeRef = useRef(null);
  const currentStepDelayRef = useRef(0);
  const hasCapturedDelayForCurrentStepRef = useRef(false);
  const isCommandRunningRef = useRef(false);
  
  const connection = (connections || []).find(c => c.id === tab.connectionId);
  const enabledServices = [];
  if (connection?.services) {
    Object.keys(connection.services).forEach(srv => {
      if (connection.services[srv]?.enabled) {
        enabledServices.push(srv);
      }
    });
  }
  const [stats, setStats] = useState(existingSession ? existingSession.stats : null);
  const [speeds, setSpeeds] = useState(existingSession ? existingSession.speeds : { rxSpeed: 0, txSpeed: 0 });
  const lastStatsTimeRef = useRef(null);

  const statusRef = useRef('connecting');
  const viewModeRef = useRef('terminal');

  const [visitedViews, setVisitedViews] = useState(new Set([viewMode]));

  useEffect(() => {
    setVisitedViews(prev => {
      if (prev.has(viewMode)) return prev;
      const next = new Set(prev);
      next.add(viewMode);
      return next;
    });
  }, [viewMode]);

  const onStatusChangeRef = useRef(onStatusChange);
  const setStatusRef = useRef(setStatus);
  const setErrorMsgRef = useRef(setErrorMsg);
  const setStatsRef = useRef(setStats);
  const setSpeedsRef = useRef(setSpeeds);

  const updateStatus = (newVal) => {
    setStatus(newVal);
    const session = getSession(tab.id);
    if (session) session.status = newVal;
  };
  const updateStats = (newVal) => {
    setStats(newVal);
    const session = getSession(tab.id);
    if (session) session.stats = newVal;
  };
  const updateSpeeds = (newVal) => {
    setSpeeds(newVal);
    const session = getSession(tab.id);
    if (session) session.speeds = newVal;
  };

  const updateStatusRef = useRef(updateStatus);
  const updateStatsRef = useRef(updateStats);
  const updateSpeedsRef = useRef(updateSpeeds);

  // Synchronize dynamic refs on every render
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
    setStatusRef.current = setStatus;
    setErrorMsgRef.current = setErrorMsg;
    setStatsRef.current = setStats;
    setSpeedsRef.current = setSpeeds;
    updateStatusRef.current = updateStatus;
    updateStatsRef.current = updateStats;
    updateSpeedsRef.current = updateSpeeds;
  });

  // Handle dynamically resizing terminal font-size (text zoom)
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.fontSize = fontSize;
      try {
        if (fitAddonRef.current) {
          fitAddonRef.current.fit();
          const cols = terminalRef.current.cols;
          const rows = terminalRef.current.rows;
          if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
          }
        }
      } catch (err) {
        // Ignore temporary layout sizing issues
      }
    }
  }, [fontSize]);

  const handleExecuteMacro = (macro) => {
    if (!macro || !macro.command) return;
    if (!window.confirm(`Are you sure you want to execute macro "${macro.name}"?`)) {
      setIsMacrosDropdownOpen(false);
      return;
    }
    setIsMacrosDropdownOpen(false);

    // Cancel any existing active macro
    if (activeMacroRef.current?.timeoutId) {
      clearTimeout(activeMacroRef.current.timeoutId);
    }

    const lines = macro.command.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return;

    const delayMs = Math.max(0, (macro.delay ?? 1)) * 1000;

    activeMacroRef.current = {
      macro,
      lines,
      currentIndex: 0,
      delayMs,
      timeoutId: null,
      waitingForMarker: false
    };

    runMacroStep(0);
  };

  const runMacroStep = (index) => {
    const macroState = activeMacroRef.current;
    if (!macroState) return;

    if (index >= macroState.lines.length) {
      activeMacroRef.current = null;
      setRunningMacroInfo(null);
      return;
    }

    macroState.currentIndex = index;
    const command = macroState.lines[index];

    // Check if it is a sleep command (e.g. sleep 2s, sleep 1.5, sleep 500ms)
    const sleepMatch = command.match(/^sleep\s+(\d+(?:\.\d+)?)(s|ms)?$/i);
    if (sleepMatch) {
      const val = parseFloat(sleepMatch[1]);
      const unit = (sleepMatch[2] || 's').toLowerCase();
      const useSleep = macroState.macro.useSleepTiming !== false;
      const delayMs = useSleep ? (unit === 'ms' ? val : val * 1000) : 0;

      const nextCommand = index + 1 < macroState.lines.length ? macroState.lines[index + 1] : 'None (finished)';

      setRunningMacroInfo({
        name: macroState.macro.name,
        currentStep: index + 1,
        totalSteps: macroState.lines.length,
        currentCommand: command,
        nextCommand: nextCommand
      });

      if (delayMs > 0) {
        macroState.timeoutId = setTimeout(() => {
          runMacroStep(index + 1);
        }, delayMs);
      } else {
        runMacroStep(index + 1);
      }
      return;
    }

    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      activeMacroRef.current = null;
      setRunningMacroInfo(null);
      return;
    }

    const nextCommand = index + 1 < macroState.lines.length ? macroState.lines[index + 1] : 'None (finished)';

    setRunningMacroInfo({
      name: macroState.macro.name,
      currentStep: index + 1,
      totalSteps: macroState.lines.length,
      currentCommand: command,
      nextCommand: nextCommand
    });

    // Append a hidden print statement to detect shell command completion
    const commandToSend = `${command} ; printf "\\033[8m__OM_DONE__\\033[0m\\n"\r`;

    incomingBufferRef.current = '';
    macroState.waitingForMarker = true;

    socketRef.current.send(JSON.stringify({ type: 'data', data: commandToSend }));
  };

  const handleAbortActiveMacro = () => {
    if (activeMacroRef.current?.timeoutId) {
      clearTimeout(activeMacroRef.current.timeoutId);
    }
    activeMacroRef.current = null;
    setRunningMacroInfo(null);
  };

  const handleCompleteCurrentStep = () => {
    const macroState = activeMacroRef.current;
    if (!macroState) return;

    macroState.waitingForMarker = false;
    incomingBufferRef.current = '';

    if (macroState.timeoutId) clearTimeout(macroState.timeoutId);

    const hasInterleavedSleeps = macroState.lines.some(line => /^sleep\s+(\d+(?:\.\d+)?)(s|ms)?$/i.test(line));

    let nextDelayMs = 0;
    if (!hasInterleavedSleeps) {
      if (macroState.macro.useSleepTiming !== false && macroState.macro.delays && Array.isArray(macroState.macro.delays)) {
        const nextIdx = macroState.currentIndex + 1;
        if (nextIdx < macroState.macro.delays.length) {
          nextDelayMs = Math.max(0, macroState.macro.delays[nextIdx]) * 1000;
        }
      }
    }

    macroState.timeoutId = setTimeout(() => {
      runMacroStep(macroState.currentIndex + 1);
    }, nextDelayMs);
  };

  const handleOpenSaveMacro = () => {
    const selection = terminalRef.current ? terminalRef.current.getSelection().trim() : '';
    setSaveMacroFormData({ name: '', command: selection, delay: 1, delays: null });
    setIsSaveMacroOpen(true);
  };

  const handleStartRecording = () => {
    recordedStepsRef.current = [];
    lastOutputTimeRef.current = Date.now();
    currentStepDelayRef.current = 0;
    hasCapturedDelayForCurrentStepRef.current = false;
    isCommandRunningRef.current = false;
    setIsRecording(true);
    isRecordingRef.current = true;
    setIsMacrosDropdownOpen(false);
  };

  const handleStopRecording = () => {
    setIsRecording(false);
    isRecordingRef.current = false;
    if (recordedStepsRef.current.length === 0) {
      alert("No commands were recorded.");
      return;
    }

    const lines = [];
    recordedStepsRef.current.forEach((step) => {
      if (step.delay > 0) {
        lines.push(`sleep ${step.delay}s`);
      }
      lines.push(step.command);
    });

    const fullCommand = lines.join('\n');
    const delays = recordedStepsRef.current.map(s => s.delay);

    setSaveMacroFormData({
      name: `Recorded Macro ${new Date().toLocaleTimeString()}`,
      command: fullCommand,
      delay: delays[0] ?? 1,
      delays: delays
    });
    setIsSaveMacroOpen(true);
  };

  const handleSaveLocalMacro = async (e) => {
    e.preventDefault();
    if (!saveMacroFormData.name || !saveMacroFormData.command) {
      alert("Macro Name and Command are required.");
      return;
    }
    try {
      const res = await fetch('/api/macros', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: saveMacroFormData.name,
          command: saveMacroFormData.command,
          delay: parseFloat(saveMacroFormData.delay) || 1,
          delays: saveMacroFormData.delays || null
        })
      });
      if (res.ok) {
        setIsSaveMacroOpen(false);
        setSaveMacroFormData({ name: '', command: '', delay: 1, delays: null });
        if (onRefreshMacros) {
          onRefreshMacros();
        }
      } else {
        const err = await res.json();
        alert(`Failed to save macro: ${err.error}`);
      }
    } catch (err) {
      alert(`Request failed: ${err.message}`);
    }
  };

  const connectSSH = () => {
    // Check if session already exists in global registry
    const existing = getSession(tab.id);
    if (existing) {
      terminalRef.current = existing.term;
      fitAddonRef.current = existing.fitAddon;
      if (existing.status !== 'disconnected') {
        socketRef.current = existing.socket;
        setStatus(existing.status);
        setStats(existing.stats);
        setSpeeds(existing.speeds);
        return;
      }
    }

    setStatus('connecting');
    setErrorMsg(null);

    // Initialize Terminal if not already done
    if (!terminalRef.current) {
      const term = new Terminal({
        cursorBlink: true,
        fontFamily: 'var(--font-mono)',
        fontSize: fontSize,
        lineHeight: 1.2,
        theme: {
          background: '#0a0d16',
          foreground: '#e2e8f0',
          cursor: '#6366f1',
          selectionBackground: 'rgba(99, 102, 241, 0.3)',
          black: '#0f172a',
          red: '#ef4444',
          green: '#10b981',
          yellow: '#f59e0b',
          blue: '#3b82f6',
          magenta: '#a855f7',
          cyan: '#06b6d4',
          white: '#f8fafc',
          brightBlack: '#475569',
          brightRed: '#f87171',
          brightGreen: '#34d399',
          brightYellow: '#fbbf24',
          brightBlue: '#60a5fa',
          brightMagenta: '#c084fc',
          brightCyan: '#22d3ee',
          brightWhite: '#ffffff'
        }
      });

      // Highlighted selection copies to system clipboard automatically
      term.onSelectionChange(() => {
        const selection = term.getSelection();
        if (selection && selection.trim().length > 0) {
          navigator.clipboard.writeText(selection).catch(err => {
            console.error('Failed to copy selection to clipboard:', err);
          });
        }
      });

      // Attach custom key event handler to allow standard browser shortcuts
      term.attachCustomKeyEventHandler((e) => {
        const isF = e.key.toLowerCase() === 'f';
        const isR = e.key.toLowerCase() === 'r';
        const isF5 = e.key === 'F5';
        const isCtrlOrMeta = e.ctrlKey || e.metaKey;

        // Allow Ctrl++ and Ctrl+- for terminal zoom
        if (isCtrlOrMeta) {
          if (e.key === '+' || e.key === '=') {
            if (e.type === 'keydown') {
              setFontSize(prev => Math.min(32, prev + 1));
            }
            e.preventDefault();
            return false;
          }
          if (e.key === '-') {
            if (e.type === 'keydown') {
              setFontSize(prev => Math.max(9, prev - 1));
            }
            e.preventDefault();
            return false;
          }
        }

        // Allow Ctrl+F / Cmd+F to bubble up for searching
        if (isCtrlOrMeta && isF) {
          return false;
        }

        // Allow F5 to bubble up for global reload prevention
        if (isF5) {
          return false;
        }

        return true;
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      terminalRef.current = term;
      fitAddonRef.current = fitAddon;
    }

    const term = terminalRef.current;
    const fitAddon = fitAddonRef.current;

    // Reset terminal content only on initial connect; keep history on reconnect
    if (!existing) {
      term.clear();
      term.reset();
      term.write('\r\n\x1b[36mConnecting to SSH remote host...\x1b[0m\r\n');
    } else {
      term.write('\r\n\r\n\x1b[36m=== Reconnecting to SSH remote host... ===\x1b[0m\r\n');
    }

    // Establish WebSocket Connection
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.host;
    const wsUrl = `${wsProtocol}//${wsHost}/ws`;

    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    // Register active session to allow survival across mounts
    registerSession(tab.id, {
      term,
      fitAddon,
      socket,
      status: 'connecting',
      stats: null,
      speeds: { rxSpeed: 0, txSpeed: 0 }
    });

    socket.onopen = () => {
      // Fit first to determine sizes
      if (containerRef.current) {
        fitAddon.fit();
      }

      const cols = term.cols || 80;
      const rows = term.rows || 24;

      // Construct and send the init payload
      const initPayload = {
        type: 'init',
        tabId: tab.id,
        cols,
        rows
      };

      if (tab.connectionId) {
        initPayload.connectionId = tab.connectionId;
      } else if (tab.quickConnectDetails) {
        // Quick connect parameters
        Object.assign(initPayload, tab.quickConnectDetails);
      }

      if (isSplit) {
        initPayload.hideStats = true;
      }

      socket.send(JSON.stringify(initPayload));
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'status') {
          updateStatusRef.current(msg.status);
          const sess = getSession(tab.id);
          if (sess) {
            sess.status = msg.status;
          }
          if (onStatusChangeRef.current) {
            onStatusChangeRef.current(tab.id, msg.status);
          }
          if (msg.error) {
            setErrorMsgRef.current(msg.error);
            term.write(`\r\n\x1b[31mSSH Error: ${msg.error}\x1b[0m\r\n`);
          }
        } else if (msg.type === 'data') {
          let cleanData = msg.data;
          
          const macroState = activeMacroRef.current;
          if (macroState) {
            // Strip command echo suffix
            cleanData = cleanData.replace(/;\s*printf\s+["']\\033\[8m__OM_DONE__\\033\[0m\\n["']/g, '');
            // Strip command output marker and optional newlines around it
            cleanData = cleanData.replace(/\r?\n?\u001b\[8m__OM_DONE__\u001b\[0m\r?\n?/g, '');
          }

          term.write(colorizeText(cleanData));

          if (isRecordingRef.current && isCommandRunningRef.current) {
            lastOutputTimeRef.current = Date.now();
          }
          
          if (macroState && macroState.waitingForMarker) {
            incomingBufferRef.current = (incomingBufferRef.current + msg.data).slice(-200);
            if (incomingBufferRef.current.includes('\u001b[8m__OM_DONE__\u001b[0m')) {
              handleCompleteCurrentStep();
            }
          }
        } else if (msg.type === 'stats') {
          const now = Date.now();
          updateStatsRef.current(current => {
            if (current && lastStatsTimeRef.current) {
              const timeDiff = (now - lastStatsTimeRef.current) / 1000;
              if (timeDiff > 0) {
                const rxDiff = msg.stats.network.rx - current.network.rx;
                const txDiff = msg.stats.network.tx - current.network.tx;
                const rxSpeed = rxDiff >= 0 ? rxDiff / timeDiff : 0;
                const txSpeed = txDiff >= 0 ? txDiff / timeDiff : 0;
                updateSpeedsRef.current({ rxSpeed, txSpeed });
              }
            }
            lastStatsTimeRef.current = now;
            return msg.stats;
          });
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    socket.onerror = (err) => {
      console.error('WebSocket encountered an error:', err);
      updateStatusRef.current('disconnected');
      const sess = getSession(tab.id);
      if (sess) {
        sess.status = 'disconnected';
      }
      if (onStatusChangeRef.current) {
        onStatusChangeRef.current(tab.id, 'disconnected');
      }
      setErrorMsgRef.current('WebSocket connection error.');
    };

    socket.onclose = () => {
      updateStatusRef.current('disconnected');
      const sess = getSession(tab.id);
      if (sess) {
        sess.status = 'disconnected';
      }
      if (onStatusChangeRef.current) {
        onStatusChangeRef.current(tab.id, 'disconnected');
      }
    };

    // Attach local term keystroke listener to WebSocket
    term.onData((data) => {
      if (isRecordingRef.current) {
        if (data === '\r' || data === '\n') {
          const activeBuffer = term.buffer.active;
          const cursorY = activeBuffer.cursorY;
          const line = activeBuffer.getLine(activeBuffer.baseY + cursorY);
          const lineText = line ? line.translateToString(true) : '';
          const commandText = cleanCommandPrompt(lineText);

          if (commandText) {
            recordedStepsRef.current.push({
              command: commandText,
              delay: currentStepDelayRef.current || 0
            });
            currentStepDelayRef.current = 0;
            hasCapturedDelayForCurrentStepRef.current = false;
            isCommandRunningRef.current = true;
          }
        } else if (data !== '\x03' && !hasCapturedDelayForCurrentStepRef.current) {
          const now = Date.now();
          const baseTime = lastOutputTimeRef.current || now;
          const delaySec = Math.max(0, parseFloat(((now - baseTime) / 1000).toFixed(1)));
          currentStepDelayRef.current = delaySec;
          hasCapturedDelayForCurrentStepRef.current = true;
          isCommandRunningRef.current = false;
        }
      }

      if (data === '\x03') {
        if (isRecordingRef.current) {
          isCommandRunningRef.current = true;
          hasCapturedDelayForCurrentStepRef.current = false;
          currentStepDelayRef.current = 0;
        }
        const macroState = activeMacroRef.current;
        if (macroState && macroState.waitingForMarker) {
          handleCompleteCurrentStep();
        }
      }

      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'data', data }));
      }
    });

    // Attach terminal resize listener to WebSocket
    term.onResize((size) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'resize',
          cols: size.cols,
          rows: size.rows
        }));
      }
    });
  };

  useEffect(() => {
    // Connect SSH on mount
    connectSSH();

    // Mount terminal DOM element
    if (containerRef.current && terminalRef.current) {
      terminalRef.current.open(containerRef.current);
      fitAddonRef.current.fit();
    }

    if (onRegisterSocket) {
      onRegisterSocket(tab.id, (data) => {
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: 'data', data }));
        }
      });
    }

    // Intercept right click (contextmenu) to paste from system clipboard
    const handleContextMenu = (e) => {
      if (viewModeRef.current !== 'terminal') return; // Do not intercept context menu in SFTP view
      e.preventDefault();
      navigator.clipboard.readText()
        .then(text => {
          if (text && socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: 'data', data: text }));
          }
        })
        .catch(err => {
          console.error('Failed to read from clipboard for paste:', err);
        });
    };

    const el = containerRef.current;
    if (el) {
      el.addEventListener('contextmenu', handleContextMenu);
    }

    const handleGlobalKeyDown = (e) => {
      if (e.defaultPrevented) return;
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      if (isCtrlOrMeta) {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          setFontSize(prev => Math.min(32, prev + 1));
        } else if (e.key === '-') {
          e.preventDefault();
          setFontSize(prev => Math.max(9, prev - 1));
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);

    // Set up ResizeObserver to handle element size changes reactively
    const resizeObserver = new ResizeObserver(() => {
      if (terminalRef.current && fitAddonRef.current && statusRef.current === 'connected' && viewModeRef.current === 'terminal') {
        try {
          fitAddonRef.current.fit();
        } catch (err) {
          // Ignore dimensions failures when container has 0 height temporarily
        }
      }
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    // Cleanup on unmount - do NOT close socket/terminal since they are registered globally
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      resizeObserver.disconnect();
      if (el) {
        el.removeEventListener('contextmenu', handleContextMenu);
      }
      if (onRegisterSocket) {
        onRegisterSocket(tab.id, null);
      }
    };
  }, []);

  // Refit whenever terminal status shifts to connected (ensures prompt size maps correctly)
  useEffect(() => {
    if (status === 'connected' && terminalRef.current && fitAddonRef.current) {
      const performFit = () => {
        try {
          if (terminalRef.current && fitAddonRef.current) {
            fitAddonRef.current.fit();
            // Send active resize update to remote host
            const cols = terminalRef.current.cols;
            const rows = terminalRef.current.rows;
            if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
              socketRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
            }
          }
        } catch (err) {
          console.error('Post-connection resize alignment failed:', err);
        }
      };

      performFit();
      const timer = setTimeout(performFit, 100);
      const timerLong = setTimeout(performFit, 500);
      document.fonts.ready.then(performFit);

      return () => {
        clearTimeout(timer);
        clearTimeout(timerLong);
      };
    }
  }, [status]);

  // Focus terminal dynamically when tab is selected/active or status changes to connected
  useEffect(() => {
    if (isActive && terminalRef.current && status === 'connected' && viewMode === 'terminal') {
      const focusTimer = setTimeout(() => {
        if (terminalRef.current) {
          terminalRef.current.focus();
        }
      }, 50);
      return () => clearTimeout(focusTimer);
    }
  }, [isActive, status, viewMode]);

  // Refit terminal when switching views
  useEffect(() => {
    if (viewMode === 'terminal' && status === 'connected' && terminalRef.current && fitAddonRef.current) {
      const performFit = () => {
        try {
          if (terminalRef.current && fitAddonRef.current) {
            fitAddonRef.current.fit();
          }
        } catch (err) {
          // Ignore
        }
      };

      performFit();
      const timer = setTimeout(performFit, 50);
      document.fonts.ready.then(performFit);

      return () => clearTimeout(timer);
    }
  }, [viewMode, status]);

  const getTerminalText = () => {
    if (!terminalRef.current) return '';
    const term = terminalRef.current;
    const buffer = term.buffer.active;
    let text = '';
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) {
        text += line.translateToString(true) + '\n';
      }
    }
    return text;
  };

  const handleSaveOutput = () => {
    const text = getTerminalText();
    if (!text) {
      alert("Console buffer is empty.");
      return;
    }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    const cleanName = (tab.title || 'console').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
    link.download = `terminal_${cleanName}_${dateStr}.txt`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const formatMB = (mb) => {
    if (!mb) return '0 GB';
    if (mb < 1024) return `${mb} MB`;
    return `${(mb / 1024).toFixed(1)} GB`;
  };

  const formatSpeed = (bytesPerSec) => {
    if (bytesPerSec === undefined || bytesPerSec === null) return '0 B/s';
    if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
    if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  return (
    <div className="terminal-wrapper">
      <style>{`
        @keyframes blink {
          0% { opacity: 1; }
          50% { opacity: 0.2; }
          100% { opacity: 1; }
        }
      `}</style>
      {status === 'connected' && (
        <div className="terminal-mode-selector">
          <div className="mode-selector-left">
            <button 
              className={`mode-btn ${viewMode === 'terminal' ? 'active' : ''}`}
              onClick={() => setViewMode('terminal')}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Console
            </button>
            <button 
              className={`mode-btn ${viewMode === 'files' ? 'active' : ''}`}
              onClick={() => setViewMode('files')}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              Files (SFTP)
            </button>
            {enabledServices.map(srv => {
              const labelMap = {
                postgres: 'PostgreSQL',
                mongo: 'MongoDB',
                redis: 'Redis',
                rabbitmq: 'RabbitMQ',
                haproxy: 'HAProxy'
              };
              const getIcon = (type) => {
                switch (type) {
                  case 'postgres':
                    return (
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m-16 5c0 2.21 3.582 4 8 4s8-1.79 8-4" />
                      </svg>
                    );
                  case 'mongo':
                    return (
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                    );
                  case 'redis':
                    return (
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 5.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
                      </svg>
                    );
                  case 'rabbitmq':
                    return (
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 10.742l-2.777 2.777M10.5 8.25l-2.777 2.777m2.777-2.777l2.777 2.777m-2.777-2.777V3m0 15.25v2.25M6.75 18a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 18a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 18a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 6a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM9 12a3 3 0 11-6 0 3 3 0 016 0zM21 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    );
                  case 'haproxy':
                    return (
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                      </svg>
                    );
                  default:
                    return null;
                }
              };
              return (
                <button
                  key={srv}
                  className={`mode-btn ${viewMode === srv ? 'active' : ''}`}
                  onClick={() => setViewMode(srv)}
                >
                  {getIcon(srv)}
                  {labelMap[srv] || srv}
                </button>
              );
            })}
          </div>
          <div className="mode-selector-right">
            {viewMode === 'terminal' && (
              <>
                <button 
                  className="mode-btn action-btn-zoom-in"
                  onClick={() => setFontSize(prev => Math.min(32, prev + 1))}
                  title="Zoom In (Increase text size)"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
                  </svg>
                </button>
                <button 
                  className="mode-btn action-btn-zoom-out"
                  onClick={() => setFontSize(prev => Math.max(9, prev - 1))}
                  title="Zoom Out (Decrease text size)"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM7 10h6" />
                  </svg>
                </button>
                <button 
                  className="mode-btn action-btn-save"
                  onClick={handleSaveOutput}
                  title="Save terminal console buffer output to a file"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-2m-4-1v8m0 0l3-3m-3 3L9 8m-5 5h2.586a1 1 0 01.707.293l2.414 2.414a1 1 0 00.707.293h3.172a1 1 0 00.707-.293l2.414-2.414a1 1 0 01.707-.293H20" />
                  </svg>
                  <span>Save Output</span>
                </button>

                {/* Macro Recording Button */}
                {!isRecording ? (
                  <button 
                    className="mode-btn"
                    onClick={handleStartRecording}
                    title="Record console commands to save as a macro"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }} />
                    <span>Record Macro</span>
                  </button>
                ) : (
                  <button 
                    className="mode-btn"
                    onClick={handleStopRecording}
                    title="Stop recording and save macro"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      background: 'rgba(239, 68, 68, 0.15)',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      color: '#ef4444',
                      animation: 'blink 1.5s infinite'
                    }}
                  >
                    <span style={{ 
                      display: 'inline-block', 
                      width: '8px', 
                      height: '8px', 
                      borderRadius: '50%', 
                      background: '#ef4444'
                    }} />
                    <span>Recording...</span>
                  </button>
                )}

                {/* Macros Dropdown */}
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <button 
                    className={`mode-btn ${isMacrosDropdownOpen ? 'active' : ''}`}
                    onClick={() => setIsMacrosDropdownOpen(!isMacrosDropdownOpen)}
                    title="Quick execute saved macros"
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span>Macros</span>
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginLeft: '4px' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {isMacrosDropdownOpen && (
                    <div 
                      className="glass-panel"
                      style={{
                        position: 'absolute',
                        top: '100%',
                        right: 0,
                        marginTop: '6px',
                        width: '240px',
                        maxHeight: '300px',
                        overflowY: 'auto',
                        zIndex: 100,
                        background: '#0a0d16',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '8px',
                        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
                        padding: '6px 0'
                      }}
                    >
                      {macros.length === 0 ? (
                        <div style={{ padding: '12px', fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center' }}>
                          No macros saved yet.
                        </div>
                      ) : (
                        macros.map((m) => (
                          <div
                            key={m.id}
                            style={{
                              padding: '8px 12px',
                              fontSize: '13px',
                              color: 'var(--text-primary)',
                              cursor: 'pointer',
                              borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                              transition: 'background 0.2s',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '2px',
                              textAlign: 'left'
                            }}
                            onClick={() => handleExecuteMacro(m)}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <span style={{ fontWeight: '600' }}>{m.name}</span>
                            <code style={{ fontSize: '11px', color: 'var(--accent-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m.command}
                            </code>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* MACRO STEP PROGRESS BANNER */}
      {runningMacroInfo && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '8px 14px',
          background: 'rgba(99,102,241,0.10)',
          borderTop: '1px solid rgba(99,102,241,0.3)',
          borderBottom: '1px solid rgba(99,102,241,0.3)',
          flexShrink: 0
        }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#6366f1' }} />
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '12px', color: '#818cf8', fontWeight: '600' }}>
                Macro: {runningMacroInfo.name} ({runningMacroInfo.currentStep}/{runningMacroInfo.totalSteps})
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                Executing: <code style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', background: 'rgba(255,255,255,0.05)', padding: '1px 4px', borderRadius: '3px' }}>{runningMacroInfo.currentCommand}</code>
              </span>
            </div>
            {runningMacroInfo.nextCommand && runningMacroInfo.nextCommand !== 'None (finished)' && (
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                Next: <code style={{ color: '#f59e0b', fontFamily: 'var(--font-mono)' }}>{runningMacroInfo.nextCommand}</code>
              </div>
            )}
          </div>
          <button
            onClick={handleAbortActiveMacro}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '4px 10px', borderRadius: '5px', border: '1px solid rgba(239,68,68,0.3)',
              background: 'rgba(239,68,68,0.15)', color: '#ef4444',
              cursor: 'pointer', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap'
            }}
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '2px' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Stop Macro
          </button>
        </div>
      )}

      <div 
        className="terminal-canvas" 
        ref={containerRef} 
        style={{ display: viewMode === 'terminal' ? 'block' : 'none' }} 
      />

      {viewMode === 'terminal' && status === 'connected' && stats && !isSplit && (
        <div className="terminal-metrics-bar">
          {/* CPU / Load Average */}
          <div className="metric-item load-metric">
            <span className="metric-label">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Load Avg
            </span>
            <span className="metric-val">{stats.load.load1.toFixed(2)} / {stats.load.load5.toFixed(2)} / {stats.load.load15.toFixed(2)}</span>
          </div>

          {/* Memory Usage */}
          <div className="metric-item memory-metric">
            <span className="metric-label">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 5h10a2 2 0 012 2v10a2 2 0 01-2 2H7a2 2 0 01-2 2V7a2 2 0 012-2z" />
              </svg>
              RAM
            </span>
            <div className="metric-progress-wrapper">
              <div className="metric-progress-track">
                <div 
                  className="metric-progress-fill" 
                  style={{ width: `${Math.min(100, (stats.memory.used / stats.memory.total) * 100)}%` }} 
                />
              </div>
              <span className="metric-val">
                {formatMB(stats.memory.used)} / {formatMB(stats.memory.total)} ({((stats.memory.used / stats.memory.total) * 100).toFixed(1)}%)
              </span>
            </div>
          </div>

          {/* Disk Usage */}
          <div className="metric-item disk-metric">
            <span className="metric-label">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
              </svg>
              Disk
            </span>
            <div className="metric-progress-wrapper">
              <div className="metric-progress-track">
                <div 
                  className="metric-progress-fill warning" 
                  style={{ width: `${Math.min(100, (stats.disk.used / stats.disk.total) * 100)}%` }} 
                />
              </div>
              <span className="metric-val">
                {formatMB(stats.disk.used)} / {formatMB(stats.disk.total)} ({((stats.disk.used / stats.disk.total) * 100).toFixed(1)}%)
              </span>
            </div>
          </div>

          {/* Network Usage */}
          <div className="metric-item network-metric">
            <span className="metric-label">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              Net
            </span>
            <div className="metric-net-speeds">
              <span className="net-speed down">
                <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
                {formatSpeed(speeds.rxSpeed)}
              </span>
              <span className="net-speed up">
                <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
                {formatSpeed(speeds.txSpeed)}
              </span>
            </div>
          </div>
        </div>
      )}

      {visitedViews.has('files') && status === 'connected' && (
        <div style={{ display: viewMode === 'files' ? 'contents' : 'none' }}>
          <SftpExplorer tabId={tab.id} />
        </div>
      )}

      {enabledServices.map(srv => {
        if (!visitedViews.has(srv) || status !== 'connected') return null;
        return (
          <div key={srv} style={{ display: viewMode === srv ? 'contents' : 'none' }}>
            <ServiceClientTab connection={connection} type={srv} tabId={tab.id} />
          </div>
        );
      })}

      {/* LOCAL SAVE MACRO MODAL */}
      {isSaveMacroOpen && (
        <div className="modal-overlay open" style={{ zIndex: 1000 }}>
          <div className="modal-container glass-panel" style={{ maxWidth: '450px' }}>
            <div className="modal-header">
              <div className="modal-title">
                {saveMacroFormData.delays ? 'Save Recorded Macro' : 'Save Selected Text as Macro'}
              </div>
              <button 
                className="modal-close-btn" 
                onClick={() => setIsSaveMacroOpen(false)}
              >
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <form onSubmit={handleSaveLocalMacro}>
              <div className="modal-body">
                {saveMacroFormData.delays && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 12px',
                    background: 'rgba(16,185,129,0.1)',
                    border: '1px solid rgba(16,185,129,0.25)',
                    borderRadius: '6px',
                    color: '#10b981',
                    fontSize: '11px',
                    marginBottom: '14px'
                  }}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>Recorded commands and exact delay timings will be saved automatically.</span>
                  </div>
                )}
                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label className="form-label">Macro Name</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Docker logs"
                    required
                    value={saveMacroFormData.name}
                    onChange={(e) => setSaveMacroFormData({ ...saveMacroFormData, name: e.target.value })}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>Command(s)</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 'normal' }}>One command per line</span>
                  </label>
                  <textarea
                    className="form-textarea"
                    rows={4}
                    placeholder="Command text"
                    required
                    style={{ fontFamily: 'var(--font-mono)' }}
                    value={saveMacroFormData.command}
                    onChange={(e) => setSaveMacroFormData({ ...saveMacroFormData, command: e.target.value })}
                  />
                </div>
              </div>
              
              <div className="modal-footer">
                <button 
                  type="button" 
                  className="btn-secondary" 
                  onClick={() => setIsSaveMacroOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Save Macro
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {status === 'connecting' && (
        <div className="terminal-overlay">
          <div className="terminal-overlay-spinner" />
          <div className="terminal-overlay-title">Establishing Connection...</div>
          <div className="terminal-overlay-desc">
            Connecting to {tab.quickConnectDetails ? tab.quickConnectDetails.host : tab.title}
          </div>
        </div>
      )}

      {status === 'disconnected' && (
        <div className="terminal-overlay" style={{ backdropFilter: 'none', background: 'rgba(10, 15, 26, 0.6)' }}>
          <svg className="terminal-overlay-error-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="terminal-overlay-title">Connection Disconnected</div>
          {errorMsg && <div className="terminal-overlay-desc">{errorMsg}</div>}
          <button className="terminal-reconnect-btn" onClick={connectSSH}>
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 15H19" />
            </svg>
            Reconnect Session
          </button>
        </div>
      )}
    </div>
  );
}

const colorizeText = (text) => {
  if (!text) return text;
  
  const ansiRegex = /(\x1b\[[0-9;?]*[a-zA-Z])/g;
  const parts = text.split(ansiRegex);
  
  return parts.map((part) => {
    if (ansiRegex.test(part)) {
      return part;
    }
    
    let modified = part;
    
    // 1. Red keywords (Error, Fail, Failed, Failure, Critical) - matched anywhere
    modified = modified.replace(/(error|fail|critical)/gi, (match) => {
      return `\x1b[1;31m${match}\x1b[22;39m`;
    });
    
    // 2. Orange keywords (Warning, Worning) - matched anywhere, (warn, warned) - matched as whole words
    modified = modified.replace(/(warning|worning)/gi, (match) => {
      return `\x1b[38;5;208;1m${match}\x1b[22;39m`;
    });
    modified = modified.replace(/\b(warn|warned)\b/gi, (match) => {
      return `\x1b[38;5;208;1m${match}\x1b[22;39m`;
    });
    
    // 3. Green keywords (Success) - matched anywhere, (ok) - matched as whole word
    modified = modified.replace(/(success)/gi, (match) => {
      return `\x1b[1;32m${match}\x1b[22;39m`;
    });
    modified = modified.replace(/\b(ok)\b/gi, (match) => {
      return `\x1b[1;32m${match}\x1b[22;39m`;
    });
    
    return modified;
  }).join('');
};
