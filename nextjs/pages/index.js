// $sudo dmesg | grep tty 
//const WEBSOCKET_SERVER_URL = 'ws://192.168.1.82:8080'; // 5 story
//const WEBSOCKET_SERVER_URL = 'ws://172.30.1.69:8080'; // 6 stroy adelpia lab
const WEBSOCKET_SERVER_URL = 'ws://localhost:8081';
//const WEBSOCKET_SERVER_URL = 'ws://192.168.219.107:8080'; //  Shaha

/*
제품명	     제품번호	                검사날짜	   
SSPC 25A - 62520204	 25040001	2025-04-21 9://const WEBSOCKET_SERVER_URL = 'ws://192.168.1.82:8080'; // 5 story
29	  

2.3.1	2.3.2	2.4.1	2.4.2	2.5.1	2.5.2	2.6.1	2.6.2	2.6.3	2.6.4	2.6.5	2.7	
17.94	 0.02 0.05 4.97	 4.97 0.04	10 1535	 465 253	186  0.40	        

검사결과	작업자
양품	장인아
*/
/*
#1 RELAY ON : 010600010100D99A   OFF : 010600010200D96A
#2 RELAY ON : 010600020100299A   OFF : 010600020200296A
#3 RELAY ON : 010600030100785A   OFF : 01060003020078AA
#4 RELAY ON : 010600040100C99B   OFF : 010600040200C96B
#5 RELAY ON : 010600050100985B   OFF : 01060005020098AB

#6 RELAY ON : 020600010100D9A9   OFF: 020600010200D959
#7 RELAY ON : 02060002010029A9   OFF: 0206000202002959
#8 RELAY ON : 0206000301007869   OFF: 0206000302007899
#9 RELAY ON : 020600040100C9A8   OFF: 020600040200C958
#10 RELAY ON : 0206000501009868   OFF: 0206000502009898
*/
import Link from 'next/link';

// Theme is now handled in _app.js for proper SSR

// import * as React from 'react';
import React,{useState, useEffect, useRef} from 'react';



import Image from "next/image";
import { Geist, Geist_Mono } from "next/font/google";
import styles from "/styles/Home.module.css";
import SetVolt from "/components/SetVolt/SetVolt";
import RelayOnOff from "/components/RelayOn/RelayOnOff";
import Button from '@mui/material/Button';

import TextButton from "/components/TextButton/TextButton";
import TestProcess from "/components/TestProcess/TestProcess";
import TestResult from "/components/TestResult/TestResult";
import DeviceSelect from "/components/DeviceSelect/DeviceSelect";
import ReadVolt from "/components/ReadVolt/ReadVolt";
import SystemSet from "/components/SystemSet/SystemSet";
import ReadChamber from "/components/ReadChamber/ReadChamber";
import HighTempSettingPanel from "/components/high-temp-setting-panel/HighTempSettingPanel";
import LowTempSettingPanel from "/components/low-temp-setting-panel/LowTempSettingPanel";
import OutVoltSettingPanel from "/components/OutVoltSettingPanel/OutVoltSettingPanel";

import UsbPortSelect from "/components/UsbPortSelect/UsbPortSelect";
import PowerSwitch from "/components/PowerButton/PowerSwitch";
import GroupImage from "/components/GroupImage/GroupImage";
import dynamic from 'next/dynamic';
import { parsePowerDataFile } from '../lib/parsePowerData';
import ProductInput from "/components/SystemSet/ProductInput";
import OptionSet1 from "/components/OptionSet1/OptionSet1";
import LogoImage from "/components/LogoImage/LogoImage";
import DebugLogoImage from "/components/LogoImage/DebugLogoImage";
import DelaySettingsPanel from "/components/delay-settings-panel/DelaySettingsPanel";
import TestSystemButton from "/components/TestSystem/TestSystemButton";
import ChannelVoltageSettings from "/components/ChannelVoltageSettings/ChannelVoltageSettings";
import TimeModePopup from "/components/TimeModePopup/TimeModePopup";
import TimeProgressWindow from "/components/TimeProgressWindow/TimeProgressWindow";
const PowerTable = dynamic(() => import('../components/power-table/PowerTable'), { ssr: false });
// import WebSocketClient from "/components/WebSocketClient/WebSocketClient";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default function Home(props) {

const [isConnected, setIsConnected] = useState(false);
const [messageInput, setMessageInput] = useState('');
const [receivedMessages, setReceivedMessages] = useState([]);
const [status, setStatus] = useState('연결 대기 중...');
const ws = useRef(null);
const [voltages, setVoltages] = useState([0, 0, 0, 0, 0]);
const [temperature, setTemperature] = useState(null);
const [isWaitingChamberResponse, setIsWaitingChamberResponse] = useState(false);
const [channelVoltages, setChannelVoltages] = useState([5, 15, -15, 24]); // 기본값 설정
const [productNames, setProductNames] = useState([]); // 제품명 상태 추가
const [isTimeModePopupOpen, setIsTimeModePopupOpen] = useState(false);
const [isMeasurementActive, setIsMeasurementActive] = useState(false);
const [hasUserInteracted, setHasUserInteracted] = useState(false);
const [showExitConfirmModal, setShowExitConfirmModal] = useState(false);
const [pendingExit, setPendingExit] = useState(false);
// 시간진행 윈도우 상태
const [showTimeWindow, setShowTimeWindow] = useState(false);
const [testDuration, setTestDuration] = useState(0); // 총 테스트 시간 (분)
const [testStartTime, setTestStartTime] = useState(null); // 테스트 시작 시간

// 시간진행 윈도우 표시/숨김 함수
const showTimeProgressWindow = (duration) => {
  setTestDuration(duration);
  setTestStartTime(Date.now());
  setShowTimeWindow(true);
};

const hideTimeProgressWindow = () => {
  setShowTimeWindow(false);
  setTestDuration(0);
  setTestStartTime(null);
};

  // 디버깅을 위한 로그
console.log('🔌 Main: channelVoltages 상태:', channelVoltages);
console.log('🔌 Main: productNames 상태:', productNames);

// 제품명 로드 useEffect
useEffect(() => {
  const loadProductNames = () => {
    try {
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem('productInput');
        if (stored) {
          const productData = JSON.parse(stored);
          if (productData.productNames && Array.isArray(productData.productNames)) {
            console.log('📥 Main: localStorage에서 제품명 로드:', productData.productNames);
            setProductNames(productData.productNames);
            return;
          }
        }
      }
      
      // 기본값 사용
      const defaultNames = ['PL2222', 'PL2233', 'PL2244', 'PL2255', 'PL2266', 'PL2277', 'PL2288', 'PL2299', 'PL2300', 'PL2311'];
      console.log('📥 Main: 기본 제품명 사용:', defaultNames);
      setProductNames(defaultNames);
    } catch (error) {
      console.error('📥 Main: 제품명 로드 오류:', error);
      // 오류 시 기본값 사용
      const defaultNames = ['PL2222', 'PL2233', 'PL2244', 'PL2255', 'PL2266', 'PL2277', 'PL2288', 'PL2299', 'PL2300', 'PL2311'];
      setProductNames(defaultNames);
    }
  };
  
  loadProductNames();
}, []); // 컴포넌트 마운트 시 한 번만 실행

  // WebSocket 연결 상태 확인 함수
  const isWebSocketReady = () => {
    const isReady = ws.current && ws.current.readyState === WebSocket.OPEN;
    // console.log('WebSocket ready check:', {
    //   hasConnection: !!ws.current,
    //   readyState: ws.current ? ws.current.readyState : 'No connection',
    //   isReady: isReady
    // });
    return isReady;
  };

// 통합된 WebSocket 메시지 처리 함수
const handleWebSocketMessage = (event) => {
  // console.log('📨 WebSocket 메시지 수신:', event.data);
  
  // [POWER_SWITCH] 메시지 처리
  if (typeof event.data === 'string' && event.data.includes('[POWER_SWITCH]')) {
    console.log('🔌 Power switch message received:', event.data);
    // 측정 상태 추적
    if (event.data.includes('ON - Machine running: true') || event.data.includes('STATUS - Machine running: true')) {
      console.log('🔌 Main: 측정 시작 - isMeasurementActive: true');
      setIsMeasurementActive(true);
      // 서버에서 [TIME_PROGRESS] 메시지를 받을 때 윈도우가 표시됨
    } else if (event.data.includes('OFF - Machine running: false') || event.data.includes('STATUS - Machine running: false') || 
               event.data.includes('PROCESS_COMPLETED') || event.data.includes('PROCESS_STOPPED:')) {
      console.log('🔌 Main: 측정 중단 - isMeasurementActive: false');
      setIsMeasurementActive(false);
      // 테스트 중지 시 시간진행 윈도우 숨김
      hideTimeProgressWindow();
      console.log('🔌 Main: 테스터 중단으로 인한 시간진행 윈도우 숨김');
    }
  }
  // [SAVE_PRODUCT_INPUT] 메시지 처리
  else if (typeof event.data === 'string' && event.data.startsWith('[SAVE_PRODUCT_INPUT]')) {
    try {
      const match = event.data.match(/\[SAVE_PRODUCT_INPUT\] (.*)/);
      if (match && match[1]) {
        const productData = JSON.parse(match[1]);
        // console.log('📥 Received product input data from server:', productData);
        
        // localStorage에 저장
        if (typeof window !== 'undefined') {
          localStorage.setItem('productInput', JSON.stringify(productData));
          // console.log('💾 Product input saved to localStorage from server:', productData);
        }
        
        // 제품명 상태 업데이트
        if (productData.productNames && Array.isArray(productData.productNames)) {
          setProductNames(productData.productNames);
          console.log('📥 Product names updated in main component from SAVE_PRODUCT_INPUT:', productData.productNames);
        }
        
        // 성공 메시지를 ProductInput 컴포넌트로 전송
        const successMessage = `[PRODUCT_INPUT_SAVED] ${JSON.stringify(productData)}`;
        ws.current.send(successMessage);
        // console.log('📤 Sent success confirmation to ProductInput component');
      }
    } catch (err) {
      console.error('Failed to parse product input data:', err);
    }
  }
  // [TIME_MODE_SAVED] 메시지 처리
  else if (typeof event.data === 'string' && event.data.startsWith('[TIME_MODE_SAVED]')) {
    try {
      const match = event.data.match(/\[TIME_MODE_SAVED\] (.*)/);
      if (match && match[1]) {
        const timeModeData = JSON.parse(match[1]);
        console.log('📥 TimeMode settings saved successfully:', timeModeData);
        
        // localStorage에 저장
        if (typeof window !== 'undefined') {
          localStorage.setItem('timeModeSettings', JSON.stringify(timeModeData));
          console.log('💾 TimeMode settings saved to localStorage:', timeModeData);
        }
        
        // 팝업 닫기
        handleTimeModeClose();
      }
    } catch (err) {
      console.error('Failed to parse TimeMode saved data:', err);
    }
  }
  // [TIME_MODE_DATA] 메시지 처리 - 서버에서 읽어온 TimeMode 데이터
  else if (typeof event.data === 'string' && event.data.startsWith('[TIME_MODE_DATA]')) {
    try {
      const match = event.data.match(/\[TIME_MODE_DATA\] (.*)/);
      if (match && match[1]) {
        const timeModeData = JSON.parse(match[1]);
        console.log('📥 TimeMode data received from server:', timeModeData);
        
        // localStorage에 저장
        if (typeof window !== 'undefined') {
          localStorage.setItem('timeModeSettings', JSON.stringify(timeModeData));
          console.log('💾 TimeMode settings saved to localStorage:', timeModeData);
        }
      }
    } catch (err) {
      console.error('Failed to parse TimeMode data:', err);
    }
  }
  // [TIME_PROGRESS] 메시지 처리 - 서버에서 총예상시간을 받는 시점에서 윈도우 표시
  else if (typeof event.data === 'string' && event.data.startsWith('[TIME_PROGRESS]')) {
    try {
      const match = event.data.match(/\[TIME_PROGRESS\] (.*)/);
      if (match && match[1]) {
        const timeProgressData = JSON.parse(match[1]);
        
        // 서버에서 받은 totalMinutes로 시간진행 윈도우 표시
        if (timeProgressData.totalMinutes && timeProgressData.totalMinutes > 0) {
          console.log('⏰ 시간진행 윈도우 표시 - 총 시간:', timeProgressData.totalMinutes, '분');
          showTimeProgressWindow(timeProgressData.totalMinutes);
        }
      }
    } catch (err) {
      console.error('⏰ TIME_PROGRESS 데이터 파싱 오류:', err);
    }
  }
  // [TEST_COMPLETED] 메시지 처리 - 테스트 완료 시 시간진행 윈도우 숨김
  else if (typeof event.data === 'string' && event.data.startsWith('[TEST_COMPLETED]')) {
    console.log('🔌 Test completed message received:', event.data);
    hideTimeProgressWindow();
    console.log('🔌 Main: 테스트 완료로 인한 시간진행 윈도우 숨김');
  }
  // [TEST_PROGRESS] 메시지 처리 - 테스트 시작 시 상황창 표시
  else if (typeof event.data === 'string' && event.data.startsWith('[TEST_PROGRESS]')) {
    console.log('🔌 Test progress message received:', event.data);
    
    // 테스트 시작 메시지인지 확인
    if (event.data.includes('테스트 시작 - 시간 모드 테스트 프로세스')) {
      console.log('🔌 Time mode test process started - waiting for server time data');
      // 서버에서 [TIME_PROGRESS] 메시지를 받을 때 윈도우가 표시됨
    }
  }
  // [Voltage data: ...] 메시지 파싱
  else if (typeof event.data === 'string' && event.data.startsWith('Voltage data:')) {
    try {
      const match = event.data.match(/Voltage data: (\[.*\])/);
      if (match && match[1]) {
        const arr = JSON.parse(match[1]);
        if (Array.isArray(arr) && arr.length === 5 && arr.every(v => typeof v === 'number')) {
          setVoltages(arr);
          // console.log('Voltage data updated:', arr);
        }
      }
    } catch (err) {
      console.error('Failed to parse voltage data:', err);
    }
  }
  // [Channel Voltages] 메시지 처리
  else if (typeof event.data === 'string' && event.data.startsWith('[Channel Voltages]')) {
    try {
      const match = event.data.match(/\[Channel Voltages\] (.*)/);
      if (match && match[1]) {
        const voltages = JSON.parse(match[1]);
        console.log('📥 Channel voltages received from server:', voltages);
        setChannelVoltages(voltages);
        
        // localStorage에 저장
        if (typeof window !== 'undefined') {
          localStorage.setItem('channelVoltages', JSON.stringify(voltages));
          console.log('💾 Channel voltages saved to localStorage:', voltages);
        }
      }
    } catch (err) {
      console.error('Failed to parse channel voltages data:', err);
    }
  }
  // [Delay Settings] 메시지 처리
  else if (typeof event.data === 'string' && event.data.startsWith('[Delay Settings]')) {
    try {
      const match = event.data.match(/\[Delay Settings\] (.*)/);
      if (match && match[1]) {
        const delaySettings = JSON.parse(match[1]);
        console.log('📥 Delay settings received from server:', delaySettings);
        
        // localStorage에 저장
        if (typeof window !== 'undefined') {
          localStorage.setItem('delaySettings', JSON.stringify(delaySettings));
          console.log('💾 Delay settings saved to localStorage:', delaySettings);
        }
      }
    } catch (err) {
      console.error('Failed to parse delay settings data:', err);
    }
  }
  // [High Temp Settings] 메시지 처리
  else if (typeof event.data === 'string' && event.data.startsWith('[High Temp Settings]')) {
    try {
      const match = event.data.match(/\[High Temp Settings\] (.*)/);
      if (match && match[1]) {
        const highTempSettings = JSON.parse(match[1]);
        console.log('📥 High temp settings received from server:', highTempSettings);
        
        // localStorage에 저장
        if (typeof window !== 'undefined') {
          localStorage.setItem('highTempSettings', JSON.stringify(highTempSettings));
          console.log('💾 High temp settings saved to localStorage:', highTempSettings);
        }
      }
    } catch (err) {
      console.error('Failed to parse high temp settings data:', err);
    }
  }
  // [Low Temp Settings] 메시지 처리
  else if (typeof event.data === 'string' && event.data.startsWith('[Low Temp Settings]')) {
    try {
      const match = event.data.match(/\[Low Temp Settings\] (.*)/);
      if (match && match[1]) {
        const lowTempSettings = JSON.parse(match[1]);
        console.log('📥 Low temp settings received from server:', lowTempSettings);
        
        // localStorage에 저장
        if (typeof window !== 'undefined') {
          localStorage.setItem('lowTempSettings', JSON.stringify(lowTempSettings));
          console.log('💾 Low temp settings saved to localStorage:', lowTempSettings);
        }
      }
    } catch (err) {
      console.error('Failed to parse low temp settings data:', err);
    }
  }
  // [USB Port Settings] 메시지 처리
  else if (typeof event.data === 'string' && event.data.startsWith('[USB Port Settings]')) {
    try {
      const match = event.data.match(/\[USB Port Settings\] (.*)/);
      if (match && match[1]) {
        const usbPortSettings = JSON.parse(match[1]);
        console.log('📥 USB port settings received from server:', usbPortSettings);
        
        // localStorage에 저장
        if (typeof window !== 'undefined') {
          localStorage.setItem('usbPortSettings', JSON.stringify(usbPortSettings));
          console.log('💾 USB port settings saved to localStorage:', usbPortSettings);
        }
      }
    } catch (err) {
      console.error('Failed to parse USB port settings data:', err);
    }
  }
  // [Out Volt Settings] 메시지 처리
  else if (typeof event.data === 'string' && event.data.startsWith('[Out Volt Settings]')) {
    try {
      const match = event.data.match(/\[Out Volt Settings\] (.*)/);
      if (match && match[1]) {
        const outVoltSettings = JSON.parse(match[1]);
        console.log('📥 Out volt settings received from server:', outVoltSettings);
        
        // localStorage에 저장
        if (typeof window !== 'undefined') {
          localStorage.setItem('outVoltSettings', JSON.stringify(outVoltSettings));
          console.log('💾 Out volt settings saved to localStorage:', outVoltSettings);
        }
      }
    } catch (err) {
      console.error('Failed to parse out volt settings data:', err);
    }
  }
  // [Product Input] 메시지 처리
  else if (typeof event.data === 'string' && event.data.startsWith('[Product Input]')) {
    try {
      const match = event.data.match(/\[Product Input\] (.*)/);
      if (match && match[1]) {
        const productData = JSON.parse(match[1]);
        // console.log('📥 Received product input data from server:', productData);
        
        // localStorage에 저장
        if (typeof window !== 'undefined') {
          localStorage.setItem('productInput', JSON.stringify(productData));
          // console.log('💾 Product input saved to localStorage from server:', productData);
        }
        
        // 제품명 상태 업데이트
        if (productData.productNames && Array.isArray(productData.productNames)) {
          setProductNames(productData.productNames);
          console.log('📥 Product names updated in main component:', productData.productNames);
        }
        
        // 성공 메시지를 ProductInput 컴포넌트로 전송
        const successMessage = `[PRODUCT_INPUT_SAVED] ${JSON.stringify(productData)}`;
        ws.current.send(successMessage);
        // console.log('📤 Sent success confirmation to ProductInput component');
      }
    } catch (err) {
      console.error('Failed to parse product input data:', err);
    }
  }
  // 기타 메시지 처리
  else {
    // console.log('📨 기타 메시지 수신:', event.data);
    setReceivedMessages(prev => [...prev, event.data]);
  }
};

// 안전한 메시지 전송 함수
const sendWebSocketMessage = (message) => {
  if (!isWebSocketReady()) {
    console.error('WebSocket이 연결되지 않았습니다. 연결 상태:', ws.current ? ws.current.readyState : 'No connection');
    return false;
  }
  
  try {
    ws.current.send(message);
    // console.log('WebSocket 메시지 전송 성공:', message);
    return true;
  } catch (error) {
    console.error('WebSocket 메시지 전송 실패:', error);
    return false;
  }
};

useEffect(() => {
  // 이미 연결이 있으면 새로 연결하지 않음
  if (ws.current && ws.current.readyState === WebSocket.OPEN) {
    // console.log('WebSocket 이미 연결되어 있음');
    return;
  }

  // 컴포넌트 마운트 시 WebSocket 연결 시도
  // console.log('WebSocket 연결 시도 중...');
  // console.log('WebSocket URL:', WEBSOCKET_SERVER_URL);
  ws.current = new WebSocket(WEBSOCKET_SERVER_URL);
  // console.log('WebSocket 객체 생성됨:', ws.current);

  // 연결 성공 시
  ws.current.onopen = () => {
    // console.log('✅ WebSocket 서버에 연결되었습니다.');
    // console.log('✅ WebSocket URL:', WEBSOCKET_SERVER_URL);
    // console.log('✅ WebSocket readyState:', ws.current.readyState);
    setIsConnected(true);
    setStatus('연결됨');
    setReceivedMessages(prev => [...prev, '--- 서버에 연결되었습니다! ---']);
  };

  // 메시지 수신 시 - 통합된 메시지 처리 함수 사용
  ws.current.onmessage = handleWebSocketMessage;

  // 에러 발생 시
  ws.current.onerror = (error) => {
    console.error('WebSocket 에러 발생:', error);
    console.error('WebSocket URL:', WEBSOCKET_SERVER_URL);
    console.error('WebSocket readyState:', ws.current ? ws.current.readyState : 'No connection');
    setStatus(`에러: ${error.message || '알 수 없는 오류'} - URL: ${WEBSOCKET_SERVER_URL}`);
    setIsConnected(false);
  };

  // 연결 종료 시
  ws.current.onclose = (event) => {
    // console.log('WebSocket 연결이 종료되었습니다. Code:', event.code, 'Reason:', event.reason);
    setIsConnected(false);
    setStatus('연결 종료됨. 재연결 시도 중...');
    
    // 모든 종료에 대해 재연결 시도 (정상 종료도 포함)
    // console.log('WebSocket 재연결 시도...');
    setTimeout(() => {
      if (ws.current && ws.current.readyState === WebSocket.CLOSED) {
        // console.log('WebSocket 재연결 시도...');
        try {
          ws.current = new WebSocket(WEBSOCKET_SERVER_URL);
          
          // 재연결 시 이벤트 핸들러 다시 설정
          ws.current.onopen = () => {
            // console.log('✅ WebSocket 재연결 성공');
            setIsConnected(true);
            setStatus('재연결됨');
          };
          
          ws.current.onmessage = handleWebSocketMessage;
          
          ws.current.onclose = (event) => {
            // console.log('WebSocket 재연결 후 종료. Code:', event.code, 'Reason:', event.reason);
            setIsConnected(false);
            setStatus('재연결 실패');
          };
          
          ws.current.onerror = (error) => {
            console.error('WebSocket 재연결 에러:', error);
            setIsConnected(false);
            setStatus('재연결 에러');
          };
        } catch (error) {
          console.error('WebSocket 재연결 실패:', error);
        }
      }
    }, 1000); // 1초 후 재연결 시도
  };

  // WebSocket 연결 상태 주기적 확인
  const connectionCheckInterval = setInterval(() => {
    if (ws.current && ws.current.readyState === WebSocket.CLOSED) {
      // console.log('🔄 WebSocket connection lost, attempting to reconnect...');
      try {
        ws.current = new WebSocket(WEBSOCKET_SERVER_URL);
        
        ws.current.onopen = () => {
          // console.log('✅ WebSocket auto-reconnection successful');
          setIsConnected(true);
          setStatus('자동 재연결됨');
        };
        
        ws.current.onmessage = handleWebSocketMessage;
        
        ws.current.onclose = (event) => {
          // console.log('Auto-reconnected WebSocket closed. Code:', event.code, 'Reason:', event.reason);
          setIsConnected(false);
          setStatus('자동 재연결 실패');
        };
        
        ws.current.onerror = (error) => {
          console.error('Auto-reconnected WebSocket error:', error);
          setIsConnected(false);
          setStatus('자동 재연결 에러');
        };
      } catch (error) {
        console.error('WebSocket auto-reconnection failed:', error);
      }
    }
  }, 5000); // 5초마다 연결 상태 확인

  // 컴포넌트 언마운트 시에만 WebSocket 연결 정리
  return () => {
    // console.log('컴포넌트 언마운트 - WebSocket 연결 정리');
    clearInterval(connectionCheckInterval);
    if (ws.current) {
      // 정상적인 종료 코드로 연결 닫기
      ws.current.close(1000, 'Component unmounting');
    }
  };
}, []); // 빈 배열은 컴포넌트 마운트 시 한 번만 실행되도록 합니다.

// 사용자 상호작용 감지를 위한 useEffect (강화된 버전)
useEffect(() => {
  const handleUserInteraction = () => {
    setHasUserInteracted(true);
    console.log('🔌 Main: 사용자 상호작용 감지됨 - beforeunload 이벤트 활성화');
  };

  if (typeof window !== 'undefined') {
    // 다양한 사용자 상호작용 이벤트 감지
    window.addEventListener('click', handleUserInteraction, { once: true });
    window.addEventListener('keydown', handleUserInteraction, { once: true });
    window.addEventListener('mousemove', handleUserInteraction, { once: true });
    window.addEventListener('touchstart', handleUserInteraction, { once: true });
    
    // 페이지 로드 후 1초 뒤에 자동으로 상호작용 활성화 (테스트용)
    const autoActivate = setTimeout(() => {
      if (!hasUserInteracted) {
        console.log('🔌 Main: 자동으로 사용자 상호작용 활성화 (테스트용)');
        setHasUserInteracted(true);
      }
    }, 1000);

    return () => {
      clearTimeout(autoActivate);
    };
  }

  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('click', handleUserInteraction);
      window.removeEventListener('keydown', handleUserInteraction);
      window.removeEventListener('mousemove', handleUserInteraction);
      window.removeEventListener('touchstart', handleUserInteraction);
    }
  };
}, [hasUserInteracted]);

// 강력한 페이지 닫기 방지 시스템 (최신 브라우저 대응)
useEffect(() => {
  const handleBeforeUnload = (event) => {
    console.log('🔌 Main: beforeunload 이벤트 발생');
    
    if (!hasUserInteracted) {
      console.log('🔌 Main: 사용자 상호작용이 없어서 팝업을 표시하지 않음');
      return;
    }
    
    // 커스텀 모달 즉시 표시
    setShowExitConfirmModal(true);
    setPendingExit(true);
    
    // 브라우저 기본 팝업도 시도
    const message = isMeasurementActive 
      ? '현재 측정이 진행 중입니다. 정말로 페이지를 닫으시겠습니까?'
      : '정말로 페이지를 닫으시겠습니까?';
    
    event.preventDefault();
    event.returnValue = message;
    return message;
  };

  const handleKeyDown = (event) => {
    // 페이지 닫기 단축키 감지
    if ((event.altKey && event.key === 'F4') || 
        (event.ctrlKey && (event.key === 'w' || event.key === 'q'))) {
      if (hasUserInteracted) {
        event.preventDefault();
        setShowExitConfirmModal(true);
        setPendingExit(true);
      }
    }
  };

  // 페이지 숨김 감지
  const handleVisibilityChange = () => {
    if (document.hidden && hasUserInteracted && !showExitConfirmModal) {
      console.log('🔌 Main: 페이지가 숨겨짐 - 확인 모달 표시');
      setShowExitConfirmModal(true);
      setPendingExit(true);
    }
  };

  if (typeof window !== 'undefined') {
    // 기본 이벤트들
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // 레거시 방식
    window.onbeforeunload = handleBeforeUnload;
  }
  
  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.onbeforeunload = null;
    }
  };
}, [isMeasurementActive, hasUserInteracted, showExitConfirmModal]);

// 사용자 상호작용 기반 경고 시스템 (최신 브라우저 대응)
useEffect(() => {
  console.log('🔌 Main: 경고 시스템 초기화 - hasUserInteracted:', hasUserInteracted);
  
  // 사용자가 페이지를 떠나려고 할 때 즉시 감지
  const handleBeforeUnload = (event) => {
    console.log('🔌 Main: beforeunload 이벤트 발생!');
    console.log('🔌 Main: hasUserInteracted:', hasUserInteracted);
    console.log('🔌 Main: isMeasurementActive:', isMeasurementActive);
    
    if (!hasUserInteracted) {
      console.log('🔌 Main: 사용자 상호작용이 없어서 경고를 표시하지 않음');
      return;
    }
    
    console.log('🔌 Main: 경고 모달 표시 시도');
    
    // 즉시 커스텀 모달 표시
    setShowExitConfirmModal(true);
    setPendingExit(true);
    
    // 브라우저 기본 팝업도 시도
    const message = isMeasurementActive 
      ? '현재 측정이 진행 중입니다. 정말로 페이지를 닫으시겠습니까?'
      : '정말로 페이지를 닫으시겠습니까?';
    
    console.log('🔌 Main: 브라우저 기본 팝업 메시지:', message);
    
    event.preventDefault();
    event.returnValue = message;
    return message;
  };

  // 키보드 단축키 감지
  const handleKeyDown = (event) => {
    if ((event.altKey && event.key === 'F4') || 
        (event.ctrlKey && (event.key === 'w' || event.key === 'q'))) {
      console.log('🔌 Main: 페이지 닫기 단축키 감지:', event.key);
      if (hasUserInteracted) {
        event.preventDefault();
        setShowExitConfirmModal(true);
        setPendingExit(true);
      }
    }
  };

  // 페이지 숨김 감지 (탭 전환 등)
  const handleVisibilityChange = () => {
    console.log('🔌 Main: visibilitychange 이벤트 - document.hidden:', document.hidden);
    if (document.hidden && hasUserInteracted && !showExitConfirmModal) {
      console.log('🔌 Main: 페이지가 숨겨짐 - 확인 모달 표시');
      setShowExitConfirmModal(true);
      setPendingExit(true);
    }
  };

  if (typeof window !== 'undefined') {
    console.log('🔌 Main: 이벤트 리스너 등록 중...');
    
    // 이벤트 리스너 등록
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // 레거시 방식
    window.onbeforeunload = handleBeforeUnload;
    
    console.log('🔌 Main: 이벤트 리스너 등록 완료');
  }

  return () => {
    if (typeof window !== 'undefined') {
      console.log('🔌 Main: 이벤트 리스너 정리 중...');
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.onbeforeunload = null;
    }
  };
}, [isMeasurementActive, hasUserInteracted, showExitConfirmModal]);

// 메시지 전송 핸들러
const sendMessage = () => {
  if (ws.current && ws.current.readyState === WebSocket.OPEN && messageInput.trim() !== '') {
    // console.log('메시지 전송:', messageInput);
    ws.current.send(messageInput);
    setMessageInput(''); // 입력 필드 초기화
  } else {
    setStatus('메시지를 보낼 수 없습니다. 연결 상태를 확인하세요.');
  }
};

	const [deviceSelectedValue, setDeviceSelectedValue] = useState('#1 Device');
	const [voltSelectValue, setVoltSelectedValue] = useState('PowerOff');
	const [selectedDevices, setSelectedDevices] = useState([0]); // 선택된 디바이스 인덱스 배열 (기본값: #1 Device)

  const handleSelectionFromDeviceSelect = (selectedDeviceIndices) => {
    console.log("DeviceSelect: 선택된 디바이스 인덱스:", selectedDeviceIndices);
    setSelectedDevices(selectedDeviceIndices);
  };

  const handleSelectionFromVoltSelect = (newValue) => {
    // console.log("VoltSelect: 하위 컴포넌트로부터 전달받은 값:", newValue);
    const messageWithIdentifier = `[VOLT_SELECT] ${newValue}`;
    sendWebSocketMessage(messageWithIdentifier);
  };

  const handleTestProcessSelect = (newValue) => {
    // console.log("TestProcess: 하위 컴포넌트로부터 전달받은 값:", newValue);
    const messageWithIdentifier = `[TEST_PROCESS] ${newValue}`;
    sendWebSocketMessage(messageWithIdentifier);
  };

  const handleReadVoltClick = () => {
    // console.log("ReadVolt: READ 버튼이 클릭되었습니다.");
    const messageWithIdentifier = `[READ_VOLT] OK`;
    sendWebSocketMessage(messageWithIdentifier);
  };

  const handleReadChamberClick = () => {
    // console.log("ReadChamber: READ 버튼이 클릭되었습니다.");
    const messageWithIdentifier = `[READ_CHAMBER] OK`;
    if (sendWebSocketMessage(messageWithIdentifier)) {
      setIsWaitingChamberResponse(true); // 응답 대기 상태로 전환
    }
  };

  const handleTestButtonClick = () => {
    // console.log("SystemSet: TEST 버튼이 클릭되었습니다.");
    const messageWithIdentifier = `[TEST_BUTTON] OK`;
    sendWebSocketMessage(messageWithIdentifier);
  };

  const handleUsbPortSelection = (deviceType, port) => {
    // console.log(`UsbPortSelect: ${deviceType} 기기의 USB 포트가 ${port}로 설정되었습니다.`);
    // USB 포트 설정은 이제 컴포넌트 내부에서 WebSocket을 통해 직접 처리됩니다.
  };

  // TimeModePopup handlers
  const handleTimeModeButtonClick = () => {
    console.log('TimeMode button clicked, opening popup');
    setIsTimeModePopupOpen(true);
  };

  const handleTimeModeSave = (timeValues, isTimeModeEnabled) => {
    console.log('TimeMode: 저장된 시간 값들:', timeValues);
    console.log('TimeMode: 활성화 상태:', isTimeModeEnabled);
    
    // 시간 값과 활성화 상태를 함께 서버로 전송
    const timeModeSettings = {
      ...timeValues,
      isTimeModeEnabled: isTimeModeEnabled
    };
    
    const messageWithIdentifier = `[TIME_MODE] ${JSON.stringify(timeModeSettings)}`;
    sendWebSocketMessage(messageWithIdentifier);
    
    // localStorage에도 저장
    if (typeof window !== 'undefined') {
      localStorage.setItem('timeModeSettings', JSON.stringify(timeModeSettings));
      console.log('TimeMode: localStorage에 설정 저장됨:', timeModeSettings);
    }
    
    // 옵션 저장 완료
    console.log('🔌 Main: TimeMode 옵션 저장 완료');
  };

  const handleTimeModeClose = () => {
    setIsTimeModePopupOpen(false);
  };

  // 페이지 닫기 확인 모달 핸들러
  const handleExitConfirm = () => {
    console.log('🔌 Main: 사용자가 페이지 닫기를 확인함');
    setShowExitConfirmModal(false);
    setPendingExit(false);
    // 실제로 페이지를 닫기
    if (typeof window !== 'undefined') {
      window.close();
    }
  };

  const handleExitCancel = () => {
    console.log('🔌 Main: 사용자가 페이지 닫기를 취소함');
    setShowExitConfirmModal(false);
    setPendingExit(false);
  };



  return (
    <div className={styles.container}>
        <header className={styles.header}>
            <div className={styles.headerItem}>
              <LogoImage 
                src="/img/adelLogo.png" 
                alt="Adel Logo" 
              />
            </div>
            <div className={styles.headerItem}> 아델피아랩 차기 전차  컨버터  환경 시험</div>

            <div className={styles.headerItem}>
              <div className={styles.boxJsk}>
                <div className={styles.loader8}></div>
              </div>
            </div>

            <div className={styles.headerItem} style={{ backgroundColor: 'black' }}>
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', width: '100%', overflow: 'hidden' }}>
                <PowerSwitch wsConnection={ws.current} />
              </div>
            </div>

        </header>

        <main className={styles.bodyContent}>
          <div className={styles.bodyItem}>
            <DeviceSelect 
              initialValue="#1 Device" 
              onSelectionChange={handleSelectionFromDeviceSelect} 
              wsConnection={ws.current}
              onTimeModeClick={handleTimeModeButtonClick}
            />
          </div>
          <div className={styles.bodyItem}>
            <PowerTable 
              groups={props.powerGroups || []} 
              wsConnection={ws.current} 
              channelVoltages={channelVoltages} // 동적으로 받은 channelVoltages 설정값
              selectedDevices={selectedDevices} // 선택된 디바이스 인덱스 배열
              productNames={productNames} // 제품명 배열
            />
            {/* 디버깅용 정보 표시 - 숨김 처리 */}
            {/* <div style={{ 
              position: 'absolute', 
              top: '10px', 
              left: '10px', 
              backgroundColor: 'rgba(0,0,0,0.8)', 
              color: 'white', 
              padding: '5px', 
              fontSize: '10px',
              borderRadius: '4px'
            }}>
              ChannelVoltages: {JSON.stringify(channelVoltages)}<br/>
              SelectedDevices: {JSON.stringify(selectedDevices)}
            </div> */}

            {/* 디버깅용 정보 표시 */}
            <div style={{ 
              position: 'absolute', 
              top: '10px', 
              right: '10px', 
              backgroundColor: 'rgba(0,0,0,0.8)', 
              color: 'white', 
              padding: '5px', 
              fontSize: '10px',
              borderRadius: '4px'
            }}>
              WebSocket: {ws.current?.readyState === WebSocket.OPEN ? '🟢 연결됨' : '🔴 연결안됨'}
            </div>
          </div>
        </main>

        <footer className={styles.footer}>
            <div className={styles.footerItem} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', padding: '4px 10px 10px 10px' }}> 
              <ProductInput wsConnection={ws.current} /> 
              <DelaySettingsPanel wsConnection={ws.current} />
              <ChannelVoltageSettings wsConnection={ws.current} />
              <TestSystemButton wsConnection={ws.current} />
              <TimeProgressWindow 
                isVisible={showTimeWindow}
                testDuration={testDuration}
                testStartTime={testStartTime}
              />
            </div>
            <div className={styles.footerItem} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '4px 10px 10px 10px' }}> 
              <OutVoltSettingPanel wsConnection={ws.current} />            
            </div>
            <div className={styles.footerItem} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '4px 10px 10px 10px' }}> 
              {/* <SetVolt initialValue="PowerOff" onSelectionChange={ handleSelectionFromVoltSelect } /> */}
              <HighTempSettingPanel wsConnection={ws.current} />
            </div>
            <div className={styles.footerItem} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '4px 10px 10px 10px' }}>          
              <LowTempSettingPanel wsConnection={ws.current} />
            </div>
            <div className={styles.footerItem} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '4px 10px 10px 10px' }}> 
              <UsbPortSelect wsConnection={ws.current} onSelectionChange={handleUsbPortSelection} />
            </div>
        </footer>

        {/* TimeModePopup Modal */}
        <TimeModePopup
          isOpen={isTimeModePopupOpen}
          onClose={handleTimeModeClose}
          onSave={handleTimeModeSave}
          wsConnection={ws.current}
        />

        {/* 페이지 닫기 확인 모달 */}
        {showExitConfirmModal && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 9999
          }}>
            <div style={{
              backgroundColor: '#1D1D1D',
              padding: '30px',
              borderRadius: '10px',
              border: '2px solid #90CAF9',
              maxWidth: '400px',
              textAlign: 'center',
              color: '#E0E0E0'
            }}>
              <h3 style={{ marginBottom: '20px', color: '#90CAF9' }}>
                {isMeasurementActive ? '⚠️ 측정 진행 중 - 브라우저 닫기' : '⚠️ 브라우저 닫기'}
              </h3>
              <p style={{ marginBottom: '30px', fontSize: '16px' }}>
                {isMeasurementActive 
                  ? '현재 측정이 진행 중입니다.\n정말로 브라우저를 닫으시겠습니까?'
                  : '정말로 브라우저를 닫으시겠습니까?'
                }
              </p>
              <div style={{ display: 'flex', gap: '15px', justifyContent: 'center' }}>
                <button
                  onClick={handleExitConfirm}
                  style={{
                    backgroundColor: '#f44336',
                    color: 'white',
                    border: 'none',
                    padding: '10px 20px',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 'bold'
                  }}
                >
                  닫기
                </button>
                <button
                  onClick={handleExitCancel}
                  style={{
                    backgroundColor: '#4CAF50',
                    color: 'white',
                    border: 'none',
                    padding: '10px 20px',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 'bold'
                  }}
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
  );
}

export async function getServerSideProps() {
  const powerGroups = await parsePowerDataFile();
  return { props: { powerGroups } };
}
