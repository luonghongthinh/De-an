require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sql = require('mssql');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

// ========== Cấu hình ==========  
const config = {
  server: 'LHT',  
  database: 'DEAN',         
  options: { 
    encrypt: false,
    trustServerCertificate: true,
    trustedConnection: true,  
         
  
  },
  pool: { 
    max: 10, 
    min: 0, 
    idleTimeoutMillis: 30000 
  }
};

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '24112004'; 
const COM_PORT = process.env.COM_PORT || 'COM3';  
const BAUD_RATE = 9600;

let isOBDConnected = false;
let currentSpeed = null;

// ========== Khởi tạo ==========  
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000", // Khớp với frontend
    methods: ["GET", "POST"]
  }
});const pool = new sql.ConnectionPool(config);

// ========== Middleware ==========  
app.use(express.json());
app.use(cors({
  origin: 'http://localhost:3000', 
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

const authenticate = (req, res, next) => {
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

// ========== Kết nối database ==========  
pool.connect()
  .then(() => console.log('✅ Đã kết nối SQL Server'))
  .catch(err => {
    console.error('❌ Lỗi kết nối database:', err);
    process.exit(1);
  });

// ========== OBD-II SerialPort ==========  
class OBDConnector {
  constructor() {
    this.port = null;
    this.parser = null;
    this.retries = 0;
    this.maxRetries = 5;
  }

  async connect() {
    try {
      this.port = new SerialPort({ path: COM_PORT, baudRate: BAUD_RATE, autoOpen: false });

      await new Promise((resolve, reject) => {
        this.port.open(err => {
          if (err) return reject(err);
          console.log('✅ OBD-II Serial Port đã mở');
          resolve();
        });
      });

      this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r\n' }));
      this.setupHandlers();
      this.retries = 0;
      return true;
    } catch (err) {
      console.error(`⛔ Kết nối thất bại (lần ${this.retries + 1}/${this.maxRetries}):`, err);
      if (this.retries++ < this.maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.connect();
      }
      throw new Error('Vượt quá số lần thử kết nối');
    }
  }

  setupHandlers() {
    this.port.on('error', err => {
      console.error('Lỗi Serial Port:', err);
      this.reconnect();
    });
  
    this.parser.on('data', line => {
      const speed = parseFloat(line);
      if (!isNaN(speed)) {
        currentSpeed = speed;
        isOBDConnected = true;
        console.log(`🚗 Tốc độ hiện tại: ${speed} km/h`);
        // Chỉ emit khi có dữ liệu mới
        io.of('/obd').emit('obd-data', { 
          speed: speed,
          timestamp: new Date().toISOString()
        });
      }
    });
  }
  async reconnect() {
    if (this.port?.isOpen) await this.port.close();
    await this.connect();
  }
}

const obdConnector = new OBDConnector();

// ========== WebSocket ==========  
io.of('/obd').on('connection', (socket) => {
  console.log('📡 Client kết nối tới /obd');
  socket.on('disconnect', () => {
    clearInterval(interval);
    console.log('🔌 Client ngắt kết nối /obd');
  });
});

// ========== API ==========  

// Test server
app.get('/api/health', (req, res) => res.json({ status: 'OK' }));

// Lấy giới hạn tốc độ
app.get('/api/settings', authenticate, async (req, res) => {
  try {
    const result = await pool.request()
      .query(`SELECT TOP 1 speed_limit FROM settings ORDER BY updated_at DESC`);
    res.json({ 
      speed_limit: result.recordset[0]?.speed_limit || 60 // Giá trị mặc định
    });
  } catch (err) {
    console.error('Lỗi khi lấy speed limit:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cập nhật giới hạn tốc độ
app.post('/api/speed-limit', authenticate, async (req, res) => {
  const { speedLimit } = req.body;
  if (speedLimit < 0 || speedLimit > 200) {
    return res.status(400).json({ error: 'Invalid speed limit' });
  }

  try {
    await pool.request()
      .input('speedLimit', sql.Int, speedLimit)
      .query(`INSERT INTO settings (speed_limit) VALUES (@speedLimit)`);
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('Lỗi DB:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Lấy lịch sử cảnh báo
app.get('/api/history', authenticate, async (req, res) => {
  try {
    const result = await pool.request().query(`
      SELECT TOP 10 * FROM history ORDER BY timestamp DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('Lỗi DB:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Ghi dữ liệu tốc độ
app.post('/api/history', authenticate, async (req, res) => {
  const { actual_speed, limit_speed, driver_name } = req.body;

  if (
    typeof actual_speed !== 'number' ||
    typeof limit_speed !== 'number' ||
    typeof driver_name !== 'string' ||
    driver_name.trim() === ''
  ) {
    return res.status(400).json({ error: 'Thiếu dữ liệu hợp lệ' });
  }

  try {
    await pool.request()
      .input('actual_speed', sql.Float, actual_speed)
      .input('limit_speed', sql.Int, limit_speed)
      .input('driver_name', sql.NVarChar, driver_name)
      .query(`
        INSERT INTO history (actual_speed, limit_speed, driver_name)
        VALUES (@actual_speed, @limit_speed, @driver_name)
      `);
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('Lỗi DB:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== Khởi động Server ==========  
async function startServer() {
  try {
    await obdConnector.connect();
    server.listen(PORT, () => {
      console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Không thể khởi động server:', err);
    process.exit(1);
  }
}
startServer();
