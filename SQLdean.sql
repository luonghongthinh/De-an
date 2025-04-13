-- Tạo database
CREATE DATABASE DEAN;
GO

-- Sử dụng database
USE DEAN;
GO
CREATE TABLE settings (
    setting_id INT IDENTITY(1,1) PRIMARY KEY,
    speed_limit INT NOT NULL CHECK (speed_limit BETWEEN 0 AND 200),
    updated_at DATETIME2 DEFAULT SYSDATETIME()
);
GO
CREATE TABLE history (
    history_id INT IDENTITY(1,1) PRIMARY KEY,
    [timestamp] DATETIME2 DEFAULT SYSDATETIME(),
    actual_speed FLOAT NOT NULL CHECK (actual_speed >= 0),
    limit_speed INT NOT NULL CHECK (limit_speed BETWEEN 0 AND 200),
    over_speed AS (actual_speed - limit_speed) PERSISTED
);
GO

-- Thêm cột driver_name vào bảng history
ALTER TABLE history
ADD driver_name NVARCHAR(100) NOT NULL DEFAULT 'Unknown';
GO
-- Ví dụ :
INSERT INTO settings (speed_limit) 
VALUES (60);  -- Giới hạn tốc độ 60 km/h

INSERT INTO history (actual_speed, limit_speed)
VALUES (75, 60);  -- Xe chạy 75 km/h vượt giới hạn 60 km/h

-- Lấy 10 cảnh báo gần nhất
SELECT TOP 10 
    actual_speed AS [Tốc độ thực],
    limit_speed AS [Giới hạn],
    over_speed AS [Vượt quá],
    FORMAT([timestamp], 'HH:mm:ss dd/MM/yyyy') AS [Thời gian]
FROM history
ORDER BY [timestamp] DESC;

-- Kiểm tra bảng đã được tạo
SELECT * FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_NAME = 'history';

-- Kiểm tra các cột trong bảng
SELECT COLUMN_NAME, DATA_TYPE 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'history';

-- Thêm dữ liệu mẫu
INSERT INTO history (actual_speed, limit_speed, driver_name)
VALUES 
    (75, 60, 'Nguyễn Văn A'),
    (85, 70, 'Trần Thị B');

select * from history