// ========== Cấu hình chung ==========
const API_URL = 'http://localhost:3000/api';
const MAX_HISTORY_ITEMS = 10;
let isConnectedOBD = false;
let alertHistory = [];
let currentDriver = 'Unknown'; // Mặc định nếu chưa nhập

// Lưu tên tài xế
document.getElementById('save-driver').addEventListener('click', () => {
    const driverName = document.getElementById('driver-name').value.trim();
    if (driverName) {
        currentDriver = driverName;
        alert('Đã lưu tên tài xế!');
    }
});

// Cập nhật hàm addHistoryEntry
function addHistoryEntry(currentSpeed, limitSpeed) {
    const historyItem = document.createElement('li');
    const overSpeed = currentSpeed - limitSpeed;
    const timestamp = formatTime();
    
    historyItem.className = `history-item ${overSpeed >= 5 ? 'danger' : 'warning'}`;
    historyItem.innerHTML = `
        <div class="history-content">
            <span class="time">${timestamp}</span>
            <div class="driver-name">Tài xế: ${currentDriver}</div>
            <div class="speed-details">
                <span class="actual">${currentSpeed}km/h</span>
                <span class="vs">vs</span>
                <span class="limit">${limitSpeed}km/h</span>
            </div>
        </div>
        <span class="over-speed ${overSpeed >= 5 ? 'danger' : 'warning'}">+${overSpeed}km/h</span>
    `;

    // ... phần còn lại giữ nguyên
}
// ========== DOM Elements ==========
const obdSpeedElement = document.getElementById('obd-speed');
const limitSpeedElement = document.getElementById('limit-speed');
const obdCircle = document.getElementById('obd-circle');
const limitCircle = document.getElementById('limit-circle');
const limitInput = document.getElementById('limit-input');
const statusMessage = document.getElementById('status');
const historyList = document.getElementById('history-list');
const connectBtn = document.getElementById('connect-btn');

// ========== Quản lý âm thanh ==========
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
let lastAlertTime = 0;

// ========== WebSocket Connection ==========
let ws;

// ========== Hàm tiện ích ==========
function formatTime(date = new Date()) {
    return date.toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// ========== Xử lý cảnh báo ==========
function createBeep(frequency = 1000, duration = 0.2) {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
    
    gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
}

function speakAlert(text) {
    if (window.speechSynthesis) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'vi-VN';
        speechSynthesis.speak(utterance);
    }
}

// ========== Quản lý lịch sử ==========
function addHistoryEntry(currentSpeed, limitSpeed) {
    const historyItem = document.createElement('li');
    const overSpeed = currentSpeed - limitSpeed;
    const timestamp = formatTime();
    
    historyItem.className = `history-item ${overSpeed >= 5 ? 'danger' : 'warning'}`;
    historyItem.innerHTML = `
        <div class="history-content">
            <span class="time">${timestamp}</span>
            <div class="speed-details">
                <span class="actual">${currentSpeed}km/h</span>
                <span class="vs">vs</span>
                <span class="limit">${limitSpeed}km/h</span>
            </div>
        </div>
        <span class="over-speed ${overSpeed >= 5 ? 'danger' : 'warning'}">+${overSpeed}km/h</span>
    `;

    historyList.prepend(historyItem);
    
    if (historyList.children.length > MAX_HISTORY_ITEMS) {
        historyList.removeChild(historyList.lastChild);
    }
}

// ========== Xử lý tốc độ ==========
async function updateSpeedLimit(speed) {
    try {
        // Chỉ gọi API khi không dùng giả lập
        if (!isSimulationActive) {
            const response = await fetch(`${API_URL}/speed-limit`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({speedLimit: speed})
            });
            if (!response.ok) throw new Error('Lỗi lưu cài đặt');
        }
        
        // Luôn cập nhật giao diện dù có giả lập hay không
        limitSpeedElement.textContent = speed;
        limitCircle.style.backgroundColor = '#4CAF50';
        
        // Kiểm tra lại vi phạm ngay lập tức
        checkSpeedViolation(parseInt(obdSpeedElement.textContent), speed);
        
    } catch (error) {
        console.error('Lỗi:', error);
        statusMessage.textContent = '⚠️ Lỗi kết nối server';
    }
}
function checkSpeedViolation(currentSpeed, limitSpeed) {
    const now = Date.now();
    const difference = currentSpeed - limitSpeed;
    
    if (difference > 0) {
        obdCircle.style.backgroundColor = '#ff4444';
        statusMessage.textContent = '⚠️ Vượt quá tốc độ cho phép!';
        statusMessage.style.color = '#ff4444';
        addHistoryEntry(currentSpeed, limitSpeed);
        
        if (difference >= 5 && now - lastAlertTime > 5000) {
            speakAlert('Cảnh báo! Bạn đã vượt quá tốc độ cho phép');
            lastAlertTime = now;
        } else if (difference >= 1) {
            createBeep();
        }
    } else {
        obdCircle.style.backgroundColor = '#fff';
        statusMessage.textContent = '✅ Đang chạy an toàn';
        statusMessage.style.color = '#4CAF50';
    }
}

// ========== Kết nối OBD-II ==========
async function connectOBD() {
    try {
        if (!navigator.bluetooth) {
            throw new Error('Trình duyệt không hỗ trợ Bluetooth');
        }
        
        const device = await navigator.bluetooth.requestDevice({
            filters: [{services: ['obd_service_uuid']}],
            optionalServices: ['battery_service']
        });
        
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService('obd_service_uuid');
        const characteristic = await service.getCharacteristic('speed_characteristic_uuid');
        
        characteristic.addEventListener('characteristicvaluechanged', event => {
            const speed = event.target.value.getUint8(0);
            obdSpeedElement.textContent = speed;
            checkSpeedViolation(speed, parseInt(limitSpeedElement.textContent));
        });
        
        await characteristic.startNotifications();
        isConnectedOBD = true;
        connectBtn.textContent = '✔️ Đã kết nối';
    } catch (error) {
        console.error('Lỗi kết nối OBD:', error);
        statusMessage.textContent = '❌ Lỗi kết nối thiết bị';
    }
}

// ========== Sự kiện ==========
limitInput.addEventListener('input', (e) => {
    const speed = parseInt(e.target.value);
    
    if (!isNaN(speed) && speed >= 0 && speed <= 200) {
        updateSpeedLimit(speed);
    } else {
        limitSpeedElement.textContent = '--';
        statusMessage.textContent = '⚠️ Giá trị không hợp lệ';
    }
});

connectBtn.addEventListener('click', connectOBD);

// ========== Khởi tạo ==========
document.addEventListener('DOMContentLoaded', () => {
    // Chỉ kết nối WebSocket khi KHÔNG dùng giả lập
    if (!isSimulationActive) {
        ws = new WebSocket('ws://localhost:3000/obd');
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            obdSpeedElement.textContent = data.speed;
            checkSpeedViolation(data.speed, parseInt(limitSpeedElement.textContent));
        };
    }
    
    audioContext.resume().then(() => {
        console.log('Audio context đã sẵn sàng');
    });
});
function toggleSimulation() {
    isSimulationActive = !isSimulationActive;
    const simButton = document.getElementById('toggle-sim');
    const simStatus = document.getElementById('sim-status');
    
    if (isSimulationActive) {
        // Tắt WebSocket nếu đang kết nối
        if (ws) {
            ws.close();
            ws = null;
        }
        
        // Bắt đầu giả lập
        simButton.textContent = '🚦 Tắt giả lập';
        simStatus.textContent = '(Đang bật)';
        
        simulationInterval = setInterval(() => {
            const currentSpeed = parseInt(obdSpeedElement.textContent);
            const newSpeed = currentSpeed + Math.floor(Math.random() * 5 - 2);
            obdSpeedElement.textContent = Math.max(0, newSpeed);
            checkSpeedViolation(newSpeed, parseInt(limitSpeedElement.textContent));
        }, 1500);
    } else {
        // Dừng giả lập
        simButton.textContent = '🚦 Bật giả lập';
        simStatus.textContent = '(Đang tắt)';
        clearInterval(simulationInterval);
    }
}
// Kích hoạt AudioContext khi người dùng click
document.addEventListener('click', () => {
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
});


// ========== Phần giả lập có thể bật/tắt ==========
let isSimulationActive = false;
let simulationInterval = null;

function toggleSimulation() {
    isSimulationActive = !isSimulationActive;
    const simButton = document.getElementById('toggle-sim');
    const simStatus = document.getElementById('sim-status');
    
    if (isSimulationActive) {
        // Bắt đầu giả lập
        simButton.textContent = '🚦 Tắt giả lập';
        simStatus.textContent = '(Đang bật)';
        
        simulationInterval = setInterval(() => {
            const currentSpeed = parseInt(obdSpeedElement.textContent);
            const newSpeed = currentSpeed + Math.floor(Math.random() * 5 - 2);
            obdSpeedElement.textContent = Math.max(0, newSpeed);
            checkSpeedViolation(newSpeed, parseInt(limitSpeedElement.textContent));
        }, 1500);
    } else {
        // Dừng giả lập
        simButton.textContent = '🚦 Bật giả lập';
        simStatus.textContent = '(Đang tắt)';
        clearInterval(simulationInterval);
    }
}

// ========== Sự kiện cho nút giả lập ==========
document.getElementById('toggle-sim').addEventListener('click', toggleSimulation);

// ========== Sửa phần khởi tạo WebSocket ==========
document.addEventListener('DOMContentLoaded', () => {
    // Chỉ kết nối WebSocket khi không dùng giả lập
    if (!isSimulationActive) {
        ws = new WebSocket('ws://localhost:3000/obd');
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            obdSpeedElement.textContent = data.speed;
            checkSpeedViolation(data.speed, parseInt(limitSpeedElement.textContent));
        };
    }
});
