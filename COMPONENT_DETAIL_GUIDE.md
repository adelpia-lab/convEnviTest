# ConvEnviTest 컴포넌트별 상세 가이드

## 📋 개요

이 문서는 ConvEnviTest 시스템의 각 UI 컴포넌트별 상세한 기능과 사용법을 설명합니다.

---

## 🏷️ 헤더 컴포넌트 (Header Components)

### LogoImage 컴포넌트
```typescript
// LogoImage.tsx
interface LogoImageProps {
  variant?: 'default' | 'debug';
  size?: 'small' | 'medium' | 'large';
}
```

#### 기능
- **브랜드 표시**: APPIA 로고와 슬로건 표시
- **반응형 크기**: 화면 크기에 따른 자동 크기 조정
- **디버그 모드**: 개발 시 디버그 정보 표시

#### 사용법
```jsx
<LogoImage variant="default" size="medium" />
```

### WebSocket 상태 표시
```typescript
// WebSocket 상태 컴포넌트
interface WebSocketStatusProps {
  isConnected: boolean;
  lastMessage?: string;
  connectionTime?: Date;
}
```

#### 기능
- **연결 상태**: 실시간 WebSocket 연결 상태 표시
- **마지막 메시지**: 최근 수신된 메시지 표시
- **연결 시간**: 연결 시작 시간 표시

---

## 🎛️ 상단 제어 바 컴포넌트들

### DeviceSelect 컴포넌트
```typescript
// DeviceSelect.tsx
interface DeviceSelectProps {
  selectedDevices: number[];
  onDeviceChange: (devices: number[]) => void;
  maxDevices?: number;
}
```

#### 기능
- **다중 선택**: 여러 장비를 동시에 선택 가능
- **체크박스 UI**: 직관적인 체크박스 인터페이스
- **선택 제한**: 최대 선택 가능한 장비 수 제한

#### 사용법
```jsx
<DeviceSelect 
  selectedDevices={[2, 4, 6, 8, 10]}
  onDeviceChange={handleDeviceChange}
  maxDevices={10}
/>
```

### TemperatureDisplay 컴포넌트
```typescript
// 온도 표시 컴포넌트
interface TemperatureDisplayProps {
  temperature: number;
  unit: 'celsius' | 'fahrenheit';
  precision?: number;
  isRealTime?: boolean;
}
```

#### 기능
- **실시간 업데이트**: 온도 변화를 실시간으로 표시
- **단위 변환**: 섭씨/화씨 단위 변환 지원
- **정밀도 설정**: 소수점 자릿수 설정 가능

#### 사용법
```jsx
<TemperatureDisplay 
  temperature={22.06}
  unit="celsius"
  precision={2}
  isRealTime={true}
/>
```

### ControlButtons 컴포넌트
```typescript
// 제어 버튼 컴포넌트
interface ControlButtonsProps {
  onTest: () => void;
  onStatusCheck: () => void;
  onAddData: () => void;
  onReset: () => void;
  dataCount: number;
  isTestRunning: boolean;
}
```

#### 기능
- **테스트 실행**: 수동 테스트 시작/중지
- **상태 확인**: 시스템 상태 점검
- **데이터 관리**: 테스트 데이터 추가/초기화
- **실행 상태**: 테스트 진행 상태 표시

---

## 📊 데이터 테이블 컴포넌트

### PowerTable 컴포넌트
```typescript
// PowerTable.tsx
interface PowerTableProps {
  data: PowerTableData[];
  onRowClick?: (row: PowerTableData) => void;
  onCellEdit?: (rowIndex: number, column: string, value: any) => void;
  isEditable?: boolean;
}
```

#### 데이터 구조
```typescript
interface PowerTableData {
  input: string;      // 입력 전압 (예: "+24V")
  output: string;     // 출력 전압 (예: "+5V")
  dev01: string;      // 장비 1 상태
  dev02: string;      // 장비 2 상태
  // ... dev03 ~ dev10
  good: 'A' | 'F' | 'P'; // 테스트 결과
}
```

#### 기능
- **실시간 데이터**: WebSocket을 통한 실시간 데이터 업데이트
- **편집 가능**: 셀 클릭으로 값 편집 가능
- **정렬 기능**: 컬럼별 정렬 지원
- **필터링**: 특정 조건으로 데이터 필터링

#### 사용법
```jsx
<PowerTable 
  data={powerData}
  onRowClick={handleRowClick}
  onCellEdit={handleCellEdit}
  isEditable={true}
/>
```

### 테이블 컬럼 설명

#### 입력/출력 전압 컬럼
- **입력 전압**: 테스트에 사용되는 기준 전압
- **출력 전압**: 각 채널에서 출력되는 전압값
- **단위**: V (볼트) 단위로 표시

#### 장비 상태 컬럼 (dev01 ~ dev10)
- **"--"**: 장비 비활성화 상태
- **실제 값**: 측정된 전압값 (예: "5.2V")
- **오류 표시**: 연결 오류 시 "ERR" 표시

#### 테스트 결과 컬럼 (GOOD)
- **"A"**: 테스트 통과 (Accept)
- **"F"**: 테스트 실패 (Fail)
- **"P"**: 테스트 진행 중 (Progress)

---

## ⚙️ 설정 패널 컴포넌트들

### InputVoltageSettings 컴포넌트
```typescript
// 입력 전압 설정 컴포넌트
interface InputVoltageSettingsProps {
  voltages: number[];
  onVoltageChange: (index: number, value: number) => void;
  onSave: () => void;
  onRead: () => void;
}
```

#### 기능
- **4개 입력 전압**: 테스트용 입력 전압 설정
- **실시간 검증**: 입력값 범위 검증 (0-50V)
- **저장/읽기**: 설정값 저장 및 불러오기

#### 사용법
```jsx
<InputVoltageSettings 
  voltages={[24, 18, 30, 40]}
  onVoltageChange={handleVoltageChange}
  onSave={handleSave}
  onRead={handleRead}
/>
```

### TemperatureSettings 컴포넌트
```typescript
// 온도 설정 컴포넌트
interface TemperatureSettingsProps {
  type: 'high' | 'low';
  enabled: boolean;
  temperature: number;
  waitTime: number;
  cycles: number;
  onToggle: (enabled: boolean) => void;
  onTemperatureChange: (temp: number) => void;
  onWaitTimeChange: (time: number) => void;
  onCyclesChange: (cycles: number) => void;
  onSave: () => void;
  onRead: () => void;
}
```

#### 기능
- **고온/저온 설정**: 온도 테스트 조건 설정
- **토글 스위치**: 온도 테스트 활성화/비활성화
- **범위 검증**: 온도 범위 검증 (-99°C ~ 99°C)
- **대기 시간**: 온도 도달 후 대기 시간 설정
- **반복 횟수**: 테스트 반복 횟수 설정

#### 사용법
```jsx
<TemperatureSettings 
  type="high"
  enabled={true}
  temperature={-99}
  waitTime={60}
  cycles={2}
  onToggle={handleToggle}
  onTemperatureChange={handleTempChange}
  onWaitTimeChange={handleWaitTimeChange}
  onCyclesChange={handleCyclesChange}
  onSave={handleSave}
  onRead={handleRead}
/>
```

### UsbPortSettings 컴포넌트
```typescript
// USB 포트 설정 컴포넌트
interface UsbPortSettingsProps {
  ports: {
    chamber: string;
    power: string;
    load: string;
    relay: string;
  };
  onPortChange: (device: string, port: string) => void;
  onSave: () => void;
  availablePorts: string[];
}
```

#### 기능
- **포트 매핑**: 각 장비별 COM 포트 설정
- **포트 검증**: 사용 가능한 포트 목록 제공
- **연결 상태**: 각 포트의 연결 상태 표시

#### 사용법
```jsx
<UsbPortSettings 
  ports={{
    chamber: 'COM4',
    power: 'COM5',
    load: 'COM3',
    relay: 'COM6'
  }}
  onPortChange={handlePortChange}
  onSave={handleSave}
  availablePorts={['COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6']}
/>
```

---

## 🔧 제어 패널 컴포넌트들

### PowerSwitch 컴포넌트
```typescript
// 전원 스위치 컴포넌트
interface PowerSwitchProps {
  isOn: boolean;
  onToggle: (isOn: boolean) => void;
  isProcessing: boolean;
  wsConnection: WebSocket | null;
}
```

#### 기능
- **전원 제어**: 시스템 전원 ON/OFF 제어
- **실시간 상태**: 서버와 실시간 상태 동기화
- **처리 중 표시**: 테스트 진행 중 상태 표시
- **안전 확인**: 전원 끄기 전 안전 확인

#### 사용법
```jsx
<PowerSwitch 
  isOn={false}
  onToggle={handlePowerToggle}
  isProcessing={false}
  wsConnection={ws}
/>
```

### RelayControl 컴포넌트
```typescript
// 릴레이 제어 컴포넌트
interface RelayControlProps {
  relays: boolean[];
  onRelayToggle: (index: number, state: boolean) => void;
  isEnabled: boolean;
}
```

#### 기능
- **개별 제어**: 각 릴레이 개별 ON/OFF 제어
- **일괄 제어**: 모든 릴레이 동시 제어
- **상태 표시**: 각 릴레이의 현재 상태 표시
- **안전 제한**: 동시 활성화 제한

#### 사용법
```jsx
<RelayControl 
  relays={[false, true, false, true, false, false, false, false, false, false]}
  onRelayToggle={handleRelayToggle}
  isEnabled={true}
/>
```

### VoltageControl 컴포넌트
```typescript
// 전압 제어 컴포넌트
interface VoltageControlProps {
  voltages: number[];
  onVoltageChange: (index: number, value: number) => void;
  isEnabled: boolean;
  maxVoltage?: number;
}
```

#### 기능
- **채널별 설정**: 각 채널별 전압값 설정
- **범위 검증**: 전압 범위 검증 (0-30V)
- **실시간 적용**: 설정값 즉시 적용
- **기본값 복원**: 기본값으로 복원 기능

---

## 📊 모니터링 컴포넌트들

### ReadVolt 컴포넌트
```typescript
// 전압 측정 컴포넌트
interface ReadVoltProps {
  voltages: number[];
  isReading: boolean;
  onRead: () => void;
  lastReadTime?: Date;
}
```

#### 기능
- **실시간 측정**: 각 채널의 전압 실시간 측정
- **측정 상태**: 현재 측정 진행 상태 표시
- **측정 시간**: 마지막 측정 시간 표시
- **오류 표시**: 측정 오류 시 경고 표시

### ReadChamber 컴포넌트
```typescript
// 챔버 온도 측정 컴포넌트
interface ReadChamberProps {
  temperature: number;
  humidity?: number;
  isReading: boolean;
  onRead: () => void;
  lastReadTime?: Date;
}
```

#### 기능
- **온도 측정**: 챔버 내부 온도 측정
- **습도 측정**: 챔버 내부 습도 측정 (선택사항)
- **실시간 업데이트**: 온도 변화 실시간 표시
- **알람 기능**: 설정 온도 도달 시 알람

---

## 🔄 실시간 통신 컴포넌트

### WebSocketClient 컴포넌트
```typescript
// WebSocket 클라이언트 컴포넌트
interface WebSocketClientProps {
  url: string;
  onMessage: (message: any) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onError: (error: Event) => void;
  autoReconnect?: boolean;
  reconnectInterval?: number;
}
```

#### 기능
- **실시간 통신**: 서버와 실시간 데이터 교환
- **자동 재연결**: 연결 끊김 시 자동 재연결
- **메시지 처리**: 서버로부터 받은 메시지 처리
- **연결 상태**: 연결 상태 실시간 모니터링

#### 메시지 타입
```typescript
type WebSocketMessage = 
  | { type: 'VOLTAGE_UPDATE'; data: number[] }
  | { type: 'TEMPERATURE_UPDATE'; data: number }
  | { type: 'RELAY_STATUS'; data: boolean[] }
  | { type: 'TEST_RESULT'; data: TestResult }
  | { type: 'ERROR'; data: string };
```

---

## 🎨 UI/UX 컴포넌트들

### TextButton 컴포넌트
```typescript
// 텍스트 버튼 컴포넌트
interface TextButtonProps {
  text: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
  loading?: boolean;
}
```

#### 기능
- **다양한 스타일**: primary, secondary, danger 스타일
- **크기 조정**: small, medium, large 크기
- **로딩 상태**: 로딩 중 상태 표시
- **비활성화**: disabled 상태 지원

### GroupImage 컴포넌트
```typescript
// 그룹 이미지 컴포넌트
interface GroupImageProps {
  images: string[];
  layout?: 'grid' | 'carousel' | 'stack';
  onImageClick?: (index: number) => void;
  showNavigation?: boolean;
}
```

#### 기능
- **이미지 그룹**: 여러 이미지를 그룹으로 표시
- **레이아웃**: grid, carousel, stack 레이아웃
- **네비게이션**: 이미지 간 이동 기능
- **클릭 이벤트**: 이미지 클릭 시 이벤트 처리

---

## 🔧 유틸리티 컴포넌트들

### useIsClient 훅
```typescript
// 클라이언트 사이드 체크 훅
function useIsClient(): boolean;
```

#### 기능
- **SSR 호환**: 서버 사이드 렌더링 호환성
- **하이드레이션**: 클라이언트 사이드 하이드레이션 처리
- **안전한 렌더링**: 서버와 클라이언트 간 안전한 렌더링

### parsePowerData 유틸리티
```typescript
// 전력 데이터 파싱 유틸리티
function parsePowerDataFile(data: string): PowerTableData[];
```

#### 기능
- **파일 파싱**: 전력 데이터 파일 파싱
- **데이터 변환**: 텍스트 데이터를 구조화된 데이터로 변환
- **오류 처리**: 파싱 오류 시 적절한 오류 처리

---

## 📱 반응형 컴포넌트들

### ResponsiveLayout 컴포넌트
```typescript
// 반응형 레이아웃 컴포넌트
interface ResponsiveLayoutProps {
  children: React.ReactNode;
  breakpoints: {
    mobile: number;
    tablet: number;
    desktop: number;
  };
}
```

#### 기능
- **반응형 레이아웃**: 화면 크기에 따른 레이아웃 조정
- **브레이크포인트**: 모바일, 태블릿, 데스크톱 브레이크포인트
- **자동 조정**: 화면 크기 변경 시 자동 레이아웃 조정

### MobileOptimized 컴포넌트
```typescript
// 모바일 최적화 컴포넌트
interface MobileOptimizedProps {
  children: React.ReactNode;
  isMobile: boolean;
  mobileLayout?: 'stack' | 'grid' | 'carousel';
}
```

#### 기능
- **모바일 최적화**: 모바일 환경에 최적화된 UI
- **터치 친화적**: 터치 인터페이스 최적화
- **성능 최적화**: 모바일 성능 최적화

---

## 🔒 보안 컴포넌트들

### SecureInput 컴포넌트
```typescript
// 보안 입력 컴포넌트
interface SecureInputProps {
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password' | 'number';
  validation?: (value: string) => boolean;
  sanitize?: (value: string) => string;
}
```

#### 기능
- **입력 검증**: 사용자 입력값 검증
- **XSS 방지**: 크로스 사이트 스크립팅 방지
- **데이터 정제**: 입력 데이터 정제 및 필터링
- **보안 강화**: 보안 취약점 방지

---

이 가이드는 ConvEnviTest 시스템의 모든 UI 컴포넌트에 대한 상세한 설명을 제공합니다. 각 컴포넌트의 기능과 사용법을 이해하여 효과적으로 개발하고 사용하시기 바랍니다.
