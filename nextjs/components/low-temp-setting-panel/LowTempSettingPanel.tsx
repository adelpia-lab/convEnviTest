import React, { useState, useEffect } from 'react';
import { z } from 'zod';
import { Button, Switch, Typography } from '@mui/material';

// Zod 스키마 정의
const lowTempSchema = z.object({
  lowTemp: z.boolean(), // 새 토글 항목
  targetTemp: z.number().min(-50).max(30),
  waitTime: z.number().min(1).max(999),
  readCount: z.number().min(1).max(10),
});

type LowTempSetting = z.infer<typeof lowTempSchema>;

/**
 * 저온 측정 설정 패널
 * @param onSave 저장 시 호출되는 콜백 (옵션)
 * @param wsConnection WebSocket 연결 객체
 */
export default function LowTempSettingPanel({ 
  onSave, 
  wsConnection 
}: { 
  onSave?: (data: LowTempSetting) => void;
  wsConnection?: WebSocket;
}) {
  // localStorage에서 저장된 값을 가져오거나 기본값 사용
  const getStoredLowTempSettings = (): LowTempSetting => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('lowTempSettings');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          const result = lowTempSchema.safeParse(parsed);
          if (result.success) {
            // console.log('💾 Loaded low temp settings from localStorage:', parsed);
            return parsed;
          }
        } catch (error) {
          // console.error('Failed to parse stored low temp settings:', error);
        }
      }
    }
    // 기본값 - lowTemp off 상태
    const defaultSettings: LowTempSetting = {
      lowTemp: false, // 새 토글 항목, 기본값 false
      targetTemp: -32,
      waitTime: 200,
      readCount: 10,
    };
    // console.log('💾 Using default low temp settings:', defaultSettings);
    return defaultSettings;
  };

  // UI 토글 상태 (렌더링용, 저장X)
  const [isLowTempEnabled, setIsLowTempEnabled] = useState(true); // 항상 활성화
  const [form, setForm] = useState<LowTempSetting>(() => {
    const initialSettings = getStoredLowTempSettings();
    return initialSettings;
  });
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false); // 초기값을 false로 변경
  const [isSaved, setIsSaved] = useState(false);

  // 컴포넌트 마운트 시 저장된 값 로드 및 백엔드에서 설정 가져오기
  useEffect(() => {
    // console.log("🚀 LowTempSettingPanel component mounting - waiting for server initial state...");
    // console.log("🔌 WebSocket connection provided:", wsConnection ? 'Yes' : 'No');
    
    // 먼저 localStorage에서 임시로 로드
    const storedSettings = getStoredLowTempSettings();
    // console.log("💾 Loaded low temp settings from localStorage as fallback:", storedSettings);
    
    // 저장된 상태를 그대로 사용
    const safeSettings = {
      ...storedSettings,
      lowTemp: storedSettings.lowTemp // 저장된 상태 유지
    };
    // console.log('🔄 Setting initial low temp settings with stored state:', safeSettings);
    setForm(safeSettings);
    
    // 서버에서 자동으로 초기 상태를 전송하므로 로딩 상태만 설정
    if (wsConnection) {
      // console.log("🔌 WebSocket readyState:", wsConnection.readyState);
      if (wsConnection.readyState === WebSocket.OPEN) {
        // console.log('🔌 WebSocket connected, waiting for initial low temp settings from server...');
        setIsLoading(true);
        
        // 5초 후에도 응답이 없으면 로딩 상태 해제
        setTimeout(() => {
          setIsLoading(false);
          // console.log('⏰ Timeout reached, using localStorage data');
        }, 5000);
      } else if (wsConnection.readyState === WebSocket.CONNECTING) {
        // console.log('🔌 WebSocket connecting, waiting for connection...');
        setIsLoading(true);
        
        // 연결 대기 중에도 5초 타임아웃 설정
        setTimeout(() => {
          setIsLoading(false);
          // console.log('⏰ Connection timeout, using localStorage data');
        }, 5000);
      } else {
        // console.log('❌ WebSocket not ready, using localStorage data only');
        // console.log('❌ WebSocket readyState:', wsConnection.readyState);
        setIsLoading(false);
      }
    } else {
      // console.log('❌ No WebSocket connection available, using localStorage data only');
      setIsLoading(false);
    }
  }, [wsConnection]);

  // WebSocket 메시지 리스너 설정
  useEffect(() => {
    if (!wsConnection) {
      // console.log("❌ LowTempSettingPanel: No WebSocket connection available");
      return;
    }

    // console.log("🔌 LowTempSettingPanel: Setting up WebSocket message listener for low temp settings");

    const handleMessage = (event) => {
      const message = event.data;
      // console.log("📥 LowTempSettingPanel received WebSocket message:", message);
      
      // 서버에서 초기 저온 설정 응답 처리 (연결 시 자동 전송)
      if (typeof message === 'string' && message.startsWith('Initial low temp settings:')) {
        // console.log("📥 Processing initial low temp settings message from server");
        // console.log("📥 Raw message:", message);
        
        try {
          const match = message.match(/Initial low temp settings: (.*)/);
          if (match && match[1]) {
            // console.log("📥 Extracted JSON string:", match[1]);
            const initialSettings = JSON.parse(match[1]);
            // console.log('📥 Parsed initial settings:', initialSettings);
            
            const result = lowTempSchema.safeParse(initialSettings);
            if (result.success) {
              // console.log('📥 Received valid initial low temp settings from server:', initialSettings);
              
              // 서버에서 받은 초기 데이터로 상태 업데이트 (저장된 상태 유지)
              const safeServerSettings = {
                ...initialSettings,
                lowTemp: initialSettings.lowTemp // 서버 데이터의 저장된 상태 유지
              };
              // console.log('🔄 Setting form to server data with stored state:', safeServerSettings);
              setForm(safeServerSettings);
              
              // localStorage에도 저장 (저장된 상태 유지)
              if (typeof window !== 'undefined') {
                localStorage.setItem('lowTempSettings', JSON.stringify(safeServerSettings));
                // console.log('💾 Updated localStorage with stored state:', safeServerSettings);
              }
              
              // 로딩 상태 해제
              setIsLoading(false);
              // console.log('✅ Initial low temp settings loaded successfully from server');
            } else {
              // console.log('❌ Server returned invalid low temp settings, using default');
              setIsLoading(false);
            }
          } else {
            // console.log('❌ No initial low temp settings found on server, using default');
            setIsLoading(false);
          }
        } catch (error) {
          // console.error('❌ Failed to parse initial low temp settings from server:', error);
          // console.error('❌ Error details:', error.message);
          setIsLoading(false);
        }
      }
      
      // 저온 설정 저장 확인 응답 처리
      if (typeof message === 'string' && message.startsWith('Low temp settings saved:')) {
        // console.log("✅ Processing low temp settings saved confirmation from server");
        try {
          const match = message.match(/Low temp settings saved: (.*)/);
          if (match && match[1]) {
            const savedSettings = JSON.parse(match[1]);
            // console.log('✅ Low temp settings successfully saved to server:', savedSettings);
            setIsSaved(true);
            // 3초 후 저장 상태 리셋
            setTimeout(() => {
              setIsSaved(false);
            }, 3000);
          }
        } catch (error) {
          // console.error('❌ Failed to parse low temp settings saved response from server:', error);
        }
      }
      
      // 에러 메시지 처리
      if (typeof message === 'string' && message.startsWith('Error:')) {
        // console.error('Server returned error:', message);
      }
    };

    wsConnection.addEventListener('message', handleMessage);
    
    return () => {
      // console.log("LowTempSettingPanel: Removing WebSocket message listener");
      wsConnection.removeEventListener('message', handleMessage);
    };
  }, [wsConnection]);

  // form 상태 변화 추적
  useEffect(() => {
    // console.log('🔄 Form state changed:', form);
    // console.log('🔄 isLowTempEnabled:', isLowTempEnabled);
    // console.log('🔄 isLoading:', isLoading);
    // console.log('🔄 SAVE button disabled:', !isLowTempEnabled || isLoading);
  }, [form, isLoading, isLowTempEnabled]);

  // 토글 스위치 핸들러 (UI용)
  const handleLowTempToggle = (checked: boolean) => {
    setIsLowTempEnabled(checked);
  };

  // 기존 handleChange는 lowTemp 등 저장용 항목만 처리
  const handleChange = (key: keyof LowTempSetting, value: any) => {
    setForm((prev) => {
      const newForm = { ...prev, [key]: value };
      return newForm;
    });
  };

  const handleSave = () => {
    // 저장 시 lowTemp만 저장, isLowTempEnabled는 저장X
    const result = lowTempSchema.safeParse(form);
    if (!result.success) {
      setError('입력값을 확인하세요.');
      return;
    }
    setError(null);
    
    console.log('💾 [LowTempSettingPanel] Saving settings:', form);
    console.log('💾 [LowTempSettingPanel] Form validation result:', result.success);
    
    // 1. localStorage에 저장
    if (typeof window !== 'undefined') {
      localStorage.setItem('lowTempSettings', JSON.stringify(form));
      console.log('💾 [LowTempSettingPanel] Saved to localStorage:', form);
    }
    
    // 2. 서버에 저장
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
      try {
        const message = `[SAVE_LOW_TEMP_SETTINGS] ${JSON.stringify(form)}`;
        console.log('📤 [LowTempSettingPanel] Sending message to server:', message);
        console.log('📤 [LowTempSettingPanel] WebSocket state:', wsConnection.readyState);
        
        wsConnection.send(message);
        console.log('✅ [LowTempSettingPanel] Message sent successfully');
      } catch (error) {
        console.error('❌ [LowTempSettingPanel] Failed to send message to server:', error);
        console.warn('❌ [LowTempSettingPanel] WebSocket connection may be unstable');
        
        // 연결 상태 재확인
        if (wsConnection) {
          console.warn('❌ [LowTempSettingPanel] Current WebSocket state:', wsConnection.readyState);
          console.warn('❌ [LowTempSettingPanel] WebSocket readyState values: CONNECTING=0, OPEN=1, CLOSING=2, CLOSED=3');
        }
      }
    } else {
      console.warn('❌ [LowTempSettingPanel] WebSocket not connected - cannot save to server');
      console.warn('❌ [LowTempSettingPanel] WebSocket state:', wsConnection ? wsConnection.readyState : 'No connection');
      console.warn('❌ [LowTempSettingPanel] WebSocket readyState values: CONNECTING=0, OPEN=1, CLOSING=2, CLOSED=3');
      
      // 연결이 끊어진 경우 재연결 시도 안내
      if (wsConnection && wsConnection.readyState === WebSocket.CLOSED) {
        console.warn('❌ [LowTempSettingPanel] WebSocket connection is closed. Please refresh the page to reconnect.');
      }
    }
    
    // 3. 상위 컴포넌트 콜백 호출
    onSave?.(form);
    console.log("📋 [LowTempSettingPanel] Settings saved successfully");
    
    // 4. 저장 상태 표시
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <div
      className="w-[260px] h-[240px] bg-white rounded-xl shadow flex flex-col items-center justify-between p-3 box-border text-gray-800"
      style={{ fontFamily: 'inherit', marginTop: '15px', marginLeft: '5px' }}
    >
      <div className="flex items-center w-full justify-between mb-2">
        <span className="font-medium px-2 py-1" style={{ fontSize: '1.5rem' }}>저온측정설정 </span>
        <Switch
          checked={isLowTempEnabled}
          onChange={e => handleLowTempToggle(e.target.checked)}
          sx={{
            '& .MuiSwitch-switchBase.Mui-checked': {
              color: '#9333ea',
              '&:hover': { backgroundColor: 'rgba(147, 51, 234, 0.08)' },
            },
            '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
              backgroundColor: '#9333ea',
            },
          }}
        />
      </div>
  
  
      <div className="flex items-center w-full justify-between mb-2 gap-2">
        {/* 저온 측정토글 - 저장된 상태 표시 */}
        <span className="font-medium px-2 py-1" style={{ fontSize: '1.2rem' }}>저온측정</span>
        <Switch
          checked={form.lowTemp}
          onChange={e => handleChange('lowTemp', e.target.checked)}
          sx={{
            '& .MuiSwitch-switchBase.Mui-checked': {
              color: '#9333ea',
              '&:hover': { backgroundColor: 'rgba(147, 51, 234, 0.08)' },
            },
            '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
              backgroundColor: '#9333ea',
            },
          }}
        />
      </div>
      {/* 저온 설정 */}
      <div className="flex items-center w-full justify-between mb-2 gap-2">
        <span className="font-medium px-2 py-1 mb-2" style={{ fontSize: '1.2rem' }}>저온 설정</span>
        <input
          type="number"
          className="text-right border border-gray-400 rounded px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-purple-400"
          value={form.targetTemp}
          min={-50}
          max={30}
          onChange={e => handleChange('targetTemp', Number(e.target.value))}
          disabled={!isLowTempEnabled}
          style={{ fontSize: '1.5rem', width: '80px', minWidth: '80px', maxWidth: '80px' }}
        />
        <span style={{ fontSize: '1.2rem' }}>℃</span>
      </div>

      {/* 대기 시간 */}
      <div className="flex items-center w-full justify-between mb-2">
        <span className="font-medium px-2 py-1" style={{ fontSize: '1.2rem' }}>대기 시간</span>
        <input
            type="number"
            className="text-right border border-gray-400 rounded px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-purple-400"
            value={form.waitTime}
            min={1}
            max={999}
            onChange={e => handleChange('waitTime', Number(e.target.value))}
            disabled={!isLowTempEnabled}
            style={{ fontSize: '1.5rem', width: '80px', minWidth: '80px', maxWidth: '80px' }}
        />
          <span style={{ fontSize: '1.2rem' }}>분</span>
      </div>

      {/* 읽기 횟수 */}
      <div className="flex items-center w-full justify-between mb-2">
      <span className="font-medium px-2 py-1" style={{ fontSize: '1.2rem' }}>ON/OFF</span>
          <input
            type="number"
            className="text-right border border-gray-400 rounded px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-purple-400"
            value={form.readCount}
            min={1}
            max={10}
            onChange={e => handleChange('readCount', Number(e.target.value))}
            disabled={!isLowTempEnabled} 
            style={{ fontSize: '1.5rem', width: '80px', minWidth: '80px', maxWidth: '80px' }}
            />
          <span style={{ fontSize: '1.2rem' }}>회</span>
    </div>

    {/* 상태 메시지 */}
    <div className="flex items-center justify-center mb-2">
      {isLoading && (
        <Typography 
          variant="caption" 
          color="info.main" 
          sx={{ fontSize: '0.8rem' }}
        >
          로딩 중...
        </Typography>
      )}
      {isSaved && (
        <Typography 
          variant="caption" 
          color="success.main" 
          sx={{ fontSize: '0.8rem' }}
        >
          저장됨 ✓
        </Typography>
      )}
      {error && (
        <Typography 
          variant="caption" 
          color="error.main" 
          sx={{ fontSize: '0.8rem' }}
        >
          {error}
        </Typography>
      )}
    </div>
    
    {/* SAVE 버튼 */}
    <Button
      variant="outlined" 
      onClick={handleSave}
      size="large"
      sx={{ 
        width: '120px',
        opacity: (isLoading || !isLowTempEnabled) ? 0.3 : 1, // 로딩 중이거나 저온측정설정이 off일 때 투명하게
        cursor: (isLoading || !isLowTempEnabled) ? 'not-allowed' : 'pointer',
        backgroundColor: (isLoading || !isLowTempEnabled) ? '#e0e0e0' : 'transparent', // 로딩 중이거나 저온측정설정이 off일 때 회색으로
        color: (isLoading || !isLowTempEnabled) ? '#666' : 'inherit', // 로딩 중이거나 저온측정설정이 off일 때 어둡게
        pointerEvents: (isLoading || !isLowTempEnabled) ? 'none' : 'auto' // 클릭 완전 차단
      }}
      disabled={isLoading || !isLowTempEnabled} 
    >
      SAVE
    </Button>
  </div>
);
} 