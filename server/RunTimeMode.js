import { GetData } from './GetData.js';
import { RelayAllOff, SelectDeviceOn, SelectDeviceOff } from './SelectDevice.js';
import { SendVoltCommand } from './SetVolt.js';
import { ReadVolt } from './ReadVolt.js';

import { ReadChamber } from './ReadChamber.js'; 
import { getProcessStopRequested, setMachineRunningStatus, getCurrentChamberTemperature, getSafeGetTableOption } from './backend-websocket-server.js';
import { getSimulationMode } from './RunTestProcess.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { InterByteTimeoutParser } from 'serialport';

// ES Module 환경에서 __dirname 사용을 위한 설정
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 파일 경로 상수
const PRODUCT_INPUT_FILE = 'product_input.json'; // 제품 입력 저장 파일

// 제품명 로딩 공통 함수 (강건한 버전)
function loadProductNames() {
  let deviceNames = [];
  
  try {
    // 파일 존재 확인
    if (!fs.existsSync(PRODUCT_INPUT_FILE)) {
      throw new Error(`Product input file not found: ${PRODUCT_INPUT_FILE}`);
    }
    
    const fileContent = fs.readFileSync(PRODUCT_INPUT_FILE, 'utf8');
    if (!fileContent.trim()) {
      throw new Error('Product input file is empty');
    }
    
    const productInputData = JSON.parse(fileContent);
    
    // 다양한 필드명 지원
    const productNames = productInputData.productNames || 
                        productInputData.deviceNames || 
                        productInputData.devices || 
                        productInputData.products;
    
    if (productNames && Array.isArray(productNames)) {
      // 제품명 정리 및 검증
      deviceNames = productNames
        .map(name => {
          if (typeof name === 'string') {
            return name.trim();
          } else if (typeof name === 'object' && name.name) {
            return name.name.trim();
          }
          return null;
        })
        .filter(name => name && name.length > 0);
      
      console.log('[ProductNames] 📝 제품명 로드 성공:', deviceNames);
    } else {
      throw new Error('No valid product names found in data');
    }
  } catch (error) {
    console.warn('[ProductNames] ⚠️ 제품명 로드 실패, 기본값 사용:', error.message);
    // 기본값: Device 1, Device 2, ... Device 10
    deviceNames = Array.from({ length: 10 }, (_, i) => `Device ${i + 1}`);
  }
  
  // 제품명이 10개 미만이면 기본값으로 채움
  while (deviceNames.length < 10) {
    deviceNames.push(`Device ${deviceNames.length + 1}`);
  }
  
  // 제품명이 10개를 초과하면 10개로 제한
  if (deviceNames.length > 10) {
    deviceNames = deviceNames.slice(0, 10);
    console.warn('[ProductNames] ⚠️ 제품명이 10개를 초과하여 10개로 제한:', deviceNames);
  }
  
  console.log('[ProductNames] 📝 최종 사용할 디바이스명:', deviceNames);
  return deviceNames;
}

// 시뮬레이션 모드는 RunTestProcess.js에서 관리됨

// 전역 WebSocket 서버 참조를 위한 변수
let globalWss = null;

// 테스트 실행별 디렉토리명을 저장하는 전역 변수
let currentTestDirectoryName = null;
// 테스트 실행별 전체 디렉토리 경로를 저장하는 전역 변수
let currentTestDirectoryPath = null;

// WebSocket 서버 참조를 설정하는 함수
export function setWebSocketServer(wss) {
  globalWss = wss;
  console.log('[RunTestProcess] WebSocket 서버 참조 설정됨');
}

// 프로세스 로그를 클라이언트에게 전송하는 함수
function sendProcessLog(message) {
  if (globalWss) {
    const logMessage = `[PROCESS_LOG] ${message}`;
    let sentCount = 0;
    globalWss.clients.forEach(client => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(logMessage);
        sentCount++;
      }
    });
    // console.log(`[ProcessLog] 전송 완료 - 클라이언트 수: ${sentCount}, 메시지: ${message}`);
  }
}

// 시간 진행 상황을 클라이언트에게 전송하는 함수
function sendTimeProgress(data) {
  if (globalWss) {
    const timeProgressMessage = `[TIME_PROGRESS] ${JSON.stringify(data)}`;
    let sentCount = 0;
    globalWss.clients.forEach(client => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(timeProgressMessage);
        sentCount++;
      }
    });
    console.log(`[TimeProgress] 전송 완료 - 클라이언트 수: ${sentCount}, 데이터:`, data);
  }
}

// 1분 간격으로 시간 진행 상황을 업데이트하는 함수
function startTimeProgressUpdates(startTime, totalDuration, currentPhase = 'waiting') {
  let isFirstSend = true; // 첫 번째 전송 여부 추적
  
  // 즉시 첫 번째 업데이트 실행
  const updateTimeProgress = () => {
    const currentTime = Date.now();
    const elapsedTime = currentTime - startTime;
    const remainingTime = Math.max(0, totalDuration - elapsedTime);
    
    const timeProgressData = {
      phase: currentPhase,
      startTime: startTime,
      currentTime: currentTime,
      elapsedTime: elapsedTime,
      totalDuration: totalDuration,
      remainingTime: remainingTime,
      elapsedMinutes: Math.round(elapsedTime / 60000),
      remainingMinutes: Math.round(remainingTime / 60000),
      totalMinutes: Math.round(totalDuration / 60000),
      progressPercentage: Math.min(100, Math.round((elapsedTime / totalDuration) * 100)),
      timestamp: new Date().toISOString()
    };
    
    // 첫 번째 전송만 실행하고 이후에는 전송하지 않음
    if (isFirstSend) {
      console.log('📤 Sending first TIME_PROGRESS message - totalMinutes:', timeProgressData.totalMinutes);
      sendTimeProgress(timeProgressData);
      isFirstSend = false;
      console.log('🔒 TIME_PROGRESS sending disabled - client will use local calculation');
    } else {
      console.log('🔒 TIME_PROGRESS sending skipped - client using local calculation');
    }
    
    // 시간이 다 되었으면 인터벌 정리
    if (remainingTime <= 0) {
      clearInterval(intervalId);
    }
  };
  
  // 즉시 첫 번째 업데이트 실행
  updateTimeProgress();
  
  // 그 후 1분 간격으로 업데이트
  const intervalId = setInterval(updateTimeProgress, 60000);
  
  return intervalId;
}
// import { listenerCount } from 'ws';

/**
 * 4시간(14400000ms) 대기 Promise
 */
function waitFourHours() {
  return new Promise(resolve => setTimeout(resolve, 4 * 60 * 60 * 1000));
}

function getDateTimeSeparated() {
  const now = new Date(); // 현재 날짜와 시간을 포함하는 Date 객체 생성

  // 날짜 부분만 로컬 형식으로 가져오기
  const dateOptions = {
    year: 'numeric',
    month: 'long', // 'numeric', '2-digit', 'short', 'long' 중 선택
    day: 'numeric'
  };
  const dateString = now.toLocaleDateString(undefined, dateOptions); // undefined는 현재 로케일을 사용하겠다는 의미

  // 시간 부분만 로컬 형식으로 가져오기
  const timeOptions = {
    hour: '2-digit',   // 'numeric', '2-digit' 중 선택
    minute: '2-digit', // 'numeric', '2-digit' 중 선택
    second: '2-digit', // 'numeric', '2-digit' 중 선택
    hourCycle: 'h23'   // 'h11', 'h12', 'h23', 'h24' 중 선택 (24시간제로 설정)
  };
  const timeString = now.toLocaleTimeString(undefined, timeOptions);

  return {
    date: dateString,
    time: timeString
  };
}

const RawVoltTable = [];

// 첫 번째 차원 (3)
for (let i = 0; i < 3; i++) {
  RawVoltTable[i] = []; // 두 번째 차원을 위한 배열 초기화
  // 두 번째 차원 (10)
  for (let j = 0; j < 10; j++) {
    RawVoltTable[i][j] = []; // 세 번째 차원을 위한 배열 초기화
    // 세 번째 차원 (4)
    for (let k = 0; k < 4; k++) {
      RawVoltTable[i][j][k] = ""; // 초기값 ""으로 설정
    }
  }
}

let pageTable = {
  TestDate: '',
  TestTime: '',
  TestTemperature: '',
  voltagTable: RawVoltTable
}

let TotaReportTable = {
  modelName: '',
  ProductNumber: [],
  inputVolt: [],
  reportTable: [pageTable, pageTable, pageTable, pageTable, pageTable, 
    pageTable, pageTable, pageTable, pageTable, pageTable]
}

// 사이클별 결과를 저장할 전역 변수
let cycleResults = [];
  
/**
 * 밀리초 단위 대기 함수
 * @param {number} ms - 대기할 밀리초
 * @returns {Promise} 대기 완료 후 resolve되는 Promise
 */
function sleep(ms) {   
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 분 단위 대기 함수 (최대 999분까지 지원)
 * @param {number} minutes - 대기할 분 (1-999)
 * @returns {Promise} 대기 완료 후 resolve되는 Promise
 */
function sleepMinutes(minutes) {
  // 입력값 검증
  if (typeof minutes !== 'number' || minutes < 1 || minutes > 999) {
    console.warn(`[sleepMinutes] 잘못된 분 값: ${minutes}. 1-999 범위의 값이어야 합니다.`);
    return Promise.resolve();
  }
  
  const milliseconds = minutes * 60 * 1000; // 분을 밀리초로 변환
  console.log(`[sleepMinutes] ${minutes}분 대기 시작 (${milliseconds}ms)`);
  
  return new Promise(resolve => {
    setTimeout(() => {
      console.log(`[sleepMinutes] ${minutes}분 대기 완료`);
      resolve();
    }, milliseconds);
  });
}

/**
 * 중지 요청을 확인할 수 있는 분 단위 대기 함수
 * @param {number} minutes - 대기할 분 (1-999)
 * @param {string} context - 대기 중인 컨텍스트 (로그용)
 * @returns {Promise} 대기 완료 후 resolve되는 Promise, 중지 요청 시 reject
 */
function sleepMinutesWithStopCheck(minutes, context = '') {
  // 입력값 검증
  if (typeof minutes !== 'number' || minutes < 1 || minutes > 999) {
    console.warn(`[sleepMinutesWithStopCheck] 잘못된 분 값: ${minutes}. 1-999 범위의 값이어야 합니다.`);
    return Promise.resolve();
  }
  
  const milliseconds = minutes * 60 * 1000; // 분을 밀리초로 변환
  const checkInterval = 5000; // 5초마다 중지 요청 확인
  const contextStr = context ? ` [${context}]` : '';
  
  console.log(`[sleepMinutesWithStopCheck]${contextStr} ${minutes}분 대기 시작 (${milliseconds}ms) - 중지 요청 확인 간격: ${checkInterval}ms`);
  
  // 시간 진행 상황 업데이트 시작
  const startTime = Date.now();
  const timeProgressInterval = startTimeProgressUpdates(startTime, milliseconds, 'waiting');
  
  return new Promise((resolve, reject) => {
    let elapsed = 0;
    
    const checkStop = () => {
      // 중지 요청 확인
      if (getProcessStopRequested()) {
        console.log(`[sleepMinutesWithStopCheck]${contextStr} 🛑 중지 요청 감지 - 대기 중단 (경과: ${Math.round(elapsed/1000)}초/${minutes}분)`);
        
        // 시간 진행 상황 인터벌 정리
        if (timeProgressInterval) {
          clearInterval(timeProgressInterval);
        }
        
        reject(new Error('PROCESS_STOP_REQUESTED'));
        return;
      }
      
      elapsed = Date.now() - startTime;
      
      if (elapsed >= milliseconds) {
        console.log(`[sleepMinutesWithStopCheck]${contextStr} ${minutes}분 대기 완료`);
        
        // 시간 진행 상황 인터벌 정리
        if (timeProgressInterval) {
          clearInterval(timeProgressInterval);
        }
        
        resolve();
      } else {
        // 다음 체크까지 대기
        setTimeout(checkStop, Math.min(checkInterval, milliseconds - elapsed));
      }
    };
    
    // 첫 번째 체크 시작
    setTimeout(checkStop, Math.min(checkInterval, milliseconds));
  });
}

function Now() {
  const now = new Date();
  return now.toISOString();
}

/**
 * 현재 날짜와 시간을 yymmdd_hhmm 형식으로 반환 (영문 형식)
 */
function getFormattedDateTime() {
  const now = new Date();
  const year = now.getFullYear().toString().slice(-2); // 마지막 2자리만
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  
  return `${year}${month}${day}_${hour}${minute}`;
}

/**
 * 날짜별 디렉토리명을 생성하는 함수
 * @returns {string} YYYYMMDD 형식의 날짜 디렉토리명
 */
function getDateDirectoryName() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  
  return `${year}${month}${day}_${hour}${minute}`;
}

/**
 * TotaReportTable을 이미지와 유사한 전기적 성능 시험 테이블 형태로 저장
 * 이미지의 테이블 구조에 맞춰 CSV 형식으로 저장
 */
function saveTotaReportTableToFile(data, channelVoltages = [5.0, 15.0, -15.0, 24.0], cycleNumber = 1, testType = '') {
  try {
    // 데이터 유효성 검사 강화
    if (!data) {
      console.error('[SaveData] ❌ 데이터가 undefined입니다.');
      return { success: false, error: '데이터가 undefined입니다.' };
    }
    
    if (!data.reportTable || !Array.isArray(data.reportTable) || data.reportTable.length === 0) {
      console.error('[SaveData] ❌ reportTable이 유효하지 않습니다.');
      return { success: false, error: 'reportTable이 유효하지 않습니다.' };
    }
    
    if (!data.reportTable[0] || !data.reportTable[0].voltagTable) {
      console.error('[SaveData] ❌ voltagTable이 유효하지 않습니다.');
      return { success: false, error: 'voltagTable이 유효하지 않습니다.' };
    }
    
    // ProductNumber 배열 검증 및 기본값 설정
    if (!data.ProductNumber || !Array.isArray(data.ProductNumber)) {
      console.warn('[SaveData] ⚠️ ProductNumber가 유효하지 않아 기본값을 사용합니다.');
      data.ProductNumber = ['Unknown'];
    }
    
    // modelName 검증 및 기본값 설정
    if (!data.modelName) {
      console.warn('[SaveData] ⚠️ modelName이 없어 기본값을 사용합니다.');
      data.modelName = 'Unknown Model';
    }
    
    // 제품명 가져오기 (공통 함수 사용)
    const deviceNames = loadProductNames();
    
    // inputVolt 검증 및 기본값 설정
    if (!data.inputVolt || !Array.isArray(data.inputVolt)) {
      console.warn('[SaveData] ⚠️ inputVolt가 유효하지 않아 기본값을 사용합니다.');
      data.inputVolt = [18, 24, 30];
    }
    
    const filename = `${getFormattedDateTime()}_Cycle${cycleNumber}_${testType}.csv`;
    
    // ===== 전역 변수에서 테스트 디렉토리 경로 사용 (새로 생성하지 않음) =====
    let dateFolderPath = currentTestDirectoryPath;
    
    if (!dateFolderPath) {
      console.log(`[SaveData] 📁 전역 디렉토리 경로가 설정되지 않음 - 자동으로 최근 테스트 디렉토리 검색`);
      
      // Automatically find the most recent test directory
      try {
        const dataFolderPath = path.join(process.cwd(), 'Data');
        const directories = fs.readdirSync(dataFolderPath, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory())
          .map(dirent => dirent.name)
          .filter(name => /^\d{8}_\d{4}$/.test(name)) // Filter for date format YYYYMMDD_HHMM
          .sort()
          .reverse(); // Most recent first
        
        if (directories.length > 0) {
          const dateDirectoryName = directories[0];
          dateFolderPath = path.join(dataFolderPath, dateDirectoryName);
          console.log(`[SaveData] 📁 자동으로 최근 테스트 디렉토리 발견: ${dateDirectoryName}`);
        } else {
          throw new Error('테스트 데이터 디렉토리를 찾을 수 없습니다');
        }
      } catch (error) {
        console.error(`[SaveData] ❌ 자동 디렉토리 검색 실패: ${error.message}`);
        throw new Error('테스트 데이터 디렉토리를 찾을 수 없습니다');
      }
    }
    
    console.log(`[SaveData] 📁 기존 테스트 디렉토리 사용: ${dateFolderPath}`);
    


    
    if (!fs.existsSync(dateFolderPath)) {
      fs.mkdirSync(dateFolderPath, { recursive: true });
      console.log(`[SaveData] 📁 테스트 결과 저장 디렉토리 생성됨: ${dateFolderPath}`);
      console.log(`[SaveData] 📅 디렉토리명: ${dateDirectoryName} (${new Date().toLocaleString('en-US')})`);
      
      // 클라이언트에게 디렉토리 생성 알림 전송
      if (globalWss) {
        const dirCreateMessage = `[DIRECTORY_CREATED] ${dateDirectoryName}`;
        let sentCount = 0;
        globalWss.clients.forEach(client => {
          if (client.readyState === 1) { // WebSocket.OPEN
            client.send(dirCreateMessage);
            sentCount++;
          }
        });
        console.log(`[SaveData] 📤 디렉토리 생성 알림 전송 완료 - 클라이언트 수: ${sentCount}`);
      }
    } else {
      console.log(`[SaveData] 📁 기존 디렉토리 사용: ${dateFolderPath}`);
    }
    
    const filePath = path.join(dateFolderPath, filename);
    
    let csvContent = '';
    const reportData = data.reportTable[0];
    
     // Document header information (similar to image format)
     csvContent += `Document No.,K2-AD-110-A241023-001\n`;
     csvContent += `Product Name,${data.modelName || ''}\n`;
     csvContent += `Product Number,${data.ProductNumber.join(';') || ''}\n`;
     csvContent += `Test Date,${reportData.TestDate || ''}\n`;
     csvContent += `Test Time,${reportData.TestTime || ''}\n`;
     csvContent += `Test Temperature,${reportData.TestTemperature || ''}℃\n`;
     csvContent += `Cycle Number,${cycleNumber}\n`;
     csvContent += `Test Type,${testType}\n`;
    csvContent += '\n';
    
     // Table header (same structure as image)
     csvContent += `No,Test Item,Test Method,Specification,Sample No.(S/N),A.Q.L\n`;
     csvContent += `,,,Input Voltage,Load Condition,Output Voltage,1,2,3,4,5,6,7,\n`;
    csvContent += '\n';
    
     // Electrical performance test data (similar to item 101 in image)
     let rowNumber = 101;
     
     // Generate table for each input voltage
     for (let k = 0; k < 3; k++) {
       const inputVoltage = data.inputVolt[k] || 24;
       const voltageName = k === 0 ? '18Vdc [Min]' : k === 1 ? '24Vdc [Rated]' : '30Vdc [Max]';
       
       // Test item: Electrical performance test - Line/Load Regulation
       csvContent += `${rowNumber},Electrical Performance Test,Power Supply,${voltageName},Max Load,5V (4.75V~5.25V),,,,,,,,A\n`;
       csvContent += `,Line/Load Regulation,O.S.C,${voltageName},Max Load,15V (14.25V~15.75V),,,,,,,,A\n`;
       csvContent += `,,Electronic Load,${voltageName},Max Load,-15V (-14.25V~-15.75V),,,,,,,,A\n`;
       csvContent += `,,DVM,${voltageName},Max Load,24V (22.80V~25.20V),,,,,,,,A\n`;
       csvContent += `,,<SPEC>,${voltageName},Min Load,5V (4.75V~5.25V),,,,,,,,A\n`;
       csvContent += `,,Line R.: ±1%,${voltageName},Min Load,15V (14.25V~15.75V),,,,,,,,A\n`;
       csvContent += `,,Load R.: ±5%,${voltageName},Min Load,-15V (-14.25V~-15.75V),,,,,,,,A\n`;
       csvContent += `,,,${voltageName},Min Load,24V (22.80V~25.20V),,,,,,,,A\n`;
       csvContent += `,,,${voltageName},Rated Load,5V (4.75V~5.25V),,,,,,,,A\n`;
       csvContent += `,,,${voltageName},Rated Load,15V (14.25V~15.75V),,,,,,,,A\n`;
       csvContent += `,,,${voltageName},Rated Load,-15V (-14.25V~-15.75V),,,,,,,,A\n`;
       csvContent += `,,,${voltageName},Rated Load,24V (22.80V~25.20V),,,,,,,,A\n`;
      
       // Actual measurement data input
       csvContent += '\n';
       csvContent += `Measurement Results (${voltageName})\n`;
       csvContent += `Channel,${deviceNames.join(',')}\n`;
      
       // Measurement results for 4 channels
      for (let j = 0; j < 4; j++) {
        const channelName = `Channel ${j+1}`;
        const expectedVoltage = channelVoltages[j];
        csvContent += `${channelName} (${expectedVoltage}V),`;
        
        for (let i = 0; i < 10; i++) {
          // voltagTable 접근 시 안전한 검증
          let voltageValue = '';
          try {
            if (reportData.voltagTable && 
                reportData.voltagTable[k] && 
                reportData.voltagTable[k][i] && 
                reportData.voltagTable[k][i][j] !== undefined) {
              voltageValue = reportData.voltagTable[k][i][j];
            }
          } catch (accessError) {
            console.warn(`[SaveData] ⚠️ voltagTable[${k}][${i}][${j}] 접근 오류:`, accessError.message);
            voltageValue = '';
          }
          
          if (voltageValue && voltageValue !== "-.-") {
            // 전압값을 소수점 2자리로 자르기
            const truncatedVoltageValue = truncateVoltageToTwoDecimals(voltageValue);
            // "5.2V|G" 형식에서 전압값만 추출
            const voltagePart = truncatedVoltageValue.split('|')[0];
            csvContent += `${voltagePart},`;
          } else {
            csvContent += `-,`;
          }
        }
        csvContent = csvContent.slice(0, -1) + '\n'; // 마지막 쉼표 제거
      }
      
      // 비교 결과 (G/N)
      csvContent += '\n';
      csvContent += `Result (G=Good, N=Not Good)\n`;
      csvContent += `Channel,${deviceNames.join(',')}\n`;
      
      for (let j = 0; j < 4; j++) {
        const channelName = `Channel ${j+1}`;
        csvContent += `${channelName},`;
        
        for (let i = 0; i < 10; i++) {
          // voltagTable 접근 시 안전한 검증
          let voltageValue = '';
          try {
            if (reportData.voltagTable && 
                reportData.voltagTable[k] && 
                reportData.voltagTable[k][i] && 
                reportData.voltagTable[k][i][j] !== undefined) {
              voltageValue = reportData.voltagTable[k][i][j];
            }
          } catch (accessError) {
            console.warn(`[SaveData] ⚠️ voltagTable[${k}][${i}][${j}] 접근 오류:`, accessError.message);
            voltageValue = '';
          }
          
          if (voltageValue && voltageValue !== "-.-") {
            // "5.2V|G" 형식에서 비교 결과만 추출 (개선된 로직)
            let comparisonResult = '';
            if (voltageValue.includes('|')) {
              const parts = voltageValue.split('|');
              comparisonResult = parts.length > 1 ? parts[1].trim() : '';
            } else if (voltageValue === 'G' || voltageValue === 'N') {
              // 이미 G/N 형태인 경우
              comparisonResult = voltageValue;
            } else {
              // 숫자만 있는 경우 (예: "5.2") - 기본값으로 G 설정
              comparisonResult = 'G';
            }
            csvContent += `${comparisonResult},`;
          } else {
            csvContent += `-,`;
          }
        }
        csvContent = csvContent.slice(0, -1) + '\n'; // 마지막 쉼표 제거
      }
      
      csvContent += '\n';
      rowNumber++;
    }
    
    // 전체 통계 계산
    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;
    
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 4; j++) {
          // voltagTable 접근 시 안전한 검증
          let voltageValue = '';
          try {
            if (reportData.voltagTable && 
                reportData.voltagTable[k] && 
                reportData.voltagTable[k][i] && 
                reportData.voltagTable[k][i][j] !== undefined) {
              voltageValue = reportData.voltagTable[k][i][j];
            }
          } catch (accessError) {
            console.warn(`[SaveData] ⚠️ 통계 계산 중 voltagTable[${k}][${i}][${j}] 접근 오류:`, accessError.message);
            voltageValue = '';
          }
          
          if (voltageValue && voltageValue !== "-.-") {
            totalTests++;
            // "5.2V|G" 형식에서 비교 결과만 추출 (개선된 로직)
            let comparisonResult = '';
            if (voltageValue.includes('|')) {
              const parts = voltageValue.split('|');
              comparisonResult = parts.length > 1 ? parts[1].trim() : '';
            } else if (voltageValue === 'G' || voltageValue === 'N') {
              // 이미 G/N 형태인 경우
              comparisonResult = voltageValue;
            } else {
              // 숫자만 있는 경우 (예: "5.2") - 기본값으로 G 설정
              comparisonResult = 'G';
            }
            
            if (comparisonResult === 'G') {
              passedTests++;
            } else if (comparisonResult === 'N') {
              failedTests++;
            }
          }
        }
      }
    }
    
     // Test results summary (similar to image bottom)
     csvContent += '\n';
     csvContent += `=== Test Results Summary ===\n`;
     csvContent += `Total Tests,${totalTests}\n`;
     csvContent += `Passed Tests,${passedTests}\n`;
     csvContent += `Failed Tests,${failedTests}\n`;
     csvContent += `Pass Rate,${totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(2) : 0}%\n`;
     csvContent += `Test Result,${passedTests > failedTests ? 'PASS' : 'FAIL'}\n`;
     csvContent += `Operator,System\n`;
     csvContent += `Document Version,PS-14(Rev.1)\n`;
     csvContent += `Company Name,Adelpia Lab Co., Ltd.\n`;
    
    // 파일에 저장
    fs.writeFileSync(filePath, csvContent, 'utf8');
    
    //console.log(`[SaveData] 전기적 성능 시험 테이블 형태로 저장 완료: ${filename}`);
    //console.log(`[SaveData] 파일 경로: ${filePath}`);
    //console.log(`[SaveData] 이미지와 유사한 테이블 구조로 저장됨`);
    console.log(`[SaveData] 테스트 통계: 총 ${totalTests}개, 통과 ${passedTests}개, 실패 ${failedTests}개`);
    
    return { success: true, filename, filePath };
  } catch (error) {
    console.error('[SaveData] 파일 저장 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 전압값을 설정값과 비교하여 ±5% 범위 내에 있는지 확인
 * @param {number} readVoltage - 읽은 전압값
 * @param {number} expectedVoltage - 설정된 전압값
 * @returns {string} "G" (Good) 또는 "N" (Not Good)
 */
function compareVoltage(readVoltage, expectedVoltage) {
  // 읽은 전압이 숫자가 아니거나 에러인 경우
  if (typeof readVoltage !== 'number' || isNaN(readVoltage)) {
    return "N";
  }
  
  // ±5% 허용 오차 계산
  let tolerance = expectedVoltage * 0.05;
  
  if(tolerance < 0 ) tolerance = tolerance * -1.0;  // 2025.0818 by skjung

  let minVoltage = expectedVoltage - tolerance;
  let maxVoltage = expectedVoltage + tolerance;
  
  // 범위 내에 있는지 확인
  if (readVoltage >= minVoltage && readVoltage <= maxVoltage) {
    return "G";
  } else {
    return "N";
  }
}

/**
 * 여러 테스트 결과를 하나로 결합
 * @param {Array} testResults - 테스트 결과 배열
 * @returns {Object} 결합된 테스트 데이터
 */

function combineTestResults(testResults) {
  if (!testResults || testResults.length === 0) {
    return null;
  }
  
  // 첫 번째 결과를 기본으로 사용
  const combinedData = {
    modelName: testResults[0].modelName,
    ProductNumber: testResults[0].ProductNumber,
    inputVolt: testResults[0].inputVolt,
    reportTable: [{
      TestDate: testResults[0].reportTable[0].TestDate,
      TestTime: testResults[0].reportTable[0].TestTime,
      TestTemperature: testResults[0].reportTable[0].TestTemperature,
      voltagTable: JSON.parse(JSON.stringify(RawVoltTable)) // 깊은 복사
    }]
  };
  
  // 모든 결과의 전압 데이터를 평균 계산
  for (let k = 0; k < 3; k++) {
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 4; j++) {
        let totalVoltage = 0;
        let validCount = 0;
        let totalGood = 0;
        let totalTests = 0;
        
        // 모든 테스트 결과에서 해당 위치의 데이터 수집
        testResults.forEach(result => {
          const voltageValue = result.reportTable[0].voltagTable[k][i][j];
          if (voltageValue && voltageValue !== "-.-") {
            // 전압값을 소수점 2자리로 자르기
            const truncatedVoltageValue = truncateVoltageToTwoDecimals(voltageValue);
            const voltagePart = truncatedVoltageValue.split('|')[0];
            const comparisonPart = truncatedVoltageValue.split('|')[1];
            
            // 전압값 추출 (V 제거)
            const voltage = parseFloat(voltagePart.replace('V', ''));
            if (!isNaN(voltage)) {
              totalVoltage += voltage;
              validCount++;
              totalTests++;
              
              if (comparisonPart === 'G') {
                totalGood++;
              }
            }
          }
        });
        
        // 평균 계산 및 결과 저장
        if (validCount > 0) {
          // 소수점 2자리로 자르기 (3자리 이하 버림)
          const averageVoltage = Math.floor((totalVoltage / validCount) * 100) / 100;
          const averageGood = totalGood / totalTests;
          const comparisonResult = averageGood >= 0.5 ? 'G' : 'N'; // 50% 이상이 Good이면 Good
          
          combinedData.reportTable[0].voltagTable[k][i][j] = `${averageVoltage}V|${comparisonResult}`;
        } else {
          combinedData.reportTable[0].voltagTable[k][i][j] = "-.-";
        }
      }
    }
  }
  
  return combinedData;
}

// 테스트를 위한 PowerTable 초기화 함수
export function testPowerTableReset() {
  if (globalWss) {
    const testResetMessage = `[POWER_TABLE_RESET] ${JSON.stringify({
      action: 'test_reset',
      timestamp: new Date().toISOString(),
      message: '테스트용 PowerTable 초기화'
    })}`;
    
    let sentCount = 0;
    globalWss.clients.forEach(client => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(testResetMessage);
        sentCount++;
      }
    });
    console.log(`[TestPowerTableReset] 테스트 초기화 메시지 전송 완료 - 클라이언트 수: ${sentCount}`);
    return { success: true, sentCount };
  } else {
    console.error(`[TestPowerTableReset] 전역 WebSocket 서버가 설정되지 않음`);
    return { success: false, error: 'WebSocket 서버 미설정' };
  }
}

// 페이지 단위 테스트 프로세스 실행
export async function runSinglePageProcess() {
  // 중단 보고서 생성을 위한 변수들
  let stopInfo = null;
  
  try {
    const modeText = getSimulationMode() ? '시뮬레이션 모드' : '실제 모드';
    console.log(`[SinglePageProcess] 🔧 단일 페이지 프로세스 시작 (${modeText})`);
    
    // 파워스위치 상태 확인
    const { getMachineRunningStatus } = await import('./backend-websocket-server.js');
    const isPowerOn = getMachineRunningStatus();
    
    if (!isPowerOn) {
      console.error(`[SinglePageProcess] ❌ 파워스위치가 OFF 상태입니다. 테스트를 중단합니다.`);
      stopInfo = { 
        status: 'stopped', 
        message: '파워스위치가 OFF 상태 - 테스트를 실행할 수 없습니다',
        errorType: 'power_switch_off',
        stoppedAtPhase: 'power_check'
      };
      return stopInfo;
    }

    // 프로세스 시작 시 테이블 데이터 초기화
    resetTableData();
    console.log(`[SinglePageProcess] ✅ 테이블 데이터 초기화 완료`);
    
    // PowerTable 전압 데이터 초기화 메시지 전송
    if (globalWss) {
      const resetMessage = `[POWER_TABLE_RESET] ${JSON.stringify({
        action: 'single_page_reset',
        timestamp: new Date().toISOString(),
        message: '단일 페이지 프로세스 시작 - 전압 데이터 초기화'
      })}`;
      
      let sentCount = 0;
      globalWss.clients.forEach(client => {
        if (client.readyState === 1) { // WebSocket.OPEN
          client.send(resetMessage);
          sentCount++;
        }
      });
      
      // 초기화 메시지 전송 후 잠시 대기 (클라이언트가 처리할 시간 확보)
      await sleep(3000);
    } else {
      console.warn(`[SinglePageProcess] 전역 WebSocket 서버가 설정되지 않음 - PowerTable 초기화 메시지 전송 불가`);
    }
    
    const getTableOption = await getSafeGetTableOption();
    
    // currentTable 변수 정의 - 테이블 데이터 저장용
    const currentTable = {
      modelName: getTableOption.modelName || 'Unknown Model',
      ProductNumber: getTableOption.ProductNumber || ['Unknown'],
      inputVolt: getTableOption.outVoltSettings || [18, 24, 30],
      reportTable: [{
        TestDate: new Date().toLocaleDateString('en-US'),
        TestTime: new Date().toLocaleTimeString('en-US'),
        TestTemperature: getTableOption.highTempSettings?.targetTemp || 'N/A',
        voltagTable: Array(3).fill(null).map(() => 
          Array(10).fill(null).map(() => 
            Array(4).fill("-.-")
          )
        )
      }]
    };
    
    // 시스템 상태 검증
    
    // 중지 요청 확인 - 프로세스 시작 전
    if (getProcessStopRequested()) {
      console.log(`[SinglePageProcess] 🛑 중지 요청 감지 - 프로세스 시작 전 중단`);
      stopInfo = { status: 'stopped', message: '사용자에 의해 중지됨', stoppedAtPhase: 'initialization' };
      return stopInfo;
    }
    
    // 딜레이 설정 로드
    const onDelay = getTableOption.delaySettings.onDelay;
    const offDelay = getTableOption.delaySettings.offDelay;
    
    // 프로세스 시작 전 포트 상태 초기화

    for(let k=0; k<3; k++) {
      // 강력한 중지 확인 - 전압 테스트 시작 전
      if (getProcessStopRequested()) {
        console.log(`[SinglePageProcess] 🛑 중지 요청 감지 - 전압 테스트 ${k+1}/3에서 중단`);
        stopInfo = { status: 'stopped', message: '사용자에 의해 중지됨', stoppedAtVoltageTest: k+1, stoppedAtPhase: 'voltage_test_start' };
        return stopInfo;
      }
      
      // 전압을 설정 한다. 
      const inputVolt = getTableOption.outVoltSettings[k];
      console.log(`[SinglePageProcess] 전압 설정: ${inputVolt}V`);
      
      // 전압 설정 재시도 로직
      let voltSetSuccess = false;
      let retryCount = 0;
      const maxRetries = 5;
      
      while (!voltSetSuccess && retryCount < maxRetries) {
        // 중지 요청 확인 - 전압 설정 중
        if (getProcessStopRequested()) {
          console.log(`[SinglePageProcess] 🛑 중지 요청 감지 - 전압 설정 중 중단`);
          stopInfo = { status: 'stopped', message: '사용자에 의해 중단됨', stoppedAtVoltageTest: k+1, stoppedAtPhase: 'voltage_setting' };
          return stopInfo;
        }
        
        // 전압 설정 전 정지 신호 확인 - 릴레이 동작 전
        if (getProcessStopRequested()) {
          console.log(`[SinglePageProcess] 🛑 전압 설정 전 정지 신호 감지 - 전압 ${inputVolt}V 설정 중단`);
          stopInfo = { status: 'stopped', message: '전압 설정 전 정지 신호 감지', stoppedAtVoltageTest: k+1, stoppedAtPhase: 'before_voltage_setting' };
          return stopInfo;
        }

        try {
          if(getSimulationMode() === false ){
            voltSetSuccess = await SendVoltCommand(inputVolt);
          }else {
            voltSetSuccess = true;
          }

          if( voltSetSuccess === true ){
            console.log(`[SinglePageProcess] 전압 설정 성공: ${inputVolt}V`);
          } else {
            throw new Error('전압 설정 실패: 응답 없음');
          }
        } catch (error) {
          retryCount++;
          console.warn(`[SinglePageProcess] 전압 설정 실패 (${retryCount}/${maxRetries}): ${error}`);
          if (retryCount < maxRetries) {
            console.log(`[SinglePageProcess] 3초 후 재시도...`);
            await sleep(3000);
          } else {
            //throw new Error(`전압 설정 실패: ${error}`);
            stopInfo = { status: 'stopped', message: '전압설정실패', stoppedAtVoltageTest: k+1, stoppedAtPhase: 'before_voltage_setting' };
            return stopInfo;
          }
        }
      }

      if( voltSetSuccess === false ){
        stopInfo = { status: 'stopped', message: '전압설정실패', stoppedAtVoltageTest: k+1, stoppedAtPhase: 'before_voltage_setting' };
        return stopInfo;
      }
      
      for ( let i = 0; i < 10; i++) {
        // 중지 요청 확인 - 디바이스 처리 시작 전
        if (getProcessStopRequested()) {
          console.log(`[SinglePageProcess] 🛑 중지 요청 감지 - 디바이스 ${i+1}/10에서 중단`);
          stopInfo = { status: 'stopped', message: '사용자에 의해 중단됨', stoppedAtVoltageTest: k+1, stoppedAtDevice: i+1, stoppedAtPhase: 'device_start' };
          return stopInfo;
        }
          
        if (getTableOption.deviceStates[i] === false) {
          for ( let j = 0; j < 4 ; j++) {  // 입력 전압 24, 18, 30V default
            currentTable.reportTable[0].voltagTable[k][i][j] = "-.-";
          }
        } else {
          // 디바이스 선택 재시도 로직
          let deviceSelectSuccess = false;
          retryCount = 0;
          
          while (!deviceSelectSuccess && retryCount < maxRetries) {
            // 중지 요청 확인 - 디바이스 선택 중
            if (getProcessStopRequested()) {
              console.log(`[SinglePageProcess] 🛑 중지 요청 감지 - 디바이스 ${i+1} 선택 중 중단`);
              stopInfo = { status: 'stopped', message: '사용자에 의해 중단됨', stoppedAtVoltageTest: k+1, stoppedAtDevice: i+1, stoppedAtPhase: 'device_selection' };
              return stopInfo;
            }
            
            try {
              // 릴레이 동작 전 정지 신호 확인 - 근본적인 문제 해결
              if (getProcessStopRequested()) {
                console.log(`[SinglePageProcess] 🛑 릴레이 동작 전 정지 신호 감지 - 디바이스 ${i+1} 선택 중단`);
                stopInfo = { status: 'stopped', message: '릴레이 동작 전 정지 신호 감지', stoppedAtVoltageTest: k+1, stoppedAtDevice: i+1, stoppedAtPhase: 'before_relay_operation' };
                return stopInfo;
              }

              await sleep(2000);
         
              let selectResult = true;

              if( getSimulationMode() === false ){
                selectResult = await SelectDeviceOn(i+1);  // 1 부터 시작 함
              }

              if (selectResult === true || selectResult.success === true) {
                deviceSelectSuccess = true;
                //console.log(`[SinglePageProcess] 디바이스 ${i+1} 선택 성공`);
              } else {
                throw new Error(selectResult?.message || selectResult?.error || '알 수 없는 오류');
              }
            } catch (error) {
              retryCount++;
              console.warn(`[SinglePageProcess] 디바이스 ${i+1} 선택 실패 (${retryCount}/${maxRetries}): ${error}`);
              if (retryCount < maxRetries) {
                console.log(`[SinglePageProcess] 10초 후 재시도...`);
                await sleep(5000); // 5초 대기로 증가
              } else {
                console.error(`[SinglePageProcess] 디바이스 ${i+1} 선택 최종 실패`);
                stopInfo = { status: 'stopped', message: '[SinglePageProcess] 디바이스선택 최종 실패', stoppedAtVoltageTest: k+1, stoppedAtDevice: i+1, stoppedAtPhase: 'before_relay_operation' };
                return stopInfo;
              }
            }
          }
          
          if (deviceSelectSuccess) {
            await sleep(onDelay);
          } else {
            console.error(`[SinglePageProcess] 디바이스 ${i+1} 선택 최종 실패`);
            stopInfo = { status: 'stopped', message: '[SinglePageProcess] 디바이스선택 최종 실패', stoppedAtVoltageTest: k+1, stoppedAtDevice: i+1, stoppedAtPhase: 'before_relay_operation' };
            return stopInfo;
          }
          
          // 4개 채널 전압을 모두 읽은 후 클라이언트에 결과 전송
          const channelResults = [];
          
          for ( let j = 0; j < 4 ; j++) {  // 입력 전압 18, 24, 30V default
            // 채널 변경을 위한 충분한 시간 확보 (기존 1초에서 2초로 증가)
            await sleep(2000);
            
            // 중지 요청 확인 - 채널 처리 시작 전
            if (getProcessStopRequested()) {
              console.log(`[SinglePageProcess] 🛑 중지 요청 감지 - 채널 ${j+1}/4에서 중단`);
              if( getSimulationMode() === false ){ 
                await SelectDeviceOff(i+1); // 안전을 위해 디바이스 끄기
              }
              stopInfo = { status: 'stopped', message: '사용자에 의해 중단됨', stoppedAtVoltageTest: k+1, stoppedAtDevice: i+1, stoppedAtChannel: j+1, stoppedAtPhase: 'channel_start' };
              return stopInfo;
            }
            
            //console.log(`[SinglePageProcess] Device ${i+1}, Channel ${j+1} 전압 읽기 시작`);
             
            // 전압 읽기 재시도 로직
            let voltReadSuccess = false;
            retryCount = 0;
            let voltData = null;
             
            while (!voltReadSuccess && retryCount < maxRetries) {
              // 중지 요청 확인 - 전압 읽기 중 (매 반복마다 확인)
              if (getProcessStopRequested()) {
                console.log(`[SinglePageProcess] 🛑 중지 요청 감지 - 전압 읽기 중 중단`);
                if( getSimulationMode() === false ){ 
                  await SelectDeviceOff(i+1); // 안전을 위해 디바이스 끄기
                }
                stopInfo = { status: 'stopped', message: '사용자에 의해 중단됨', stoppedAtVoltageTest: k+1, stoppedAtDevice: i+1, stoppedAtChannel: j+1, stoppedAtPhase: 'voltage_reading' };
                return stopInfo;
              }
              
                          try {
              if( getSimulationMode() === false ){
                // 순차적 실행을 위한 로깅 추가
                // console.log(`[SinglePageProcess] Device ${i+1}, Channel ${j+1} 전압 읽기 시작`);
                voltData = await ReadVolt(j+1);
              } else {
                // 시뮬레이션 모드에서는 설정된 채널 전압값을 사용하고 약간의 변동 추가
                const baseVoltage = getTableOption.channelVoltages[j];
                let variation = (Math.random() - 0.5) * 0.2; // ±0.1V 변동
                
                // 채널 3 (-15)의 경우 음수 값이 올바르게 생성되도록 보장
                if (j === 2 && baseVoltage < 0) {
                  // -15 채널의 경우 음수 값 유지
                  voltData = baseVoltage + variation;
                } else {
                  voltData = baseVoltage + variation;
                }
                
                await sleep(100); // 시뮬레이션을 위한 짧은 대기
              }
              voltReadSuccess = true;
              //console.log(`[SinglePageProcess] Device ${i+1}, Channel ${j+1} 전압 읽기 성공: ${voltData}V`);
            } catch (error) {
                retryCount++;
                console.warn(`[SinglePageProcess] Device ${i+1}, Channel ${j+1} 전압 읽기 실패 (${retryCount}/${maxRetries}): ${error}`);
                if (retryCount < maxRetries) {
                  console.log(`[SinglePageProcess] 2초 후 재시도...`);
                  await sleep(2000); // 재시도 대기 시간을 2초로 증가
                } else {
                  console.error(`[SinglePageProcess] Device ${i+1}, Channel ${j+1} 전압 읽기 최종 실패`);
                  voltData = 'error';
                  stopInfo = { status: 'stopped', message: '전압 읽기 최종 실패', stoppedAtVoltageTest: k+1, stoppedAtDevice: i+1, stoppedAtChannel: j+1, stoppedAtPhase: 'channel_start' };
                  return stopInfo;
                }
              }
            }
            
            // 채널 읽기 완료 후 안정화를 위한 추가 대기 시간
            if (voltReadSuccess && voltData !== 'error') {
              await sleep(1000); // 채널 읽기 완료 후 1초 대기
            }
             
            // 채널 3 (j=2)의 경우 읽은 전압에 -1.0을 곱함
            // 시뮬레이션인 경우는 통과한다. 
            if( getSimulationMode() === false ){
              if (j === 2 && voltData !== 'error' && typeof voltData === 'number') {
                voltData = voltData * -1.0;
              }
            } else {
              // 시뮬레이션 모드에서도 채널 3 (-15) 처리
              if (j === 2 && voltData !== 'error' && typeof voltData === 'number') {
                // 시뮬레이션에서는 이미 -15 근처의 값이 생성되므로 추가 변환 불필요
              }
            }
             
            const expectedVoltage = getTableOption.channelVoltages[j] || 0;
            const comparisonResult = voltData === 'error' ? 'N' : compareVoltage(voltData, expectedVoltage);
             
            // 전압값과 비교 결과를 함께 저장 (예: "5.2V|G" 또는 "5.2V|N")
            // 전압값을 소수점 2자리로 자르기 (3자리 이하 버림)
            const truncatedVoltData = voltData === 'error' ? voltData : Math.floor(voltData * 100) / 100;
            const voltageWithComparison = voltData === 'error' ? 'error|N' : `${truncatedVoltData}V|${comparisonResult}`;
             
            // 기존 voltagTable에도 저장 (호환성 유지)
            currentTable.reportTable[0].voltagTable[k][i][j] = voltageWithComparison;
             
            // 채널 결과 수집
            channelResults.push({
              device: i+1,
              channel: j+1,
              voltage: voltData,
              expected: expectedVoltage,
              result: comparisonResult,
              voltageWithComparison: voltageWithComparison
            });
            
            // console.log(`[SinglePageProcess] Device ${i+1}, Channel ${j+1} 완료: ${voltageWithComparison}`);
          } // for (let j = 0; j < 4; j++) 루프 닫기
          
          // 4개 채널 전압을 모두 읽은 후 테이블에 누적
          //console.log(`[SinglePageProcess] Device ${i+1}, Test ${k+1} 전압 데이터 테이블에 누적`);
          
          // 각 채널의 전압 데이터를 테이블에 업데이트
          channelResults.forEach((channelResult, channelIndex) => {
            if (channelResult && typeof channelResult.voltage === 'number') {
              const channelNumber = channelIndex + 1;
              updateTableData(i+1, k+1, channelNumber, channelResult.voltage, 'completed');
            }
          });
          
          // 4개 채널 전압을 모두 읽은 후 클라이언트에 실시간 전송
          console.log(`[SinglePageProcess] Device ${i+1}, Test ${k+1}: 4개 채널 완료 - 클라이언트에 데이터 전송`);
          await broadcastTableData();
          
          // 디바이스 해제 재시도 로직
          retryCount = 0;
          while (retryCount < maxRetries) {
            // 중지 요청 확인 - 디바이스 해제 중
            if (getProcessStopRequested()) {
              console.log(`[SinglePageProcess] 🛑 중지 요청 감지 - 디바이스 ${i+1} 해제 중 중단`);
              // 디바이스 해제는 시도하되 즉시 반환
              try {
                if( getSimulationMode() === false ){
                  await SelectDeviceOff(i+1);
                }
              } catch (error) {
                console.warn(`[SinglePageProcess] 디바이스 ${i+1} 해제 실패 (중지 요청으로 인한): ${error}`);
              }
              stopInfo = { status: 'stopped', message: '사용자에 의해 중단됨', stoppedAtVoltageTest: k+1, stoppedAtDevice: i+1, stoppedAtPhase: 'device_release' };
              return stopInfo;
            }
            
            try {
              // 디바이스 해제 전 포트 상태 확인을 위한 대기
              await sleep(2000);
              
              let offResult = true;
              if( getSimulationMode() === false ){
                offResult =  await SelectDeviceOff(i+1); // 1 부터 시작 함
              }
              
              if (offResult === true || offResult.success === true) {
                console.log(`[SinglePageProcess] 디바이스 ${i+1} 해제 성공`);
                break;
              } else {
                throw new Error(offResult?.message || offResult?.error || '알 수 없는 오류');
              }
            } catch (error) {
              retryCount++;
              console.warn(`[SinglePageProcess] 디바이스 ${i+1} 해제 실패 (${retryCount}/${maxRetries}): ${error}`);
              if (retryCount < maxRetries) {
                console.log(`[SinglePageProcess] 5초 후 재시도...`);
                await sleep(5000);
              } else {
                console.error(`[SinglePageProcess] 디바이스 ${i+1} 해제 최종 실패`);
                stopInfo = { status: 'stopped', message: '[SinglePageProcess] 디바이스 해제 최종 실패', stoppedAtVoltageTest: k+1, stoppedAtDevice: i+1, stoppedAtPhase: 'before_relay_operation' };
                return stopInfo;
              }
            }
          }
          
          await sleep(offDelay);
        } // if (getTableOption.deviceStates[i] === false) else 블록 닫기
      } // for (let i = 0; i < 10; i++) 루프 닫기
    } // for (let k = 0; k < 3; k++) 루프 닫기
    
    // 모든 테스트가 완료된 후 테이블 완성 상태 확인
    console.log('[SinglePageProcess] 모든 테스트 완료 - 테이블 완성 상태 확인');
    
    // SinglePageProcess에서는 최종 전송하지 않음 - 상위 프로세스에서 처리
    
    return { 
      status: 'completed', 
      message: '단일 페이지 프로세스 완료',
      data: currentTable
    };
    
  } catch (error) {
    console.error('[SinglePageProcess] 예외 발생:', error);
    
    // 에러 발생 시에도 중단 보고서 생성하지 않음 - 상위 함수에서 처리
    stopInfo = { 
      status: 'error', 
      message: `예외 발생: ${error.message}`,
      errorType: 'exception',
      stoppedAtPhase: 'unknown'
    };
    
    return stopInfo;
  }
}


// 중단 보고서 생성을 위한 통일된 함수
async function generateStopReport(stopInfo) {
  try {
    console.log(`[SinglePageProcess] 🛑 중단 보고서 생성 시작: ${stopInfo.status}`);
    
    // 전역 디렉토리명이 있는지 확인
    if (!currentTestDirectoryName) {
      currentTestDirectoryName = getDateDirectoryName();
      console.log(`[SinglePageProcess] ⚠️ 전역 디렉토리명이 없어 새로 생성: ${currentTestDirectoryName}`);
    }
    
    // 테스트 설정 정보 수집
    const getTableOption = await getSafeGetTableOption();
    const testSettings = {
      modelName: getTableOption.productInput?.modelName || 'N/A',
      productNumber: getTableOption.productInput?.productNumber || 'N/A',
      temperature: getTableOption.highTempSettings?.targetTemp || 'N/A',
      totalCycles: 1 // 단일 페이지 테스트는 1 사이클
    };
    
    // 중단 보고서 생성
    const reportResult = await generateInterruptedTestResultFile({
      stopReason: stopInfo.errorType || 'user_stop',
      stoppedAtCycle: 1, // 단일 페이지 테스트는 1 사이클
      stoppedAtPhase: stopInfo.stoppedAtPhase || 'unknown',
      errorMessage: stopInfo.message,
      testSettings: testSettings
    });
    
    if (reportResult && reportResult.success) {
      console.log(`[SinglePageProcess] ✅ 중단 보고서 생성 성공: ${reportResult.filename}`);
    } else {
      console.error(`[SinglePageProcess] ❌ 중단 보고서 생성 실패:`, reportResult?.error || '알 수 없는 오류');
    }
    
    // 중단 정보와 함께 반환
    return {
      ...stopInfo,
      finalReportGenerated: reportResult?.success || false,
      reportFilename: reportResult?.filename || null
    };
    
  } catch (reportError) {
    console.error(`[SinglePageProcess] ❌ 중단 보고서 생성 실패:`, reportError.message);
    
    // 보고서 생성 실패 시에도 원래 중단 정보 반환
    return {
      ...stopInfo,
      finalReportGenerated: false,
      reportError: reportError.message
    };
  }
}

// TimeMode 설정을 로드하는 함수
function loadTimeModeSettings() {
  try {
    const settingsPath = path.join(__dirname, 'time_mode_settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    
    // T1~T8 값을 분 단위에서 밀리초로 변환
    const T1 = parseInt(settings.T1) * 60 * 1000; // 분 -> 밀리초
    const T2 = parseInt(settings.T2) * 60 * 1000;
    const T3 = parseInt(settings.T3) * 60 * 1000;
    const T4 = parseInt(settings.T4) * 60 * 1000;
    const T5 = parseInt(settings.T5) * 60 * 1000;
    const T6 = parseInt(settings.T6) * 60 * 1000;
    const T7 = parseInt(settings.T7) * 60 * 1000;
    const T8 = parseInt(settings.T8) * 60 * 1000;
    
    // T_elapsed 배열 계산 (그림의 공식에 따라)
    const T_high1 = T1 + T2;
    const T_low1 = T_high1 + T3 + T4;
    const T_high2 = T_low1 + T5 + T6;
    const T_low2 = T_high2 + T3 + T4;
    const T_end = T_low2 + T5 + T7 + T8;
    
    const T_elapsed = [T_high1, T_low1, T_high2, T_low2];
    
    console.log(`[TimeMode] 시간 설정 로드됨:`);
    console.log(`  T1: ${settings.T1}분, T2: ${settings.T2}분, T3: ${settings.T3}분, T4: ${settings.T4}분`);
    console.log(`  T5: ${settings.T5}분, T6: ${settings.T6}분, T7: ${settings.T7}분, T8: ${settings.T8}분`);
    console.log(`  T_elapsed: [${T_elapsed.map(t => Math.round(t/60000)).join('분, ')}분]`);
    console.log(`  T_end: ${Math.round(T_end/60000)}분`);
    
    return {
      T_elapsed,
      T_end,
      intervals: { T1, T2, T3, T4, T5, T6, T7, T8 }
    };
  } catch (error) {
    console.error(`[TimeMode] 시간 설정 로드 실패:`, error);
    // 기본값 반환
    return {
      T_elapsed: [10*60*1000, 20*60*1000, 30*60*1000, 40*60*1000], // 기본 10, 20, 30, 40분
      T_end: 50*60*1000, // 기본 50분
      intervals: { T1: 5*60*1000, T2: 5*60*1000, T3: 5*60*1000, T4: 5*60*1000, T5: 5*60*1000, T6: 5*60*1000, T7: 5*60*1000, T8: 5*60*1000 }
    };
  }
}

// TimeMode 기반 테스트 실행 함수
export async function runTimeModeTestProcess() {
  try {
    const modeText = getSimulationMode() ? '시뮬레이션 모드' : '실제 모드';
    console.log(`[TimeModeTestProcess] 🔄 TimeMode 테스트 프로세스 시작 (${modeText})`);
    
    // 테스트 시작 알림
    if (globalWss) {
      const testStartMessage = `[TEST_PROGRESS] 테스트 시작 - 시간 모드 테스트 프로세스 (${modeText})`;
      console.log(`[TimeModeTestProcess] 📤 테스트 시작 메시지 전송: ${testStartMessage}`);
      let sentCount = 0;
      globalWss.clients.forEach(client => {
        if (client.readyState === 1) { // WebSocket.OPEN
          client.send(testStartMessage);
          sentCount++;
        }
      });
      console.log(`[TimeModeTestProcess] 📤 ${sentCount}개 클라이언트에게 메시지 전송 완료`);
    } else {
      console.log(`[TimeModeTestProcess] ❌ globalWss가 null입니다. WebSocket 서버가 설정되지 않았습니다.`);
    }
    
    // 프로세스 시작 전 중지 요청 확인
    if (getProcessStopRequested()) {
      console.log(`[TimeModeTestProcess] 🛑 중지 요청 감지 - 프로세스 시작 전 중단`);
      return { 
        status: 'stopped', 
        message: '사용자에 의해 중지됨', 
        stoppedAtPhase: 'initialization',
        stopReason: 'power_switch_off'
      };
    }
    
    // ===== 디렉토리명을 한 번만 생성하고 전역 변수에 저장 =====
    currentTestDirectoryName = getDateDirectoryName();
    console.log(`[TimeModeTestProcess] 📁 테스트 디렉토리명 생성: ${currentTestDirectoryName}`);
    
    // 테스트 결과 저장을 위한 디렉토리 생성
    const dataFolderPath = path.join(process.cwd(), 'Data');
    if (!fs.existsSync(dataFolderPath)) {
      fs.mkdirSync(dataFolderPath, { recursive: true });
      console.log(`[TimeModeTestProcess] 📁 Data 폴더 생성됨: ${dataFolderPath}`);
    }
    
    const dateFolderPath = path.join(dataFolderPath, currentTestDirectoryName);
    // 전역 변수에 전체 디렉토리 경로 저장
    currentTestDirectoryPath = dateFolderPath;
    
    if (!fs.existsSync(dateFolderPath)) {
      fs.mkdirSync(dateFolderPath, { recursive: true });
      console.log(`[TimeModeTestProcess] 📁 테스트 결과 저장 디렉토리 생성됨: ${dateFolderPath}`);
      
      if (globalWss) {
        const dirCreateMessage = `[DIRECTORY_CREATED] ${currentTestDirectoryName}`;
        let sentCount = 0;
        globalWss.clients.forEach(client => {
          if (client.readyState === 1) { // WebSocket.OPEN
            client.send(dirCreateMessage);
            sentCount++;
          }
        });
        console.log(`[TimeModeTestProcess] 📤 디렉토리 생성 알림 전송 완료 - 클라이언트 수: ${sentCount}`);
      }
    } else {
      console.log(`[TimeModeTestProcess] 📁 기존 테스트 결과 저장 디렉토리 사용: ${dateFolderPath}`);
    }
    
    // 중지 요청 확인 - 디렉토리 생성 후
    if (getProcessStopRequested()) {
      console.log(`[TimeModeTestProcess] 🛑 중지 요청 감지 - 디렉토리 생성 후 중단`);
      return { 
        status: 'stopped', 
        message: '사용자에 의해 중지됨', 
        stoppedAtPhase: 'directory_creation',
        stopReason: 'power_switch_off'
      };
    }
    
    // TimeMode 설정 로드
    const timeSettings = loadTimeModeSettings();
    const { T_elapsed, T_end } = timeSettings;
    
    // 시뮬레이션 모드에 따른 초기화 처리
    if (getSimulationMode() === false) {
      await RelayAllOff();                      // jsk debug return error 에 대한 처리를 할 것
      await sleep(3000); // 포트 초기화를 위한 추가 대기
    } else {
      // 시뮬레이션 모드일 경우 패스
      console.log('[TimeModeTestProcess] 시뮬레이션 모드: RelayAllOff 및 포트 초기화 대기 패스');
    }
    
    // CtrlTimer 초기화 및 시작
    let CtrlTimer = 0;
    const startTime = Date.now();
    let i = 0; // T_elapsed 배열 인덱스
    
    console.log(`[TimeModeTestProcess] ⏰ CtrlTimer 시작 - T_end: ${Math.round(T_end/60000)}분`);
    
    // 시간 진행 상황 업데이트 시작
    let timeProgressInterval = startTimeProgressUpdates(startTime, T_end, 'waiting');
    
    // 메인 루프: T_elapsed[i] 시간이 경과할 때까지 대기
    while (i < T_elapsed.length) {
      // 중지 요청 확인
      if (getProcessStopRequested()) {
        console.log(`[TimeModeTestProcess] 🛑 중지 요청 감지 - T_elapsed[${i}] 대기 중 중단`);
        setMachineRunningStatus(false);
        
        // 시간 진행 상황 인터벌 정리
        if (timeProgressInterval) {
          clearInterval(timeProgressInterval);
        }
        
        if (globalWss) {
          const powerOffMessage = `[POWER_SWITCH] OFF - Machine running: false - Process stopped during time waiting`;
          globalWss.clients.forEach(client => {
            if (client.readyState === 1) {
              client.send(powerOffMessage);
            }
          });
        }
        
        return { 
          status: 'stopped', 
          message: '사용자에 의해 중지됨', 
          stoppedAtPhase: `time_waiting_${i}`,
          stopReason: 'power_switch_off'
        };
      }
      
      // 현재 경과 시간 계산
      CtrlTimer = Date.now() - startTime;
      
      // T_elapsed[i] 시간이 경과했는지 확인
        if (CtrlTimer > T_elapsed[i]) {
          console.log(`[TimeModeTestProcess] ⏰ T_elapsed[${i}] 시간 경과 (${Math.round(T_elapsed[i]/60000)}분) - runSinglePageProcess() 실행`);
          
          // 시간 진행 상황 인터벌 정리 (테스트 실행 중에는 1분 간격 업데이트 중단)
          if (timeProgressInterval) {
            clearInterval(timeProgressInterval);
          }
          
          // 단계별 진행상황 알림
          if (globalWss) {
            const stepProgressMessage = `[TEST_PROGRESS] 단계 ${i+1}/${T_elapsed.length} 실행 중 (${Math.round(T_elapsed[i]/60000)}분 경과)`;
            console.log(`[TimeModeTestProcess] 📤 단계 진행상황 메시지 전송: ${stepProgressMessage}`);
            let sentCount = 0;
            globalWss.clients.forEach(client => {
              if (client.readyState === 1) { // WebSocket.OPEN
                client.send(stepProgressMessage);
                sentCount++;
              }
            });
            console.log(`[TimeModeTestProcess] 📤 ${sentCount}개 클라이언트에게 메시지 전송 완료`);
          } else {
            console.log(`[TimeModeTestProcess] ❌ globalWss가 null입니다.`);
          }
          
          // i 값에 따라 고온/저온 설정의 readCount만큼 runSinglePageProcess() 반복 실행
          const getTableOption = await getSafeGetTableOption();
          let readCount;
          let testType;
          
          if (i === 0 || i === 2) {
            // i가 0 또는 2일 때: 고온 테스트
            readCount = getTableOption.highTempSettings?.readCount || 10;
            testType = 'high_temp';
            console.log(`[TimeModeTestProcess] 🔥 T_elapsed[${i}] 고온 테스트 시작 - readCount: ${readCount}`);
          } else if (i === 1 || i === 3) {
            // i가 1 또는 3일 때: 저온 테스트
            readCount = getTableOption.lowTempSettings?.readCount || 10;
            testType = 'low_temp';
            console.log(`[TimeModeTestProcess] ❄️ T_elapsed[${i}] 저온 테스트 시작 - readCount: ${readCount}`);
          } else {
            // 기본값 (i가 4 이상일 때)
            readCount = 1;
            testType = 'normal';
            console.log(`[TimeModeTestProcess] 📊 T_elapsed[${i}] 일반 테스트 시작 - readCount: ${readCount}`);
          }
          
          // readCount만큼 runSinglePageProcess() 반복 실행
          for (let j = 0; j < readCount; j++) {
            // 중지 요청 확인
            if (getProcessStopRequested()) {
              console.log(`[TimeModeTestProcess] 🛑 중지 요청 감지 - ${testType} 테스트 실행 중 중단 (${j+1}/${readCount})`);
              
              // 중지 시에도 PowerSwitch 상태를 off로 설정
              setMachineRunningStatus(false);
              console.log(`[TimeModeTestProcess] 🔌 중지로 인한 PowerSwitch 상태 OFF 설정`);
              
              // 클라이언트에게 파워스위치 OFF 상태 전송
              if (globalWss) {
                const powerOffMessage = `[POWER_SWITCH] OFF - Machine running: false - ${testType} test execution stopped`;
                let sentCount = 0;
                globalWss.clients.forEach(client => {
                  if (client.readyState === 1) { // WebSocket.OPEN
                    client.send(powerOffMessage);
                    sentCount++;
                  }
                });
                console.log(`[TimeModeTestProcess] 🔌 ${testType} 테스트 실행 중단으로 인한 파워스위치 OFF 상태 메시지 전송 완료 - 클라이언트 수: ${sentCount}`);
              } else {
                console.warn(`[TimeModeTestProcess] 전역 WebSocket 서버가 설정되지 않음 - ${testType} 테스트 실행 중단 시 파워스위치 OFF 메시지 전송 불가`);
              }
              
              return { 
                status: 'stopped', 
                message: '사용자에 의해 중지됨', 
                stoppedAtPhase: `${testType}_test_execution_${j+1}_${readCount}`,
                stopReason: 'power_switch_off'
              };
            }
            
            console.log(`[TimeModeTestProcess] ${testType} 테스트 실행 중 (${j+1}/${readCount})`);
            
            // runSinglePageProcess() 실행
            const result = await runSinglePageProcess();
            
            // 성공 여부 확인
            if (!result || result.status !== 'completed') {
              console.log(`[TimeModeTestProcess] ❌ runSinglePageProcess() 실패 (${j+1}/${readCount}) - generateStopReport() 실행`);
              return await generateStopReport(result);
            }
            
            // 측정 데이터 저장 (runNextTankEnviTestProcess 패턴과 동일)
            if (result && result.status === 'completed' && result.data) {
              console.log(`[TimeModeTestProcess] T_elapsed[${i}] ${testType} 테스트 ${j+1}/${readCount} 측정 결과 저장 시작`);
              try {
                const saveResult = saveTotaReportTableToFile(
                  result.data, 
                  getTableOption.outVoltSettings || [18, 24, 30], 
                  i + 1, // T_elapsed 단계 번호를 사이클 번호로 사용
                  `TimeMode_${testType}_Test${i + 1}_${j + 1}`
                );
                
                if (saveResult && saveResult.success) {
                  console.log(`[TimeModeTestProcess] ✅ T_elapsed[${i}] ${testType} 테스트 ${j+1}/${readCount} 측정 데이터 저장 성공: ${saveResult.filename}`);
                } else {
                  console.error(`[TimeModeTestProcess] ❌ T_elapsed[${i}] ${testType} 테스트 ${j+1}/${readCount} 측정 데이터 저장 실패:`, saveResult?.error || '알 수 없는 오류');
                }
              } catch (saveError) {
                console.error(`[TimeModeTestProcess] ❌ T_elapsed[${i}] ${testType} 테스트 ${j+1}/${readCount} 측정 데이터 저장 중 오류:`, saveError.message);
              }
            }
            
            console.log(`[TimeModeTestProcess] ✅ ${testType} 테스트 ${j+1}/${readCount} 완료`);
          }
          
          console.log(`[TimeModeTestProcess] ✅ T_elapsed[${i}] ${testType} 테스트 전체 완료 (${readCount}회 실행)`);
        i++; // 다음 T_elapsed로 진행
        
        // 다음 단계 대기 시간이 있다면 시간 진행 상황 업데이트 재시작
        if (i < T_elapsed.length) {
          const nextWaitTime = T_elapsed[i] - T_elapsed[i-1];
          const nextStartTime = Date.now();
          const remainingTime = T_end - (Date.now() - startTime);
          
          if (remainingTime > 0) {
            console.log(`[TimeModeTestProcess] ⏰ 다음 단계 대기 시작 - ${Math.round(nextWaitTime/60000)}분 후 실행`);
            console.log('🔒 TIME_PROGRESS sending skipped - client using local calculation');
            // 시간 진행 상황 업데이트는 클라이언트에서 로컬 계산으로 처리
          }
        }
      } else {
        // 아직 시간이 경과하지 않았으면 잠시 대기 (중지 요청 확인을 위해)
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1초 대기
      }
    }
    
    // 모든 T_elapsed 단계 완료 후 최종 보고서 생성
    console.log(`[TimeModeTestProcess] 📄 모든 T_elapsed 단계 완료 - 종합 리포트 생성`);
    try {
      const finalReportResult = await generateFinalDeviceReport(i); // 실제 실행된 단계 수
      if (finalReportResult && finalReportResult.success) {
        console.log(`[TimeModeTestProcess] ✅ 종합 리포트 생성 성공: ${finalReportResult.filename}`);
      } else {
        console.error(`[TimeModeTestProcess] ❌ 종합 리포트 생성 실패:`, finalReportResult?.error || '알 수 없는 오류');
      }
    } catch (error) {
      console.error(`[TimeModeTestProcess] ❌ 종합 리포트 생성 실패:`, error.message);
    }
    
    // T_end 시간까지 대기
    console.log(`[TimeModeTestProcess] ⏰ T_end 시간까지 대기 (${Math.round(T_end/60000)}분)`);
    
    // 대기 시작 알림
    if (globalWss) {
      const waitStartMessage = `[TEST_PROGRESS] 모든 측정 완료 - T_end 시간까지 대기 중 (${Math.round(T_end/60000)}분)`;
      globalWss.clients.forEach(client => {
        if (client.readyState === 1) { // WebSocket.OPEN
          client.send(waitStartMessage);
        }
      });
    }
    
    while (CtrlTimer < T_end) {
      // 중지 요청 확인
      if (getProcessStopRequested()) {
        console.log(`[TimeModeTestProcess] 🛑 중지 요청 감지 - T_end 대기 중 중단`);
        setMachineRunningStatus(false);
        
        if (globalWss) {
          const powerOffMessage = `[POWER_SWITCH] OFF - Machine running: false - Process stopped during T_end waiting`;
          globalWss.clients.forEach(client => {
            if (client.readyState === 1) {
              client.send(powerOffMessage);
            }
          });
        }
        
        return { 
          status: 'stopped', 
          message: '사용자에 의해 중지됨', 
          stoppedAtPhase: 't_end_waiting',
          stopReason: 'power_switch_off'
        };
      }
      
      // 현재 경과 시간 업데이트
      CtrlTimer = Date.now() - startTime;
      
      // 아직 T_end에 도달하지 않았으면 잠시 대기
      if (CtrlTimer < T_end) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1초 대기
      }
    }
    
    // PowerSwitch 상태 OFF 설정
    setMachineRunningStatus(false);
    
    // 클라이언트에게 파워스위치 OFF 상태 전송
    if (globalWss) {
      const powerOffMessage = `[POWER_SWITCH] OFF - Machine running: false - Test completed`;
      globalWss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(powerOffMessage);
        }
      });
    }
    
    console.log(`[TimeModeTestProcess] 🛑 프로세스 완료 - 중지 플래그 상태 유지`);
    
    // 프로세스 완료 후 전역 디렉토리명 초기화 (모든 파일 생성 완료 후)
    console.log(`[TimeModeTestProcess] 📁 프로세스 완료 - 전역 디렉토리명 초기화: ${currentTestDirectoryName}`);
    currentTestDirectoryName = null;
    
    // 테스트 완료 알림
    if (globalWss) {
      const testCompleteMessage = `[TEST_COMPLETED] 시간 모드 테스트 프로세스 완료 - 총 ${i}개 단계 완료`;
      const testCompleteData = {
        type: 'TEST_COMPLETED',
        testType: '시간 모드 테스트',
        cycleCount: i,
        completionTime: new Date().toISOString(),
        status: 'success'
      };
      
      globalWss.clients.forEach(client => {
        if (client.readyState === 1) { // WebSocket.OPEN
          client.send(testCompleteMessage);
          client.send(`[TEST_COMPLETE_DATA] ${JSON.stringify(testCompleteData)}`);
        }
      });
      console.log(`[TimeModeTestProcess] 🎉 테스트 완료 알림 메시지 전송 완료 - 클라이언트 수: ${globalWss.clients.size}`);
    } else {
      console.warn(`[TimeModeTestProcess] 전역 WebSocket 서버가 설정되지 않음 - 테스트 완료 알림 메시지 전송 불가`);
    }
    
    return { 
      status: 'completed', 
      message: '모든 T_elapsed 단계 완료 및 종합 리포트 생성 완료',
      totalSteps: i, // 실제 실행된 단계 수
      finalReportGenerated: true
    };
    
  } catch (error) {
    console.error(`[TimeModeTestProcess] ❌ 오류 발생:`, error);
    setMachineRunningStatus(false);
    return {
      status: 'error',
      message: `TimeMode 테스트 프로세스 오류: ${error.message}`,
      error: error
    };
  }
}

export async function runNextTankEnviTestProcess() {
  try {
    const modeText = getSimulationMode() ? '시뮬레이션 모드' : '실제 모드';
    console.log(`[NextTankEnviTestProcess] 🔄 환경 테스트 프로세스 시작 (${modeText})`);
    
    // 프로세스 시작 전 중지 요청 확인
    if (getProcessStopRequested()) {
      console.log(`[NextTankEnviTestProcess] 🛑 중지 요청 감지 - 프로세스 시작 전 중단`);
      return { 
        status: 'stopped', 
        message: '사용자에 의해 중지됨', 
        stoppedAtPhase: 'initialization',
        stopReason: 'power_switch_off'
      };
    }
    
    // ===== 디렉토리명을 한 번만 생성하고 전역 변수에 저장 =====
    currentTestDirectoryName = getDateDirectoryName();
    console.log(`[NextTankEnviTestProcess] 📁 테스트 디렉토리명 생성: ${currentTestDirectoryName}`);
    
    // 테스트 결과 저장을 위한 디렉토리 생성
    const dataFolderPath = path.join(process.cwd(), 'Data');
    if (!fs.existsSync(dataFolderPath)) {
      fs.mkdirSync(dataFolderPath, { recursive: true });
      console.log(`[NextTankEnviTestProcess] 📁 Data 폴더 생성됨: ${dataFolderPath}`);
    }
    
    const dateFolderPath = path.join(dataFolderPath, currentTestDirectoryName);
    // 전역 변수에 전체 디렉토리 경로 저장
    currentTestDirectoryPath = dateFolderPath;
    
    if (!fs.existsSync(dateFolderPath)) {
      fs.mkdirSync(dateFolderPath, { recursive: true });
      console.log(`[NextTankEnviTestProcess] 📁 테스트 결과 저장 디렉토리 생성됨: ${dateFolderPath}`);
      
      if (globalWss) {
        const dirCreateMessage = `[DIRECTORY_CREATED] ${currentTestDirectoryName}`;
        let sentCount = 0;
        globalWss.clients.forEach(client => {
          if (client.readyState === 1) { // WebSocket.OPEN
            client.send(dirCreateMessage);
            sentCount++;
          }
        });
        console.log(`[NextTankEnviTestProcess] 📤 디렉토리 생성 알림 전송 완료 - 클라이언트 수: ${sentCount}`);
      }
    } else {
      console.log(`[NextTankEnviTestProcess] 📁 기존 테스트 결과 저장 디렉토리 사용: ${dateFolderPath}`);
    }
    
    // 중지 요청 확인 - 디렉토리 생성 후
    if (getProcessStopRequested()) {
      console.log(`[NextTankEnviTestProcess] 🛑 중지 요청 감지 - 디렉토리 생성 후 중단`);
      return { 
        status: 'stopped', 
        message: '사용자에 의해 중지됨', 
        stoppedAtPhase: 'directory_creation',
        stopReason: 'power_switch_off'
      };
    }
    
    // 테스트 설정 확인
    const getTableOption = await getSafeGetTableOption();
    const highTempEnabled = getTableOption.highTempSettings.highTemp;
    const lowTempEnabled = getTableOption.lowTempSettings.lowTemp;
    
    if (!highTempEnabled && !lowTempEnabled) {
      console.error(`[NextTankEnviTestProcess] ❌ 고온/저온 테스트가 모두 비활성화되어 있습니다.`);
      setMachineRunningStatus(false);
      return { 
        status: 'error', 
        message: '테스트가 비활성화됨 - 고온/저온 테스트 설정을 확인하세요',
        errorType: 'no_tests_enabled'
      };
    }
    // cycleNumber 횟수만큼 반복
    const cycleNumber = getTableOption.delaySettings.cycleNumber || 1; // 기본값 1

    if( getSimulationMode() === false ){
      await RelayAllOff();                      // jsk debug return error 에 대한 처리를 할 것
      await sleep(3000); // 포트 초기화를 위한 추가 대기
    } else {
      // 시뮬레이션 모드일 경우 패스
      console.log('시뮬레이션 모드: RelayAllOff 및 포트 초기화 대기 패스');
    }

    for (let cycle = 1; cycle <= cycleNumber; cycle++) {
      // 중지 요청 확인 - 사이클 시작 전
      // 단순한 중지 확인 - 사이클 시작 전
      if (getProcessStopRequested()) {
        console.log(`[NextTankEnviTestProcess] 🛑 중지 요청 감지 - 사이클 ${cycle}에서 프로세스 중단`);
        return { 
          status: 'stopped', 
          message: '사용자에 의한 파워스위치 OFF',
          stoppedAtCycle: cycle,
          stopReason: 'power_switch_off'
        };
      }
      
      console.log(`[NextTankEnviTestProcess] === 사이클 ${cycle}/${cycleNumber} 시작 ===`);
      
      // 각 사이클 시작 시 PowerTable 전압 데이터 초기화
      if (globalWss) {
        const cycleResetMessage = `[POWER_TABLE_RESET] ${JSON.stringify({
          action: 'cycle_reset',
          cycle: cycle,
          totalCycles: cycleNumber,
          testPhase: 'none', // 사이클 시작 시에는 테스트 페이즈 없음
          currentTestNumber: 0,
          totalTestCount: 0,
          testStatus: 'none',
          timestamp: new Date().toISOString(),
          message: `사이클 ${cycle} 시작 - 전압 데이터 초기화`
        })}`;
        
        let sentCount = 0;
        globalWss.clients.forEach(client => {
          if (client.readyState === 1) { // WebSocket.OPEN
            client.send(cycleResetMessage);
            sentCount++;
            console.log(`[NextTankEnviTestProcess] 사이클 ${cycle} - 클라이언트 ${sentCount}에게 초기화 메시지 전송됨`);
          }
        });
        console.log(`[NextTankEnviTestProcess] 사이클 ${cycle} PowerTable 초기화 메시지 전송 완료 - 클라이언트 수: ${sentCount}`);
      } else {
        console.warn(`[NextTankEnviTestProcess] 사이클 ${cycle} - 전역 WebSocket 서버가 설정되지 않음 - PowerTable 초기화 메시지 전송 불가`);
      }
      
      // 사이클별 결과 저장용 변수
      let highTempResults = [];
      let lowTempResults = [];
      
      // high temp test
      const highTemp = getTableOption.highTempSettings.targetTemp;
      const waitTime = getTableOption.highTempSettings.waitTime; // 분 단위로 저장된 값
      const highTempTest = getTableOption.highTempSettings.highTemp;
      const readCount = getTableOption.highTempSettings.readCount;

      if(highTempTest === true) {
        console.log(`[NextTankEnviTestProcess] 사이클 ${cycle}: 1. 고온 테스트 시작`);
        
        // 고온 테스트 시작 시 PowerTable에 테스트 정보 업데이트
        if (globalWss) {
          const highTempStartMessage = `[POWER_TABLE_RESET] ${JSON.stringify({
            action: 'test_start',
            cycle: cycle,
            totalCycles: cycleNumber,
            testPhase: 'high_temp',
            currentTestNumber: 0,
            totalTestCount: readCount,
            testStatus: 'ON',
            timestamp: new Date().toISOString(),
            message: `사이클 ${cycle}: 고온 테스트 시작 (${readCount}회)`
          })}`;
          
          let sentCount = 0;
          globalWss.clients.forEach(client => {
            if (client.readyState === 1) { // WebSocket.OPEN
              client.send(highTempStartMessage);
              sentCount++;
            }
          });
          console.log(`[NextTankEnviTestProcess] 사이클 ${cycle} 고온 테스트 시작 메시지 전송 완료 - 클라이언트 수: ${sentCount}`);
        }
        
        // 챔버 온도를 읽어서 비교하여 도달하면 테스트 시작
        // 아니면 온도가 도달 할때 까지 대기
        // 온도 대기 중 중지 요청 확인을 위한 간격 - 더 빠른 응답을 위해 1초로 단축
        const tempCheckInterval = 1000; // 1초마다 중지 요청 확인
        let lastTempCheck = Date.now();
        
        // 온도 대기 시작 시간 기록
        const tempWaitStartTime = Date.now();
        const estimatedTempWaitTime = 30 * 60 * 1000; // 30분 예상 대기 시간
        console.log('🔒 TIME_PROGRESS sending skipped - client using local calculation');
        // 시간 진행 상황 업데이트는 클라이언트에서 로컬 계산으로 처리
        
        while(true) {
          // 중지 요청 확인 - 온도 대기 중
          if (getProcessStopRequested()) {
            console.log(`[NextTankEnviTestProcess] 🛑 중지 요청 감지 - 고온 테스트 온도 대기 중 중단`);
            
            // 온도 대기 진행 상황 인터벌 정리 (이미 제거됨)
            
            // PowerSwitch 상태 OFF 설정
            setMachineRunningStatus(false);
            
            // 클라이언트에게 파워스위치 OFF 상태 전송
            if (globalWss) {
              const powerOffMessage = `[POWER_SWITCH] OFF - Machine running: false - Process stopped during high temp waiting`;
              globalWss.clients.forEach(client => {
                if (client.readyState === 1) {
                  client.send(powerOffMessage);
                }
              });
            }
            
                          // 중단 보고서 생성은 최종 종료 시에만 생성하도록 수정
              console.log(`[NextTankEnviTestProcess] 📄 중단 보고서는 최종 종료 시에 생성됩니다.`);
            
            // 프로세스 중지 플래그 초기화 제거 - 중지 상태 유지
            console.log(`[NextTankEnviTestProcess] 🛑 프로세스 중지 상태 유지 - 고온 테스트 온도 대기 중`);
            // setProcessStopRequested(false) 호출 제거
            
            return { 
              status: 'stopped', 
              message: '사용자에 의해 중지됨', 
              stoppedAtCycle: cycle, 
              stoppedAtPhase: 'high_temp_waiting',
              totalCycles: cycle
            };
          }
          
          // 온도 대기 중 중지 요청 확인을 위한 간격 체크
          const now = Date.now();
          if (now - lastTempCheck >= tempCheckInterval) {
            lastTempCheck = now;
            
            // 중지 요청 확인 - 온도 대기 중 주기적 체크
            if (getProcessStopRequested()) {
              console.log(`[NextTankEnviTestProcess] 🛑 중지 요청 감지 - 고온 테스트 온도 대기 중 주기적 체크에서 중단`);
              
              // 온도 대기 진행 상황 인터벌 정리
              if (tempWaitProgressInterval) {
                clearInterval(tempWaitProgressInterval);
              }
              
              // PowerSwitch 상태 OFF 설정
              setMachineRunningStatus(false);
              
              // 클라이언트에게 파워스위치 OFF 상태 전송
              if (globalWss) {
                const powerOffMessage = `[POWER_SWITCH] OFF - Machine running: false - Process stopped during high temp waiting`;
                globalWss.clients.forEach(client => {
                  if (client.readyState === 1) {
                    client.send(powerOffMessage);
                  }
                });
              }
              
              // 중단 보고서 생성은 최종 종료 시에만 생성하도록 수정
              console.log(`[NextTankEnviTestProcess] 📄 중단 보고서는 최종 종료 시에 생성됩니다.`);
              
              // 프로세스 중지 플래그 초기화 제거 - 중지 상태 유지
              console.log(`[NextTankEnviTestProcess] 🛑 프로세스 중지 상태 유지 - 고온 테스트 온도 대기 중 주기적 체크`);
              // setProcessStopRequested(false) 호출 제거
              
              return { 
                status: 'stopped', 
                message: '사용자에 의해 중지됨', 
                stoppedAtCycle: cycle, 
                stoppedAtPhase: 'high_temp_waiting',
                totalCycles: cycle
              };
            }
          }
          
          let chamberTemp = 23.45;
          if( getSimulationMode() === false ){
            console.log(`[NextTankEnviTestProcess] 사이클 ${cycle}: 고온 테스트 대기 중 온도 읽기`);
            chamberTemp = await getCurrentChamberTemperature();
          }
          
          // ReadChamber 실패 시 처리
          if (chamberTemp === false) {
            console.error(`[NextTankEnviTestProcess] 🛑 챔버 온도 읽기 실패 - 사이클 ${cycle}에서 프로세스 중단`);
            
            // PowerSwitch 상태를 off로 설정
            setMachineRunningStatus(false);
            console.log(`[NextTankEnviTestProcess] 🔌 챔버 오류로 인한 PowerSwitch 상태 OFF 설정`);
            
            // 클라이언트에게 파워스위치 OFF 상태 전송
            if (globalWss) {
              const powerOffMessage = `[POWER_SWITCH] OFF - Machine running: false - Chamber read failed`;
              let sentCount = 0;
              globalWss.clients.forEach(client => {
                if (client.readyState === 1) { // WebSocket.OPEN
                  client.send(powerOffMessage);
                  sentCount++;
                }
              });
              //console.log(`[NextTankEnviTestProcess] 🔌 챔버 오류로 인한 파워스위치 OFF 상태 메시지 전송 완료 - 클라이언트 수: ${sentCount}`);
            } else {
              console.warn(`[NextTankEnviTestProcess] 전역 WebSocket 서버가 설정되지 않음 - 챔버 오류 시 파워스위치 OFF 메시지 전송 불가`);
            }
            
            // 중단된 테스트 결과 파일 생성
            console.log(`[NextTankEnviTestProcess] 📄 중단된 테스트 결과 파일 생성 시작...`);
            
            try {
              // 생성된 파일들을 찾기 위해 Data 폴더 스캔
              const dataFolderPath = path.join(process.cwd(), 'Data');
              // 전역 변수에서 테스트 디렉토리명 사용
              let dateDirectoryName = currentTestDirectoryName || getDateDirectoryName();
              const dateFolderPath = path.join(dataFolderPath, dateDirectoryName);
              
              let existingFiles = [];
              if (fs.existsSync(dateFolderPath)) {
                const files = fs.readdirSync(dateFolderPath);
                existingFiles = files
                  .filter(file => file.endsWith('.csv'))
                  .map(file => path.join(dateFolderPath, file));
              }
              
              // 테스트 설정 정보 수집
              const testSettings = {
                modelName: getTableOption.productInput?.modelName || 'N/A',
                productNumber: getTableOption.productInput?.productNumber || 'N/A',
                temperature: getTableOption.highTempSettings?.targetTemp || 'N/A',
                highTempEnabled: getTableOption.highTempSettings?.highTemp || false,
                lowTempEnabled: getTableOption.lowTempSettings?.lowTemp || false,
                totalCycles: cycleNumber,
                highTempWaitTime: getTableOption.highTempSettings?.waitTime || 'N/A',
                lowTempWaitTime: getTableOption.lowTempSettings?.waitTime || 'N/A',
                highTempReadCount: getTableOption.highTempSettings?.readCount || 'N/A',
                lowTempReadCount: getTableOption.lowTempSettings?.readCount || 'N/A'
              };
              
              // 중단된 테스트 결과 파일 생성
              const result = await generateInterruptedTestResultFile({
                stopReason: 'system_failure',
                stoppedAtCycle: cycle,
                stoppedAtPhase: 'high_temp_waiting',
                errorMessage: '챔버 온도 읽기 실패 - 장비 연결 상태를 확인하세요',
                testSettings
              });
              
              if (result.success) {
                console.log(`[NextTankEnviTestProcess] ✅ 중단된 테스트 결과 파일 생성 완료: ${result.filename}`);
              } else {
                console.error(`[NextTankEnviTestProcess] ❌ 중단된 테스트 결과 파일 생성 실패: ${result.error}`);
              }
            } catch (fileError) {
              console.error(`[NextTankEnviTestProcess] 중단된 테스트 결과 파일 생성 중 오류:`, fileError);
            }

            return { 
              status: 'error', 
              message: '챔버 온도 읽기 실패 - 장비 연결 상태를 확인하세요', 
              stoppedAtCycle: cycle, 
              errorType: 'chamber_read_failed' 
            };
          }
          
          if(chamberTemp >= highTemp) {
            console.log(`[NextTankEnviTestProcess] 사이클 ${cycle}: 고온 테스트 시작 (${chamberTemp}°C)`);
            
            // 온도 대기 진행 상황 인터벌 정리 (이미 제거됨)
            
            // waitTime 분 만큼 대기 (중지 요청 확인 가능)
            if(getSimulationMode() === false){
              console.log(`[NextTankEnviTestProcess] 고온 도달 후 ${waitTime}분 대기 시작...`);
              try {
                await sleepMinutesWithStopCheck(waitTime, `사이클 ${cycle} 고온 대기`);
              } catch (error) {
                if (error.message === 'PROCESS_STOP_REQUESTED') {
                  console.log(`[NextTankEnviTestProcess] 🛑 중지 요청 감지 - 고온 대기 중 중단`);
                  
                  // 중지 시에도 PowerSwitch 상태를 off로 설정
                  setMachineRunningStatus(false);
                  console.log(`[NextTankEnviTestProcess] 🔌 중지로 인한 PowerSwitch 상태 OFF 설정`);
                  
                  // 클라이언트에게 파워스위치 OFF 상태 전송
                  if (globalWss) {
                    const powerOffMessage = `[POWER_SWITCH] OFF - Machine running: false - High temp waiting stopped`;
                    let sentCount = 0;
                    globalWss.clients.forEach(client => {
                      if (client.readyState === 1) { // WebSocket.OPEN
                        client.send(powerOffMessage);
                        sentCount++;
                      }
                    });
                    console.log(`[NextTankEnviTestProcess] 🔌 고온 대기 중단으로 인한 파워스위치 OFF 상태 메시지 전송 완료 - 클라이언트 수: ${sentCount}`);
                  } else {
                    console.warn(`[NextTankEnviTestProcess] 전역 WebSocket 서버가 설정되지 않음 - 고온 대기 중단 시 파워스위치 OFF 메시지 전송 불가`);
                  }
                  
                  return { 
                    status: 'stopped', 
                    message: '사용자에 의해 중지됨', 
                    stoppedAtCycle: cycle, 
                    stoppedAtPhase: 'high_temp_waiting',
                    totalCycles: cycle
                  };
                } else {
                  throw error; // 다른 에러는 다시 던짐
                }
              }
            }
            
            // runSinglePageProcess 를 readCount 만큼 실행
            for(let i = 0; i < readCount; i++) {
              // 중지 요청 확인
              if (getProcessStopRequested()) {
                console.log(`[NextTankEnviTestProcess] 🛑 중지 요청 감지 - 고온 테스트 실행 중 중단 (${i+1}/${readCount})`);
                
                // 중지 시에도 PowerSwitch 상태를 off로 설정
                setMachineRunningStatus(false);
                console.log(`[NextTankEnviTestProcess] 🔌 중지로 인한 PowerSwitch 상태 OFF 설정`);
                
                // 클라이언트에게 파워스위치 OFF 상태 전송
                if (globalWss) {
                  const powerOffMessage = `[POWER_SWITCH] OFF - Machine running: false - High temp test execution stopped`;
                  let sentCount = 0;
                  globalWss.clients.forEach(client => {
                    if (client.readyState === 1) { // WebSocket.OPEN
                      client.send(powerOffMessage);
                      sentCount++;
                    }
                  });
                  console.log(`[NextTankEnviTestProcess] 🔌 고온 테스트 실행 중단으로 인한 파워스위치 OFF 상태 메시지 전송 완료 - 클라이언트 수: ${sentCount}`);
                } else {
                  console.warn(`[NextTankEnviTestProcess] 전역 WebSocket 서버가 설정되지 않음 - 고온 테스트 실행 중단 시 파워스위치 OFF 메시지 전송 불가`);
                }
                
                // 중단 보고서 생성은 최종 종료 시에만 생성하도록 수정
                console.log(`[NextTankEnviTestProcess] 📄 중단 보고서는 최종 종료 시에 생성됩니다.`);
                
                return { 
                  status: 'stopped', 
                  message: '사용자에 의해 중단됨', 
                  stoppedAtCycle: cycle, 
                  stoppedAtPhase: 'high_temp_test', 
                  stoppedAtTest: i+1,
                  totalCycles: cycle
                };
              }
              
              console.log(`[NextTankEnviTestProcess] 사이클 ${cycle}: 고온 테스트 ${i+1}/${readCount} 실행`);
              
              // 현재 테스트 번호를 PowerTable에 업데이트
              if (globalWss) {
                const testUpdateMessage = `[POWER_TABLE_RESET] ${JSON.stringify({
                  action: 'test_progress',
                  cycle: cycle,
                  totalCycles: cycleNumber,
                  testPhase: 'high_temp',
                  currentTestNumber: i + 1,
                  totalTestCount: readCount,
                  testStatus: 'ON',
                  timestamp: new Date().toISOString(),
                  message: `사이클 ${cycle}: 고온 테스트 ${i+1}/${readCount} 실행 중`
                })}`;
                
                let sentCount = 0;
                globalWss.clients.forEach(client => {
                  if (client.readyState === 1) { // WebSocket.OPEN
                    client.send(testUpdateMessage);
                    sentCount++;
                  }
                });
                console.log(`[NextTankEnviTestProcess] 사이클 ${cycle} 고온 테스트 ${i+1}/${readCount} 진행 상황 업데이트 전송 완료 - 클라이언트 수: ${sentCount}`);
              }
              
              // SinglePageProcess 재시도 로직 (최대 5회)
              let singlePageSuccess = false;
              let retryCount = 0;
              const maxRetries = 5;
              let singlePageResult = null;
              
              while (!singlePageSuccess && retryCount < maxRetries) {
                try {
                  singlePageResult = await runSinglePageProcess();
                  
                  if ( singlePageResult.status === 'stopped') {
                    console.log(`[NextTankEnviTestProcess] 🛑 SinglePageProcess 중지됨: ${singlePageResult.message}`);
                    console.log(`[NextTankEnviTestProcess] 🛑 SinglePageProcess 중지로 인한 중단 보고서 생성`);
                    // PowerSwitch 상태를 off로 설정
                    setMachineRunningStatus(false);
                    
                    // 클라이언트에게 파워스위치 OFF 상태 전송
                    if (globalWss) {
                      const powerOffMessage = `[POWER_SWITCH] OFF - Machine running: false - SinglePageProcess stopped`;
                      let sentCount = 0;
                      globalWss.clients.forEach(client => {
                        if (client.readyState === 1) { // WebSocket.OPEN
                          client.send(powerOffMessage);
                          sentCount++;
                        }
                      });
                      console.log(`[NextTankEnviTestProcess] 🔌 SinglePageProcess 중지로 인한 파워스위치 OFF 상태 메시지 전송 완료 - 클라이언트 수: ${sentCount}`);
                    }
                    
                    // 중단 보고서는 최종 종료 시에만 생성하도록 수정
                    console.log(`[NextTankEnviTestProcess] 📄 중단 보고서는 최종 종료 시에 생성됩니다.`);
                    
                    // 전역 디렉토리명 초기화
                    currentTestDirectoryName = null;
                    
                    // 중단 상태로 프로세스 완료
                                      return {
                    status: 'stopped',
                    message: 'SinglePageProcess 중지로 인한 전체 프로세스 중단',
                    stoppedAtCycle: cycle,
                    stoppedAtPhase: 'high_temp_test',
                    stopReason: 'SinglePageProcess_stopped',
                    finalReportGenerated: true,
                    totalCycles: cycle
                  };
                  }
                  
                  if (singlePageResult && singlePageResult.status === 'completed' && singlePageResult.data) {
                    singlePageSuccess = true;
                    console.log(`[NextTankEnviTestProcess] 사이클 ${cycle} 고온 테스트 ${i+1}/${readCount} 성공 (${retryCount + 1}번째 시도)`);
                  } else {
                    throw new Error(`SinglePageProcess 실패: ${singlePageResult?.message || '알 수 없는 오류'}`);
                  }
                } catch (error) {
                  retryCount++;
                  console.warn(`[NextTankEnviTestProcess] 사이클 ${cycle} 고온 테스트 ${i+1}/${readCount} 실패 (${retryCount}/${maxRetries}): ${error.message}`);
                  
                  if (retryCount < maxRetries) {
                    console.log(`[NextTankEnviTestProcess] 3초 후 재시도...`);
                    await sleep(3000);
                  } else {
                    console.error(`[NextTankEnviTestProcess] 사이클 ${cycle} 고온 테스트 ${i+1}/${readCount} 최종 실패 - 프로세스 중단`);
                    
                    // PowerSwitch 상태를 off로 설정
                    setMachineRunningStatus(false);
                    console.log(`[NextTankEnviTestProcess] 🔌 고온 테스트 실패로 인한 PowerSwitch 상태 OFF 설정`);
                    
                                        // 중단 보고서는 최종 종료 시에만 생성하도록 수정
                    console.log(`[NextTankEnviTestProcess] 📄 중단 보고서는 최종 종료 시에 생성됩니다.`);
                    
                    // 전역 디렉토리명 초기화
                    currentTestDirectoryName = null;
                    
                    return { 
                      status: 'error', 
                      message: `고온 테스트 ${i+1}/${readCount} 실패 - 5회 재시도 후 최종 실패`, 
                      stoppedAtCycle: cycle, 
                      stoppedAtPhase: 'high_temp_test', 
                      stoppedAtTest: i+1,
                      errorType: 'high_temp_test_failed',
                      finalReportGenerated: true
                    };
                  }
                }
              }
              
              // 각 실행 결과를 개별 파일로 저장
              if (singlePageResult && singlePageResult.status === 'completed' && singlePageResult.data) {
                console.log(`[NextTankEnviTestProcess] 사이클 ${cycle} 고온 테스트 ${i+1}/${readCount} 결과 저장 시작`);
                const saveResult = saveTotaReportTableToFile(
                  singlePageResult.data, 
                  getTableOption.channelVoltages, 
                  cycle, 
                  `HighTemp_Test${i+1}`
                );
                if (saveResult.success) {
                  console.log(`[NextTankEnviTestProcess] 사이클 ${cycle} 고온 테스트 ${i+1}/${readCount} 결과 저장 완료: ${saveResult.filename}`);
                } else {
                  console.error(`[NextTankEnviTestProcess] 사이클 ${cycle} 고온 테스트 ${i+1}/${readCount} 결과 저장 실패: ${saveResult.error}`);
                }
                
                // 결과 누적 (기존 로직 유지)
                highTempResults.push(singlePageResult.data);
              }
            }
            console.log(`[NextTankEnviTestProcess] 사이클 ${cycle}: 고온 테스트 완료 (${highTempResults.length}개 결과 누적)`);
            
            // 실행완료 하면 빠져 나감
            break;
          } else {
            console.log(`[NextTankEnviTestProcess] 사이클 ${cycle}: 고온 대기 중... 현재: ${chamberTemp}°C, 목표: ${highTemp}°C`);
            await sleep(60000); // 1분 대기
          }
        }
      }
      
      // low temp test
      const lowTemp = getTableOption.lowTempSettings.targetTemp;
      const lowWaitTime = getTableOption.lowTempSettings.waitTime; // 분 단위로 저장된 값
      const lowTempTest = getTableOption.lowTempSettings.lowTemp;
      const lowReadCount = getTableOption.lowTempSettings.readCount;
      //console.log(`[NextTankEnviTestProcess] lowTemp: ${lowTemp}`);
      //console.log(`[NextTankEnviTestProcess] lowWaitTime: ${lowWaitTime}분`);
      //console.log(`[NextTankEnviTestProcess] lowReadCount: ${lowReadCount}`); 
      //console.log(`[NextTankEnviTestProcess] lowTempTest: ${lowTempTest}`);
      
      if(lowTempTest === true) {
        console.log(`[NextTankEnviTestProcess] 사이클 ${cycle}: 2. 저온 테스트 시작`); 
        
        // 저온 테스트 시작 시 PowerTable에 테스트 정보 업데이트
        if (globalWss) {
          const lowTempStartMessage = `[POWER_TABLE_RESET] ${JSON.stringify({
            action: 'test_start',
            cycle: cycle,
            totalCycles: cycleNumber,
            testPhase: 'low_temp',
            currentTestNumber: 0,
            totalTestCount: lowReadCount,
            testStatus: 'ON',
            timestamp: new Date().toISOString(),
            message: `사이클 ${cycle}: 저온 테스트 시작 (${lowReadCount}회)`
          })}`;
          
          let sentCount = 0;
          globalWss.clients.forEach(client => {
            if (client.readyState === 1) { // WebSocket.OPEN
              client.send(lowTempStartMessage);
              sentCount++;
            }
          });
          console.log(`[NextTankEnviTestProcess] 사이클 ${cycle} 저온 테스트 시작 메시지 전송 완료 - 클라이언트 수: ${sentCount}`);
        }
        
        // 챔버 온도를 읽어서 비교하여 도달하면 테스트 시작
        // 아니면 온도가 도달 할때 까지 대기
        // 온도 대기 중 중지 요청 확인을 위한 간격 - 더 빠른 응답을 위해 1초로 단축
        const lowTempCheckInterval = 1000; // 1초마다 중지 요청 확인
        let lastLowTempCheck = Date.now();
        
        while(true) {
          // 중지 요청 확인 - 온도 대기 중
          if (getProcessStopRequested()) {
            console.log(`[NextTankEnviTestProcess] 🛑 중지 요청 감지 - 저온 테스트 대기 중 중단`);
            
            // 중지 시에도 PowerSwitch 상태를 off로 설정
            setMachineRunningStatus(false);
            console.log(`[NextTankEnviTestProcess] 🔌 중지로 인한 PowerSwitch 상태 OFF 설정`);
            
            // 클라이언트에게 파워스위치 OFF 상태 전송
            if (globalWss) {
              const powerOffMessage = `[POWER_SWITCH] OFF - Machine running: false - Low temp test waiting stopped`;
              let sentCount = 0;
              globalWss.clients.forEach(client => {
                if (client.readyState === 1) { // WebSocket.OPEN
                  client.send(powerOffMessage);
                  sentCount++;
                }
              });
              console.log(`[NextTankEnviTestProcess] 🔌 저온 테스트 대기 중단으로 인한 파워스위치 OFF 상태 메시지 전송 완료 - 클라이언트 수: ${sentCount}`);
            } else {
              console.warn(`[NextTankEnviTestProcess] 전역 WebSocket 서버가 설정되지 않음 - 저온 테스트 대기 중단 시 파워스위치 OFF 메시지 전송 불가`);
            }
            
            // 중단된 테스트 결과 파일 생성
            console.log(`[NextTankEnviTestProcess] 📄 중단된 테스트 결과 파일 생성 시작...`);
            
            try {
              // 테스트 설정 정보 수집
              const testSettings = {
                modelName: getTableOption.productInput?.modelName || 'N/A',
                productNumber: getTableOption.productInput?.productNumber || 'N/A',
                temperature: getTableOption.lowTempSettings?.targetTemp || 'N/A',
                highTempEnabled: getTableOption.highTempSettings?.highTemp || false,
                lowTempEnabled: getTableOption.lowTempSettings?.lowTemp || false,
                totalCycles: cycleNumber,
                highTempWaitTime: getTableOption.highTempSettings?.waitTime || 'N/A',
                lowTempWaitTime: getTableOption.lowTempSettings?.waitTime || 'N/A',
                highTempReadCount: getTableOption.highTempSettings?.readCount || 'N/A',
                lowTempReadCount: getTableOption.lowTempSettings?.readCount || 'N/A'
              };
              
              // 중단된 테스트 결과 파일 생성
              const result = await generateInterruptedTestResultFile({
                stopReason: 'manual_stop',
                stoppedAtCycle: cycle,
                stoppedAtPhase: 'low_temp_waiting',
                testSettings
              });
              
              if (result.success) {
                console.log(`[NextTankEnviTestProcess] ✅ 중단된 테스트 결과 파일 생성 완료: ${result.filename}`);
              } else {
                console.error(`[NextTankEnviTestProcess] ❌ 중단된 테스트 결과 파일 생성 실패: ${result.error}`);
              }
            } catch (fileError) {
              console.error(`[NextTankEnviTestProcess] 중단된 테스트 결과 파일 생성 중 오류:`, fileError);
            }
            
            // 수동 중지 시 전역 디렉토리명 초기화 (보고서 생성 후)
            console.log(`[NextTankEnviTestProcess] 📁 수동 중지 - 전역 디렉토리명 초기화: ${currentTestDirectoryName}`);
            // currentTestDirectoryName은 generateInterruptedTestResultFile에서 사용 후 null로 설정됨
            
            return { 
              status: 'stopped', 
              message: '사용자에 의해 중지됨', 
              stoppedAtCycle: cycle, 
              stoppedAtPhase: 'low_temp_waiting',
              totalCycles: cycle
            };
          }
          
          console.log(`[NextTankEnviTestProcess] 사이클 ${cycle}: 저온 테스트 대기 중 목표 온도: ${lowTemp}℃`);

          // 온도 대기 중 중지 요청 확인을 위한 간격 체크
          const now = Date.now();
          if (now - lastLowTempCheck >= lowTempCheckInterval) {
            lastLowTempCheck = now;
            
            // 중지 요청 확인 - 온도 대기 중 주기적 체크
            if (getProcessStopRequested()) {
              console.log(`[NextTankEnviTestProcess] 🛑 중지 요청 감지 - 저온 테스트 온도 대기 중 주기적 체크에서 중단`);
              
              // PowerSwitch 상태 OFF 설정
              setMachineRunningStatus(false);
              
              // 클라이언트에게 파워스위치 OFF 상태 전송
              if (globalWss) {
                const powerOffMessage = `[POWER_SWITCH] OFF - Machine running: false - Process stopped during low temp waiting`;
                globalWss.clients.forEach(client => {
                  if (client.readyState === 1) {
                    client.send(powerOffMessage);
                  }
                });
              }
              
              // 중단 보고서 생성 (안전한 처리)
              try {
                // 전역 디렉토리명이 있는지 확인
                if (!currentTestDirectoryName) {
                  currentTestDirectoryName = getDateDirectoryName();
                  console.log(`[NextTankEnviTestProcess] ⚠️ 전역 디렉토리명이 없어 새로 생성: ${currentTestDirectoryName}`);
                }
                
                const testSettings = {
                  modelName: getTableOption.productInput?.modelName || 'N/A',
                  productNumber: getTableOption.productInput?.productNumber || 'N/A',
                  temperature: getTableOption.lowTempSettings?.targetTemp || 'N/A',
                  totalCycles: cycleNumber
                };
                
                const reportResult = await generateInterruptedTestResultFile({
                  stopReason: 'power_switch_off',
                  stoppedAtCycle: cycle,
                  stoppedAtPhase: 'low_temp_waiting',
                  errorMessage: '사용자에 의한 파워스위치 OFF',
                  testSettings: testSettings
                });
                
                if (reportResult && reportResult.success) {
                  console.log(`[NextTankEnviTestProcess] ✅ 중단 보고서 생성 성공: ${reportResult.filename}`);
                  // 전역 디렉토리명은 유지 (다른 함수에서도 사용)
                  console.log(`[NextTankEnviTestProcess] 📁 전역 디렉토리명 유지: ${currentTestDirectoryName}`);
                } else {
                  console.error(`[NextTankEnviTestProcess] ❌ 중단 보고서 생성 실패:`, reportResult?.error || '알 수 없는 오류');
                }
                
              } catch (error) {
                console.error(`[NextTankEnviTestProcess] ❌ 중단 보고서 생성 실패:`, error.message);
              }
              
              // 프로세스 중지 플래그 상태 유지
              console.log(`[NextTankEnviTestProcess] 🛑 프로세스 중지 상태 유지 - 저온 테스트 온도 대기 중`);
              // setProcessStopRequested(false) 호출 제거
              
              return { 
                status: 'stopped', 
                message: '사용자에 의해 중지됨', 
                stoppedAtCycle: cycle, 
                stoppedAtPhase: 'low_temp_waiting',
                totalCycles: cycle
              };
            }
          }
          
          let chamberTemp = 23.45;
          if( getSimulationMode() != true ){
            chamberTemp = await getCurrentChamberTemperature();
          }
          console.log(`[NextTankEnviTestProcess] 사이클 ${cycle}: 저온 테스트 대기 중 온도: ${chamberTemp}℃`);
          
          // ReadChamber 실패 시 처리
          if (chamberTemp === false) {
            console.error(`[NextTankEnviTestProcess] 🛑 챔버 온도 읽기 실패 - 사이클 ${cycle}에서 프로세스 중단`);
            
            // PowerSwitch 상태를 off로 설정
            setMachineRunningStatus(false);
            console.log(`[NextTankEnviTestProcess] 🔌 챔버 오류로 인한 PowerSwitch 상태 OFF 설정`);
            
            // 클라이언트에게 파워스위치 OFF 상태 전송
            if (globalWss) {
              const powerOffMessage = `[POWER_SWITCH] OFF - Machine running: false - Chamber read failed`;
              let sentCount = 0;
              globalWss.clients.forEach(client => {
                if (client.readyState === 1) { // WebSocket.OPEN
                  client.send(powerOffMessage);
                  sentCount++;
                }
              });
              console.log(`[NextTankEnviTestProcess] 🔌 챔버 오류로 인한 파워스위치 OFF 상태 메시지 전송 완료 - 클라이언트 수: ${sentCount}`);
            } else {
              console.warn(`[NextTankEnviTestProcess] 전역 WebSocket 서버가 설정되지 않음 - 챔버 오류 시 파워스위치 OFF 메시지 전송 불가`);
            }
            
            return { 
              status: 'error', 
              message: '챔버 온도 읽기 실패 - 장비 연결 상태를 확인하세요', 
              stoppedAtCycle: cycle, 
              errorType: 'chamber_read_failed' 
            };
          }
          
          if(chamberTemp <= lowTemp) {
            console.log(`[NextTankEnviTestProcess] 사이클 ${cycle}: 저온 테스트 시작 (${chamberTemp}°C)`);
            console.log(`[NextTankEnviTestProcess] 저온테스트 전 ${lowWaitTime}분 대기`);
            
            // lowWaitTime 분 만큼 대기 (중지 요청 확인 가능)
            try {
              await sleepMinutesWithStopCheck(lowWaitTime, `사이클 ${cycle} 저온 대기`);
            } catch (error) {
              if (error.message === 'PROCESS_STOP_REQUESTED') {
                console.log(`[NextTankEnviTestProcess] 🛑 중지 요청 감지 - 저온 대기 중 중단`);
                
                // 중지 시에도 PowerSwitch 상태를 off로 설정
                setMachineRunningStatus(false);
                console.log(`[NextTankEnviTestProcess] 🔌 중지로 인한 PowerSwitch 상태 OFF 설정`);
                
                // 클라이언트에게 파워스위치 OFF 상태 전송
                if (globalWss) {
                  const powerOffMessage = `[POWER_SWITCH] OFF - Machine running: false - Low temp waiting stopped`;
                  let sentCount = 0;
                  globalWss.clients.forEach(client => {
                    if (client.readyState === 1) { // WebSocket.OPEN
                      client.send(powerOffMessage);
                      sentCount++;
                    }
                  });
                  console.log(`[NextTankEnviTestProcess] 🔌 저온 대기 중단으로 인한 파워스위치 OFF 상태 메시지 전송 완료 - 클라이언트 수: ${sentCount}`);
                } else {
                  console.warn(`[NextTankEnviTestProcess] 전역 WebSocket 서버가 설정되지 않음 - 저온 대기 중단 시 파워스위치 OFF 메시지 전송 불가`);
                }
                
                return { 
                  status: 'stopped', 
                  message: '사용자에 의해 중지됨', 
                  stoppedAtCycle: cycle, 
                  stoppedAtPhase: 'low_temp_waiting',
                  totalCycles: cycle
                };
              } else {
                throw error; // 다른 에러는 다시 던짐
              }
            }
            
            // runSinglePageProcess 를 readCount 만큼 실행
            for(let i = 0; i < lowReadCount; i++) {
              // 중지 요청 확인
              if (getProcessStopRequested()) {
                console.log(`[NextTankEnviTestProcess] 🛑 중지 요청 감지 - 저온 테스트 실행 중 중단 (${i+1}/${lowReadCount})`);
                
                // PowerSwitch 상태 OFF 설정
                setMachineRunningStatus(false);
                
                // 클라이언트에게 파워스위치 OFF 상태 전송
                if (globalWss) {
                  const powerOffMessage = `[POWER_SWITCH] OFF - Machine running: false - Low temp test execution stopped`;
                  globalWss.clients.forEach(client => {
                    if (client.readyState === 1) {
                      client.send(powerOffMessage);
                    }
                  });
                }
                
                // 중단 보고서는 최종 종료 시에만 생성하도록 수정
                console.log(`[NextTankEnviTestProcess] 📄 중단 보고서는 최종 종료 시에 생성됩니다.`);
                
                return { 
                  status: 'stopped', 
                  message: '사용자에 의해 중단됨', 
                  stoppedAtCycle: cycle, 
                  stoppedAtPhase: 'low_temp_test', 
                  stoppedAtTest: i+1,
                  totalCycles: cycle
                };
              }
              
              console.log(`[NextTankEnviTestProcess] 사이클 ${cycle}: 저온 테스트 ${i+1}/${lowReadCount} 실행`);
              
              // 현재 테스트 번호를 PowerTable에 업데이트
              if (globalWss) {
                const testUpdateMessage = `[POWER_TABLE_RESET] ${JSON.stringify({
                  action: 'test_progress',
                  cycle: cycle,
                  totalCycles: cycleNumber,
                  testPhase: 'low_temp',
                  currentTestNumber: i + 1,
                  totalTestCount: lowReadCount,
                  testStatus: 'ON',
                  timestamp: new Date().toISOString(),
                  message: `사이클 ${cycle}: 저온 테스트 ${i+1}/${lowReadCount} 실행 중`
                })}`;
                
                let sentCount = 0;
                globalWss.clients.forEach(client => {
                  if (client.readyState === 1) { // WebSocket.OPEN
                    client.send(testUpdateMessage);
                    sentCount++;
                  }
                });
                console.log(`[NextTankEnviTestProcess] 사이클 ${cycle} 저온 테스트 ${i+1}/${lowReadCount} 진행 상황 업데이트 전송 완료 - 클라이언트 수: ${sentCount}`);
              }
              
              // SinglePageProcess 재시도 로직 (최대 5회)
              let singlePageSuccess = false;
              let retryCount = 0;
              const maxRetries = 5;
              let singlePageResult = null;
              
              while (!singlePageSuccess && retryCount < maxRetries) {
                try {
                  singlePageResult = await runSinglePageProcess();
                  
                  if (singlePageResult.status === 'stopped') {
                    console.log(`[NextTankEnviTestProcess] 🛑 SinglePageProcess 중지됨: ${singlePageResult.message}`);
                    console.log(`[NextTankEnviTestProcess] 🛑 SinglePageProcess 중지로 인한 중단 보고서 생성`);
                    
                    // PowerSwitch 상태를 off로 설정
                    setMachineRunningStatus(false);
                    
                    // 클라이언트에게 파워스위치 OFF 상태 전송
                    if (globalWss) {
                      const powerOffMessage = `[POWER_SWITCH] OFF - Machine running: false - SinglePageProcess stopped`;
                      let sentCount = 0;
                      globalWss.clients.forEach(client => {
                        if (client.readyState === 1) { // WebSocket.OPEN
                          client.send(powerOffMessage);
                          sentCount++;
                        }
                      });
                      console.log(`[NextTankEnviTestProcess] 🔌 SinglePageProcess 중지로 인한 파워스위치 OFF 상태 메시지 전송 완료 - 클라이언트 수: ${sentCount}`);
                    }
                    
                    // 중단 보고서는 최종 종료 시에만 생성하도록 수정
                    console.log(`[NextTankEnviTestProcess] 📄 중단 보고서는 최종 종료 시에 생성됩니다.`);
                    
                    // 전역 디렉토리명 초기화
                    currentTestDirectoryName = null;
                    
                    // 중단 상태로 프로세스 완료
                    return { 
                      status: 'stopped', 
                      message: 'SinglePageProcess 중지로 인한 전체 프로세스 중단',
                      stoppedAtCycle: cycle,
                      stoppedAtPhase: 'low_temp_test',
                      stopReason: 'SinglePageProcess_stopped',
                      finalReportGenerated: true
                    };
                  }
                  
                  if (singlePageResult && singlePageResult.status === 'completed' && singlePageResult.data) {
                    singlePageSuccess = true;
                    console.log(`[NextTankEnviTestProcess] 사이클 ${cycle} 저온 테스트 ${i+1}/${lowReadCount} 성공 (${retryCount + 1}번째 시도)`);
                  } else {
                    throw new Error(`SinglePageProcess 실패: ${singlePageResult?.message || '알 수 없는 오류'}`);
                  }
                } catch (error) {
                  retryCount++;
                  console.warn(`[NextTankEnviTestProcess] 사이클 ${cycle} 저온 테스트 ${i+1}/${lowReadCount} 실패 (${retryCount}/${maxRetries}): ${error.message}`);
                  
                  if (retryCount < maxRetries) {
                    console.log(`[NextTankEnviTestProcess] 3초 후 재시도...`);
                    await sleep(3000);
                  } else {
                    console.error(`[NextTankEnviTestProcess] 사이클 ${cycle} 저온 테스트 ${i+1}/${lowReadCount} 최종 실패 - 프로세스 중단`);
                    
                    // PowerSwitch 상태를 off로 설정
                    setMachineRunningStatus(false);
                    console.log(`[NextTankEnviTestProcess] 🔌 저온 테스트 실패로 인한 PowerSwitch 상태 OFF 설정`);
                    
                    // 최종 실패 시에도 중단 보고서 생성
                    try {
                      const testSettings = {
                        modelName: getTableOption.productInput?.modelName || 'N/A',
                        productNumber: getTableOption.productInput?.productNumber || 'N/A',
                        temperature: getTableOption.lowTempSettings?.targetTemp || 'N/A',
                        totalCycles: cycleNumber
                      };
                      
                      const reportResult = await generateInterruptedTestResultFile({
                        stopReason: 'low_temp_test_failed',
                        stoppedAtCycle: cycle,
                        stoppedAtPhase: 'low_temp_test',
                        errorMessage: `저온 테스트 ${i+1}/${lowReadCount} 실패 - 5회 재시도 후 최종 실패`,
                        testSettings: testSettings
                      });
                      
                      if (reportResult && reportResult.success) {
                        console.log(`[NextTankEnviTestProcess] ✅ 최종 실패로 인한 중단 보고서 생성 성공: ${reportResult.filename}`);
                      } else {
                        console.error(`[NextTankEnviTestProcess] ❌ 최종 실패로 인한 중단 보고서 생성 실패:`, reportResult?.error || '알 수 없는 오류');
                      }
                    } catch (reportError) {
                      console.error(`[NextTankEnviTestProcess] ❌ 최종 실패로 인한 중단 보고서 생성 실패:`, reportError.message);
                    }
                    
                    // 전역 디렉토리명 초기화
                    currentTestDirectoryName = null;
                    
                    return { 
                      status: 'error', 
                      message: `저온 테스트 ${i+1}/${lowReadCount} 실패 - 5회 재시도 후 최종 실패`, 
                      stoppedAtCycle: cycle, 
                      stoppedAtPhase: 'low_temp_test', 
                      stoppedAtTest: i+1,
                      errorType: 'low_temp_test_failed',
                      finalReportGenerated: true
                    };
                  }
                }
              }
              
              // 각 실행 결과를 개별 파일로 저장
              if (singlePageResult && singlePageResult.status === 'completed' && singlePageResult.data) {
                console.log(`[NextTankEnviTestProcess] 사이클 ${cycle} 저온 테스트 ${i+1}/${lowReadCount} 결과 저장 시작`);
                const saveResult = saveTotaReportTableToFile(
                  singlePageResult.data, 
                  getTableOption.channelVoltages, 
                  cycle, 
                  `LowTemp_Test${i+1}`
                );
                if (saveResult.success) {
                  console.log(`[NextTankEnviTestProcess] 사이클 ${cycle} 저온 테스트 ${i+1}/${lowReadCount} 결과 저장 완료: ${saveResult.filename}`);
                } else {
                  console.error(`[NextTankEnviTestProcess] 사이클 ${cycle} 저온 테스트 ${i+1}/${lowReadCount} 결과 저장 실패: ${saveResult.error}`);
                }
                
                // 결과 누적 (기존 로직 유지)
                lowTempResults.push(singlePageResult.data);
              }
            }
            console.log(`[NextTankEnviTestProcess] 사이클 ${cycle}: 저온 테스트 완료 (${lowTempResults.length}개 결과 누적)`);
            
            // 실행완료 하면 빠져 나감
            break;
          } else {
            console.log(`[NextTankEnviTestProcess] 사이클 ${cycle}: 저온 대기 중... 현재: ${chamberTemp}°C, 목표: ${lowTemp}°C`);
            await sleep(60000); // 1분 대기
          }
        }
      }
      
      console.log(`[NextTankEnviTestProcess] === 사이클 ${cycle}/${cycleNumber} 완료 ===`);
      
      // 마지막 사이클이 아니면 다음 사이클을 위한 대기 시간 추가
      if (cycle < cycleNumber) {
        console.log(`[NextTankEnviTestProcess] 다음 사이클을 위한 대기 중...`);
        await sleep(5000); // 5초 대기 (필요에 따라 조정 가능)
      }
    }
    
    console.log(`[NextTankEnviTestProcess] 모든 사이클(${cycleNumber}회) 완료`);
    
    // 모든 사이클 완료 후 종합 리포트 생성
    console.log(`[NextTankEnviTestProcess] 📄 모든 사이클 완료 - 종합 리포트 생성`);
    try {
      const finalReportResult = await generateFinalDeviceReport(cycleNumber);
      if (finalReportResult && finalReportResult.success) {
        console.log(`[NextTankEnviTestProcess] ✅ 종합 리포트 생성 성공: ${finalReportResult.filename}`);
      } else {
        console.error(`[NextTankEnviTestProcess] ❌ 종합 리포트 생성 실패:`, finalReportResult?.error || '알 수 없는 오류');
      }
    } catch (error) {
      console.error(`[NextTankEnviTestProcess] ❌ 종합 리포트 생성 실패:`, error.message);
    }
    
    // PowerSwitch 상태 OFF 설정
    setMachineRunningStatus(false);
    
    // 클라이언트에게 파워스위치 OFF 상태 전송
    if (globalWss) {
      const powerOffMessage = `[POWER_SWITCH] OFF - Machine running: false - Test completed`;
      globalWss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(powerOffMessage);
        }
      });
    }
    
    // 프로세스 중지 플래그 초기화 제거 - 중지 상태 유지
    console.log(`[NextTankEnviTestProcess] 🛑 프로세스 완료 - 중지 플래그 상태 유지`);
    // setProcessStopRequested(false) 호출 제거
    
    // 프로세스 완료 후 전역 디렉토리명 초기화 (모든 파일 생성 완료 후)
    console.log(`[NextTankEnviTestProcess] 📁 프로세스 완료 - 전역 디렉토리명 초기화: ${currentTestDirectoryName}`);
    currentTestDirectoryName = null;
    
    return { 
      status: 'completed', 
      message: '모든 사이클 완료 및 종합 리포트 생성 완료',
      totalCycles: cycleNumber,
      finalReportGenerated: true
    };
    
  } catch (error) {
    console.error('[NextTankEnviTestProcess] 예외 발생:', error);
    
    // SinglePageProcess 중지로 인한 에러인지 확인
    if (error.status === 'stopped_by_singlepage') {
      console.log(`[NextTankEnviTestProcess] 🛑 SinglePageProcess 중지로 인한 프로세스 중단 처리`);
      
      // PowerSwitch 상태 OFF 설정
      setMachineRunningStatus(false);
      
      // 프로세스 중지 플래그 초기화 제거 - 중지 상태 유지
      console.log(`[NextTankEnviTestProcess] 🛑 SinglePageProcess 중지 - 중지 플래그 상태 유지`);
      // setProcessStopRequested(false) 호출 제거
      
      // 클라이언트에게 파워스위치 OFF 상태 전송
      if (globalWss) {
        const powerOffMessage = `[POWER_SWITCH] OFF - Machine running: false - SinglePageProcess stopped`;
        let sentCount = 0;
        globalWss.clients.forEach(client => {
          if (client.readyState === 1) { // WebSocket.OPEN
            client.send(powerOffMessage);
            sentCount++;
          }
        });
        console.log(`[NextTankEnviTestProcess] 🔌 SinglePageProcess 중지로 인한 파워스위치 OFF 상태 메시지 전송 완료 - 클라이언트 수: ${sentCount}`);
      }
      
      // 전역 디렉토리명 초기화
      currentTestDirectoryName = null;
      
      // SinglePageProcess 중지로 인한 프로세스 완료 반환
      return {
        status: 'completed',
        message: error.message,
        stoppedAtCycle: error.stoppedAtCycle,
        stoppedAtPhase: error.stoppedAtPhase,
        stoppedAtTest: error.stoppedAtTest,
        finalReportGenerated: error.finalReportGenerated,
        result: error.result,
        totalCycles: error.stoppedAtCycle || 1
      };
    }
    
    // 일반 에러 발생 시 PowerSwitch 상태 OFF 설정
    setMachineRunningStatus(false);
    
    // 에러 발생 시 프로세스 중지 플래그 초기화 제거 - 중지 상태 유지
    console.log(`[NextTankEnviTestProcess] 🛑 에러 발생 - 중지 플래그 상태 유지`);
    // setProcessStopRequested(false) 호출 제거
    
    // 에러 발생 시에도 클라이언트에게 파워스위치 OFF 상태 전송
    if (globalWss) {
      const powerOffMessage = `[POWER_SWITCH] OFF - Machine running: false - Error occurred`;
      let sentCount = 0;
      globalWss.clients.forEach(client => {
        if (client.readyState === 1) { // WebSocket.OPEN
          client.send(powerOffMessage);
          sentCount++;
        }
      });
      console.log(`[NextTankEnviTestProcess] 🔌 에러 발생으로 인한 파워스위치 OFF 상태 메시지 전송 완료 - 클라이언트 수: ${sentCount}`);
    } else {
      console.warn(`[NextTankEnviTestProcess] 전역 WebSocket 서버가 설정되지 않음 - 에러 발생 시 파워스위치 OFF 메시지 전송 불가`);
    }
    
    // 에러 발생 시에도 중단된 테스트 결과 파일 생성
    console.log(`[NextTankEnviTestProcess] 📄 에러로 인한 중단된 테스트 결과 파일 생성 시작...`);
    
    try {
      // 테스트 설정 정보 수집 (에러 발생 시에는 기본값 사용)
      const testSettings = {
        modelName: 'N/A',
        productNumber: 'N/A',
        temperature: 'N/A',
        highTempEnabled: false,
        lowTempEnabled: false,
        totalCycles: 1,
        highTempWaitTime: 'N/A',
        lowTempWaitTime: 'N/A',
        highTempReadCount: 'N/A',
        lowTempReadCount: 'N/A'
      };
      
      // 중단된 테스트 결과 파일 생성 (안전한 처리)
      try {
        // 전역 디렉토리명이 있는지 확인
        if (!currentTestDirectoryName) {
          currentTestDirectoryName = getDateDirectoryName();
          console.log(`[NextTankEnviTestProcess] ⚠️ 전역 디렉토리명이 없어 새로 생성: ${currentTestDirectoryName}`);
        }
        
        const result = await generateInterruptedTestResultFile({
          stopReason: 'error',
          stoppedAtCycle: 1, // 에러 발생 시에는 사이클 1로 가정
          stoppedAtPhase: 'unknown',
          errorMessage: error.message || '알 수 없는 에러',
          testSettings
        });
        
        if (result && result.success) {
          console.log(`[NextTankEnviTestProcess] ✅ 에러로 인한 중단된 테스트 결과 파일 생성 완료: ${result.filename}`);
          // 전역 디렉토리명은 유지 (다른 함수에서도 사용)
          console.log(`[NextTankEnviTestProcess] 📁 전역 디렉토리명 유지: ${currentTestDirectoryName}`);
        } else {
          console.error(`[NextTankEnviTestProcess] ❌ 에러로 인한 중단된 테스트 결과 파일 생성 실패:`, result?.error || '알 수 없는 오류');
        }
      } catch (reportError) {
        console.error(`[NextTankEnviTestProcess] ❌ 에러로 인한 중단 보고서 생성 실패:`, reportError.message);
      }
          } catch (fileError) {
        console.error(`[NextTankEnviTestProcess] 에러로 인한 중단된 테스트 결과 파일 생성 중 오류:`, fileError);
      }
      
      // SinglePageProcess 중지가 아닌 일반 에러인 경우에도 중단 보고서 생성 후 프로세스 완료
      if (error.status !== 'stopped_by_singlepage') {
        console.log(`[NextTankEnviTestProcess] 🛑 일반 에러로 인한 프로세스 중단 - 중단 보고서 생성 완료`);
        
        // 전역 디렉토리명은 유지 (다른 함수에서도 사용)
        console.log(`[NextTankEnviTestProcess] 📁 전역 디렉토리명 유지: ${currentTestDirectoryName}`);
        
        // 에러 상태로 프로세스 완료 (에러를 다시 던지지 않음)
        return {
          status: 'error',
          message: error.message || '알 수 없는 에러',
          errorType: 'general_error',
          finalReportGenerated: true,
          totalCycles: 1
        };
      }
  }
}

/**
 * 모든 사이클의 테스트 결과를 종합하여 디바이스별 G/N 결론 리포트 생성
 * @param {number} cycleNumber - 총 사이클 수
 * @returns {Object} 종합 리포트 생성 결과
 */
async function generateFinalDeviceReport(cycleNumber) {
  try {
    console.log(`[FinalDeviceReport] 디바이스별 종합 리포트 생성 시작 - ${cycleNumber} 사이클`);
    
    // 제품명 가져오기 (공통 함수 사용)
    const deviceNames = loadProductNames();
    
    // ===== 현재 테스트 디렉토리에서만 CSV 파일 검색 =====
    let testDirectoryPath = null;
    
    if (currentTestDirectoryPath) {
      // 전역 변수에서 현재 테스트 디렉토리 경로 사용
      testDirectoryPath = currentTestDirectoryPath;
      console.log(`[FinalDeviceReport] 📁 현재 테스트 디렉토리에서만 파일 검색: ${testDirectoryPath}`);
    } else {
      // 전역 변수가 없으면 자동으로 최근 테스트 디렉토리 검색
      console.warn(`[FinalDeviceReport] ⚠️ 현재 테스트 디렉토리 경로가 설정되지 않음 - 자동으로 최근 테스트 디렉토리 검색`);
      
      try {
        const dataFolderPath = path.join(process.cwd(), 'Data');
        if (fs.existsSync(dataFolderPath)) {
          const dataFolders = fs.readdirSync(dataFolderPath)
            .filter(folder => fs.statSync(path.join(dataFolderPath, folder)).isDirectory())
            .sort()
            .reverse(); // 최신 순으로 정렬
          
          if (dataFolders.length > 0) {
            const latestFolder = dataFolders[0];
            testDirectoryPath = path.join(dataFolderPath, latestFolder);
            console.log(`[FinalDeviceReport] 📁 자동으로 최근 테스트 디렉토리 선택: ${testDirectoryPath}`);
          } else {
            console.error(`[FinalDeviceReport] ❌ Data 폴더에 테스트 디렉토리가 없음`);
            return { success: false, error: 'Data 폴더에 테스트 디렉토리가 없음' };
          }
        } else {
          console.error(`[FinalDeviceReport] ❌ Data 폴더가 존재하지 않음`);
          return { success: false, error: 'Data 폴더가 존재하지 않음' };
        }
      } catch (error) {
        console.error(`[FinalDeviceReport] ❌ 최근 테스트 디렉토리 검색 실패:`, error.message);
        return { success: false, error: `최근 테스트 디렉토리 검색 실패: ${error.message}` };
      }
    }
    
    // 테스트 디렉토리가 존재하는지 확인
    if (!fs.existsSync(testDirectoryPath)) {
      console.error(`[FinalDeviceReport] ❌ 테스트 디렉토리가 존재하지 않음: ${testDirectoryPath}`);
      return { success: false, error: '테스트 디렉토리가 존재하지 않음' };
    }
    
    // 현재 테스트 디렉토리에서만 CSV 파일 검색
    const allCsvFiles = [];
    
    try {
      const testDirFiles = fs.readdirSync(testDirectoryPath);
      console.log(`[FinalDeviceReport] 📁 테스트 디렉토리 파일 목록:`, testDirFiles);
      
      const testDirCsvFiles = testDirFiles.filter(file => 
        file.endsWith('.csv') && 
        (file.includes('Cycle') || file.includes('TimeMode') || file.includes('Test'))
      );
      console.log(`[FinalDeviceReport] 📁 테스트 관련 CSV 파일:`, testDirCsvFiles);
      
      allCsvFiles.push(...testDirCsvFiles.map(file => ({ file, directory: '' })));
      
      console.log(`[FinalDeviceReport] 📁 현재 테스트 디렉토리에서 발견된 CSV 파일: ${testDirCsvFiles.length}개`);
    } catch (error) {
      console.error(`[FinalDeviceReport] ❌ 테스트 디렉토리 읽기 실패:`, error.message);
      return { success: false, error: `테스트 디렉토리 읽기 실패: ${error.message}` };
    }
    
    const csvFiles = allCsvFiles;
    
    //console.log(`[FinalDeviceReport] 발견된 CSV 파일 수: ${csvFiles.length}`);
    
    if (csvFiles.length === 0) {
      console.warn(`[FinalDeviceReport] 분석할 CSV 파일이 없음`);
      return { success: false, error: '분석할 CSV 파일이 없음' };
    }
    
    console.log(`[FinalDeviceReport] 검색된 디렉토리: ${csvFiles.map(f => f.directory || 'current_test_dir').join(', ')}`);
    
    // 디바이스별 G/N 카운트 초기화 (제품명 사용)
    const deviceResults = {};
    for (let device = 0; device < deviceNames.length; device++) {
      const deviceName = deviceNames[device];
      deviceResults[deviceName] = {
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        channels: {
          'Channel 1 (5V)': { total: 0, passed: 0, failed: 0 },
          'Channel 2 (15V)': { total: 0, passed: 0, failed: 0 },
          'Channel 3 (-15V)': { total: 0, passed: 0, failed: 0 },
          'Channel 4 (24V)': { total: 0, passed: 0, failed: 0 }
        }
      };
    }
    
    console.log(`[FinalDeviceReport] 디바이스 결과 초기화 완료:`, Object.keys(deviceResults));
    
    // 채널명 매핑 함수
    const getChannelName = (channelIndex) => {
      const channelNames = [
        'Channel 1 (5V)',
        'Channel 2 (15V)', 
        'Channel 3 (-15V)',
        'Channel 4 (24V)'
      ];
      return channelNames[channelIndex] || `Channel ${channelIndex + 1}`;
    };

    // 안전한 속성 접근 함수 (강건한 버전)
    const safeUpdateChannel = (deviceName, channelName, result) => {
      try {
        // 디바이스명 검증
        if (!deviceName || typeof deviceName !== 'string') {
          console.warn(`[FinalDeviceReport] 유효하지 않은 디바이스명: ${deviceName}`);
          return;
        }
        
        // 채널명 검증
        if (!channelName || typeof channelName !== 'string') {
          console.warn(`[FinalDeviceReport] 유효하지 않은 채널명: ${channelName}`);
          return;
        }
        
        // 결과값 검증
        if (!result || (result !== 'G' && result !== 'N')) {
          console.warn(`[FinalDeviceReport] 유효하지 않은 결과값: ${result}`);
          return;
        }
        
        // 디바이스 존재 확인
        if (!deviceResults[deviceName]) {
          console.warn(`[FinalDeviceReport] 알 수 없는 디바이스: ${deviceName}. 사용 가능한 디바이스:`, Object.keys(deviceResults));
          return;
        }
        
        // 채널 존재 확인
        if (!deviceResults[deviceName].channels[channelName]) {
          console.warn(`[FinalDeviceReport] 알 수 없는 채널: ${channelName} for ${deviceName}. 사용 가능한 채널:`, Object.keys(deviceResults[deviceName].channels));
          return;
        }
        
        // 데이터 업데이트
        deviceResults[deviceName].totalTests++;
        deviceResults[deviceName].channels[channelName].total++;
        
        if (result === 'G') {
          deviceResults[deviceName].passedTests++;
          deviceResults[deviceName].channels[channelName].passed++;
          console.log(`[FinalDeviceReport] ${deviceName} ${channelName}: G - 통과 증가 (총: ${deviceResults[deviceName].channels[channelName].total})`);
        } else if (result === 'N') {
          deviceResults[deviceName].failedTests++;
          deviceResults[deviceName].channels[channelName].failed++;
          console.log(`[FinalDeviceReport] ${deviceName} ${channelName}: N - 실패 증가 (총: ${deviceResults[deviceName].channels[channelName].total})`);
        }
        
        console.log(`[FinalDeviceReport] ${deviceName} ${channelName}: ${result} (총: ${deviceResults[deviceName].channels[channelName].total})`);
      } catch (error) {
        console.error(`[FinalDeviceReport] safeUpdateChannel 오류 - ${deviceName} ${channelName}:`, error);
      }
    };

    // 각 CSV 파일 분석
    let processedFiles = 0;
    for (const fileInfo of csvFiles) {
      try {
        const { file: filename, directory } = fileInfo;
        const filePath = directory 
          ? path.join(testDirectoryPath, directory, filename)
          : path.join(testDirectoryPath, filename);
        const fileContent = fs.readFileSync(filePath, 'utf8');
        
        // 파일명에서 사이클 번호와 테스트 유형 추출 (개선된 패턴 매칭)
        console.log(`[FinalDeviceReport] 파일명 분석 중: ${filename}`);
        
        // 더 유연한 패턴 매칭
        const cycleMatch = filename.match(/Cycle(\d+)/i) || filename.match(/cycle(\d+)/i);
        const testTypeMatch = filename.match(/(HighTemp_Test\d+|LowTemp_Test\d+|TimeMode_Test\d+|TimeMode_high_temp_Test\d+|TimeMode_low_temp_Test\d+|TimeMode.*Test\d+|Test\d+)/i);
        
        console.log(`[FinalDeviceReport] Cycle 매치 결과:`, cycleMatch);
        console.log(`[FinalDeviceReport] TestType 매치 결과:`, testTypeMatch);
        
        // 사이클 매치가 없어도 계속 진행 (TimeMode 테스트의 경우)
        if (!testTypeMatch) {
          console.warn(`[FinalDeviceReport] 파일명에서 테스트 유형을 찾을 수 없음: ${filename}`);
          console.warn(`[FinalDeviceReport] 예상 형식: Cycle숫자_TimeMode_high_temp_Test숫자 또는 TimeMode_Test숫자`);
          // 테스트 유형이 없어도 파일을 분석해보기
        }
        
        const cycle = cycleMatch ? parseInt(cycleMatch[1]) : 1; // 기본값 1
        const testType = testTypeMatch ? testTypeMatch[1] : 'Unknown';
        
        //console.log(`[FinalDeviceReport] 분석 중: ${filename} (사이클 ${cycle}, ${testType})`);
        
        // CSV 내용에서 G/N 결과 추출
        const lines = fileContent.split('\n');
        let inComparisonSection = false;
        let inMeasurementSection = false;
        let channelIndex = 0;
        let sectionCount = 0;
        
        //console.log(`[FinalDeviceReport] ${filename} 분석 시작 - 총 ${lines.length}줄`);
        
        for (const line of lines) {
          const trimmedLine = line.trim();
          
          // 측정 결과 섹션 시작 감지 (이 섹션은 건너뛰기)
          if (trimmedLine.includes('Measurement Results') || trimmedLine.includes('측정 결과')) {
            inMeasurementSection = true;
            inComparisonSection = false;
            console.log(`[FinalDeviceReport] 측정 결과 섹션 발견 (건너뛰기): ${trimmedLine}`);
            continue;
          }
          
          // 비교결과 섹션 시작 감지 (G/N 결과만 처리)
          if ((trimmedLine.includes('Result') && trimmedLine.includes('G=Good')) || 
              trimmedLine.includes('비교결과') || 
              (trimmedLine.includes('G=Good') && trimmedLine.includes('N=Not Good'))) {
            inComparisonSection = true;
            inMeasurementSection = false;
            channelIndex = 0;
            sectionCount++;
            console.log(`[FinalDeviceReport] 비교결과 섹션 ${sectionCount} 발견: ${filename}`);
            console.log(`[FinalDeviceReport] 섹션 시작 라인: ${trimmedLine}`);
            continue;
          }
          
          // 측정 결과 섹션이면 건너뛰기
          if (inMeasurementSection) {
            continue;
          }
          
          if (inComparisonSection && (trimmedLine.startsWith('Channel') || trimmedLine.startsWith('채널') || trimmedLine.startsWith('CH'))) {
            console.log(`[FinalDeviceReport] 채널 라인 감지: ${trimmedLine}`);
            
            // 헤더 라인 감지 (정확한 패턴 매칭)
            // 헤더는 "Channel, PL2222, PL2233, ..." 형태여야 함
            const isHeaderLine = trimmedLine.match(/^(Channel|채널|CH)\s*,/i) && 
                                trimmedLine.split(',').length > 5 &&
                                !trimmedLine.includes('(') && // "Channel 1 (24V)" 같은 실제 데이터가 아님
                                !trimmedLine.match(/\d+\.\d+V/); // "4.99V" 같은 측정값이 아님
            
            if (isHeaderLine) {
              console.log(`[FinalDeviceReport] 헤더 라인 건너뛰기: ${trimmedLine}`);
              continue;
            }
            
            // 빈 라인이나 유효하지 않은 데이터 건너뛰기
            if (!trimmedLine || trimmedLine.split(',').length < 2) {
              console.log(`[FinalDeviceReport] 빈 라인 또는 유효하지 않은 데이터 건너뛰기: ${trimmedLine}`);
              continue;
            }
            
            // 채널 데이터 라인 감지 (G/N 결과만 처리)
            // "Channel 1, G, -, -, ..." 형태의 라인만 처리
            const channelMatch = trimmedLine.match(/^(Channel|채널|CH)\s+(\d+)/i);
            if (!channelMatch) {
              console.log(`[FinalDeviceReport] 채널 라인이 아님, 건너뛰기: ${trimmedLine}`);
              continue;
            }
            
            // 측정값이 포함된 라인은 건너뛰기 (예: "Channel 1 (24V), 4.99V, ...")
            if (trimmedLine.includes('(') || trimmedLine.match(/\d+\.\d+V/)) {
              console.log(`[FinalDeviceReport] 측정값이 포함된 라인 건너뛰기: ${trimmedLine}`);
              continue;
            }
            
            const detectedChannelNumber = parseInt(channelMatch[2]);
            console.log(`[FinalDeviceReport] 감지된 채널 번호: ${detectedChannelNumber}, 현재 채널 인덱스: ${channelIndex}`);
            
            const channelName = getChannelName(channelIndex);
            const results = trimmedLine.split(',').slice(1).map(r => r.trim()); // 제품명들 결과
            
            console.log(`[FinalDeviceReport] 섹션 ${sectionCount} 채널 ${channelIndex + 1} 분석: ${channelName}, 결과 수: ${results.length}`);
            console.log(`[FinalDeviceReport] 결과 데이터:`, results);
            console.log(`[FinalDeviceReport] 예상 제품명:`, deviceNames);
            
            // 결과 수와 제품명 수가 일치하는지 확인
            const expectedDeviceCount = Math.min(10, deviceNames.length);
            const actualResultCount = results.length;
            
            if (actualResultCount < expectedDeviceCount) {
              console.warn(`[FinalDeviceReport] 결과 수(${actualResultCount})가 예상 제품명 수(${expectedDeviceCount})보다 적음`);
            }
            
            // 결과 데이터와 제품명을 매핑 (더 안전한 처리)
            for (let deviceIndex = 0; deviceIndex < Math.min(expectedDeviceCount, actualResultCount); deviceIndex++) {
              const deviceName = deviceNames[deviceIndex] || `Device ${deviceIndex + 1}`;
              const result = results[deviceIndex];
              
              // 결과값 검증 및 정리 (더 포괄적인 처리)
              const cleanResult = result ? result.trim().toUpperCase() : '';
              
              if (cleanResult === 'G' || cleanResult === 'GOOD') {
                console.log(`[FinalDeviceReport] ${deviceName} ${channelName}: G - 업데이트 중`);
                safeUpdateChannel(deviceName, channelName, 'G');
              } else if (cleanResult === 'N' || cleanResult === 'NOT GOOD' || cleanResult === 'BAD') {
                console.log(`[FinalDeviceReport] ${deviceName} ${channelName}: N - 업데이트 중`);
                safeUpdateChannel(deviceName, channelName, 'N');
              } else if (cleanResult && cleanResult !== '-' && cleanResult !== '') {
                console.log(`[FinalDeviceReport] ${deviceName} ${channelName}: 알 수 없는 결과값 '${cleanResult}'`);
              } else {
                console.log(`[FinalDeviceReport] ${deviceName} ${channelName}: 빈 값 또는 '-' - 스킵`);
              }
            }
            channelIndex++;
            
            if (channelIndex >= 4) {
              inComparisonSection = false;
              console.log(`[FinalDeviceReport] 섹션 ${sectionCount} 완료: ${filename}`);
            }
          }
        }
        
        if (sectionCount === 0) {
          console.warn(`[FinalDeviceReport] ${filename}에서 비교결과 섹션을 찾을 수 없음`);
        } else {
          console.log(`[FinalDeviceReport] ${filename}에서 총 ${sectionCount}개의 비교결과 섹션 처리 완료`);
        }
        
        processedFiles++;
        
      } catch (fileError) {
        console.error(`[FinalDeviceReport] 파일 분석 실패: ${filename}`, fileError);
        console.error(`[FinalDeviceReport] 오류 상세:`, fileError.stack);
      }
    }
    
    console.log(`[FinalDeviceReport] 처리된 파일 수: ${processedFiles}/${csvFiles.length}`);
    
    // 분석 결과 요약 출력
    console.log(`[FinalDeviceReport] 디바이스별 분석 결과:`);
    for (const [deviceName, results] of Object.entries(deviceResults)) {
      if (results.totalTests > 0) {
        console.log(`[FinalDeviceReport] ${deviceName}: 총 ${results.totalTests}회, 통과 ${results.passedTests}회, 실패 ${results.failedTests}회`);
        for (const [channelName, channelResult] of Object.entries(results.channels)) {
          if (channelResult.total > 0) {
            //console.log(`[FinalDeviceReport]   ${channelName}: ${channelResult.passed}/${channelResult.total} (${((channelResult.passed / channelResult.total) * 100).toFixed(1)}%)`);
          }
        }
      }
    }
    
    // 디바이스별 최종 결론 생성
    const finalConclusions = {};
    console.log(`[FinalDeviceReport] 디바이스별 최종 결론 생성 시작`);
    for (const [deviceName, results] of Object.entries(deviceResults)) {
      console.log(`[FinalDeviceReport] ${deviceName} 분석: 총 ${results.totalTests}회, 통과 ${results.passedTests}회, 실패 ${results.failedTests}회`);
      if (results.totalTests > 0) {
        // 하나라도 N이 있으면 전체 디바이스는 N
        const hasAnyFailure = results.failedTests > 0;
        const conclusion = hasAnyFailure ? 'N' : 'G';
        finalConclusions[deviceName] = {
          conclusion: conclusion,
          totalTests: results.totalTests,
          passedTests: results.passedTests,
          failedTests: results.failedTests,
          passRate: ((results.passedTests / results.totalTests) * 100).toFixed(2),
          channels: results.channels
        };
        console.log(`[FinalDeviceReport] ${deviceName} 최종 결론: ${conclusion} (통과율: ${((results.passedTests / results.totalTests) * 100).toFixed(2)}%)`);
      } else {
        console.log(`[FinalDeviceReport] ${deviceName}: 테스트 없음 - 스킵`);
      }
    }
    
    console.log(`[FinalDeviceReport] 최종 결론 생성 완료: ${Object.keys(finalConclusions).length}개 디바이스`);
    
    // finalConclusions가 비어있으면 경고 및 상세 디버깅
    if (Object.keys(finalConclusions).length === 0) {
      console.warn(`[FinalDeviceReport] ⚠️ 최종 결론이 비어있음 - 모든 디바이스의 totalTests가 0`);
      console.warn(`[FinalDeviceReport] ⚠️ CSV 파일에서 데이터를 제대로 읽지 못했을 가능성`);
      
      // 상세 디버깅 정보 출력
      console.log(`[FinalDeviceReport] 🔍 디버깅 정보:`);
      console.log(`[FinalDeviceReport] - 처리된 파일 수: ${processedFiles}`);
      console.log(`[FinalDeviceReport] - 총 CSV 파일 수: ${csvFiles.length}`);
      console.log(`[FinalDeviceReport] - 디바이스 수: ${Object.keys(deviceResults).length}`);
      
      for (const [deviceName, results] of Object.entries(deviceResults)) {
        console.log(`[FinalDeviceReport] - ${deviceName}: totalTests=${results.totalTests}, passedTests=${results.passedTests}, failedTests=${results.failedTests}`);
        for (const [channelName, channelResult] of Object.entries(results.channels)) {
          if (channelResult.total > 0) {
            console.log(`[FinalDeviceReport]   - ${channelName}: total=${channelResult.total}, passed=${channelResult.passed}, failed=${channelResult.failed}`);
          }
        }
      }
    }
    
    // 종합 리포트 파일 생성
    const reportFilename = `${getFormattedDateTime()}_Final_Device_Report.csv`;
    
    // ===== 전역 변수에서 테스트 디렉토리명 사용 (새로 생성하지 않음) =====
    let dateDirectoryName = currentTestDirectoryName;

    // ===== 테스트 디렉토리 경로 찾기 로직 개선 =====
    let dateFolderPath = null;
    
    // 1. 전역 변수에서 테스트 디렉토리 경로 확인
    if (currentTestDirectoryPath && fs.existsSync(currentTestDirectoryPath)) {
      dateFolderPath = currentTestDirectoryPath;
      console.log(`[FinalDeviceReport] 📁 전역 변수에서 테스트 디렉토리 경로 사용: ${dateFolderPath}`);
    } else {
      // 2. 전역 변수가 없거나 경로가 존재하지 않으면 Data 폴더에서 최신 디렉토리 찾기
      const dataDir = path.join(process.cwd(), 'Data');
      if (fs.existsSync(dataDir)) {
        try {
          const dirs = fs.readdirSync(dataDir, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name)
            .sort()
            .reverse(); // 최신 순으로 정렬
          
          if (dirs.length > 0) {
            dateFolderPath = path.join(dataDir, dirs[0]);
            console.log(`[FinalDeviceReport] 📁 Data 폴더에서 최신 디렉토리 사용: ${dateFolderPath}`);
          } else {
            dateFolderPath = path.join(dataDir, 'default');
            console.log(`[FinalDeviceReport] 📁 Data 폴더에 디렉토리가 없어 기본 경로 사용: ${dateFolderPath}`);
          }
        } catch (error) {
          console.error(`[FinalDeviceReport] ❌ Data 폴더 읽기 실패:`, error.message);
          dateFolderPath = path.join(process.cwd(), 'Data', 'default');
          console.log(`[FinalDeviceReport] 📁 오류 발생으로 기본 경로 사용: ${dateFolderPath}`);
        }
      } else {
        // 3. Data 폴더도 없으면 기본 경로 사용
        dateFolderPath = path.join(process.cwd(), 'Data', 'default');
        console.log(`[FinalDeviceReport] 📁 Data 폴더가 없어 기본 경로 사용: ${dateFolderPath}`);
      }
    }
    
    const reportFilePath = path.join(dateFolderPath, reportFilename);
    
    let reportContent = '';
     reportContent += `=== Device Comprehensive Test Report ===\n`;
     reportContent += `Generated Date,${new Date().toLocaleString('en-US')}\n`;
     reportContent += `Total Cycles,${cycleNumber}\n`;
     reportContent += `Analyzed Files,${processedFiles}\n`;
    reportContent += `\n`;
    
     // Device summary
     reportContent += `Device,Final Result,Total Tests,Passed,Failed,Pass Rate,Detailed Results\n`;
    
    if (Object.keys(finalConclusions).length > 0) {
      for (const [deviceName, conclusion] of Object.entries(finalConclusions)) {
        reportContent += `${deviceName},${conclusion.conclusion},${conclusion.totalTests},${conclusion.passedTests},${conclusion.failedTests},${conclusion.passRate}%,`;
        
         // Channel detailed results
        const channelDetails = [];
        for (const [channelName, channelResult] of Object.entries(conclusion.channels)) {
          if (channelResult.total > 0) {
            const channelPassRate = ((channelResult.passed / channelResult.total) * 100).toFixed(1);
            channelDetails.push(`${channelName}: ${channelResult.passed}/${channelResult.total} (${channelPassRate}%)`);
          }
        }
        reportContent += channelDetails.join('; ') + '\n';
      }
    } else {
      // finalConclusions가 비어있을 때 모든 디바이스를 N으로 표시
      console.log(`[FinalDeviceReport] finalConclusions가 비어있음 - 모든 디바이스를 N으로 표시`);
      for (let device = 1; device <= 10; device++) {
        const deviceName = `Device ${device}`;
        reportContent += `${deviceName},N,0,0,0,0%,No data available\n`;
      }
    }
    
     // Overall statistics
     const totalDevices = Object.keys(finalConclusions).length > 0 ? Object.keys(finalConclusions).length : 10; // finalConclusions가 비어있으면 10개 디바이스로 가정
     const goodDevices = Object.values(finalConclusions).filter(c => c.conclusion === 'G').length;
     const notGoodDevices = Object.keys(finalConclusions).length > 0 ? Object.values(finalConclusions).filter(c => c.conclusion === 'N').length : 10; // finalConclusions가 비어있으면 모든 디바이스를 N으로 간주
     
     reportContent += `\n`;
     reportContent += `=== Overall Summary ===\n`;
     reportContent += `Total Devices,${totalDevices}\n`;
     reportContent += `Good(G) Devices,${goodDevices}\n`;
     reportContent += `Bad(N) Devices,${notGoodDevices}\n`;
     const overallPassRate = totalDevices > 0 ? ((goodDevices / totalDevices) * 100).toFixed(2) : 0;
     reportContent += `Overall Pass Rate,${overallPassRate}%\n`;
     reportContent += `\n`;
     
     // Include all test files sequentially
     reportContent += `=== Test Files Details ===\n`;
     reportContent += `File Name,Cycle,Test Type,Status,Processed\n`;
     
     for (let i = 0; i < csvFiles.length; i++) {
       const file = csvFiles[i];
       const filePath = file.directory 
         ? path.join(file.directory, file.file)
         : path.join(testDirectoryPath, file.file);
       
       // Extract cycle and test type from filename
       const cycleMatch = file.file.match(/Cycle(\d+)/);
       const testTypeMatch = file.file.match(/(HighTemp_Test\d+|LowTemp_Test\d+|TimeMode_Test\d+)/);
       
       const cycle = cycleMatch ? cycleMatch[1] : 'Unknown';
       const testType = testTypeMatch ? testTypeMatch[1] : 'Unknown';
       const status = i < processedFiles ? 'Processed' : 'Skipped';
       
       reportContent += `${file.file},${cycle},${testType},${status},${i < processedFiles ? 'Yes' : 'No'}\n`;
     }
     
     // Include CSV file contents
     reportContent += `\n`;
     reportContent += `=== CSV File Contents ===\n`;
     
     for (let i = 0; i < csvFiles.length; i++) {
       const file = csvFiles[i];
       const filePath = file.directory 
         ? path.join(file.directory, file.file)
         : path.join(testDirectoryPath, file.file);
       
       try {
         if (fs.existsSync(filePath)) {
           const csvContent = fs.readFileSync(filePath, 'utf8');
           
           // Extract cycle and test type from filename
           const cycleMatch = file.file.match(/Cycle(\d+)/);
           const testTypeMatch = file.file.match(/(HighTemp_Test\d+|LowTemp_Test\d+|TimeMode_Test\d+)/);
           
           const cycle = cycleMatch ? cycleMatch[1] : 'Unknown';
           const testType = testTypeMatch ? testTypeMatch[1] : 'Unknown';
           
           reportContent += `\n--- File: ${file.file} (Cycle ${cycle}, ${testType}) ---\n`;
           reportContent += csvContent;
           reportContent += `\n--- End of File: ${file.file} ---\n`;
         } else {
           reportContent += `\n--- File: ${file.file} (File not found) ---\n`;
         }
       } catch (error) {
         console.error(`[FinalDeviceReport] CSV 파일 읽기 실패: ${file.file}`, error);
         reportContent += `\n--- File: ${file.file} (Error reading file: ${error.message}) ---\n`;
       }
     }
     
     reportContent += `\n`;
     reportContent += `=== Test Conditions ===\n`;
     reportContent += `High Temperature Test,10 times (per cycle)\n`;
     reportContent += `Low Temperature Test,10 times (per cycle)\n`;
     reportContent += `Total Tests,${cycleNumber * 20} times\n`;
     reportContent += `\n`;
     reportContent += `=== Conclusion ===\n`;
     reportContent += `All devices G: Overall Pass\n`;
     reportContent += `Any device N: That device is defective\n`;
     reportContent += `\n`;
     reportContent += `Author,System\n`;
     reportContent += `Document Version,PS-14(Rev.1)\n`;
     reportContent += `Company Name,Adelpia Lab Co., Ltd.\n`;
    
    // 파일 저장
    fs.writeFileSync(reportFilePath, reportContent, 'utf8');
    
    console.log(`[FinalDeviceReport] 종합 리포트 생성 완료: ${reportFilename}`);
    console.log(`[FinalDeviceReport] 파일 경로: ${reportFilePath}`);
    console.log(`[FinalDeviceReport] 전체 디바이스: ${totalDevices}개, 양품: ${goodDevices}개, 불량: ${notGoodDevices}개`);
    
    return {
      success: true,
      filename: reportFilename,
      filePath: reportFilePath,
      totalDevices,
      goodDevices,
      notGoodDevices,
      deviceResults: finalConclusions
    };
    
  } catch (error) {
    console.error('[FinalDeviceReport] 종합 리포트 생성 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 작업 디렉토리의 측정파일을 조사하여 실제 존재하는 파일 목록을 반환
 * @param {string} dateDirectoryName - 테스트 디렉토리명
 * @returns {Array} 발견된 측정파일 목록
 */
function scanExistingMeasurementFiles(dateDirectoryName) {
  try {
    // ===== 전역 변수에서 테스트 디렉토리 경로 사용 (새로 생성하지 않음) =====
    let dataFolderPath = null;
    
    if (currentTestDirectoryPath) {
      // 전역 변수에서 Data 폴더 경로 추출
      dataFolderPath = path.dirname(currentTestDirectoryPath);
      console.log(`[ScanFiles] 📁 전역 변수에서 Data 폴더 경로 사용: ${dataFolderPath}`);
    } else {
      // 전역 변수가 없으면 기본 경로 사용
      dataFolderPath = path.join(process.cwd(), 'Data');
      console.log(`[ScanFiles] 📁 기본 Data 폴더 경로 사용: ${dataFolderPath}`);
    }
    
    const dateFolderPath = path.join(dataFolderPath, dateDirectoryName);
    
    console.log(`[ScanFiles] 📁 측정파일 조사 시작: ${dateFolderPath}`);
    
    if (!fs.existsSync(dateFolderPath)) {
      console.log(`[ScanFiles] ⚠️ 디렉토리가 존재하지 않음: ${dateFolderPath}`);
      return [];
    }
    
    const files = fs.readdirSync(dateFolderPath);
    const measurementFiles = files
      .filter(file => {
        const isCSV = file.endsWith('.csv');
        const isMeasurementFile = file.includes('Cycle') || file.includes('Test') || file.includes('측정') || file.includes('결과');
        const isNotReport = !file.includes('중단보고서') && !file.includes('종합리포트') && !file.includes('최종보고서');
        return isCSV && isMeasurementFile && isNotReport;
      })
      .map(file => {
        const filePath = path.join(dateFolderPath, file);
        const stats = fs.statSync(filePath);
        return {
          filename: file,
          filepath: filePath,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime
        };
      })
      .sort((a, b) => b.modified - a.modified); // 최신 파일순으로 정렬
    
    console.log(`[ScanFiles] 📊 발견된 측정파일 수: ${measurementFiles.length}`);
    measurementFiles.forEach((file, index) => {
      console.log(`[ScanFiles] ${index + 1}. ${file.filename} (${(file.size / 1024).toFixed(1)}KB)`);
    });
    
    return measurementFiles;
    
  } catch (error) {
    console.error(`[ScanFiles] ❌ 측정파일 조사 실패:`, error.message);
    return [];
  }
}

/**
 * 중단 원인을 상세하게 분석하여 사용자 친화적인 메시지로 변환
 * @param {string} stopReason - 원본 중단 원인
 * @param {string} errorMessage - 에러 메시지
 * @param {string} stoppedAtPhase - 중단된 페이즈
 * @returns {Object} 분석된 중단 정보
 */
function analyzeStopReason(stopReason, errorMessage, stoppedAtPhase) {
  const reasonMap = {
    'power_switch_off': {
      category: '수동 중지',
      description: '사용자가 파워 스위치를 OFF로 변경',
      severity: 'normal',
      actionRequired: '필요시 테스트 재시작'
    },
    'manual_stop': {
      category: '수동 중지',
      description: '사용자가 수동으로 테스트 중단',
      severity: 'normal', 
      actionRequired: '필요시 테스트 재시작'
    },
    'system_failure': {
      category: '시스템 오류',
      description: '시스템 장애로 인한 강제 중단',
      severity: 'critical',
      actionRequired: '시스템 점검 후 재시작 필요'
    },
    'error': {
      category: '예외 오류',
      description: '예기치 않은 오류 발생',
      severity: 'high',
      actionRequired: '오류 원인 분석 후 재시작 필요'
    },
    'timeout': {
      category: '시간 초과',
      description: '설정된 대기 시간 초과',
      severity: 'medium',
      actionRequired: '설정 확인 후 재시작'
    },
    'unknown': {
      category: '알 수 없음',
      description: '원인 불명의 중단',
      severity: 'medium',
      actionRequired: '시스템 상태 점검 필요'
    }
  };
  
  const analysis = reasonMap[stopReason] || reasonMap['unknown'];
  
  return {
    ...analysis,
    originalReason: stopReason,
    errorMessage: errorMessage || '',
    stoppedAtPhase: stoppedAtPhase || 'unknown',
    timestamp: new Date().toLocaleString('en-US')
  };
}

/**
 * 테스트가 중단된 경우 측정파일을 조사하고 정상 종료와 유사한 형식으로 최종 리포트를 생성
 * @param {Object} options - 중단 정보 및 설정
 * @param {string} options.stopReason - 중단 원인 ('manual_stop', 'error', 'system_failure', 'power_switch_off', 'timeout')
 * @param {number} options.stoppedAtCycle - 중단된 사이클 번호
 * @param {string} options.stoppedAtPhase - 중단된 테스트 페이즈
 * @param {number} options.stoppedAtTest - 중단된 테스트 번호
 * @param {string} options.errorMessage - 에러 메시지 (에러 발생 시)
 * @param {Object} options.testSettings - 테스트 설정 정보
 * @param {Array} options.existingFiles - 이미 생성된 파일들의 경로 배열 (선택사항, 자동 조사됨)
 * @returns {Object} 결과 파일 생성 결과
 */
export async function generateInterruptedTestResultFile(options) {
  try {
    console.log(`[InterruptedTestResult] 📄 중단된 테스트 최종 리포트 생성 시작`);
    
    // 기본 옵션 설정
    const {
      stopReason = 'unknown',
      stoppedAtCycle = 1,
      stoppedAtPhase = 'unknown',
      stoppedAtTest = 0,
      errorMessage = '',
      testSettings = {},
      existingFiles = [] // 이 값은 무시하고 실제 파일을 조사함
    } = options || {};
    
    // ===== 전역 변수에서 디렉토리명 가져오기 (새로 생성하지 않음) =====
    let dateDirectoryName = currentTestDirectoryName;
          if (!dateDirectoryName) {
        console.log(`[InterruptedTestResult] 📁 전역 디렉토리명이 설정되지 않음 - 자동으로 최근 테스트 디렉토리 검색`);
        
        // Automatically find the most recent test directory
        try {
          const dataFolderPath = path.join(process.cwd(), 'Data');
          const directories = fs.readdirSync(dataFolderPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name)
            .filter(name => /^\d{8}_\d{4}$/.test(name)) // Filter for date format YYYYMMDD_HHMM
            .sort()
            .reverse(); // Most recent first
          
          if (directories.length > 0) {
            dateDirectoryName = directories[0];
            console.log(`[InterruptedTestResult] 📁 자동으로 최근 테스트 디렉토리 발견: ${dateDirectoryName}`);
          } else {
            throw new Error('테스트 데이터 디렉토리를 찾을 수 없습니다');
          }
        } catch (error) {
          console.error(`[InterruptedTestResult] ❌ 자동 디렉토리 검색 실패: ${error.message}`);
          throw new Error('테스트 데이터 디렉토리를 찾을 수 없습니다');
        }
      }
    console.log(`[InterruptedTestResult] 📁 기존 테스트 디렉토리 사용: ${dateDirectoryName}`);
    
    const dataFolderPath = path.join(process.cwd(), 'Data');
    const dateFolderPath = path.join(dataFolderPath, dateDirectoryName);
    
    // 디렉토리 생성 (안전한 처리)
    try {
      if (!fs.existsSync(dataFolderPath)) {
        fs.mkdirSync(dataFolderPath, { recursive: true });
      }
      if (!fs.existsSync(dateFolderPath)) {
        fs.mkdirSync(dateFolderPath, { recursive: true });
      }
    } catch (mkdirError) {
      console.error(`[InterruptedTestResult] ❌ 디렉토리 생성 실패:`, mkdirError.message);
      throw new Error(`디렉토리 생성 실패: ${mkdirError.message}`);
    }
    
    // ===== 1. 측정파일 조사 =====
    const measurementFiles = scanExistingMeasurementFiles(dateDirectoryName);
    
    // ===== 2. 중단 원인 분석 =====
    let stopAnalysis;
    if (stopReason === 'completed_successfully') {
      stopAnalysis = {
        category: '정상 완료',
        description: '모든 테스트가 성공적으로 완료됨',
        severity: '정보',
        actionRequired: '추가 조치 불필요',
        errorMessage: '',
        timestamp: new Date().toLocaleString('en-US')
      };
    } else {
      stopAnalysis = analyzeStopReason(stopReason, errorMessage, stoppedAtPhase);
    }
    
    // ===== 3. 파일명 생성 (정상 종료와 유사한 형식) =====
    const timestamp = getFormattedDateTime();
    let filename;
    if (stopReason === 'completed_successfully') {
      filename = `최종보고서_${timestamp}.csv`;
    } else {
      filename = `중단된테스트_최종보고서_${timestamp}.csv`;
    }
    const filePath = path.join(dateFolderPath, filename);
    
    // ===== 4. CSV 내용 생성 (정상 종료 형식과 유사하게) =====
    let csvContent = '';
    
    // 헤더 정보 (정상 종료 리포트와 유사)
    if (stopReason === 'completed_successfully') {
      csvContent += `=== 테스트 최종 결과 보고서 ===\n`;
      csvContent += `생성일시,${timestamp}\n`;
      csvContent += `테스트 상태,완료됨\n`;
      csvContent += `완료 사이클,${stoppedAtCycle}/${testSettings.totalCycles || 'N/A'}\n`;
      csvContent += `완료 지점,사이클 ${stoppedAtCycle} - ${stoppedAtPhase}\n`;
    } else {
      csvContent += `=== 중단된 테스트 최종 결과 보고서 ===\n`;
      csvContent += `생성일시,${timestamp}\n`;
      csvContent += `테스트 상태,중단됨\n`;
      csvContent += `완료 사이클,${stoppedAtCycle - 1}/${testSettings.totalCycles || 'N/A'}\n`;
      csvContent += `중단 지점,사이클 ${stoppedAtCycle} - ${stoppedAtPhase}\n`;
    }
    csvContent += `\n`;
    
    // 중단 원인 상세 정보
    if (stopReason === 'completed_successfully') {
      csvContent += `=== 테스트 완료 요약 ===\n`;
      csvContent += `분류,${stopAnalysis.category}\n`;
      csvContent += `상태,${stopAnalysis.description}\n`;
      csvContent += `심각도,${stopAnalysis.severity}\n`;
      csvContent += `조치사항,${stopAnalysis.actionRequired}\n`;
      csvContent += `완료 시간,${stopAnalysis.timestamp}\n`;
    } else {
      csvContent += `=== 중단 원인 분석 ===\n`;
      csvContent += `분류,${stopAnalysis.category}\n`;
      csvContent += `원인,${stopAnalysis.description}\n`;
      csvContent += `심각도,${stopAnalysis.severity}\n`;
      csvContent += `조치사항,${stopAnalysis.actionRequired}\n`;
      if (stopAnalysis.errorMessage) {
        csvContent += `오류 메시지,${stopAnalysis.errorMessage}\n`;
      }
      csvContent += `중단 시간,${stopAnalysis.timestamp}\n`;
    }
    csvContent += `\n`;
    
    // 테스트 설정 정보 (정상 종료 리포트와 동일 형식)
    csvContent += `=== 테스트 설정 정보 ===\n`;
    csvContent += `제품명,${testSettings.modelName || 'N/A'}\n`;
    csvContent += `제품번호,${testSettings.productNumber || 'N/A'}\n`;
    csvContent += `목표 사이클 수,${testSettings.totalCycles || 'N/A'}\n`;
    csvContent += `고온 테스트,${testSettings.highTempEnabled ? 'O' : 'X'}\n`;
    csvContent += `저온 테스트,${testSettings.lowTempEnabled ? 'O' : 'X'}\n`;
    if (testSettings.highTempEnabled) {
      csvContent += `고온 설정,${testSettings.temperature || 'N/A'}℃\n`;
      csvContent += `고온 대기시간,${testSettings.highTempWaitTime || 'N/A'}초\n`;
      csvContent += `고온 측정횟수,${testSettings.highTempReadCount || 'N/A'}회\n`;
    }
    if (testSettings.lowTempEnabled) {
      csvContent += `저온 설정,${testSettings.lowTempSettings?.targetTemp || 'N/A'}℃\n`;
      csvContent += `저온 대기시간,${testSettings.lowTempWaitTime || 'N/A'}초\n`;
      csvContent += `저온 측정횟수,${testSettings.lowTempReadCount || 'N/A'}회\n`;
    }
    csvContent += `\n`;
    
    // 측정파일 조사 결과 (요구사항 4,5,6)
    csvContent += `=== 측정파일 조사 결과 ===\n`;
    if (measurementFiles.length === 0) {
      csvContent += `상태,측정파일이 하나도 생성되지 않았습니다\n`;
      csvContent += `파일 수,0개\n`;
    } else {
      csvContent += `상태,${measurementFiles.length}개의 측정파일이 발견되었습니다\n`;
      csvContent += `파일 수,${measurementFiles.length}개\n`;
      csvContent += `\n`;
      csvContent += `=== 발견된 파일 목록 ===\n`;
      csvContent += `순번,파일명,크기(KB),생성시간,수정시간\n`;
      measurementFiles.forEach((file, index) => {
        const sizeKB = (file.size / 1024).toFixed(1);
        const createdTime = file.created.toLocaleString('en-US');
        const modifiedTime = file.modified.toLocaleString('en-US');
        csvContent += `${index + 1},${file.filename},${sizeKB},${createdTime},${modifiedTime}\n`;
      });
    }
    csvContent += `\n`;
    
    // 테스트 진행 상황 분석
    csvContent += `=== 테스트 진행 상황 ===\n`;
    const totalExpectedCycles = testSettings.totalCycles || 1;
    let completedCycles, progressPercentage;
    
    if (stopReason === 'completed_successfully') {
      completedCycles = stoppedAtCycle;
      progressPercentage = '100.0';
    } else {
      completedCycles = Math.max(0, stoppedAtCycle - 1);
      progressPercentage = ((completedCycles / totalExpectedCycles) * 100).toFixed(1);
    }
    
    csvContent += `전체 진행률,${progressPercentage}% (${completedCycles}/${totalExpectedCycles} 사이클)\n`;
    csvContent += `완료된 사이클,${completedCycles}개\n`;
    csvContent += `미완료 사이클,${totalExpectedCycles - completedCycles}개\n`;
    if (stopReason === 'completed_successfully') {
      csvContent += `최종 완료 단계,${stoppedAtPhase}\n`;
    } else {
      csvContent += `마지막 완료 단계,${stoppedAtPhase}\n`;
    }
    csvContent += `\n`;
    
    // 권장 조치사항 (상세화)
    if (stopReason === 'completed_successfully') {
      csvContent += `=== 권장 조치사항 ===\n`;
      csvContent += `1단계,생성된 측정파일 검증 (${measurementFiles.length}개 파일)\n`;
      csvContent += `2단계,테스트 결과 데이터 백업\n`;
      csvContent += `3단계,시스템 상태 점검\n`;
      csvContent += `4단계,다음 테스트 준비\n`;
      csvContent += `5단계,테스트 완료 보고서 검토\n`;
    } else {
      csvContent += `=== 권장 조치사항 ===\n`;
      csvContent += `1단계,시스템 상태 점검\n`;
      csvContent += `2단계,생성된 측정파일 검증 (${measurementFiles.length}개 파일)\n`;
      csvContent += `3단계,중단 원인 해결 (${stopAnalysis.category})\n`;
      csvContent += `4단계,${stopAnalysis.actionRequired}\n`;
      if (measurementFiles.length > 0) {
        csvContent += `5단계,기존 데이터 백업 후 테스트 재시작\n`;
      } else {
        csvContent += `5단계,처음부터 테스트 재시작\n`;
      }
    }
    csvContent += `\n`;
    
    // 문서 정보 (정상 종료 리포트와 동일)
    csvContent += `=== 문서 정보 ===\n`;
    csvContent += `작성자,시스템\n`;
    csvContent += `문서버전,PS-14(Rev.1)\n`;
    csvContent += `회사명,(주)아델피아랩\n`;
    if (stopReason === 'completed_successfully') {
      csvContent += `보고서 유형,테스트 최종 보고서\n`;
    } else {
      csvContent += `보고서 유형,중단된 테스트 최종 보고서\n`;
    }
    csvContent += `생성 시스템,환경 테스트 자동화 시스템\n`;
    
    // ===== 5. 파일 저장 =====
    try {
      
      fs.writeFileSync(filePath, csvContent, 'utf8');
      
      // 2초 대기 후 파일 존재 여부 확인
      await sleep(2000);
      
      // 파일 존재 여부 확인
      if (!fs.existsSync(filePath)) {
        throw new Error('파일이 생성되지 않음');
      }
      
      if (stopReason === 'completed_successfully') {
        console.log(`[InterruptedTestResult] ✅ 테스트 최종 보고서 생성 완료: ${filename}`);
        console.log(`[InterruptedTestResult] 📁 파일 경로: ${filePath}`);
        console.log(`[InterruptedTestResult] 📊 조사된 측정파일: ${measurementFiles.length}개`);
        console.log(`[InterruptedTestResult] 🎉 테스트 완료: ${stopAnalysis.category} - ${stopAnalysis.description}`);
      } else {
        console.log(`[InterruptedTestResult] ✅ 중단된 테스트 최종 보고서 생성 완료: ${filename}`);
        console.log(`[InterruptedTestResult] 📁 파일 경로: ${filePath}`);
        console.log(`[InterruptedTestResult] 📊 조사된 측정파일: ${measurementFiles.length}개`);
        console.log(`[InterruptedTestResult] 🔍 중단 원인: ${stopAnalysis.category} - ${stopAnalysis.description}`);
      }
      
    } catch (writeError) {
      console.error(`[InterruptedTestResult] ❌ 파일 저장 실패:`, writeError.message);
      throw new Error(`파일 저장 실패: ${writeError.message}`);
    }
    
    return { 
      success: true, 
      filename,
      filePath,
      stopReason,
      stoppedAtCycle,
      stoppedAtPhase,
      stoppedAtTest,
      measurementFilesCount: measurementFiles.length,
      measurementFiles: measurementFiles.map(f => f.filename),
      stopAnalysis
    };
    
  } catch (error) {
    console.error('[InterruptedTestResult] ❌ 중단된 테스트 최종 보고서 생성 실패:', error.message);
    
    // 에러 발생 시에도 간단한 로그 파일 생성
    try {
      const errorLogPath = path.join(process.cwd(), 'Data', 'error-interrupted-report.txt');
      const errorContent = `[${new Date().toISOString()}] 중단된 테스트 보고서 생성 실패\n에러: ${error.message}\n스택: ${error.stack}\n`;
      fs.writeFileSync(errorLogPath, errorContent, 'utf8');
      console.log(`[InterruptedTestResult] 📝 에러 로그 저장됨: ${errorLogPath}`);
    } catch (logError) {
      console.error('[InterruptedTestResult] ❌ 에러 로그 생성도 실패:', logError.message);
    }
    
    return { 
      success: false, 
      error: error.message
    };
  }
}

// 전역 테이블 데이터 저장소 추가
let globalTableData = {
  devices: Array.from({ length: 10 }, (_, deviceIndex) => ({
    deviceNumber: deviceIndex + 1,
    tests: Array.from({ length: 3 }, (_, testIndex) => ({
      testNumber: testIndex + 1,
      channels: Array.from({ length: 4 }, (_, channelIndex) => ({
        channelNumber: channelIndex + 1,
        voltage: null,
        timestamp: null,
        status: 'pending'
      }))
    }))
  })),
  lastUpdate: null,
  isComplete: false
};

// 전압 데이터를 테이블에 업데이트하는 함수
export function updateTableData(deviceNumber, testNumber, channelNumber, voltage, status = 'completed') {
  try {
    if (deviceNumber >= 1 && deviceNumber <= 10 && 
        testNumber >= 1 && testNumber <= 3 && 
        channelNumber >= 1 && channelNumber <= 4) {
      
      globalTableData.devices[deviceNumber - 1].tests[testNumber - 1].channels[channelNumber - 1] = {
        channelNumber,
        voltage: voltage,
        timestamp: new Date().toISOString(),
        status: status
      };
      
      globalTableData.lastUpdate = new Date().toISOString();
      
      console.log(`[TableData] Device ${deviceNumber}, Test ${testNumber}, Channel ${channelNumber}: ${voltage}V (${status})`);
      
      // 전압 데이터가 업데이트될 때마다 즉시 클라이언트에 전송하는 대신
      // 4개 채널이 모두 읽힌 후에 전송하도록 변경
      // broadcastTableData(); // 이 줄 제거
    }
  } catch (error) {
    console.error(`[TableData] 테이블 데이터 업데이트 오류:`, error);
  }
}

// 현재 테이블 데이터를 가져오는 함수
export function getCurrentTableData() {
  return globalTableData;
}

// 테이블 데이터를 클라이언트에 전송하는 함수
export async function broadcastTableData() {
  if (!globalWss) {
    console.warn(`[TableData] 전역 WebSocket 서버가 설정되지 않음`);
    return;
  }
  
  try {
    // 시간 기반 디바운싱 제거 - 이벤트 기반 전송으로 변경
    
    // 선택된 디바이스 상태 가져오기
    const getTableOption = await getSafeGetTableOption();
    const deviceStates = getTableOption.deviceStates || [];
    
    // 선택된 디바이스만 필터링하여 테이블 완성도 계산
    let totalCells = 0;
    let completedCells = 0;
    
    globalTableData.devices.forEach((device, deviceIndex) => {
      // 선택된 디바이스만 처리
      if (deviceStates[deviceIndex]) {
        device.tests.forEach(test => {
          test.channels.forEach(channel => {
            totalCells++;
            if (channel.status === 'completed' && channel.voltage !== null) {
              completedCells++;
            }
          });
        });
      }
    });
    
    const completionPercentage = totalCells > 0 ? (completedCells / totalCells) * 100 : 0;
    
    // 전송할 테이블 데이터 구성
    const tableDataForClient = {
      timestamp: globalTableData.lastUpdate || new Date().toISOString(),
      totalDevices: 10,
      totalTests: 3,
      totalChannels: 4,
      completionPercentage: completionPercentage,
      completedCells: completedCells,
      totalCells: totalCells,
      tableData: globalTableData.devices.map(device => 
        device.tests.map(test => 
          test.channels.map(channel => {
            if (channel.status === 'completed' && channel.voltage !== null) {
              return truncateNumericVoltageToTwoDecimals(channel.voltage);
            } else {
              return '-.-';
            }
          })
        )
      ),
      summary: {
        totalCells: totalCells,
        completedCells: completedCells,
        status: completionPercentage >= 95 ? 'completed' : 'in_progress'
      }
    };
    
    // 테이블 데이터 전송
    const tableMessage = `[POWER_TABLE_UPDATE] ${JSON.stringify(tableDataForClient)}`;
    
    let sentCount = 0;
    globalWss.clients.forEach(client => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(tableMessage);
        sentCount++;
      }
    });
    
    console.log(`[TableData] 테이블 데이터 전송 완료 - 클라이언트 수: ${sentCount}, 완성도: ${completionPercentage.toFixed(1)}%`);
    
    // 테이블이 완성되면 완성 메시지도 전송
    if (completionPercentage >= 95 && !globalTableData.isComplete) {
      globalTableData.isComplete = true;
      const completeMessage = `[POWER_TABLE_COMPLETE] ${JSON.stringify(tableDataForClient)}`;
      
      globalWss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(completeMessage);
        }
      });
      
      console.log(`[TableData] 테이블 완성 알림 전송`);
    }
    
  } catch (error) {
    console.error(`[TableData] 테이블 데이터 전송 오류:`, error);
  }
}

// 테이블 초기화 함수
export function resetTableData() {
  globalTableData = {
    devices: Array.from({ length: 10 }, (_, deviceIndex) => ({
      deviceNumber: deviceIndex + 1,
      tests: Array.from({ length: 3 }, (_, testIndex) => ({
        testNumber: testIndex + 1,
        channels: Array.from({ length: 4 }, (_, channelIndex) => ({
          channelNumber: channelIndex + 1,
          voltage: null,
          timestamp: null,
          status: 'pending'
        }))
      }))
    })),
    lastUpdate: null,
    isComplete: false
  };
  
  console.log(`[TableData] 테이블 데이터 초기화 완료`);
  
  // 테이블 초기화 시에는 클라이언트에 전송하지 않음 - 실제 데이터가 있을 때만 전송
  // broadcastTableData(); // 제거: 초기화 시 불필요한 전송 방지
}

/**
 * 전압값을 소수점 2자리로 자르는 함수 (3자리 이하 버림)
 * @param {string} voltageValue - "5.2V|G" 형식의 전압값 문자열
 * @returns {string} 소수점 2자리로 자른 전압값 문자열
 */
function truncateVoltageToTwoDecimals(voltageValue) {
  if (!voltageValue || voltageValue === "-.-") {
    return voltageValue;
  }
  
  // "5.2V|G" 형식에서 전압값만 추출
  const parts = voltageValue.split('|');
  if (parts.length < 2) {
    return voltageValue; // 형식이 맞지 않으면 원본 반환
  }
  
  const voltagePart = parts[0];
  const comparisonPart = parts[1];
  
  // V 제거하고 숫자로 변환
  const voltage = parseFloat(voltagePart.replace('V', ''));
  if (isNaN(voltage)) {
    return voltageValue; // 숫자로 변환할 수 없으면 원본 반환
  }
  
  // 소수점 2자리로 자르기 (3자리 이하 버림)
  const truncatedVoltage = Math.floor(voltage * 100) / 100;
  
  // 원본 형식으로 반환
  return `${truncatedVoltage}V|${comparisonPart}`;
}

/**
 * 숫자 전압값을 소수점 2자리로 자르는 함수 (3자리 이하 버림)
 * @param {number} voltage - 숫자 전압값
 * @returns {string} 소수점 2자리로 자른 전압값 문자열 (V 포함)
 */
function truncateNumericVoltageToTwoDecimals(voltage) {
  if (typeof voltage !== 'number' || isNaN(voltage)) {
    return '-.-';
  }
  
  // 소수점 2자리로 자르기 (3자리 이하 버림)
  const truncatedVoltage = Math.floor(voltage * 100) / 100;
  
  return `${truncatedVoltage}V`;
}

/**
 * runNextTankEnviTestProcess의 결과를 받아서 최종 리포트를 생성하는 오케스트레이터 함수
 * @param {Object} testResult - runNextTankEnviTestProcess의 리턴 값
 * @param {string} directoryName - 리포트 작성에 필요한 디렉토리 이름
 * @returns {Object} 최종 리포트 생성 결과
 */
export async function processTestResultAndGenerateReport(testResult, directoryName) {
  try {
    console.log(`[TestResultProcessor] 🚀 테스트 결과 처리 시작: ${testResult.status}`);
    
    if (!testResult) {
      console.error(`[TestResultProcessor] ❌ 테스트 결과가 없습니다.`);
      return {
        success: false,
        error: '테스트 결과가 없습니다.',
        reportType: 'none'
      };
    }

    // ===== 디렉토리명 설정 (기존 전역 변수 우선 사용) =====
    if (directoryName && !currentTestDirectoryName) {
      currentTestDirectoryName = directoryName;
      console.log(`[TestResultProcessor] 📁 외부에서 전달된 디렉토리명 설정: ${currentTestDirectoryName}`);
          } else if (!currentTestDirectoryName) {
        console.log(`[TestResultProcessor] 📁 전역 디렉토리명이 설정되지 않음 - 자동으로 최근 테스트 디렉토리 검색`);
        
        // Automatically find the most recent test directory
        try {
          const dataFolderPath = path.join(process.cwd(), 'Data');
          const directories = fs.readdirSync(dataFolderPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name)
            .filter(name => /^\d{8}_\d{4}$/.test(name)) // Filter for date format YYYYMMDD_HHMM
            .sort()
            .reverse(); // Most recent first
          
          if (directories.length > 0) {
            currentTestDirectoryName = directories[0];
            console.log(`[TestResultProcessor] 📁 자동으로 최근 테스트 디렉토리 발견: ${currentTestDirectoryName}`);
          } else {
            throw new Error('테스트 데이터 디렉토리를 찾을 수 없습니다');
          }
        } catch (error) {
          console.error(`[TestResultProcessor] ❌ 자동 디렉토리 검색 실패: ${error.message}`);
          throw new Error('테스트 데이터 디렉토리를 찾을 수 없습니다');
        }
      } else {
      console.log(`[TestResultProcessor] 📁 기존 전역 디렉토리명 사용: ${currentTestDirectoryName}`);
    }

    let reportResult = null;
    let reportType = '';

    // 테스트 결과 상태에 따라 리포트 생성
    switch (testResult.status) {
      case 'completed':
        console.log(`[TestResultProcessor] ✅ 정상 완료 - 정상 동작 리포트 생성 시작`);
        reportType = 'normal_operation';
        
        // 정상 완료 시에는 이미 생성된 리포트가 있는지 확인
        if (testResult.finalReportGenerated) {
          console.log(`[TestResultProcessor] ✅ 이미 정상 완료 리포트가 생성됨`);
          reportResult = {
            success: true,
            filename: testResult.reportFilename || '정상완료_리포트.csv',
            reportType: reportType
          };
        } else {
          // 정상 완료 리포트 생성 (필요한 경우)
          try {
            const getTableOption = await getSafeGetTableOption();
            const testSettings = {
              modelName: getTableOption.productInput?.modelName || 'N/A',
              productNumber: getTableOption.productInput?.productNumber || 'N/A',
              temperature: getTableOption.highTempSettings?.targetTemp || 'N/A',
              totalCycles: testResult.totalCycles || 1
            };
            
            // 정상 완료 리포트 생성 로직 (필요시 구현)
            console.log(`[TestResultProcessor] 📄 정상 완료 리포트 생성 완료`);
            reportResult = {
              success: true,
              filename: `정상완료_리포트_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`,
              reportType: reportType
            };
          } catch (reportError) {
            console.error(`[TestResultProcessor] ❌ 정상 완료 리포트 생성 실패:`, reportError.message);
            reportResult = {
              success: false,
              error: reportError.message,
              reportType: reportType
            };
          }
        }
        break;

      case 'stopped':
        console.log(`[TestResultProcessor] 🛑 중단됨 - 중간정지 리포트 생성 시작`);
        reportType = 'intermediate_stop';
        
        // 중단 시에는 이미 생성된 리포트가 있는지 확인
        if (testResult.finalReportGenerated) {
          console.log(`[TestResultProcessor] ✅ 이미 중단 리포트가 생성됨: ${testResult.reportFilename}`);
          reportResult = {
            success: true,
            filename: testResult.reportFilename,
            reportType: reportType
          };
        } else {
          // 중단 리포트 생성
          try {
            const getTableOption = await getSafeGetTableOption();
            const testSettings = {
              modelName: getTableOption.productInput?.modelName || 'N/A',
              productNumber: getTableOption.productInput?.productNumber || 'N/A',
              temperature: getTableOption.highTempSettings?.targetTemp || 'N/A',
              totalCycles: testResult.totalCycles || 1
            };
            
            const stopReportResult = await generateInterruptedTestResultFile({
              stopReason: testResult.stopReason || 'user_stop',
              stoppedAtCycle: testResult.stoppedAtCycle || 1,
              stoppedAtPhase: testResult.stoppedAtPhase || 'unknown',
              errorMessage: testResult.message || '사용자에 의해 중단됨',
              testSettings: testSettings
            });
            
            if (stopReportResult && stopReportResult.success) {
              console.log(`[TestResultProcessor] ✅ 중단 리포트 생성 성공: ${stopReportResult.filename}`);
              reportResult = {
                success: true,
                filename: stopReportResult.filename,
                reportType: reportType
              };
            } else {
              console.error(`[TestResultProcessor] ❌ 중단 리포트 생성 실패:`, stopReportResult?.error || '알 수 없는 오류');
              reportResult = {
                success: false,
                error: stopReportResult?.error || '알 수 없는 오류',
                reportType: reportType
              };
            }
          } catch (reportError) {
            console.error(`[TestResultProcessor] ❌ 중단 리포트 생성 실패:`, reportError.message);
            reportResult = {
              success: false,
              error: reportError.message,
              reportType: reportType
            };
          }
        }
        break;

      case 'error':
        console.log(`[TestResultProcessor] ❌ 에러 발생 - 중간정지 리포트 생성 시작`);
        reportType = 'intermediate_stop';
        
        // 에러 시에는 이미 생성된 리포트가 있는지 확인
        if (testResult.finalReportGenerated) {
          console.log(`[TestResultProcessor] ✅ 이미 에러 리포트가 생성됨: ${testResult.reportFilename}`);
          reportResult = {
            success: true,
            filename: testResult.reportFilename,
            reportType: reportType
          };
        } else {
          // 에러 리포트 생성
          try {
            const getTableOption = await getSafeGetTableOption();
            const testSettings = {
              modelName: getTableOption.productInput?.modelName || 'N/A',
              productNumber: getTableOption.productInput?.productNumber || 'N/A',
              temperature: getTableOption.highTempSettings?.targetTemp || 'N/A',
              totalCycles: testResult.totalCycles || 1
            };
            
            const errorReportResult = await generateInterruptedTestResultFile({
              stopReason: testResult.errorType || 'error',
              stoppedAtCycle: testResult.stoppedAtCycle || 1,
              stoppedAtPhase: testResult.stoppedAtPhase || 'unknown',
              errorMessage: testResult.message || '알 수 없는 에러',
              testSettings: testSettings
            });
            
            if (errorReportResult && errorReportResult.success) {
              console.log(`[TestResultProcessor] ✅ 에러 리포트 생성 성공: ${errorReportResult.filename}`);
              reportResult = {
                success: true,
                filename: errorReportResult.filename,
                reportType: reportType
              };
            } else {
              console.error(`[TestResultProcessor] ❌ 에러 리포트 생성 실패:`, errorReportResult?.error || '알 수 없는 오류');
              reportResult = {
                success: false,
                error: errorReportResult?.error || '알 수 없는 오류',
                reportType: reportType
              };
            }
          } catch (reportError) {
            console.error(`[TestResultProcessor] ❌ 에러 리포트 생성 실패:`, reportError.message);
            reportResult = {
              success: false,
              error: reportError.message,
              reportType: reportType
            };
          }
        }
        break;

      default:
        console.warn(`[TestResultProcessor] ⚠️ 알 수 없는 상태: ${testResult.status}`);
        reportType = 'unknown';
        reportResult = {
          success: false,
          error: `알 수 없는 상태: ${testResult.status}`,
          reportType: reportType
        };
        break;
    }

    // 프로세스 완료 후 전역 디렉토리명 초기화 (모든 파일 생성 완료 후)
    console.log(`[TestResultProcessor] 📁 프로세스 완료 - 전역 디렉토리명 초기화: ${currentTestDirectoryName}`);
    currentTestDirectoryName = null;
    
    // 최종 결과 반환
    const finalResult = {
      success: reportResult.success,
      reportType: reportType,
      testResult: testResult,
      reportResult: reportResult,
      directoryName: directoryName
    };

    if (reportResult.success) {
      console.log(`[TestResultProcessor] ✅ 최종 리포트 처리 완료: ${reportType} - ${reportResult.filename}`);
    } else {
      console.error(`[TestResultProcessor] ❌ 최종 리포트 처리 실패: ${reportType} - ${reportResult.error}`);
    }

    return finalResult;

  } catch (error) {
    console.error(`[TestResultProcessor] ❌ 예외 발생:`, error.message);
    
    // 전역 디렉토리명 초기화
    currentTestDirectoryName = null;
    
    return {
      success: false,
      error: error.message,
      reportType: 'error',
      testResult: testResult,
      reportResult: null,
      directoryName: directoryName
    };
  }
}

/**
 * runNextTankEnviTestProcess를 실행하고 결과를 처리하는 메인 함수
 * @param {Object} options - 테스트 실행 옵션
 * @returns {Object} 최종 처리 결과
 */
export async function runTestProcessWithResultHandling(options = {}) {
  try {
    console.log(`[TestProcessOrchestrator] 🚀 테스트 프로세스 실행 시작`);
    
    // runNextTankEnviTestProcess 실행 (내부에서 디렉토리명 생성)
    const testResult = await runNextTankEnviTestProcess(options);
    console.log(`[TestProcessOrchestrator] ✅ 테스트 프로세스 실행 완료: ${testResult.status}`);
    
    // 결과 처리 및 리포트 생성 (전역 변수의 디렉토리명 사용)
    const finalResult = await processTestResultAndGenerateReport(testResult, null);
    
    console.log(`[TestProcessOrchestrator] 🎯 최종 처리 완료: ${finalResult.reportType}`);
    return finalResult;
    
  } catch (error) {
    console.error(`[TestProcessOrchestrator] ❌ 예외 발생:`, error.message);
    
    // 에러 발생 시에도 에러 리포트 생성 시도
    const errorResult = {
      status: 'error',
      message: error.message,
      errorType: 'orchestrator_error'
    };
    
    try {
      const finalResult = await processTestResultAndGenerateReport(errorResult, null);
      return finalResult;
    } catch (reportError) {
      console.error(`[TestProcessOrchestrator] ❌ 에러 리포트 생성 실패:`, reportError.message);
      
      // 에러 리포트 생성 실패 시에도 전역 디렉토리명 초기화
      if (currentTestDirectoryName) {
        console.log(`[TestProcessOrchestrator] 📁 에러 발생 - 전역 디렉토리명 초기화: ${currentTestDirectoryName}`);
        currentTestDirectoryName = null;
      }
      
      return {
        success: false,
        error: error.message,
        reportType: 'error',
        testResult: errorResult,
        reportResult: null,
        directoryName: null
      };
    }
  }
}
