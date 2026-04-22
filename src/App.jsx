import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Hand, Pencil, Circle, Square, Type, Trash2, Undo2, Redo2, Settings, Share2, Video, Mic, MicOff, VideoOff, Copy, Check, Info, Triangle, X, Eraser, FileUp, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Peer from 'peerjs';

const BOARD_SIZE = 19;

const App = () => {
  const [boardPx, setBoardPx] = useState(600);
  const cellSize = boardPx / 19;

  // --- Game State ---
  const [stones, setStones] = useState(new Map());
  const [history, setHistory] = useState([]);
  const [currentTurn, setCurrentTurn] = useState('black');
  const [activeTool, setActiveTool] = useState('stone');
  const [annotations, setAnnotations] = useState([]);
  const [showCoords, setShowCoords] = useState(true);
  const [showMoveNumbers, setShowMoveNumbers] = useState(false);
  const [moveCount, setMoveCount] = useState(0);
  const [markerCount, setMarkerCount] = useState(1);
  const [sgfMoves, setSgfMoves] = useState([]);
  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1);
  const [activeColor, setActiveColor] = useState('#d4af37'); // Default gold
  
  // --- Peer & Media State ---
  const [peer, setPeer] = useState(null);
  const [myId, setMyId] = useState('');
  const [remoteId, setRemoteId] = useState('');
  const [conn, setConn] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isJoined, setIsJoined] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isTeacher, setIsTeacher] = useState(true); // Default to teacher
  const [canStudentPlay, setCanStudentPlay] = useState(false);
  
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState(null);
  const stoneAudioRef = useRef(new Audio('/落子音.m4a'));

  // Resize Handler
  useEffect(() => {
    const handleResize = () => {
      const h = window.innerHeight - 120;
      const w = window.innerWidth - 360;
      setBoardPx(Math.max(300, Math.min(h, w)));
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Initialize Peer
  useEffect(() => {
    const newPeer = new Peer();
    newPeer.on('open', setMyId);
    newPeer.on('connection', (c) => {
      setConn(c);
      setIsJoined(true);
      c.on('data', handleIncomingData);
    });
    newPeer.on('call', (call) => {
      navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((stream) => {
        setLocalStream(stream);
        call.answer(stream);
        call.on('stream', setRemoteStream);
      }).catch(err => console.error("Media error:", err));
    });
    setPeer(newPeer);
    return () => newPeer.destroy();
  }, []);

  // --- Keyboard Shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.ctrlKey && e.key === 'z') {
        // Simple Undo for now
        setStones(prev => {
          const arr = Array.from(prev.entries());
          if (arr.length === 0) return prev;
          arr.pop();
          return new Map(arr);
        });
      }
      if (e.key === 'c') {
        setAnnotations([]);
        setMarkerCount(1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  const handleIncomingData = (data) => {
    if (data.type === 'MOVE') {
      playStoneSound();
      setStones(new Map(JSON.parse(data.stones)));
      setCurrentTurn(data.turn);
      setMoveCount(data.moveCount || 0);
    } else if (data.type === 'SYNC') {
      setStones(new Map(JSON.parse(data.stones)));
      setCurrentTurn(data.turn);
      setAnnotations(data.annotations);
      setMoveCount(data.moveCount || 0);
    } else if (data.type === 'PERMISSION_UPDATE') {
      setCanStudentPlay(data.canPlay);
    }
  };

  const sendData = (data) => {
    if (conn && conn.open) conn.send(data);
  };

  const connectToPeer = () => {
    if (!remoteId) return;
    const c = peer.connect(remoteId);
    setConn(c);
    c.on('open', () => {
      setIsJoined(true);
      c.on('data', handleIncomingData);
    });
    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((stream) => {
      setLocalStream(stream);
      const call = peer.call(remoteId, stream);
      call.on('stream', setRemoteStream);
    }).catch(err => {
      console.error("Connect media error:", err);
      setIsJoined(true);
    });
  };

  const toggleMic = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => track.enabled = !isMicOn);
      setIsMicOn(!isMicOn);
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => track.enabled = !isVideoOn);
      setIsVideoOn(!isVideoOn);
    }
  };

  // --- SGF Parsing ---
  const parseSGF = (sgfString) => {
    const moves = [];
    const moveRegex = /([BW])\[([a-s]{2})\]/g;
    let match;
    while ((match = moveRegex.exec(sgfString)) !== null) {
      const color = match[1] === 'B' ? 'black' : 'white';
      const x = match[2].charCodeAt(0) - 97;
      const y = match[2].charCodeAt(1) - 97;
      moves.push({ x, y, color });
    }
    return moves;
  };

  const goToMove = (index) => {
    if (index < -1 || index >= sgfMoves.length) return;
    
    let tempStones = new Map();
    // Play through moves up to the target index
    for (let i = 0; i <= index; i++) {
      const m = sgfMoves[i];
      const key = `${m.x},${m.y}`;
      
      // Basic capture logic during SGF playback
      tempStones.set(key, { color: m.color, moveNumber: i + 1 });
      
      // Handle simple captures (could be improved with full Go logic if needed)
      const opponent = m.color === 'black' ? 'white' : 'black';
      getNeighbors(m.x, m.y).forEach(([nx, ny]) => {
        const nk = `${nx},${ny}`;
        if (tempStones.get(nk)?.color === opponent) {
          const group = getGroup(nx, ny, opponent, tempStones);
          if (getLiberties(group, tempStones).size === 0) {
            group.forEach(gk => tempStones.delete(gk));
          }
        }
      });
    }
    
    setStones(tempStones);
    setCurrentMoveIndex(index);
    setMoveCount(index + 1);
    setCurrentTurn((index + 1) % 2 === 0 ? 'black' : 'white');
    
    sendData({
      type: 'SYNC',
      stones: JSON.stringify(Array.from(tempStones.entries())),
      turn: (index + 1) % 2 === 0 ? 'black' : 'white',
      annotations,
      moveCount: index + 1
    });
  };

  const handleSGFUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target.result;
      const moves = parseSGF(content);
      setSgfMoves(moves);
      goToMove(moves.length - 1);
    };
    reader.readAsText(file);
  };

  // --- Go Logic ---
  const getNeighbors = (x, y) => [
    [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]
  ].filter(([nx, ny]) => nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE);

  const getGroup = (x, y, color, currentStones) => {
    const group = new Set();
    const stack = [[x, y]];
    const key = (cx, cy) => `${cx},${cy}`;
    while (stack.length > 0) {
      const [cx, cy] = stack.pop();
      const k = key(cx, cy);
      if (group.has(k)) continue;
      if (currentStones.get(k)?.color === color) {
        group.add(k);
        getNeighbors(cx, cy).forEach(n => stack.push(n));
      }
    }
    return group;
  };

  const getLiberties = (group, currentStones) => {
    const liberties = new Set();
    group.forEach(k => {
      const [x, y] = k.split(',').map(Number);
      getNeighbors(x, y).forEach(([nx, ny]) => {
        const nk = `${nx},${ny}`;
        if (!currentStones.has(nk)) liberties.add(nk);
      });
    });
    return liberties;
  };

  const playStoneSound = () => {
    // 每次落子创建一个新的音效实例，避免状态冲突
    const audio = new Audio('/落子音.m4a');
    audio.volume = 0.6;
    audio.play().catch(() => {});
    
    // 0.5秒后切断该实例
    setTimeout(() => {
      audio.pause();
      audio.remove(); // 释放资源
    }, 500);
  };

  const handlePlaceStone = (x, y) => {
    // Check permissions
    if (!isTeacher && !canStudentPlay) {
      alert("请等待老师开启落子权限");
      return;
    }

    const key = `${x},${y}`;
    
    // 如果是标记工具，执行自动标记逻辑
    if (['circle', 'triangle', 'square', 'x'].includes(activeTool)) {
      const px = cellSize * (x + 0.5);
      const py = cellSize * (y + 0.5);
      const r = cellSize * 0.3; // 固定大小
      
      const newAnno = { 
        tool: activeTool, 
        points: [[px, py], [px + r, py]], // 模拟两点以复用现有的绘图逻辑，或者之后重写绘图
        grid: {x, y},
        color: '#d4af37' 
      };
      
      const newAnnos = [...annotations, newAnno];
      setAnnotations(newAnnos);
      sendData({ type: 'SYNC', stones: JSON.stringify(Array.from(stones.entries())), turn: currentTurn, annotations: newAnnos, moveCount });
      return;
    }

    if (stones.has(key)) return;

    const newStones = new Map(stones);
    const newMoveCount = moveCount + 1;
    newStones.set(key, { color: currentTurn, moveNumber: newMoveCount });

    // Capture Logic
    const opponent = currentTurn === 'black' ? 'white' : 'black';
    let capturedAny = false;
    getNeighbors(x, y).forEach(([nx, ny]) => {
      const nk = `${nx},${ny}`;
      if (newStones.get(nk)?.color === opponent) {
        const group = getGroup(nx, ny, opponent, newStones);
        if (getLiberties(group, newStones).size === 0) {
          group.forEach(gk => newStones.delete(gk));
          capturedAny = true;
        }
      }
    });

    // Suicide Check
    const group = getGroup(x, y, currentTurn, newStones);
    if (getLiberties(group, newStones).size === 0 && !capturedAny) {
      console.warn("Invalid move: Suicide");
      return;
    }

    // Success! 
    playStoneSound();
    setHistory([...history, new Map(stones)]);
    setStones(newStones);
    setMoveCount(newMoveCount);
    const nextTurn = opponent;
    setCurrentTurn(nextTurn);

    sendData({
      type: 'MOVE',
      stones: JSON.stringify(Array.from(newStones.entries())),
      turn: nextTurn,
      moveCount: newMoveCount
    });
  };

  // Drawing
  const startDrawing = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;

    // 如果是标记工具，直接进行网格对齐的一键标记
    if (['circle', 'triangle', 'square', 'x', 'number'].includes(activeTool)) {
      const x = Math.floor(rawX / cellSize);
      const y = Math.floor(rawY / cellSize);
      
      const newAnno = { 
        tool: activeTool, 
        grid: {x, y},
        label: activeTool === 'number' ? markerCount : null,
        color: activeColor 
      };
      
      if (activeTool === 'number') setMarkerCount(prev => prev + 1);
      
      const newAnnos = [...annotations, newAnno];
      setAnnotations(newAnnos);
      sendData({ type: 'SYNC', stones: JSON.stringify(Array.from(stones.entries())), turn: currentTurn, annotations: newAnnos, moveCount });
      return;
    }

    if (activeTool === 'stone') return;
    setIsDrawing(true);
    setCurrentPath({ tool: activeTool, points: [[rawX, rawY]], color: activeColor });
  };
  const draw = (e) => {
    if (!isDrawing) return;
    const rect = canvasRef.current.getBoundingClientRect();
    setCurrentPath(prev => ({ ...prev, points: [...prev.points, [e.clientX - rect.left, e.clientY - rect.top]] }));
  };
  const endDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const newAnnos = [...annotations, currentPath];
    setAnnotations(newAnnos);
    setCurrentPath(null);
    sendData({ type: 'SYNC', stones: JSON.stringify(Array.from(stones.entries())), turn: currentTurn, annotations: newAnnos, moveCount });
  };

  // --- Touch Support ---
  const handleTouchStart = (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    startDrawing({ 
      clientX: touch.clientX, 
      clientY: touch.clientY,
      target: e.target
    });
  };

  const handleTouchMove = (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    draw({
      clientX: touch.clientX,
      clientY: touch.clientY
    });
  };

  const handleTouchEnd = (e) => {
    e.preventDefault();
    endDrawing();
  };

  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.clearRect(0, 0, boardPx, boardPx);
    [...annotations, currentPath].filter(Boolean).forEach(anno => {
      // 颜色优先级：优先使用记录在标记里的颜色
      let markColor = anno.color || '#d4af37';
      
      // 如果没有指定颜色（旧数据）或者是数字，才走之前的特殊逻辑
      if (anno.tool === 'number' && !anno.color) {
        markColor = '#ffffff';
      }

      ctx.beginPath(); 
      ctx.strokeStyle = markColor; 
      ctx.lineWidth = Math.max(2, boardPx / 200);
      
      // 如果有网格信息，实时计算中心点（防止缩放偏移）
      let x, y, r;
      if (anno.grid) {
        x = cellSize * (anno.grid.x + 0.5);
        y = cellSize * (anno.grid.y + 0.5);
        r = cellSize * 0.25;
      } else {
        // 兼容自由涂鸦工具（如画笔）
        const [p1, p2] = [anno.points[0], anno.points[anno.points.length - 1]];
        x = p1[0]; y = p1[1];
        r = Math.sqrt(Math.pow(p2[0]-x, 2) + Math.pow(p2[1]-y, 2));
      }

      if (anno.tool === 'pen') {
        anno.points.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
      }
      else if (anno.tool === 'circle') {
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      else if (anno.tool === 'triangle') {
        ctx.moveTo(x, y - r);
        ctx.lineTo(x - r * Math.sin(Math.PI/3), y + r * Math.cos(Math.PI/3));
        ctx.lineTo(x + r * Math.sin(Math.PI/3), y + r * Math.cos(Math.PI/3));
        ctx.closePath();
      }
      else if (anno.tool === 'square') {
        ctx.rect(x - r, y - r, r * 2, r * 2);
      }
      else if (anno.tool === 'x') {
        ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
        ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
      }
      else if (anno.tool === 'number' && anno.label) {
        ctx.font = `bold ${cellSize * 0.5}px Inter`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = markColor;
        ctx.fillText(anno.label.toString(), x, y);
      }
      ctx.stroke();
    });
  }, [annotations, currentPath, boardPx, cellSize]);

  return (
    <div className="app-container">
      {!isJoined && !remoteStream && (
        <div className="connection-overlay">
          <div className="connection-card">
            <h2>大川围棋互动教室</h2>
            
            <div className="role-selector" style={{display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 20}}>
              <button className={`role-btn ${isTeacher ? 'active' : ''}`} onClick={() => setIsTeacher(true)}>我是老师</button>
              <button className={`role-btn ${!isTeacher ? 'active' : ''}`} onClick={() => setIsTeacher(false)}>我是学生</button>
            </div>

            <div className="id-display" onClick={() => {navigator.clipboard.writeText(myId); setCopied(true); setTimeout(() => setCopied(false), 2000);}}>
              {myId || '生成中...'} {copied ? <Check size={16}/> : <Copy size={16}/>}
            </div>
            <div style={{display: 'flex', gap: 10}}>
              <input type="text" placeholder="学生 ID" value={remoteId} onChange={e => setRemoteId(e.target.value)} style={{flex: 1, padding: 10, background: '#111', color: 'white', borderRadius: 8, border: '1px solid #333'}} />
              <button onClick={connectToPeer} style={{padding: '0 20px', background: '#d4af37', border: 'none', borderRadius: 8, cursor: 'pointer'}}>进入</button>
            </div>
            <button onClick={() => setIsJoined(true)} style={{marginTop: 20, background: 'none', border: 'none', color: '#666', cursor: 'pointer'}}>离线模式</button>
          </div>
        </div>
      )}

      <main className="main-content">
        <div className="go-board-wrapper" style={{ width: boardPx, height: boardPx, '--cell-size': `${cellSize}px` }}>
          {showCoords && Array.from({length: 19}).map((_, i) => (
            <React.Fragment key={i}>
              <div className="coord-label" style={{ top: -20, left: cellSize * (i + 0.5), transform: 'translateX(-50%)' }}>{String.fromCharCode(65 + (i >= 8 ? i + 1 : i))}</div>
              <div className="coord-label" style={{ bottom: -20, left: cellSize * (i + 0.5), transform: 'translateX(-50%)' }}>{String.fromCharCode(65 + (i >= 8 ? i + 1 : i))}</div>
              <div className="coord-label" style={{ left: -20, top: cellSize * (i + 0.5), transform: 'translateY(-50%)' }}>{19 - i}</div>
              <div className="coord-label" style={{ right: -20, top: cellSize * (i + 0.5), transform: 'translateY(-50%)' }}>{19 - i}</div>
            </React.Fragment>
          ))}
          <div className="go-board" style={{ gridTemplateColumns: `repeat(19, 1fr)`, width: '100%', height: '100%' }}>
            {Array.from({length: 19}).map((_, i) => (
              <React.Fragment key={i}>
                <div className="grid-line" style={{ top: cellSize * (i + 0.5), left: cellSize * 0.5, width: cellSize * 18, height: 1 }} />
                <div className="grid-line" style={{ left: cellSize * (i + 0.5), top: cellSize * 0.5, height: cellSize * 18, width: 1 }} />
              </React.Fragment>
            ))}
            {[3, 9, 15].map(x => [3, 9, 15].map(y => <div key={`${x}-${y}`} className="star-point" style={{ left: cellSize * (x + 0.5), top: cellSize * (y + 0.5) }} />))}
            {Array.from({length: 19 * 19}).map((_, i) => {
              const x = i % 19; const y = Math.floor(i / 19); const stone = stones.get(`${x},${y}`);
              return (
                <div key={i} className="board-cell" onClick={() => handlePlaceStone(x, y)}>
                  <AnimatePresence>
                    {stone && (
                      <motion.div 
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 300, damping: 20 }}
                        className={`stone ${stone.color}`}
                      >
                        {showMoveNumbers && <div className="move-number">{stone.moveNumber}</div>}
                        {stone.moveNumber === moveCount && !showMoveNumbers && <div className="last-move-marker" />}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
          <canvas 
            ref={canvasRef} 
            className={`drawing-layer ${activeTool !== 'stone' ? 'active' : ''}`} 
            width={boardPx} 
            height={boardPx} 
            onMouseDown={startDrawing} 
            onMouseMove={draw} 
            onMouseUp={endDrawing} 
            onMouseLeave={endDrawing} 
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          />
        </div>

        {/* SGF Navigation Controls */}
        {sgfMoves.length > 0 && (
          <div className="sgf-controls" style={{ width: boardPx }}>
            <div className="sgf-slider-container">
              <span>{currentMoveIndex + 1} / {sgfMoves.length}</span>
              <input 
                type="range" 
                min="-1" 
                max={sgfMoves.length - 1} 
                value={currentMoveIndex} 
                onChange={(e) => goToMove(parseInt(e.target.value))}
                className="sgf-slider"
              />
            </div>
            <div className="sgf-buttons">
              <button className="nav-btn" onClick={() => goToMove(-1)} title="第一手"><ChevronsLeft size={20}/></button>
              <button className="nav-btn" onClick={() => goToMove(currentMoveIndex - 1)} title="上一手"><ChevronLeft size={24}/></button>
              <button className="nav-btn" onClick={() => goToMove(currentMoveIndex + 1)} title="下一手"><ChevronRight size={24}/></button>
              <button className="nav-btn" onClick={() => goToMove(sgfMoves.length - 1)} title="最后一手"><ChevronsRight size={20}/></button>
            </div>
          </div>
        )}
      </main>

      <aside className="sidebar">
        <div className="logo">大川围棋</div>
        
        {isTeacher && (
          <div className="admin-controls" style={{padding: '10px', background: 'rgba(212,175,55,0.1)', borderRadius: 10, marginBottom: 15}}>
            <label style={{display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: '14px'}}>
              <input 
                type="checkbox" 
                checked={canStudentPlay} 
                onChange={(e) => {
                  setCanStudentPlay(e.target.checked);
                  sendData({ type: 'PERMISSION_UPDATE', canPlay: e.target.checked });
                }} 
              />
              允许学生落子
            </label>
          </div>
        )}

        <div className="video-container">
          <div className="video-slot">
            <video ref={localVideoRef} autoPlay muted playsInline />
            <div className="video-label">老师</div>
            <div className="video-controls">
              <button onClick={toggleMic} className={`control-btn ${!isMicOn ? 'off' : ''}`}>
                {isMicOn ? <Mic size={16}/> : <MicOff size={16}/>}
              </button>
              <button onClick={toggleVideo} className={`control-btn ${!isVideoOn ? 'off' : ''}`}>
                {isVideoOn ? <Video size={16}/> : <VideoOff size={16}/>}
              </button>
            </div>
          </div>
          <div className="video-slot">
            {remoteStream ? <video ref={remoteVideoRef} autoPlay playsInline /> : <div style={{height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333'}}>等待学生...</div>}
            <div className="video-label">学生</div>
          </div>
        </div>
        {isTeacher && (
          <>
            <div className="tool-group">
              <span className="tool-label">工具箱</span>
              <div className="tool-grid">
                <button className={`tool-button ${activeTool === 'stone' ? 'active' : ''}`} onClick={() => setActiveTool('stone')}><Hand size={20}/></button>
                <button className={`tool-button ${activeTool === 'pen' ? 'active' : ''}`} onClick={() => setActiveTool('pen')}><Pencil size={20}/></button>
                <button className={`tool-button ${activeTool === 'circle' ? 'active' : ''}`} onClick={() => setActiveTool('circle')}><Circle size={20}/></button>
                <button className={`tool-button ${activeTool === 'triangle' ? 'active' : ''}`} onClick={() => setActiveTool('triangle')}><Triangle size={20}/></button>
                <button className={`tool-button ${activeTool === 'square' ? 'active' : ''}`} onClick={() => setActiveTool('square')}><Square size={20}/></button>
                <button className={`tool-button ${activeTool === 'x' ? 'active' : ''}`} onClick={() => setActiveTool('x')}><X size={20}/></button>
                <button className={`tool-button ${activeTool === 'number' ? 'active' : ''}`} onClick={() => setActiveTool('number')}><div style={{fontWeight: 'bold', fontSize: '18px'}}>#</div></button>
                <button className={`tool-button ${showCoords ? 'active' : ''}`} onClick={() => setShowCoords(!showCoords)}><Info size={20}/></button>
                <button className={`tool-button ${showMoveNumbers ? 'active' : ''}`} onClick={() => setShowMoveNumbers(!showMoveNumbers)}><div style={{fontWeight: 'bold', fontSize: '14px'}}>123</div></button>
              </div>
            </div>

            <div className="tool-group">
              <span className="tool-label">调色盘</span>
              <div style={{display: 'flex', gap: 12, padding: '10px 5px'}}>
                {['#000000', '#ffffff', '#d4af37', '#ff4d4f', '#52c41a', '#1890ff'].map(color => (
                  <div 
                    key={color} 
                    onClick={() => setActiveColor(color)}
                    style={{
                      width: 24, height: 24, borderRadius: '50%', background: color, cursor: 'pointer',
                      border: activeColor === color ? '2px solid white' : '2px solid transparent',
                      boxShadow: activeColor === color ? `0 0 8px ${color}` : 'none'
                    }}
                  />
                ))}
              </div>
            </div>
            
            <button className="tool-button" style={{width: '100%', marginBottom: 8}} onClick={() => document.getElementById('sgf-input').click()}>
              <FileUp size={18} /><span>导入棋谱 (SGF)</span>
            </button>
            <input type="file" id="sgf-input" accept=".sgf" style={{display: 'none'}} onChange={handleSGFUpload} />
            
            <button className="tool-button" style={{width: '100%', marginBottom: 8}} onClick={() => {setAnnotations([]); setMarkerCount(1); sendData({ type: 'SYNC', stones: JSON.stringify(Array.from(stones.entries())), turn: currentTurn, annotations: [], moveCount });}}>
              <Eraser size={18} /><span>擦除标记</span>
            </button>

            <button className="tool-button" style={{width: '100%', background: 'rgba(255, 77, 79, 0.1)', color: '#ff4d4f'}} onClick={() => {setStones(new Map()); setAnnotations([]); setMoveCount(0); setMarkerCount(1); sendData({ type: 'SYNC', stones: '[]', turn: 'black', annotations: [], moveCount: 0 });}}>
              <Trash2 size={18} /><span>清空棋盘</span>
            </button>
          </>
        )}
      </aside>
    </div>
  );
};

export default App;
