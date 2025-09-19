// components/power-table/PowerTable.tsx
'use client';
import React, { useState, useEffect, useCallback } from 'react';
import type { PowerDataGroup } from '../../lib/parsePowerData';

interface PowerTableProps {
  groups: PowerDataGroup[];
  wsConnection?: WebSocket | null;
  channelVoltages?: number[]; // 채널 전압 설정 추가
  selectedDevices?: number[]; // 선택된 디바이스 인덱스 배열
  productNames?: string[]; // 제품명 배열 추가
}

interface VoltageData {
  device: number;
  voltageTest: number;
  channels: Array<{
    device: number;
    channel: number;
    voltage: number | string;
    expected: number;
    result: string;
    voltageWithComparison: string;
  }>;
  inputVoltage: number;
  rowIndex: number;
  testIndex: number;
}

// 누적 테이블 데이터 인터페이스
interface AccumulatedTableData {
  [deviceKey: string]: {
    [testKey: string]: {
      [channelKey: string]: string;
    };
  };
}

export default function PowerTable({ groups, wsConnection, channelVoltages = [5, 15, -15, 24], selectedDevices = [0], productNames = [] }: PowerTableProps) {
  // 디버깅을 위한 로그
  console.log('🔌 PowerTable: 컴포넌트 렌더링, channelVoltages:', channelVoltages);
  console.log('🔌 PowerTable: 선택된 디바이스:', selectedDevices);
  console.log('🔌 PowerTable: 제품명:', productNames);
  
  // 제품명 상태 관리
  const [deviceNames, setDeviceNames] = useState<string[]>([]);
  
  // 누적 전압 데이터 상태
  const [accumulatedVoltageData, setAccumulatedVoltageData] = useState<AccumulatedTableData>({});
  
  // 테이블 완성도 추적 상태
  const [tableCompletionStatus, setTableCompletionStatus] = useState<{
    totalCells: number;
    filledCells: number;
    completionPercentage: number;
    isComplete: boolean;
    lastUpdate?: number;
    lastForceUpdate?: number;
  }>({
    totalCells: 0,
    filledCells: 0,
    completionPercentage: 0,
    isComplete: false
  });

  const [chamberTemperature, setChamberTemperature] = useState<number | null>(null);
  const [processLogs, setProcessLogs] = useState<string[]>([]);
  const [currentCycle, setCurrentCycle] = useState<number | null>(null);
  const [cycleMessage, setCycleMessage] = useState<string>('');
  
  // 사이클 및 테스트 진행 상황 추적을 위한 상태 변수들
  const [totalCycles, setTotalCycles] = useState<number>(0);
  const [testPhase, setTestPhase] = useState<'high_temp' | 'low_temp' | 'none'>('none');
  const [currentTestNumber, setCurrentTestNumber] = useState<number>(0);
  const [totalTestCount, setTotalTestCount] = useState<number>(0);
  const [testStatus, setTestStatus] = useState<'ON' | 'OFF' | 'none'>('none');
  
  // 테스트 진행상황 메시지 보호를 위한 상태
  const [testProgressMessage, setTestProgressMessage] = useState<string>('');
  const [isTestProgressActive, setIsTestProgressActive] = useState<boolean>(false);
  
  // 테이블 상태 관리 개선
  const [isTableStable, setIsTableStable] = useState<boolean>(true);
  const [lastTableUpdate, setLastTableUpdate] = useState<number>(Date.now());
  
  // 테이블 완성도 계산 함수 개선
  const calculateTableCompletion = (data: AccumulatedTableData) => {
    try {
      // 선택된 디바이스 수에 따라 총 셀 수 계산
      const totalCells = selectedDevices.length * 3 * 4; // 선택된 디바이스 수 * 3개 테스트 * 4개 채널
      let filledCells = 0;
      let validDataCount = 0;
      
      // 데이터 구조 검증
      if (!data || typeof data !== 'object') {
        console.warn('PowerTable: 잘못된 데이터 구조:', data);
        return {
          totalCells,
          filledCells: 0,
          completionPercentage: 0,
          isComplete: false
        };
      }
      
      // 선택된 디바이스만 처리
      selectedDevices.forEach(deviceIndex => {
        const deviceKey = `device${deviceIndex + 1}`;
        const deviceData = data[deviceKey];
        
        if (deviceData && typeof deviceData === 'object') {
          Object.values(deviceData).forEach(testData => {
            if (testData && typeof testData === 'object') {
              Object.values(testData).forEach(channelData => {
                if (channelData && channelData !== '-.-' && channelData !== '') {
                  filledCells++;
                  // 유효한 전압 데이터인지 확인 (숫자+V 형식)
                  if (typeof channelData === 'string' && channelData.match(/^[\d.-]+V$/)) {
                    // 전압값 범위 검증 (0.1V ~ 100V)
                    const voltageValue = parseFloat(channelData.replace('V', ''));
                    if (!isNaN(voltageValue) && voltageValue >= 0.1 && voltageValue <= 100) {
                      validDataCount++;
                    }
                  }
                }
              });
            }
          });
        }
      });
      
      // 완성도 계산 개선: 유효한 데이터가 90% 이상이고 최소 선택된 디바이스의 80% 이상의 셀이 채워져야 완성으로 간주
      const completionPercentage = (filledCells / totalCells) * 100;
      const validDataPercentage = (validDataCount / totalCells) * 100;
      
      // 완성 조건 강화: 95% 이상의 셀이 채워지고, 90% 이상이 유효한 데이터여야 함
      const minRequiredCells = Math.ceil(totalCells * 0.8); // 최소 80% 이상의 셀이 채워져야 함
      const isComplete = completionPercentage >= 95 && validDataPercentage >= 90 && filledCells >= minRequiredCells;
      
      return {
        totalCells,
        filledCells,
        completionPercentage,
        isComplete
      };
    } catch (error) {
      console.error('PowerTable: calculateTableCompletion 오류:', error);
      return {
        totalCells: selectedDevices.length * 3 * 4,
        filledCells: 0,
        completionPercentage: 0,
        isComplete: false
      };
    }
  };

  // 전압 데이터 누적 함수 개선
  const accumulateVoltageData = (newData: VoltageData) => {
    try {
      // 입력 데이터 검증
      if (!newData || !newData.device || !newData.voltageTest || !newData.channels) {
        console.warn('PowerTable: 잘못된 전압 데이터 형식:', newData);
        return;
      }
      
      // 디바이스 번호 검증 (1-10)
      if (newData.device < 1 || newData.device > 10) {
        console.warn(`PowerTable: 잘못된 디바이스 번호: ${newData.device}`);
        return;
      }
      
      // 테스트 번호 검증 (1-3)
      if (newData.voltageTest < 1 || newData.voltageTest > 3) {
        console.warn(`PowerTable: 잘못된 테스트 번호: ${newData.voltageTest}`);
        return;
      }
      
      // 디버깅을 위한 로그 (특히 -15 채널에 대해)
      if (process.env.NODE_ENV === 'development') {
        console.log(`PowerTable: accumulateVoltageData - Device: ${newData.device}, Test: ${newData.voltageTest}`);
        console.log(`PowerTable: Channels data:`, newData.channels);
      }
      
      setAccumulatedVoltageData(prevData => {
        const updatedData = { ...prevData };
        
        // 디바이스 키가 없으면 생성
        if (!updatedData[`device${newData.device}`]) {
          updatedData[`device${newData.device}`] = {};
        }
        
        // 테스트 키가 없으면 생성
        if (!updatedData[`device${newData.device}`][`test${newData.voltageTest}`]) {
          updatedData[`device${newData.device}`][`test${newData.voltageTest}`] = {};
        }
        
        // 각 채널 데이터 누적
        newData.channels.forEach(channel => {
          try {
            // 채널 번호 검증 (1-4)
            if (!channel.channel || channel.channel < 1 || channel.channel > 4) {
              console.warn(`PowerTable: 잘못된 채널 번호: ${channel.channel}`);
              return;
            }
            
            const channelKey = `channel${channel.channel}`;
            let displayValue = '-.-';
            
            if (channel.voltage === 'error') {
              displayValue = '-.-';
            } else if (typeof channel.voltage === 'number') {
              // 전압값 범위 검증 (-100V ~ 100V로 확장하여 -15 채널 지원)
              if (channel.voltage >= -100 && channel.voltage <= 100) {
                displayValue = `${channel.voltage.toFixed(2)}V`;
              } else {
                console.warn(`PowerTable: 전압값 범위 오류: ${channel.voltage}V`);
                displayValue = '-.-';
              }
            } else {
              displayValue = '-.-';
            }
            
            // 디버깅을 위한 로그 (특히 -15 채널에 대해)
            if (process.env.NODE_ENV === 'development' && channel.channel === 3) {
              console.log(`PowerTable: Channel 3 (-15) - Device: ${newData.device}, Test: ${newData.voltageTest}, Voltage: ${channel.voltage}, Display: ${displayValue}`);
              console.log(`PowerTable: Channel 3 (-15) - 원본 데이터:`, channel);
              console.log(`PowerTable: Channel 3 (-15) - 누적 데이터 구조:`, updatedData[`device${newData.device}`]?.[`test${newData.voltageTest}`]);
            }
            
            updatedData[`device${newData.device}`][`test${newData.voltageTest}`][channelKey] = displayValue;
          } catch (channelError) {
            console.error(`PowerTable: 채널 데이터 처리 오류:`, channelError);
          }
        });
        
        return updatedData;
      });
      
      // 테이블 업데이트 시간 기록
      setLastTableUpdate(Date.now());
    } catch (error) {
      console.error('PowerTable: accumulateVoltageData 오류:', error);
    }
  };

  // 테이블 초기화 함수 개선
  const resetTable = () => {
    console.log('🔄 PowerTable: 테이블 초기화 실행');
    setAccumulatedVoltageData({});
    setTableCompletionStatus({
      totalCells: 0,
      filledCells: 0,
      completionPercentage: 0,
      isComplete: false
    });
    setIsTableStable(false);
    
    // 1초 후 테이블 상태를 안정화
    setTimeout(() => {
      setIsTableStable(true);
    }, 1000);
  };

  // 테이블 완성도 모니터링 개선
  useEffect(() => {
    const completion = calculateTableCompletion(accumulatedVoltageData);
    setTableCompletionStatus(completion);
    
    // 테이블이 완성되고 안정적인 상태일 때만 초기화 고려
    if (completion.isComplete && isTableStable) {
      console.log('✅ PowerTable: 테이블 완성! 초기화 대기 중...');
      
      // 테이블 완성 후 5초 대기 (기존 2초에서 증가)
      setTimeout(() => {
        // 테이블이 여전히 완성된 상태인지 재확인
        const currentCompletion = calculateTableCompletion(accumulatedVoltageData);
        if (currentCompletion.isComplete) {
          console.log('✅ PowerTable: 테이블 완성 상태 유지 확인됨. 초기화 실행');
          resetTable();
        } else {
          console.log('⚠️ PowerTable: 테이블 완성 상태가 변경됨. 초기화 취소');
        }
      }, 5000);
    }
  }, [accumulatedVoltageData, isTableStable]);

  // channelVoltages 변경 추적 및 테이블 강제 업데이트
  useEffect(() => {
    console.log('🔌 PowerTable: channelVoltages 변경됨:', channelVoltages);
    // 채널 전압이 변경되면 테이블을 강제로 다시 렌더링하여 GOOD/NO GOOD 판단 업데이트
    setLastTableUpdate(Date.now());
    
    // 채널 전압이 변경되면 기존 테이블 데이터를 새로운 전압 기준으로 재계산
    if (Object.keys(accumulatedVoltageData).length > 0) {
      console.log('🔄 PowerTable: 채널 전압 변경으로 인한 테이블 데이터 재계산');
      // 테이블 상태를 강제로 업데이트하여 GOOD/NO GOOD 판단을 새로 수행
      setTableCompletionStatus(prev => ({
        ...prev,
        // 강제 리렌더링을 위해 상태 업데이트
        lastUpdate: Date.now()
      }));
    }
  }, [channelVoltages, accumulatedVoltageData]);

  // selectedDevices 변경 추적 및 테이블 강제 업데이트
  useEffect(() => {
    console.log('🔌 PowerTable: selectedDevices 변경됨:', selectedDevices);
    // 선택된 디바이스가 변경되면 테이블을 강제로 다시 렌더링하여 GOOD/NO GOOD 판단 업데이트
    setLastTableUpdate(Date.now());
    
    // 선택된 디바이스가 변경되면 기존 테이블 데이터를 새로운 선택 기준으로 재계산
    if (Object.keys(accumulatedVoltageData).length > 0) {
      console.log('🔄 PowerTable: 선택된 디바이스 변경으로 인한 테이블 데이터 재계산');
      // 테이블 상태를 강제로 업데이트하여 GOOD/NO GOOD 판단을 새로 수행
      setTableCompletionStatus(prev => ({
        ...prev,
        // 강제 리렌더링을 위해 상태 업데이트
        lastUpdate: Date.now()
      }));
    }
  }, [selectedDevices, accumulatedVoltageData]);
  
  // 제품명 로드 및 업데이트
  useEffect(() => {
    const loadProductNames = () => {
      try {
        // props로 전달받은 productNames가 있으면 사용
        if (productNames && productNames.length > 0) {
          console.log('🔌 PowerTable: props에서 제품명 로드:', productNames);
          setDeviceNames(productNames);
          return;
        }
        
        // localStorage에서 제품명 로드
        if (typeof window !== 'undefined') {
          const stored = localStorage.getItem('productInput');
          if (stored) {
            const productData = JSON.parse(stored);
            if (productData.productNames && Array.isArray(productData.productNames)) {
              console.log('🔌 PowerTable: localStorage에서 제품명 로드:', productData.productNames);
              setDeviceNames(productData.productNames);
              return;
            }
          }
        }
        
        // 기본값 사용 (dev01, dev02, ...)
        const defaultNames = Array.from({ length: 10 }, (_, i) => `dev${String(i + 1).padStart(2, '0')}`);
        console.log('🔌 PowerTable: 기본 제품명 사용:', defaultNames);
        setDeviceNames(defaultNames);
      } catch (error) {
        console.error('🔌 PowerTable: 제품명 로드 오류:', error);
        // 오류 시 기본값 사용
        const defaultNames = Array.from({ length: 10 }, (_, i) => `dev${String(i + 1).padStart(2, '0')}`);
        setDeviceNames(defaultNames);
      }
    };
    
    loadProductNames();
  }, [productNames]);

  // localStorage 변경 감지 (다른 탭에서 제품명이 변경된 경우)
  useEffect(() => {
    const handleStorageChange = (event) => {
      if (event.key === 'productInput') {
        try {
          if (event.newValue) {
            const productData = JSON.parse(event.newValue);
            if (productData.productNames && Array.isArray(productData.productNames)) {
              console.log('🔌 PowerTable: localStorage 변경 감지 - 제품명 업데이트:', productData.productNames);
              setDeviceNames(productData.productNames);
            }
          }
        } catch (error) {
          console.error('🔌 PowerTable: localStorage 변경 처리 오류:', error);
        }
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', handleStorageChange);
      return () => window.removeEventListener('storage', handleStorageChange);
    }
  }, []);
  
  // 컴포넌트 마운트 시 초기 상태 강제 설정
  useEffect(() => {
    //console.log('🔌 PowerTable: 컴포넌트 마운트 - 초기 상태 강제 설정');
    
    // 모든 상태를 초기값으로 강제 설정
    resetTable();
    setProcessLogs([]);
    setCurrentCycle(null);
    setCycleMessage('');
    setTotalCycles(0);
    setTestPhase('none');
    setCurrentTestNumber(0);
    setTotalTestCount(0);
    setTestStatus('none');
    setTestProgressMessage('');
    setIsTestProgressActive(false);
    
    //console.log('✅ PowerTable: 초기 상태 강제 설정 완료');
  }, [wsConnection]);

  const group = groups[0]; // 첫 번째 그룹만 사용
  if (!group) return <div className="text-red-400">데이터 없음</div>;

  // 출력 전압 표시 함수
  const getOutputVoltageDisplay = useCallback((outputValue: string) => {
    //console.log(`🔌 PowerTable: getOutputVoltageDisplay 호출 - outputValue: ${outputValue}, channelVoltages:`, channelVoltages);
    
    // 기존 출력값을 channelVoltages 인덱스로 매핑
    let channelIndex = -1;
    
    // 기존 하드코딩된 값들과의 매핑
    if (outputValue === '+5') channelIndex = 0;
    else if (outputValue === '+15') channelIndex = 1;
    else if (outputValue === '-15') channelIndex = 2;
    else if (outputValue === '+24') channelIndex = 3;
    
    // channelVoltages에서 해당 인덱스의 값을 가져와서 표시
    if (channelIndex >= 0 && channelIndex < channelVoltages.length) {
      const voltage = channelVoltages[channelIndex];
      //console.log(`🔌 PowerTable: channelIndex: ${channelIndex}, voltage: ${voltage}`);
      
      if (voltage !== undefined) {
        // 음수 값 처리 개선
        let result;
        if (voltage === 0) {
          result = '0';
        } else if (voltage > 0) {
          result = `+${voltage}`;
        } else {
          result = `${voltage}`; // 음수는 그대로 표시 (예: -15)
        }
        // console.log(`🔌 PowerTable: 변환 결과: ${outputValue} -> ${result}`);
        return result;
      }
    }
    
    // fallback: 기존 값 사용
    //console.log(`🔌 PowerTable: fallback 사용: ${outputValue}`);
    return outputValue;
  }, [channelVoltages]); // channelVoltages가 변경될 때마다 함수 재생성

  // 출력값으로부터 채널 번호를 결정하는 함수
  const getChannelNumberFromOutput = useCallback((outputValue: string) => {
    // 현재 설정된 channelVoltages 값과 매칭하여 채널 번호 결정
    for (let i = 0; i < channelVoltages.length; i++) {
      const voltage = channelVoltages[i];
      const expectedOutput = voltage > 0 ? `+${voltage}` : `${voltage}`;
      
      // 다양한 형식의 출력값과 매칭
      if (outputValue === expectedOutput || 
          outputValue === `+${voltage}` || 
          outputValue === `${voltage}` ||
          outputValue === voltage.toString()) {
        return i + 1; // 채널 번호는 1부터 시작
      }
    }
    
    // 기존 하드코딩된 값들과의 호환성 유지
    if (outputValue === '+5' || outputValue === '5') return 1;
    else if (outputValue === '+15' || outputValue === '15') return 2;
    else if (outputValue === '-15') return 3;
    else if (outputValue === '+24' || outputValue === '24') return 4;
    else {
      // 디버깅을 위한 로그 추가
      console.warn(`PowerTable: 알 수 없는 출력값: ${outputValue}, channelVoltages:`, channelVoltages);
      return 1; // 기본값
    }
  }, [channelVoltages]); // channelVoltages가 변경될 때마다 함수 재생성

  // GOOD/NO GOOD 판단 함수
  const determineGoodNoGood = useCallback((deviceNumber: number, testNumber: number, channelNumber: number, measuredVoltage: string) => {
    try {
      // 측정된 전압값이 유효하지 않으면 NO GOOD
      if (!measuredVoltage || measuredVoltage === '-.-' || measuredVoltage === '') {
        return 'NO GOOD';
      }

      // 측정된 전압값에서 숫자 부분 추출
      const voltageMatch = measuredVoltage.match(/^([\d.-]+)V$/);
      if (!voltageMatch) {
        return 'NO GOOD';
      }

      const measuredValue = parseFloat(voltageMatch[1]);
      if (isNaN(measuredValue)) {
        return 'NO GOOD';
      }

      // 해당 채널의 설정된 전압값 가져오기
      const expectedVoltage = channelVoltages[channelNumber - 1];
      if (expectedVoltage === undefined || expectedVoltage === null) {
        return 'NO GOOD';
      }

      // 허용 오차 범위 (±0.5V)
      const tolerance = 0.5;
      const minVoltage = expectedVoltage - tolerance;
      const maxVoltage = expectedVoltage + tolerance;

      // 측정값이 허용 범위 내에 있는지 확인
      if (measuredValue >= minVoltage && measuredValue <= maxVoltage) {
        return 'GOOD';
      } else {
        return 'NO GOOD';
      }
    } catch (error) {
      console.error(`PowerTable: GOOD/NO GOOD 판단 오류 - device: ${deviceNumber}, test: ${testNumber}, channel: ${channelNumber}`, error);
      return 'NO GOOD';
    }
  }, [channelVoltages]); // channelVoltages가 변경될 때마다 함수 재생성

  // 누적된 전압 데이터 표시 함수 개선
  const getAccumulatedVoltageDisplay = (device: number, test: number, channel: number) => {
    try {
      // 입력값 검증
      if (!device || !test || !channel || 
          device < 1 || device > 10 || 
          test < 1 || test > 3 || 
          channel < 1 || channel > 4) {
        console.warn(`PowerTable: 잘못된 인덱스 - device: ${device}, test: ${test}, channel: ${channel}`);
        return '-.-';
      }
      
      const deviceKey = `device${device}`;
      const testKey = `test${test}`;
      const channelKey = `channel${channel}`;
      
      const voltage = accumulatedVoltageData[deviceKey]?.[testKey]?.[channelKey];
      
      // 데이터가 없거나 비어있으면 기본값 반환
      if (!voltage || voltage === '' || voltage === '-.-') {
        return '-.-';
      }
      
      // 전압값이 유효한 형식인지 확인 (숫자+V 형식)
      if (typeof voltage === 'string' && voltage.match(/^[\d.-]+V$/)) {
        // 전압값 범위 검증 (-100V ~ 100V로 확장하여 -15 채널 지원)
        const voltageValue = parseFloat(voltage.replace('V', ''));
        if (isNaN(voltageValue) || voltageValue < -100 || voltageValue > 100) {
          console.warn(`PowerTable: 전압값 범위 오류 - ${voltage}`);
          return '-.-';
        }
        return voltage;
      }
      
      // 유효하지 않은 데이터는 기본값 반환
      console.warn(`PowerTable: 유효하지 않은 전압 데이터 형식 - ${voltage}`);
      return '-.-';
    } catch (error) {
      console.error(`PowerTable: getAccumulatedVoltageDisplay 오류 - device: ${device}, test: ${test}, channel: ${channel}`, error);
      return '-.-';
    }
  };

  // WebSocket 메시지 수신 처리
  useEffect(() => {
    if (!wsConnection) {
      return;
    }

    if (wsConnection.readyState !== WebSocket.OPEN) {
      console.log('🔌 PowerTable: WebSocket이 아직 열리지 않았습니다. readyState:', wsConnection.readyState);
      return;
    }

    // 마지막으로 받은 테이블 데이터를 추적하여 중복 처리 방지
    let lastTableDataHash = '';

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      
      // PowerTable에서 필요한 메시지만 처리
      // 1. 테스트 진행상황 메시지 처리
      if (typeof message === 'string' && message.startsWith('[TEST_PROGRESS]')) {
        try {
          const match = message.match(/\[TEST_PROGRESS\] (.+)/);
          if (match && match[1]) {
            const progressMessage = match[1];
            console.log('🔌 PowerTable: 테스트 진행상황 메시지 수신:', progressMessage);
            setTestProgressMessage(progressMessage);
            setIsTestProgressActive(true);
          }
        } catch (error) {
          console.error('PowerTable: 테스트 진행상황 메시지 파싱 오류:', error);
        }
        return; // 처리 완료 후 종료
      }
      
      // 2. 테스트 완료 메시지 처리
      if (typeof message === 'string' && message.startsWith('[TEST_COMPLETED]')) {
        try {
          const match = message.match(/\[TEST_COMPLETED\] (.+)/);
          if (match && match[1]) {
            const completeMessage = match[1];
            console.log('🔌 PowerTable: 테스트 완료 메시지 수신:', completeMessage);
            setTestProgressMessage(completeMessage);
            setIsTestProgressActive(true);
          }
        } catch (error) {
          console.error('PowerTable: 테스트 완료 메시지 파싱 오류:', error);
        }
        return; // 처리 완료 후 종료
      }
      
      // 3. 챔버 온도 업데이트
      if (typeof message === 'string' && message.startsWith('[CHAMBER_TEMPERATURE]')) {
        try {
          const match = message.match(/\[CHAMBER_TEMPERATURE] (.+)/);
          if (match && match[1]) {
            const temperature = parseFloat(match[1]);
            if (!isNaN(temperature)) {
              console.log('🔌 PowerTable: 챔버 온도 업데이트:', temperature);
              setChamberTemperature(temperature);
            }
          }
        } catch (error) {
          console.error('PowerTable: 챔버 온도 파싱 오류:', error);
        }
        return; // 처리 완료 후 종료
      }
      
      // 4. PowerTable 전압 데이터 초기화 메시지 처리
      if (typeof message === 'string' && message.startsWith('[POWER_TABLE_RESET]')) {
        try {
          
          const match = message.match(/\[POWER_TABLE_RESET\] (.+)/);
          if (match && match[1]) {
          
            const resetData = JSON.parse(match[1]);
            
            // 액션 타입에 따른 처리
            switch (resetData.action) {
              case 'reset':
                // 일반 초기화 - 모든 상태 초기화 (테스트 진행상황 메시지는 보호)
                resetTable();
                setCycleMessage(resetData.message || '');
                break;
                
              case 'cycle_reset':
                // 사이클 시작 - 전압 데이터 초기화하고 사이클 정보 설정
                resetTable();
                setCurrentCycle(resetData.cycle || null);
                setTotalCycles(resetData.totalCycles || 0);
                setCycleMessage(resetData.message || '');
                setTestPhase('none');
                setCurrentTestNumber(0);
                setTotalTestCount(0);
                setTestStatus('none');
                break;
                
              case 'single_page_reset':
                // 단일 페이지 프로세스 - 전압 데이터 초기화
                resetTable();
                setCurrentCycle(null);
                setTotalCycles(0);
                setCycleMessage(resetData.message || '');
                setTestPhase('none');
                setCurrentTestNumber(0);
                setTotalTestCount(0);
                setTestStatus('none');
                break;
                
              case 'test_start':
                // 테스트 시작 - 전압 데이터는 유지하고 테스트 정보만 업데이트
                setCurrentCycle(resetData.cycle || null);
                setTotalCycles(resetData.totalCycles || 0);
                setTestPhase(resetData.testPhase || 'none');
                setCurrentTestNumber(0);
                setTotalTestCount(resetData.totalTestCount || 0);
                setTestStatus(resetData.testStatus || 'none');
                setCycleMessage(resetData.message || '');
                
                // PowerSwitch에 측정 시작 알림
                if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
                  const measurementMessage = `[MEASUREMENT_STATUS] STARTED`;
                  wsConnection.send(measurementMessage);
                  console.log('🔌 PowerTable: 측정 시작 메시지 전송');
                }
                break;
                
              case 'test_progress':
                // 테스트 진행 상황 - 전압 데이터는 유지하고 진행 상황만 업데이트
                setCurrentCycle(resetData.cycle || null);
                setTotalCycles(resetData.totalCycles || 0);
                setTestPhase(resetData.testPhase || 'none');
                setCurrentTestNumber(resetData.currentTestNumber || 0);
                setTotalTestCount(resetData.totalTestCount || 0);
                setTestStatus(resetData.testStatus || 'none');
                
                // 테스트 진행상황 메시지 처리
                if (resetData.message) {
                  setTestProgressMessage(resetData.message);
                  setIsTestProgressActive(true);
                }
                break;
                
              default:
                // 알 수 없는 액션 - 기본 초기화 (테스트 진행상황 메시지는 보호)
                console.log('🔄 PowerTable: 알 수 없는 액션 - 기본 초기화 실행');
                resetTable();
                setCycleMessage(resetData.message || '');
                console.log('✅ PowerTable: 기본 초기화 완료');
                break;
            }
            
          } else {
            console.error('🔄 PowerTable: [POWER_TABLE_RESET] 메시지 형식 오류 - 매치 실패');
            console.error('🔄 PowerTable: 원본 메시지:', message);
          }
        } catch (error) {
          console.error('PowerTable: PowerTable 메시지 파싱 오류:', error);
          console.error('PowerTable: 원본 메시지:', message);
          
          // 메시지 형식이 맞지 않으면 원본 메시지를 그대로 표시
          setTestProgressMessage(message);
          setIsTestProgressActive(true);
        }
        return; // 처리 완료 후 종료
      }
      
      // 3. 테이블 업데이트 메시지 처리 - 통합된 방식으로 변경
      if (typeof message === 'string' && (
        message.startsWith('[POWER_TABLE_UPDATE]') || 
        message.startsWith('[TABLE_DATA_RESPONSE]') || 
        message.startsWith('[POWER_TABLE_COMPLETE]')
      )) {
        try {
          let tableData: any;
          let messageType = '';
          
          // 메시지 타입에 따른 파싱
          if (message.startsWith('[POWER_TABLE_UPDATE]')) {
          const match = message.match(/\[POWER_TABLE_UPDATE\] (.+)/);
          if (match && match[1]) {
              tableData = JSON.parse(match[1]);
              messageType = 'POWER_TABLE_UPDATE';
            }
          } else if (message.startsWith('[TABLE_DATA_RESPONSE]')) {
            const match = message.match(/\[TABLE_DATA_RESPONSE\] (.+)/);
            if (match && match[1]) {
              tableData = JSON.parse(match[1]);
              messageType = 'TABLE_DATA_RESPONSE';
            }
          } else if (message.startsWith('[POWER_TABLE_COMPLETE]')) {
            const match = message.match(/\[POWER_TABLE_COMPLETE\] (.+)/);
            if (match && match[1]) {
              tableData = JSON.parse(match[1]);
              messageType = 'POWER_TABLE_COMPLETE';
            }
          }
          
          if (tableData) {
            // 중복 데이터 처리 방지: 데이터 해시 생성 및 비교
            const currentDataHash = JSON.stringify(tableData);
            if (currentDataHash === lastTableDataHash) {
              console.log(`🔌 PowerTable: ${messageType} 중복 데이터 무시`);
              return;
            }
            
            // 새로운 데이터인 경우 해시 업데이트
            lastTableDataHash = currentDataHash;
            
            //console.log(`🔌 PowerTable: ${messageType} 데이터 수신:`, tableData);
            
            // 서버에서 전달받은 테이블 데이터를 누적 데이터로 변환
            const newAccumulatedData: AccumulatedTableData = {};
            
            // 메시지 타입에 따른 데이터 구조 처리
            if (messageType === 'POWER_TABLE_UPDATE' && tableData.tableData && Array.isArray(tableData.tableData)) {
              // POWER_TABLE_UPDATE 형식 처리
              tableData.tableData.forEach((deviceData: any[], deviceIndex: number) => {
                const deviceNumber = deviceIndex + 1;
                newAccumulatedData[`device${deviceNumber}`] = {};
                
                deviceData.forEach((testData: any[], testIndex: number) => {
                  const testNumber = testIndex + 1;
                  newAccumulatedData[`device${deviceNumber}`][`test${testNumber}`] = {};
                  
                  testData.forEach((channelData: any, channelIndex: number) => {
                    const channelNumber = channelIndex + 1;
                    
                    // channelData가 문자열인 경우 (예: "5.2V" 또는 "-.-") 그대로 사용
                    let displayValue = '-.-';
                    if (typeof channelData === 'string' && channelData !== '') {
                      if (channelData === '-.-') {
                        displayValue = '-.-';
                      } else if (channelData.endsWith('V')) {
                        displayValue = channelData;
                      } else {
                        displayValue = '-.-';
                      }
                    }
                    
                    newAccumulatedData[`device${deviceNumber}`][`test${testNumber}`][`channel${channelNumber}`] = displayValue;
                  });
                });
              });
            } else if (messageType === 'TABLE_DATA_RESPONSE' && tableData.devices && Array.isArray(tableData.devices)) {
              // TABLE_DATA_RESPONSE 형식 처리
              tableData.devices.forEach((device: any) => {
                const deviceNumber = device.deviceNumber;
                newAccumulatedData[`device${deviceNumber}`] = {};
                
                device.tests.forEach((test: any) => {
                  const testNumber = test.testNumber;
                  newAccumulatedData[`device${deviceNumber}`][`test${testNumber}`] = {};
                  
                  test.channels.forEach((channel: any) => {
                    const channelNumber = channel.channelNumber;
                    
                    let displayValue = '-.-';
                    if (channel.status === 'completed' && channel.voltage !== null) {
                      displayValue = `${channel.voltage.toFixed(2)}V`;
                    }
                    
                    newAccumulatedData[`device${deviceNumber}`][`test${testNumber}`][`channel${channelNumber}`] = displayValue;
                  });
                });
              });
            } else if (messageType === 'POWER_TABLE_COMPLETE' && tableData.tableData && Array.isArray(tableData.tableData)) {
              // POWER_TABLE_COMPLETE 형식 처리
              tableData.tableData.forEach((deviceData: any[], deviceIndex: number) => {
                const deviceNumber = deviceIndex + 1;
                newAccumulatedData[`device${deviceNumber}`] = {};
                
                deviceData.forEach((testData: any[], testIndex: number) => {
                  const testNumber = testIndex + 1;
                  newAccumulatedData[`device${deviceNumber}`][`test${testNumber}`] = {};
                  
                  testData.forEach((channelData: any, channelIndex: number) => {
                    const channelNumber = channelIndex + 1;
                    
                    // channelData가 문자열인 경우 (예: "5.2V|G") 전압값만 추출
                    let displayValue = '-.-';
                    if (typeof channelData === 'string' && channelData !== '') {
                      const voltageMatch = channelData.match(/^([\d.-]+)V/);
                      if (voltageMatch) {
                        displayValue = `${voltageMatch[1]}V`;
                      }
                    }
                    
                    newAccumulatedData[`device${deviceNumber}`][`test${testNumber}`][`channel${channelNumber}`] = displayValue;
                  });
                });
              });
            }
              
              // 누적 데이터 업데이트
              setAccumulatedVoltageData(newAccumulatedData);
            console.log(`✅ PowerTable: ${messageType}으로 누적 데이터 업데이트 완료`);
            
            // 테이블 완성도 정보 업데이트 (POWER_TABLE_UPDATE와 POWER_TABLE_COMPLETE에서만)
            if ((messageType === 'POWER_TABLE_UPDATE' || messageType === 'POWER_TABLE_COMPLETE') && 
                tableData.completionPercentage !== undefined) {
              // 선택된 디바이스 수에 따른 동적 계산
              const dynamicTotalCells = selectedDevices.length * 3 * 4;
              setTableCompletionStatus({
                totalCells: tableData.totalCells || dynamicTotalCells,
                filledCells: tableData.completedCells || 0,
                completionPercentage: tableData.completionPercentage || 0,
                isComplete: tableData.completionPercentage >= 95
              });
            }
          }
          
        } catch (error) {
          console.error('PowerTable: 테이블 데이터 파싱 오류:', error);
        }
        return; // 처리 완료 후 종료
      }
      
      // 4. 전압 업데이트 메시지 처리 - 누적 방식으로 변경 (기존 호환성 유지)
      if (typeof message === 'string' && message.startsWith('[VOLTAGE_UPDATE]')) {
        try {
          const match = message.match(/\[VOLTAGE_UPDATE\] (.+)/);
          if (match && match[1]) {
            const voltageUpdate: VoltageData = JSON.parse(match[1]);
            
            console.log(`🔌 PowerTable: 전압 데이터 누적 업데이트 - Device ${voltageUpdate.device}, Test ${voltageUpdate.voltageTest}`);
            
            // 전압 데이터를 누적 방식으로 처리
            accumulateVoltageData(voltageUpdate);
            
          }
        } catch (error) {
          console.error('PowerTable: 전압 업데이트 파싱 오류:', error);
        }
        return; // 처리 완료 후 종료
      }
      
      // 5. 파워스위치 메시지 처리
      if (typeof message === 'string' && message.includes('[POWER_SWITCH]')) {
        if (message.includes('STOPPING - Processing stop request')) {
          // 중지 처리 중 메시지 표시
          setTestProgressMessage('중지 처리중...');
          setIsTestProgressActive(true);
          console.log('🔌 PowerTable: 파워스위치 중지 처리 중 상태 감지');
        } else if (message.includes('OFF - Machine running: false')) {
          // 파워스위치 OFF 시 테스트 진행상황 메시지 초기화
          if (message.includes('Test completed')) {
            // 테스트 완료 시
            setTestProgressMessage('테스트 완료 - 중단 시작 대기중');
            
            // PowerSwitch에 측정 완료 알림
            if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
              const measurementMessage = `[MEASUREMENT_STATUS] COMPLETED`;
              wsConnection.send(measurementMessage);
              console.log('🔌 PowerTable: 측정 완료 메시지 전송');
            }
          } else {
            // 일반 중지 시
            setTestProgressMessage('중단 시작 대기중');
            
            // PowerSwitch에 측정 중단 알림
            if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
              const measurementMessage = `[MEASUREMENT_STATUS] STOPPED`;
              wsConnection.send(measurementMessage);
              console.log('🔌 PowerTable: 측정 중단 메시지 전송');
            }
          }
          setIsTestProgressActive(true);
          console.log('🔌 PowerTable: 파워스위치 OFF 상태 감지 - 중단 시작 대기중 메시지 표시');
        }
        return; // 처리 완료 후 종료
      }
      
      // 5-1. 측정 상태 메시지 처리 - PowerSwitch에 전달
      if (typeof message === 'string' && message.includes('[MEASUREMENT_STATUS]')) {
        // PowerSwitch 컴포넌트에서 처리하므로 여기서는 로그만 출력
        console.log('🔌 PowerTable: 측정 상태 메시지 수신:', message);
        return; // 처리 완료 후 종료
      }
      
      // 6. 파워 테이블 강제 업데이트 메시지 처리
      if (typeof message === 'string' && message.startsWith('[POWER_TABLE_FORCE_UPDATE]')) {
        try {
          const match = message.match(/\[POWER_TABLE_FORCE_UPDATE\] (\[.*\])/);
          if (match && match[1]) {
            const newVoltages = JSON.parse(match[1]);
            if (Array.isArray(newVoltages) && newVoltages.length === 4) {
              console.log('🔄 PowerTable: 강제 업데이트 메시지 수신, 채널 전압 변경:', newVoltages);
              // 채널 전압이 변경되었으므로 테이블을 강제로 다시 렌더링
              setLastTableUpdate(Date.now());
              
              // 기존 테이블 데이터가 있다면 GOOD/NO GOOD 판단을 새로 수행
              if (Object.keys(accumulatedVoltageData).length > 0) {
                console.log('🔄 PowerTable: 기존 테이블 데이터 재계산 시작');
                // 테이블 완성도 상태를 강제로 업데이트하여 리렌더링 유발
                setTableCompletionStatus(prev => ({
                  ...prev,
                  lastForceUpdate: Date.now()
                }));
              }
            }
          }
        } catch (error) {
          console.error('PowerTable: 강제 업데이트 메시지 파싱 오류:', error);
        }
        return; // 처리 완료 후 종료
      }
      
      // 7. 기타 메시지는 무시 (PowerTable에서 처리하지 않음)
    };

    wsConnection.addEventListener('message', handleMessage);
    
    return () => {
      wsConnection.removeEventListener('message', handleMessage);
    };
  }, [wsConnection, accumulateVoltageData]);

  // 초기화 메시지 타입에 따른 텍스트 반환 함수
  const getActionTypeText = (message: string) => {
    if (message.includes('단일 페이지')) return '단일페이지 초기화';
    if (message.includes('사이클')) return '사이클 초기화';
    return '일반 초기화';
  };
  






  // 현재 테이블 데이터 가져오기 함수
  const getCurrentTableData = () => {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
      const getTableMessage = `[TABLE_DATA_GET]`;
      wsConnection.send(getTableMessage);
      console.log('📊 PowerTable: 현재 테이블 데이터 요청 전송');
    } else {
      console.warn('📊 PowerTable: 테이블 데이터 요청: WebSocket 연결이 없습니다.');
    }
  };

  // 테이블 데이터 초기화 함수
  const resetTableData = () => {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
      const resetTableMessage = `[TABLE_DATA_RESET]`;
      wsConnection.send(resetTableMessage);
      console.log('🔄 PowerTable: 테이블 데이터 초기화 요청 전송');
    } else {
      console.warn('🔄 PowerTable: 테이블 초기화: WebSocket 연결이 없습니다.');
    }
  };

  // 데모 테이블 완성 데이터 생성 함수
  const generateDemoCompleteTable = useCallback(() => {
    console.log('🧪 PowerTable: 데모 테이블 생성 시작');
    console.log('🧪 PowerTable: 현재 channelVoltages prop:', channelVoltages);
    console.log('🧪 PowerTable: channelVoltages 타입:', typeof channelVoltages);
    console.log('🧪 PowerTable: channelVoltages 길이:', channelVoltages?.length);
    
    // channelVoltages가 유효한지 확인
    if (!channelVoltages || !Array.isArray(channelVoltages) || channelVoltages.length !== 4) {
      console.error('🧪 PowerTable: channelVoltages가 유효하지 않음, 기본값 사용');
      const defaultVoltages = [5, 15, -15, 24];
      channelVoltages = defaultVoltages;
    }
    
    // 새로운 테이블 업데이트 방식으로 데모 데이터 생성
    const demoTableData = {
      timestamp: new Date().toISOString(),
      totalDevices: selectedDevices.length,
      totalTests: 3,
      totalChannels: 4,
      completionPercentage: 100.0,
      completedCells: selectedDevices.length * 3 * 4,
      totalCells: selectedDevices.length * 3 * 4,
      tableData: Array.from({ length: selectedDevices.length }, (_, deviceIndex) =>
        Array.from({ length: 3 }, (_, testIndex) =>
          Array.from({ length: 4 }, (_, channelIndex) => {
            // 현재 설정된 channelVoltages 값을 사용하여 랜덤한 전압값 생성
            const baseVoltage = channelVoltages[channelIndex] || 0;
            const voltage = baseVoltage + (Math.random() - 0.5) * 0.2;
            console.log(`🧪 PowerTable: 채널 ${channelIndex + 1} - 기본값: ${baseVoltage}, 생성값: ${voltage.toFixed(2)}V`);
            return `${voltage.toFixed(2)}V`;
          })
        )
      ),
      summary: {
        totalCells: selectedDevices.length * 3 * 4,
        completedCells: selectedDevices.length * 3 * 4,
        status: 'completed'
      }
    };

    // 데모 데이터를 누적 데이터로 변환하여 표시
    const newAccumulatedData: AccumulatedTableData = {};
    
    demoTableData.tableData.forEach((deviceData: any[], deviceIndex: number) => {
      const deviceNumber = deviceIndex + 1;
      newAccumulatedData[`device${deviceNumber}`] = {};
      
      deviceData.forEach((testData: any[], testIndex: number) => {
        const testNumber = testIndex + 1;
        newAccumulatedData[`device${deviceNumber}`][`test${testNumber}`] = {};
        
        testData.forEach((channelData: any, channelIndex: number) => {
          const channelNumber = channelIndex + 1;
          
          // channelData가 이미 전압값 형식이므로 그대로 사용
          let displayValue = '-.-';
          if (typeof channelData === 'string' && channelData !== '') {
            if (channelData.endsWith('V')) {
              displayValue = channelData;
            }
          }
          
          newAccumulatedData[`device${deviceNumber}`][`test${testNumber}`][`channel${channelNumber}`] = displayValue;
        });
      });
    });
    
    setAccumulatedVoltageData(newAccumulatedData);
    
    // 테이블 완성도 상태도 업데이트
    setTableCompletionStatus({
      totalCells: selectedDevices.length * 3 * 4,
      filledCells: selectedDevices.length * 3 * 4,
      completionPercentage: 100,
      isComplete: true
    });
    
    console.log('🧪 PowerTable: 데모 테이블 데이터 생성 완료, 사용된 channelVoltages:', channelVoltages);
    console.log('🧪 PowerTable: 생성된 누적 데이터 샘플:', Object.keys(newAccumulatedData).slice(0, 2));
  }, [channelVoltages]); // channelVoltages가 변경될 때마다 함수 재생성

  return (
    <div className="w-full h-full bg-[#181A20] rounded-lg shadow-md p-2" style={{ 
      width: '100%', 
      height: '100%',
      display: 'grid',
      gridTemplateRows: 'auto auto 1fr',
      gridTemplateAreas: '"header" "progress" "table"',
      gap: '10px'
    }}>
      {/* 상단 정보 영역 - 그리드 영역 */}
      <div className="px-2" style={{ 
        gridArea: 'header',
        backgroundColor: '#23242a',
        borderRadius: '8px',
        padding: '15px'
      }}>
        {/* 온도와 테스트 진행상황, 그리고 테스트 버튼들을 가로로 배치 */}
        <div style={{ 
          width: '100%',
          height: 'auto',
          display: 'table',
          tableLayout: 'fixed'
        }}>
          <div style={{ 
            display: 'table-row'
          }}>
            {/* 온도 표시 - 좌측 셀 */}
            <div style={{ 
              display: 'table-cell',
              width: '25%',
              verticalAlign: 'middle',
              paddingRight: '20px'
            }}>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '18px',
                fontWeight: '600',
                color: '#90CAF9',
                backgroundColor: 'rgba(30, 58, 138, 0.3)',
                borderRadius: '8px',
                padding: '8px 16px'
              }}>
                <span style={{ color: '#F472B6' }}>🌡️</span>
                <span>온도: <span style={{ color: '#FFFFFF', fontWeight: '700' }}>
                  {chamberTemperature !== null ? `${chamberTemperature.toFixed(2)}°C` : `${group.temperature}°C`}
                </span></span>
              </div>
            </div>
            
            {/* 테스트 진행 상황 표시 - 중앙 셀 */}
            <div style={{ 
              display: 'table-cell',
              width: '45%',
              verticalAlign: 'middle',
              textAlign: 'center'
            }}>
              {isTestProgressActive && testProgressMessage ? (
                <div style={{
                  display: 'inline-block',
                  fontSize: '18px',
                  fontWeight: '600',
                  color: '#86EFAC',
                  backgroundColor: 'rgba(20, 83, 45, 0.3)',
                  borderRadius: '8px',
                  padding: '8px 16px'
                }}>
                  <span style={{ color: '#F472B6' }}>📢</span> {testProgressMessage}
                </div>
              ) : (
                <div style={{
                  display: 'inline-block',
                  fontSize: '18px',
                  fontWeight: '600',
                  color: '#9CA3AF',
                  backgroundColor: 'rgba(31, 41, 55, 0.3)',
                  borderRadius: '8px',
                  padding: '8px 16px'
                }}>
                  <span style={{ color: '#F472B6' }}>⏳</span> 테스트 대기 중
                </div>
              )}
            </div>

            {/* 테스트 버튼들 - 우측 셀 */}
            <div style={{ 
              display: 'table-cell',
              width: '30%',
              verticalAlign: 'middle',
              textAlign: 'right'
            }}>
              <div style={{
                display: 'flex',
                gap: '8px',
                justifyContent: 'flex-end'
              }}>
                
                
                
                <button
                  onClick={generateDemoCompleteTable}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#F59E0B',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                >
                  🎯 데모 테이블
                </button>
                <button
                  onClick={getCurrentTableData}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#06B6D4',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                >
                  📊 데이터 요청
                </button>
                <button
                  onClick={resetTableData}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#F97316',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                >
                  🔄 서버 초기화
                </button>
                <button
                  onClick={resetTable}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#EF4444',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                >
                  🔄 테이블 초기화
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 테이블 진행 상황 표시 영역 */}
      <div className="px-2" style={{ 
        gridArea: 'progress',
        backgroundColor: '#23242a',
        borderRadius: '8px',
        padding: '10px'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '16px',
          color: '#E5E7EB'
        }}>
          <span>📊 테이블 진행 상황:</span>
          <span>
            {tableCompletionStatus.filledCells} / {tableCompletionStatus.totalCells} 셀 완성
            <span style={{ color: '#60A5FA', marginLeft: '10px' }}>
              ({tableCompletionStatus.completionPercentage?.toFixed(1)}%)
            </span>
            {tableCompletionStatus.isComplete && (
              <span style={{ color: '#10B981', marginLeft: '10px' }}>
                ✅ 완성! {isTableStable ? '5초 후 초기화' : '초기화 대기 중...'}
              </span>
            )}
          </span>
        </div>
        {/* 진행률 바 */}
        <div style={{
          width: '100%',
          height: '8px',
          backgroundColor: '#374151',
          borderRadius: '4px',
          marginTop: '8px',
          overflow: 'hidden'
        }}>
          <div style={{
            width: `${(tableCompletionStatus.filledCells / tableCompletionStatus.totalCells) * 100}%`,
            height: '100%',
            backgroundColor: tableCompletionStatus.isComplete ? '#10B981' : '#3B82F6',
            transition: 'width 0.3s ease'
          }} />
        </div>
        

      </div>
      
      {/* 테이블 컨테이너 - 그리드 영역 */}
      <div className="overflow-x-auto overflow-y-auto" style={{ 
        width: '100%', 
        gridArea: 'table',
        backgroundColor: '#1a1b20',
        borderRadius: '8px',
        padding: '10px',
        maxHeight: 'calc(100vh - 300px)', /* 최대 높이 설정으로 스크롤 가능하게 함 */
        minHeight: '400px', /* 최소 높이 보장 */
        /* 스크롤바 스타일링 */
        scrollbarWidth: 'thin',
        scrollbarColor: '#4a5568 #2d3748'
      }}>
        <table className="w-full text-xs sm:text-sm md:text-base text-left text-gray-300 border-separate border-spacing-0" style={{ width: '100%', tableLayout: 'fixed' }}>
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#23242a]" style={{ height: '36px' }}>
              <th className="px-1 py-0" style={{ width: '8%', fontSize: '16px', height: '36px' }}>입력</th>
              <th className="px-1 py-0" style={{ width: '8%', fontSize: '16px', height: '36px' }}>출력</th>
              {Array.from({ length: 10 }, (_, i) => (
                <th key={i} className="px-1 py-0" style={{ width: '6%', fontSize: '16px', height: '36px' }}>
                  {deviceNames[i] || `dev${String(i+1).padStart(2,'0')}`}
                </th>
              ))}
              <th className="px-1 py-0" style={{ width: '8%', fontSize: '16px', height: '36px' }}>GOOD</th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row, idx) => (
              <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#3a3a3a' : '#1a1a1a', height: '31px' }}>
                <td className="px-1 py-0 whitespace-nowrap text-right" style={{ fontSize: '16px', height: '31px' }}>{row.input}</td>
                <td className="px-1 py-0 whitespace-nowrap text-right" style={{ fontSize: '16px', height: '31px' }}>{getOutputVoltageDisplay(row.output)}</td>
                {row.devs.map((v, i) => {
                  try {
                    // 누적된 전압 데이터를 사용하여 표시
                    const deviceNumber = i + 1; // 디바이스 번호 (1-10)
                    
                    // 현재 행의 출력값을 기반으로 채널 번호 결정
                    const channelNumber = getChannelNumberFromOutput(row.output);
                    
                    // 현재 행의 입력값을 기반으로 테스트 번호 결정 (서버의 outVoltSettings [24, 18, 30, 0] 순서에 맞춤)
                    let testNumber = 1;
                    if (row.input === '+24') testNumber = 1;  // 첫 번째: 24V
                    else if (row.input === '+18') testNumber = 2;  // 두 번째: 18V
                    else if (row.input === '+30') testNumber = 3;  // 세 번째: 30V
                    
                    const accumulatedVoltage = getAccumulatedVoltageDisplay(deviceNumber, testNumber, channelNumber);
                    
                    return (
                      <td key={i} className="px-1 py-0 whitespace-nowrap text-right" style={{ fontSize: '16px', height: '31px' }}>
                        {accumulatedVoltage}
                      </td>
                    );
                  } catch (error) {
                    console.error(`PowerTable: 디바이스 ${i+1} 데이터 표시 오류:`, error);
                    return (
                      <td key={i} className="px-1 py-0 whitespace-nowrap text-right" style={{ fontSize: '16px', height: '31px', color: '#EF4444' }}>
                        ERROR
                      </td>
                    );
                  }
                })}
                <td className="px-1 py-0 whitespace-nowrap text-center" style={{ fontSize: '16px', height: '31px' }}>
                  {(() => {
                    // 현재 행의 출력값을 기반으로 채널 번호 결정
                    const channelNumber = getChannelNumberFromOutput(row.output);
                    
                    // 현재 행의 입력값을 기반으로 테스트 번호 결정
                    let testNumber = 1;
                    if (row.input === '+24') testNumber = 1;
                    else if (row.input === '+18') testNumber = 2;
                    else if (row.input === '+30') testNumber = 3;
                    
                    // 선택된 디바이스들의 측정 상태 확인
                    const selectedDeviceData = selectedDevices.map(deviceIndex => {
                      const deviceNumber = deviceIndex + 1; // 디바이스 번호는 1부터 시작
                      const measuredVoltage = getAccumulatedVoltageDisplay(deviceNumber, testNumber, channelNumber);
                      return {
                        deviceNumber,
                        measuredVoltage,
                        hasData: measuredVoltage !== '-.-' && measuredVoltage !== ''
                      };
                    });
                    
                    // 모든 선택된 디바이스가 측정되었는지 확인
                    const allDevicesMeasured = selectedDeviceData.every(device => device.hasData);
                    const hasAnyData = selectedDeviceData.some(device => device.hasData);
                    
                    // 데이터가 전혀 없으면 -.- 표시
                    if (!hasAnyData) {
                      return <span style={{ color: '#9CA3AF' }}>-.-</span>;
                    }
                    
                    // 모든 선택된 디바이스가 측정되지 않았으면 WAIT 표시
                    if (!allDevicesMeasured) {
                      return <span style={{ color: '#F59E0B', fontWeight: 'bold' }}>WAIT</span>;
                    }
                    
                    // 모든 디바이스가 측정되었으면 GOOD/NO GOOD 판단
                    const deviceResults = selectedDeviceData.map(device => 
                      determineGoodNoGood(device.deviceNumber, testNumber, channelNumber, device.measuredVoltage)
                    );
                    
                    const allGood = deviceResults.length > 0 && deviceResults.every(result => result === 'GOOD');
                    const result = allGood ? 'GOOD' : 'NO GOOD';
                    const color = allGood ? '#10B981' : '#EF4444'; // GOOD: 초록색, NO GOOD: 빨간색
                    
                    return <span style={{ color, fontWeight: 'bold' }}>{result}</span>;
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
